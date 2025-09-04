const TILE_PERCENT_KEY = "tilePercent"; // user-facing 10..100
const TILE_OPACITY_KEY = "tileOpacity"; // user-facing 0..100
const FOLDER_OPACITY_KEY = "folderOpacity"; // user-facing 0..100
const FAVICON_SATURATION_KEY = "faviconSaturation"; // user-facing 0..100
const BASE_TILE_PX = 56;
const MAX_COLS_KEY = "maxCols"; // user-facing 3..10
const LIST_COLS_KEY = "listCols"; // user-facing 1..5
const SHOW_TITLES_KEY = "showTitles"; // boolean, default false
const BG_TRANSPARENT_KEY = "bgTransparent"; // boolean
const FOOTER_TRANSPARENT_KEY = "footerTransparent"; // boolean
const THEME_KEY = "theme"; // "dark" or "light"
const MIN_INTERNAL = 0.7;
const MAX_INTERNAL = 1.4;
const ICON_THEME_KEY = 'iconTheme'; // 'dark' | 'light'
const SYNC_BOOKMARKS_KEY = 'syncBookmarks'; // boolean

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

function clampUserPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(10, n));
}
function mapRange(x, inMin, inMax, outMin, outMax){
  const t = (x - inMin) / (inMax - inMin);
  const cl = Math.min(1, Math.max(0, isNaN(t)?0:t));
  return outMin + (outMax - outMin) * cl;
}

function applyTilePercentUser(userPercent, {save=true, broadcast=true}={}){
  const user = clampUserPercent(userPercent);
  const internal = mapRange(user, 10, 100, MIN_INTERNAL, MAX_INTERNAL);
  const px = Math.round(BASE_TILE_PX * internal);
  document.documentElement.style.setProperty('--tileSize', px+"px");
  if (save) chrome.storage.local.set({ [TILE_PERCENT_KEY]: user });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'tilePercentChanged', user, px }); }catch{}
}

function clampOpacityPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
function applyTileOpacityUser(userPercent, {save=true, broadcast=false}={}){
  const user = clampOpacityPercent(userPercent);
  const val = Math.min(1, Math.max(0, user/100));
  document.documentElement.style.setProperty('--tileOpacity', String(val));
  if (save) chrome.storage.local.set({ [TILE_OPACITY_KEY]: user });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'tileOpacityChanged', user, val }); }catch{}
}

function applyFolderOpacityUser(userPercent, {save=true, broadcast=false}={}){
  const user = clampOpacityPercent(userPercent);
  const val = Math.min(1, Math.max(0, user/100));
  document.documentElement.style.setProperty('--folderOpacity', String(val));
  if (save) chrome.storage.local.set({ [FOLDER_OPACITY_KEY]: user });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'folderOpacityChanged', user, val }); }catch{}
}

function clampSaturationPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
function applyFaviconSaturationUser(userPercent, {save=true, broadcast=false}={}){
  const user = clampSaturationPercent(userPercent);
  const cssVal = `${user}%`;
  document.documentElement.style.setProperty('--faviconSaturation', cssVal);
  if (save) chrome.storage.local.set({ [FAVICON_SATURATION_KEY]: user });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'faviconSaturationChanged', user, cssVal }); }catch{}
}

function clampMaxCols(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(3, n));
}
function applyMaxCols(userCols, {save=true, broadcast=true}={}){
  const cols = clampMaxCols(userCols);
  document.documentElement.style.setProperty('--cols', String(cols));
  if (save) chrome.storage.local.set({ [MAX_COLS_KEY]: cols });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'maxColsChanged', cols }); }catch{}
}

function clampListCols(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}
function applyListCols(userCols, {save=true, broadcast=true}={}){
  const cols = clampListCols(userCols);
  document.documentElement.style.setProperty('--listCols', String(cols));
  if (save) chrome.storage.local.set({ [LIST_COLS_KEY]: cols });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'listColsChanged', cols }); }catch{}
}

function applyShowTitles(on, {save=true, broadcast=true}={}){
  const val = !!on;
  if (save) chrome.storage.local.set({ [SHOW_TITLES_KEY]: val });
  try{ chrome.runtime.sendMessage({ type:'showTitlesChanged', on: val }); }catch{}
}

