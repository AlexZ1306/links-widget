// Background worker to ensure setIcon works and persists across sessions
const ICON_THEME_KEY = 'iconTheme';
const LINKS_KEY = 'links';
const FOLDERS_KEY = 'folders';
const SYNC_BOOKMARKS_KEY = 'syncBookmarks';
const MAP_LINK_E2C = 'map_link_e2c';
const MAP_LINK_C2E = 'map_link_c2e';
const MAP_FOLDER_E2C = 'map_folder_e2c';
const MAP_FOLDER_C2E = 'map_folder_c2e';
let internalUpdate = false; // guard to skip reacting to our own writes
const pendingExtAdds = new Set(); // ext link IDs just created from browser events

function setActionIconByTheme(theme){
  const t = theme === 'light' ? 'light' : 'dark';
  try{
    const map = {
      "16": chrome.runtime.getURL(t === 'light' ? 'icon_light_16.png' : 'icon_dark_16.png'),
      "32": chrome.runtime.getURL(t === 'light' ? 'icon_light_32.png' : 'icon_dark_32.png'),
      "48": chrome.runtime.getURL(t === 'light' ? 'icon_light_48.png' : 'icon_dark_48.png'),
      "128": chrome.runtime.getURL(t === 'light' ? 'icon_light_128.png' : 'icon_dark_128.png'),
    };
    if (chrome?.action?.setIcon){
      chrome.action.setIcon({ path: map });
    } else if (chrome?.browserAction?.setIcon){
      chrome.browserAction.setIcon({ path: map });
    }
  }catch{}
}

async function init(){
  try{
    const { [ICON_THEME_KEY]: iconTheme = 'dark' } = await chrome.storage.local.get(ICON_THEME_KEY);
    setActionIconByTheme(iconTheme);
  }catch{}
  try{
    // Синхронизация всегда включена (тумблера больше нет)
    await chrome.storage.local.set({ [SYNC_BOOKMARKS_KEY]: true });
  }catch{}
  try{ await syncFromChromeBookmarks(); }catch{}
}

chrome.runtime.onInstalled.addListener(()=>{ init(); });
chrome.runtime.onStartup?.addListener(()=>{ init(); });

try{
  chrome.runtime.onMessage.addListener((msg)=>{
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'iconThemeChanged'){
      setActionIconByTheme(msg.iconTheme);
    }
    if (msg.type === 'syncBookmarksNow'){
      syncFromChromeBookmarks();
    }
    // Extension → Browser operations (from UI)
    if (msg.type === 'extAddLink'){
      extAddLink(msg.link).catch(()=>{});
    }
    if (msg.type === 'extUpdateLink'){
      extUpdateLink(msg.link).catch(()=>{});
    }
    if (msg.type === 'extRemoveLink'){
      extRemoveLink(msg.linkId).catch(()=>{});
    }
    if (msg.type === 'extAddFolder'){
      extAddFolder(msg.folder).catch(()=>{});
    }
  });
}catch{}

// Map Chrome bookmarks tree to our storage format
async function syncFromChromeBookmarks(){
  try{
    const { [SYNC_BOOKMARKS_KEY]: on = false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY);
    if (!on) return;
    // Если уже есть маппинги linkC2E (хотя бы одна запись), считаем, что первичная синхронизация уже происходила и не затираем текущее состояние
    try{
      const st = await chrome.storage.local.get(MAP_LINK_C2E);
      const hasAny = st && st[MAP_LINK_C2E] && Object.keys(st[MAP_LINK_C2E]).length > 0;
      if (hasAny) return;
    }catch{}
    const tree = await chrome.bookmarks.getTree();
    const links = [];
    const folders = [];
    const folderExtByChrome = {}; // chromeId -> extId
    const folderChromeByExt = {}; // extId -> chromeId
    const linkExtByChrome = {};   // chromeId -> extId
    const linkChromeByExt = {};   // extId -> chromeId
    const newId = ()=> (crypto?.randomUUID?.() || String(Date.now()+Math.random()));

    const walk = (nodes, parentFolderId=null)=>{
      for (const n of nodes){
        if (n.url){
          const extId = newId();
          links.push({ id:extId, title:n.title||n.url, url:n.url, favicon:null, iconTone:null, folderId: parentFolderId, createdAt: new Date().toISOString() });
          linkExtByChrome[n.id] = extId;
          linkChromeByExt[extId] = n.id;
        } else {
          const fid = newId();
          folders.push({ id: fid, name: n.title || 'Folder', icon: chrome.runtime.getURL('icon_folder.png'), createdAt: new Date().toISOString(), parentFolderId });
          folderExtByChrome[n.id] = fid;
          folderChromeByExt[fid] = n.id;
          if (Array.isArray(n.children) && n.children.length){
            walk(n.children, fid);
          }
        }
      }
    };
    if (tree && tree[0] && Array.isArray(tree[0].children)){
      walk(tree[0].children, null);
    }
    internalUpdate = true;
    await chrome.storage.local.set({ [LINKS_KEY]: links, [FOLDERS_KEY]: folders, [MAP_FOLDER_C2E]: folderExtByChrome, [MAP_FOLDER_E2C]: folderChromeByExt, [MAP_LINK_C2E]: linkExtByChrome, [MAP_LINK_E2C]: linkChromeByExt });
    internalUpdate = false;
    try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{}
  }catch(err){
    console.error('syncFromChromeBookmarks failed', err);
  }
}