function applyWidgetBgTransparency(on, {save=true, broadcast=true}={}){
  const val = !!on;
  if (save) chrome.storage.local.set({ [BG_TRANSPARENT_KEY]: val });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'widgetBgTransparencyChanged', on: val }); }catch{}
}
function applyFooterTransparency(on, {save=true, broadcast=true}={}){
  const val = !!on;
  if (save) chrome.storage.local.set({ [FOOTER_TRANSPARENT_KEY]: val });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'footerTransparencyChanged', on: val }); }catch{}
}

function applyTheme(theme, {save=true, broadcast=true}={}){
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  if (save) chrome.storage.local.set({ [THEME_KEY]: t });
  if (broadcast) try{ chrome.runtime.sendMessage({ type:'themeChanged', theme: t }); }catch{}
}

async function exportLinks(){
  const LINKS_KEY = 'links';
  try{
    const stAll = await chrome.storage.local.get([
      LINKS_KEY,
      TILE_PERCENT_KEY, TILE_OPACITY_KEY, FAVICON_SATURATION_KEY,
      MAX_COLS_KEY, SHOW_TITLES_KEY, THEME_KEY, ICON_THEME_KEY,
      'groups', 'lastGroupId', 'bgTransparent', 'footerTransparent',
      // extra settings and mapping
      'listIconPercent', 'rootViewMode', 'folderDefaultViewMode', 'folderOpacity', 'tileGapPercent', 'autoFavicon', 'map_link_e2c'
    ]);
    const allLinks = Array.isArray(stAll[LINKS_KEY]) ? stAll[LINKS_KEY] : [];
    const mapLinkE2C = stAll['map_link_e2c'] || {};
    // Only export root-level custom (non-Chrome-mapped) links
    const links = allLinks.filter(x => !x?.folderId && !mapLinkE2C[x?.id]);
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: {
        tilePercent: clampUserPercent(stAll[TILE_PERCENT_KEY] ?? 100),
        tileOpacity: clampOpacityPercent(stAll[TILE_OPACITY_KEY] ?? 100),
        faviconSaturation: clampSaturationPercent(stAll[FAVICON_SATURATION_KEY] ?? 100),
        maxCols: clampMaxCols(stAll[MAX_COLS_KEY] ?? 5),
        showTitles: !!(stAll[SHOW_TITLES_KEY]),
        theme: stAll[THEME_KEY] || 'dark',
        iconTheme: stAll[ICON_THEME_KEY] || 'dark',
        bgTransparent: !!(stAll.bgTransparent),
        footerTransparent: !!(stAll.footerTransparent),
        // include extra settings from main widget
        listIconPercent: clampUserPercent(stAll['listIconPercent'] ?? 100),
        rootViewMode: (stAll['rootViewMode']==='list') ? 'list' : 'grid',
        folderDefaultViewMode: (stAll['folderDefaultViewMode']==='list') ? 'list' : 'grid',
        folderOpacity: clampOpacityPercent(stAll['folderOpacity'] ?? 100),
        tileGapPercent: (()=>{ const v = stAll['tileGapPercent']; const def = 50; const n = Math.round(Number(v)); if(!Number.isFinite(n)) return def; return Math.min(100, Math.max(0, n)); })(),
        autoFavicon: !!(stAll['autoFavicon']),
      },
      links: links.map((x, index)=> ({ ...x, index })),
      groups: (Array.isArray(stAll.groups)?stAll.groups:[]).map(g=>({ id:g.id, name:g.name, index:g.index })),
      lastGroupId: stAll.lastGroupId ?? null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='links-widget-export.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }catch(err){ alert('Не удалось выполнить экспорт: ' + (err?.message || String(err))); }
}

function importLinks(){
  const LINKS_KEY = 'links';
  try{
    const input=document.createElement('input'); input.type='file'; input.accept='application/json'; input.style.display='none';
    document.body.appendChild(input);
    input.addEventListener('change', ()=>{
      const file=input.files?.[0]; document.body.removeChild(input); if(!file) return;
      const r=new FileReader(); r.onerror=()=>alert('Ошибка чтения файла.'); r.onload=async ()=>{
        try{
          const json=JSON.parse(String(r.result||''));
          // Map v1/v2 to v3
          let links = [];
          let settings = {};
          let groups = [];
          let lastGroupId = null;
          if (Array.isArray(json.links)) links = json.links;
          else if (Array.isArray(json.items)) links = json.items;
          if (json.settings && typeof json.settings==='object') settings = json.settings; else settings = {
            tilePercent: json.tilePercent,
            tileOpacity: json.tileOpacity,
            faviconSaturation: json.faviconSaturation,
            maxCols: json.maxCols,
            showTitles: json.showTitles,
            iconTheme: json.iconTheme,
            bgTransparent: json.bgTransparent,
            footerTransparent: json.footerTransparent,
          };
          groups = Array.isArray(json.groups)? json.groups : [];
          lastGroupId = json.lastGroupId ?? null;
          if(!links || !Array.isArray(links)) return alert('Неверный формат: нет массива "links".');
          if(!confirm('Импорт заменит корневые пользовательские ссылки. Продолжить?')) return;

          // Merge strategy: keep non-root or Chrome-mapped links, replace only root-level custom ones
          const stNow = await chrome.storage.local.get([LINKS_KEY, 'map_link_e2c']);
          const current = Array.isArray(stNow[LINKS_KEY]) ? stNow[LINKS_KEY] : [];
          const mapE2C = stNow['map_link_e2c'] || {};
          const kept = current.filter(x => x?.folderId || mapE2C[x?.id]);
          const sanitized = links.map(x => ({ ...x, folderId: null }));
          await chrome.storage.local.set({ [LINKS_KEY]: [...kept, ...sanitized], groups, lastGroupId });
          if(typeof settings.tilePercent!== 'undefined'){
            const user = clampUserPercent(settings.tilePercent);
            await chrome.storage.local.set({ [TILE_PERCENT_KEY]: user });
            applyTilePercentUser(user, {save:false});
          }
          if(typeof settings.tileOpacity!== 'undefined'){
            const op = clampOpacityPercent(settings.tileOpacity);
            await chrome.storage.local.set({ [TILE_OPACITY_KEY]: op });
            applyTileOpacityUser(op, {save:false});
          }
          if(typeof settings.faviconSaturation!== 'undefined'){
            const fs = clampSaturationPercent(settings.faviconSaturation);
            await chrome.storage.local.set({ [FAVICON_SATURATION_KEY]: fs });
            applyFaviconSaturationUser(fs, {save:false});
          }
          if(typeof settings.maxCols!== 'undefined'){
            const mc = clampMaxCols(settings.maxCols);
            await chrome.storage.local.set({ [MAX_COLS_KEY]: mc });
            applyMaxCols(mc, {save:false, broadcast:true});
            const r= document.getElementById('maxColsRange'); if(r) r.value=String(mc);
            const i= document.getElementById('maxColsInput'); if(i) i.value=String(mc);
          }
          if(typeof settings.showTitles !== 'undefined'){
            const on = !!settings.showTitles;
            await chrome.storage.local.set({ [SHOW_TITLES_KEY]: on });
            applyShowTitles(on, {save:false, broadcast:true});
            const t = document.getElementById('showTitlesToggle'); if (t) t.checked = on;
          }
          if(typeof settings.theme !== 'undefined'){
            const theme = settings.theme === 'light' ? 'light' : 'dark';
            await chrome.storage.local.set({ [THEME_KEY]: theme });
            applyTheme(theme, {save:false, broadcast:true});
            const t = document.getElementById('themeToggle'); if (t) t.checked = theme === 'light';
          }
          if (typeof settings.iconTheme !== 'undefined'){
            const iconTheme = settings.iconTheme === 'light' ? 'light' : 'dark';
            await chrome.storage.local.set({ [ICON_THEME_KEY]: iconTheme });
            setActionIconByTheme(iconTheme);
            const it = document.getElementById('themeIconToggle'); if (it) it.checked = iconTheme === 'light';
          }
          if (typeof settings.bgTransparent !== 'undefined'){
            applyWidgetBgTransparency(!!settings.bgTransparent, {save:true, broadcast:true});
          }
          if (typeof settings.footerTransparent !== 'undefined'){
            applyFooterTransparency(!!settings.footerTransparent, {save:true, broadcast:true});
          }
          // store additional settings (no immediate apply hooks here)
          const extra = {};
          if (typeof settings.listIconPercent !== 'undefined') extra['listIconPercent'] = clampUserPercent(settings.listIconPercent);
          if (typeof settings.rootViewMode !== 'undefined') extra['rootViewMode'] = (settings.rootViewMode==='list')?'list':'grid';
          if (typeof settings.folderDefaultViewMode !== 'undefined') extra['folderDefaultViewMode'] = (settings.folderDefaultViewMode==='list')?'list':'grid';
          if (typeof settings.folderOpacity !== 'undefined') extra['folderOpacity'] = clampOpacityPercent(settings.folderOpacity);
          if (typeof settings.tileGapPercent !== 'undefined') extra['tileGapPercent'] = clampUserPercent(settings.tileGapPercent);
          if (typeof settings.autoFavicon !== 'undefined') extra['autoFavicon'] = !!settings.autoFavicon;
          if (Object.keys(extra).length){ await chrome.storage.local.set(extra); }
          try{ chrome.runtime.sendMessage({ type:'dataImported' }); }catch{}
          // Enable Save button so user can confirm changes
          try{ const btn = document.getElementById('settingsSave'); if (btn) btn.disabled = false; }catch{}
          alert('Импорт завершён.');
        }catch(e){ alert('Не удалось импортировать: ' + (e?.message || String(e))); }
      }; r.readAsText(file);
    }, { once:true });
    input.click();
  }catch(err){ alert('Не удалось начать импорт: ' + (err?.message || String(err))); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const $range = document.getElementById('tileSizeRange');
  const $input = document.getElementById('tileSizeInput');
  const $opRange = document.getElementById('tileOpacityRange');
  const $opInput = document.getElementById('tileOpacityInput');
  const $foRange = document.getElementById('folderOpacityRange');
  const $foInput = document.getElementById('folderOpacityInput');
  const $fsRange = document.getElementById('faviconSaturationRange');
  const $fsInput = document.getElementById('faviconSaturationInput');
  const $gridColsSelect = document.getElementById('gridColsSelect');
  const $listColsSelect = document.getElementById('listColsSelect');
  const $showTitles = document.getElementById('showTitlesToggle');
  const $themeToggle = document.getElementById('themeToggle');
  const $themeIconToggle = document.getElementById('themeIconToggle');
  const $syncBookmarksToggle = null;
  const $save = document.getElementById('settingsSave');
  const $cancel = document.getElementById('settingsCancel');
  const $close = document.getElementById('btnClose');
  const $exp = document.getElementById('settingsExport');
  const $imp = document.getElementById('settingsImport');

  // --- Tooltips for setting labels (English help) ---
  const TOOLTIP_DELAY_MS = 730;
  function ensureTooltipEl(){
    let el = document.querySelector('.tooltip');
    if (!el){ el = document.createElement('div'); el.className='tooltip'; document.body.appendChild(el); }
    return el;
  }
  function attachTip(labelEl, text){
    if (!labelEl || labelEl.dataset.tipAttached) return;
    labelEl.dataset.tipAttached = '1';
    let timer = 0;
    const show = ()=>{
      const tip = ensureTooltipEl(); tip.textContent = text; tip.classList.add('show');
      const r = labelEl.getBoundingClientRect();
      const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const vh = Math.max(document.documentElement.clientHeight, window.innerHeight||0);
      let left = r.left + (r.width - tip.offsetWidth)/2; left = Math.min(Math.max(4,left), vw - tip.offsetWidth - 4);
      let top = r.bottom + 4; if (top + tip.offsetHeight > vh - 4) top = r.top - tip.offsetHeight - 4; top = Math.min(Math.max(4,top), vh - tip.offsetHeight - 4);
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    const hide = ()=>{ const tip=document.querySelector('.tooltip'); if(tip) tip.classList.remove('show'); };
    labelEl.addEventListener('mouseenter', ()=>{ clearTimeout(timer); timer=setTimeout(show, TOOLTIP_DELAY_MS); });
    labelEl.addEventListener('mouseleave', ()=>{ clearTimeout(timer); hide(); });
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
  }
  // Map labels -> texts
  attachTip(document.querySelector('label[for="tileSizeRange"]'), 'Adjusts tile icon size.');
  attachTip(document.querySelector('label[for="tileOpacityRange"]'), 'Opacity of bookmark tiles background.');
  attachTip(document.querySelector('label[for="folderOpacityRange"]'), 'Opacity of folder tiles background.');
  attachTip(document.querySelector('label[for="faviconSaturationRange"]'), 'Color saturation for favicons (0–100%).');
  attachTip(document.querySelector('label[for="gridColsSelect"]'), 'Maximum number of columns in the grid.');
  attachTip(document.querySelector('label[for="listColsSelect"]'), 'Number of columns in list view (1–5).');
  attachTip(document.querySelector('label[for="showTitlesToggle"]'), 'Show text captions under tiles.');
  attachTip(document.querySelector('label[for="themeIconToggle"]'), 'Switch the extension toolbar icon theme.');
  attachTip(document.querySelector('label[for="themeToggle"]'), 'Switch between light and dark theme.');
  

  const { [TILE_PERCENT_KEY]: p=100 } = await chrome.storage.local.get(TILE_PERCENT_KEY);
  const user = clampUserPercent(p);
  if ($range) $range.value = String(user);
  if ($input) $input.value = String(user);
  applyTilePercentUser(user, {save:false});

  const { [TILE_OPACITY_KEY]: op=100 } = await chrome.storage.local.get(TILE_OPACITY_KEY);
  const opUser = clampOpacityPercent(op);
  if ($opRange) $opRange.value = String(opUser);
  if ($opInput) $opInput.value = String(opUser);
  applyTileOpacityUser(opUser, {save:false});

  const { [FOLDER_OPACITY_KEY]: fo=100 } = await chrome.storage.local.get(FOLDER_OPACITY_KEY);
  const foUser = clampOpacityPercent(fo);
  if ($foRange) $foRange.value = String(foUser);
  if ($foInput) $foInput.value = String(foUser);
  applyFolderOpacityUser(foUser, {save:false});

  const { [FAVICON_SATURATION_KEY]: fs=100 } = await chrome.storage.local.get(FAVICON_SATURATION_KEY);
  const fsUser = clampSaturationPercent(fs);
  if ($fsRange) $fsRange.value = String(fsUser);
  if ($fsInput) $fsInput.value = String(fsUser);
  applyFaviconSaturationUser(fsUser, {save:false});

  const { [MAX_COLS_KEY]: mc=5 } = await chrome.storage.local.get(MAX_COLS_KEY);
  const mcUser = clampMaxCols(mc);
  if ($gridColsSelect) $gridColsSelect.value = String(mcUser);
  applyMaxCols(mcUser, {save:false});

  const { [LIST_COLS_KEY]: lc=1 } = await chrome.storage.local.get(LIST_COLS_KEY);
  const lcUser = clampListCols(lc);
  if ($listColsSelect) $listColsSelect.value = String(lcUser);
  applyListCols(lcUser, {save:false});

  const { [SHOW_TITLES_KEY]: st=false } = await chrome.storage.local.get(SHOW_TITLES_KEY);
  if ($showTitles) $showTitles.checked = !!st;

  const { [THEME_KEY]: theme='dark' } = await chrome.storage.local.get(THEME_KEY);
  if ($themeToggle) $themeToggle.checked = theme === 'light';
  applyTheme(theme, {save:false});

  // init theme icon toggle
  const { [ICON_THEME_KEY]: iconTheme = 'dark' } = await chrome.storage.local.get(ICON_THEME_KEY);
  if ($themeIconToggle) $themeIconToggle.checked = (iconTheme === 'light');
  setActionIconByTheme(iconTheme);

  // init sync toggle
  

  function markDirty(){ if ($save) $save.disabled = false; }

  if ($range) $range.addEventListener('input', ()=>{
    const v = clampUserPercent($range.value);
    if ($input) $input.value = String(v);
    applyTilePercentUser(v, {save:false, broadcast:true});
    markDirty();
  });
  function parseNumberField(){
    const raw = ($input?.value ?? '').trim(); if(raw==='') return null; const n=Number(raw); if(!Number.isFinite(n)) return null; return clampUserPercent(n);
  }
  function commitNumber(){ let v=parseNumberField(); if(v==null) v=100; if($range) $range.value=String(v); if($input) $input.value=String(v); applyTilePercentUser(v,{save:false, broadcast:true}); markDirty(); }
  if ($input){
    $input.addEventListener('input', ()=>{ /* allow empty while typing */ });
    $input.addEventListener('change', commitNumber);
    $input.addEventListener('blur', commitNumber);
    $input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commitNumber(); });
  }

  if ($opRange) $opRange.addEventListener('input', ()=>{
    const v = clampOpacityPercent($opRange.value);
    if ($opInput) $opInput.value = String(v);
    applyTileOpacityUser(v, {save:false, broadcast:true});
    markDirty();
  });
  function parseOpacityField(){
    const raw = ($opInput?.value ?? '').trim(); if(raw==='') return null; const n=Number(raw); if(!Number.isFinite(n)) return null; return clampOpacityPercent(n);
  }
  function commitOpacity(){ let v=parseOpacityField(); if(v==null) v=100; if($opRange) $opRange.value=String(v); if($opInput) $opInput.value=String(v); applyTileOpacityUser(v,{save:false, broadcast:true}); markDirty(); }
  if ($opInput){
    $opInput.addEventListener('input', ()=>{ /* allow empty while typing */ });
    $opInput.addEventListener('change', commitOpacity);
    $opInput.addEventListener('blur', commitOpacity);
    $opInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commitOpacity(); });
  }

  if ($foRange) $foRange.addEventListener('input', ()=>{
    const v = clampOpacityPercent($foRange.value);
    if ($foInput) $foInput.value = String(v);
    applyFolderOpacityUser(v, {save:false, broadcast:true});
    markDirty();
  });
  function parseFolderOpacityField(){
    const raw = ($foInput?.value ?? '').trim(); if(raw==='') return null; const n=Number(raw); if(!Number.isFinite(n)) return null; return clampOpacityPercent(n);
  }
  function commitFolderOpacity(){ let v=parseFolderOpacityField(); if(v==null) v=100; if($foRange) $foRange.value=String(v); if($foInput) $foInput.value=String(v); applyFolderOpacityUser(v,{save:false, broadcast:true}); markDirty(); }
  if ($foInput){
    $foInput.addEventListener('input', ()=>{ /* allow empty while typing */ });
    $foInput.addEventListener('change', commitFolderOpacity);
    $foInput.addEventListener('blur', commitFolderOpacity);
    $foInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commitFolderOpacity(); });
  }

  if ($fsRange) $fsRange.addEventListener('input', ()=>{
    const v = clampSaturationPercent($fsRange.value);
    if ($fsInput) $fsInput.value = String(v);
    applyFaviconSaturationUser(v, {save:false, broadcast:true});
    markDirty();
  });
  function parseFsField(){
    const raw = ($fsInput?.value ?? '').trim(); if(raw==='') return null; const n=Number(raw); if(!Number.isFinite(n)) return null; return clampSaturationPercent(n);
  }
  function commitFs(){ let v=parseFsField(); if(v==null) v=100; if($fsRange) $fsRange.value=String(v); if($fsInput) $fsInput.value=String(v); applyFaviconSaturationUser(v,{save:false, broadcast:true}); markDirty(); }
  if ($fsInput){
    $fsInput.addEventListener('input', ()=>{ /* allow empty while typing */ });
    $fsInput.addEventListener('change', commitFs);
    $fsInput.addEventListener('blur', commitFs);
    $fsInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commitFs(); });
  }
  if ($exp) $exp.addEventListener('click', exportLinks);
  if ($imp) $imp.addEventListener('click', importLinks);
  if ($close) $close.addEventListener('click', ()=>{ window.close(); });

  if ($gridColsSelect) $gridColsSelect.addEventListener('change', ()=>{
    const v = clampMaxCols($gridColsSelect.value);
    applyMaxCols(v, {save:false, broadcast:true});
    markDirty();
  });
  if ($listColsSelect) $listColsSelect.addEventListener('change', ()=>{
    const v = clampListCols($listColsSelect.value);
    applyListCols(v, {save:false, broadcast:true});
    markDirty();
  });

  if ($showTitles){
    $showTitles.addEventListener('change', ()=>{
      applyShowTitles(!!$showTitles.checked, {save:false, broadcast:true});
      markDirty();
    });
  }

  if ($themeToggle){
    $themeToggle.addEventListener('change', ()=>{
      const theme = $themeToggle.checked ? 'light' : 'dark';
      applyTheme(theme, {save:false, broadcast:true});
      markDirty();
    });
  }

  if ($themeIconToggle){
    $themeIconToggle.addEventListener('change', ()=>{
      const iconTheme = $themeIconToggle.checked ? 'light' : 'dark';
      setActionIconByTheme(iconTheme);
      chrome.storage.local.set({ [ICON_THEME_KEY]: iconTheme });
      try{ chrome.runtime.sendMessage({ type:'iconThemeChanged', iconTheme }); }catch{}
      markDirty();
    });
  }

  

  // Save/Cancel: коммит и откат
  function gather(){
    return {
      [TILE_PERCENT_KEY]: clampUserPercent(($input?.value ?? $range?.value) || 100),
      [TILE_OPACITY_KEY]: clampOpacityPercent(($opInput?.value ?? $opRange?.value) || 100),
      [FOLDER_OPACITY_KEY]: clampOpacityPercent(($foInput?.value ?? $foRange?.value) || 100),
      [FAVICON_SATURATION_KEY]: clampSaturationPercent(($fsInput?.value ?? $fsRange?.value) || 100),
      [MAX_COLS_KEY]: clampMaxCols(($gridColsSelect?.value) || 5),
      [LIST_COLS_KEY]: clampListCols(($listColsSelect?.value) || 1),
      [SHOW_TITLES_KEY]: !!($showTitles?.checked),
      [THEME_KEY]: $themeToggle?.checked ? 'light' : 'dark',
      [ICON_THEME_KEY]: $themeIconToggle?.checked ? 'light' : 'dark',
    };
  }
  async function commit(){
    const s = gather();
    await chrome.storage.local.set(s);
    if ($save) $save.disabled = true;
    // закрыть окно настроек
    try{ window.close(); }catch{}
  }
  async function revert(){
    const st = await chrome.storage.local.get({
      [TILE_PERCENT_KEY]: 100,
      [TILE_OPACITY_KEY]: 100,
      [FOLDER_OPACITY_KEY]: 100,
      [FAVICON_SATURATION_KEY]: 100,
      [MAX_COLS_KEY]: 5,
      [LIST_COLS_KEY]: 1,
      [SHOW_TITLES_KEY]: false,
      [THEME_KEY]: 'dark',
      [ICON_THEME_KEY]: 'dark',
    });
    const p = clampUserPercent(st[TILE_PERCENT_KEY]);
    const op = clampOpacityPercent(st[TILE_OPACITY_KEY]);
    const fo = clampOpacityPercent(st[FOLDER_OPACITY_KEY]);
    const fs = clampSaturationPercent(st[FAVICON_SATURATION_KEY]);
    const mc = clampMaxCols(st[MAX_COLS_KEY]);
    const lc = clampListCols(st[LIST_COLS_KEY]);
    const on = !!st[SHOW_TITLES_KEY];
    const theme = st[THEME_KEY] || 'dark';
    const iconTheme = st[ICON_THEME_KEY] || 'dark';
    const syncOn = !!st[SYNC_BOOKMARKS_KEY];
    if ($range) $range.value = String(p); if ($input) $input.value = String(p); applyTilePercentUser(p,{save:false, broadcast:true});
    if ($opRange) $opRange.value = String(op); if ($opInput) $opInput.value = String(op); applyTileOpacityUser(op,{save:false, broadcast:true});
    if ($foRange) $foRange.value = String(fo); if ($foInput) $foInput.value = String(fo); applyFolderOpacityUser(fo,{save:false, broadcast:true});
    if ($fsRange) $fsRange.value = String(fs); if ($fsInput) $fsInput.value = String(fs); applyFaviconSaturationUser(fs,{save:false, broadcast:true});
    if ($gridColsSelect) $gridColsSelect.value = String(mc); applyMaxCols(mc,{save:false, broadcast:true});
    if ($listColsSelect) $listColsSelect.value = String(lc); applyListCols(lc,{save:false, broadcast:true});
    if ($showTitles) $showTitles.checked = on; applyShowTitles(on,{save:false, broadcast:true});
    if ($themeToggle) $themeToggle.checked = theme === 'light'; applyTheme(theme,{save:false, broadcast:true});
    if ($themeIconToggle) $themeIconToggle.checked = iconTheme === 'light'; setActionIconByTheme(iconTheme);
    
    if ($save) $save.disabled = true;
  }
  if ($save) $save.addEventListener('click', commit);
  if ($cancel) $cancel.addEventListener('click', revert);
});