// Removed aggressive full-resync listeners to avoid races; use incremental handlers below

// Helpers to read/write mapping
async function getMaps(){
  const st = await chrome.storage.local.get([MAP_LINK_E2C, MAP_LINK_C2E, MAP_FOLDER_E2C, MAP_FOLDER_C2E]);
  return {
    linkE2C: st[MAP_LINK_E2C] || {},
    linkC2E: st[MAP_LINK_C2E] || {},
    folderE2C: st[MAP_FOLDER_E2C] || {},
    folderC2E: st[MAP_FOLDER_C2E] || {},
  };
}
async function setMaps(m){
  await chrome.storage.local.set({ [MAP_LINK_E2C]: m.linkE2C, [MAP_LINK_C2E]: m.linkC2E, [MAP_FOLDER_E2C]: m.folderE2C, [MAP_FOLDER_C2E]: m.folderC2E });
}

// Add/update/remove from extension to browser
async function getDefaultParentChromeFolderId(){
  // Use Bookmarks Bar ('1') if exists; fallback to '0' (Bookmarks root)
  try{ const nodes = await chrome.bookmarks.getTree(); if(nodes?.[0]?.children?.[0]) return nodes[0].children[0].id; }catch{}
  return '1';
}
async function extAddLink(link){
  const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
  const maps = await getMaps();
  // Если уже есть привязка extId -> chromeId, ничего не делаем (защита от дублей)
  if (maps.linkE2C?.[link.id]) return;
  // Попробуем найти уже существующую закладку с таким URL и привязать к ней, вместо создания дубля
  try{
    const found = await chrome.bookmarks.search({ url: link.url });
    if (Array.isArray(found) && found.length > 0){
      const existing = found.find(n=> n.url === link.url) || found[0];
      if (existing && existing.id){
        maps.linkE2C[link.id] = existing.id; maps.linkC2E[existing.id] = link.id; await setMaps(maps);
        return;
      }
    }
  }catch{}
  const parentChromeId = link.folderId ? (maps.folderE2C?.[link.folderId] || await getDefaultParentChromeFolderId()) : await getDefaultParentChromeFolderId();
  const created = await chrome.bookmarks.create({ parentId: String(parentChromeId), title: link.title || link.url, url: link.url });
  maps.linkE2C[link.id] = created.id; maps.linkC2E[created.id] = link.id; await setMaps(maps);
}
async function extUpdateLink(link){
  const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
  const maps = await getMaps();
  const chromeId = maps.linkE2C?.[link.id]; if(!chromeId) return;
  await chrome.bookmarks.update(String(chromeId), { title: link.title, url: link.url });
}
async function extRemoveLink(linkId){
  const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
  const maps = await getMaps(); const chromeId = maps.linkE2C?.[linkId]; if(!chromeId) return;
  try{ await chrome.bookmarks.remove(String(chromeId)); }catch(e){ console.warn('Failed to remove chrome bookmark', e); }
  delete maps.linkE2C[linkId]; delete maps.linkC2E[chromeId]; await setMaps(maps);
}

async function extAddFolder(folder){
  const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
  const maps = await getMaps();
  const parentChromeId = folder.parentFolderId ? (maps.folderE2C?.[folder.parentFolderId] || await getDefaultParentChromeFolderId()) : await getDefaultParentChromeFolderId();
  const created = await chrome.bookmarks.create({ parentId: String(parentChromeId), title: folder.name });
  maps.folderE2C[folder.id] = created.id; maps.folderC2E[created.id] = folder.id; await setMaps(maps);
  // Prevent echo when onCreated fires by having mapping ready
}

// Browser → Extension live updates: reflect changes without full rebuild
try{
  chrome.bookmarks.onCreated.addListener(async (id, node)=>{
    const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
    const maps = await getMaps();
    // If already known (created by extension), skip
    if (maps.linkC2E[id] || maps.folderC2E[id]) return;
    // Map parent
    const parentExt = node.parentId && maps.folderC2E[node.parentId] ? maps.folderC2E[node.parentId] : null;
    if (node.url){
      const extId = crypto?.randomUUID?.() || String(Date.now()+Math.random());
      const links = (await chrome.storage.local.get(LINKS_KEY))[LINKS_KEY] || [];
      links.push({ id: extId, title: node.title||node.url, url: node.url, favicon: null, iconTone: null, folderId: parentExt, createdAt: new Date().toISOString() });
      pendingExtAdds.add(extId);
      internalUpdate = true; await chrome.storage.local.set({ [LINKS_KEY]: links }); internalUpdate = false;
      maps.linkC2E[id] = extId; maps.linkE2C[extId] = id; await setMaps(maps);
      try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{}
    } else {
      const extFolderId = crypto?.randomUUID?.() || String(Date.now()+Math.random());
      const folders = (await chrome.storage.local.get(FOLDERS_KEY))[FOLDERS_KEY] || [];
      folders.push({ id: extFolderId, name: node.title||'Folder', icon: chrome.runtime.getURL('icon_folder.png'), createdAt: new Date().toISOString(), parentFolderId: parentExt });
      internalUpdate = true; await chrome.storage.local.set({ [FOLDERS_KEY]: folders }); internalUpdate = false;
      maps.folderC2E[id] = extFolderId; maps.folderE2C[extFolderId] = id; await setMaps(maps);
      try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{}
    }
  });

  chrome.bookmarks.onRemoved.addListener(async (id, removeInfo)=>{
    const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
    const maps = await getMaps();
    // Link
    const extId = maps.linkC2E[id];
    if (extId){
      const links = (await chrome.storage.local.get(LINKS_KEY))[LINKS_KEY] || [];
      const i = links.findIndex(l=>l.id===extId); if(i>=0){ links.splice(i,1); internalUpdate = true; await chrome.storage.local.set({ [LINKS_KEY]: links }); internalUpdate = false; }
      delete maps.linkC2E[id]; delete maps.linkE2C[extId]; await setMaps(maps);
      try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{}
      return;
    }
    // Folder
    const extFolderId = maps.folderC2E[id];
    if (extFolderId){
      const folders = (await chrome.storage.local.get(FOLDERS_KEY))[FOLDERS_KEY] || [];
      const nf = folders.filter(f=>f.id!==extFolderId); internalUpdate = true; await chrome.storage.local.set({ [FOLDERS_KEY]: nf }); internalUpdate = false;
      // Also remove links inside this folder
      const links = (await chrome.storage.local.get(LINKS_KEY))[LINKS_KEY] || [];
      const nlinks = links.filter(l=>l.folderId!==extFolderId); internalUpdate = true; await chrome.storage.local.set({ [LINKS_KEY]: nlinks }); internalUpdate = false;
      delete maps.folderC2E[id]; delete maps.folderE2C[extFolderId]; await setMaps(maps);
      try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{}
    }
  });

  chrome.bookmarks.onChanged.addListener(async (id, changeInfo)=>{
    const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
    const maps = await getMaps();
    const extId = maps.linkC2E[id];
    if (extId){
      const links = (await chrome.storage.local.get(LINKS_KEY))[LINKS_KEY] || [];
      const i = links.findIndex(l=>l.id===extId); if(i>=0){ links[i] = { ...links[i], title: changeInfo.title || links[i].title, url: changeInfo.url || links[i].url }; internalUpdate = true; await chrome.storage.local.set({ [LINKS_KEY]: links }); internalUpdate = false; try{ chrome.runtime.sendMessage({ type:'bookmarksSynced' }); }catch{} }
    }
  });
}catch{}

// Mirror extension local changes into browser (diff-based)
try{
  chrome.storage.onChanged.addListener(async (changes, area)=>{
    if (area !== 'local' || !changes[LINKS_KEY]) return;
    if (internalUpdate) return; // skip our own writes to avoid echo duplicates
    const { [SYNC_BOOKMARKS_KEY]: on=false } = await chrome.storage.local.get(SYNC_BOOKMARKS_KEY); if(!on) return;
    const oldArr = changes[LINKS_KEY].oldValue || [];
    const newArr = changes[LINKS_KEY].newValue || [];
    const oldMap = Object.fromEntries(oldArr.map(x=>[x.id,x]));
    const newMap = Object.fromEntries(newArr.map(x=>[x.id,x]));
    const maps = await getMaps();
    // removed
    for (const id in oldMap){ if (!newMap[id]){ try{ await extRemoveLink(id); }catch{} } }
    // added
    for (const id in newMap){
      if (!oldMap[id]){
        if (pendingExtAdds.has(id)){ pendingExtAdds.delete(id); continue; }
        // Если уже существует привязка (например, нашли ранее существующую в Chrome) — пропускаем
        if (maps.linkE2C && maps.linkE2C[id]){ continue; }
        try{ await extAddLink(newMap[id]); }catch{}
      }
    }
    // updated
    for (const id in newMap){ if (oldMap[id]){ const a=oldMap[id], b=newMap[id]; if (a.title!==b.title || a.url!==b.url){ try{ await extUpdateLink(b); }catch{} } } }
  });
}catch{}








