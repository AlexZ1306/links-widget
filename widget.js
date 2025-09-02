// Синхронизация порядка текущей папки с закладками Chrome (опционально)
async function syncChromeOrderForCurrentFolder(liveOrder){
  try{
    // Флаг можно позже вынести в настройки; сейчас синхрон включён по умолчанию
    const enable = true;
    if (!enable) return;
    // Карты соответствий: расширение -> Chrome ID
    let mapFolderE2C = {}; let mapLinkE2C = {};
    try{ const st = await chrome.storage.local.get(['map_folder_e2c','map_link_e2c']); mapFolderE2C = st?.['map_folder_e2c'] || {}; mapLinkE2C = st?.['map_link_e2c'] || {}; }catch{}

    // Определяем parentId и набор элементов этой папки
    let parentChromeId = null;
    if (currentFolderId===null || currentFolderId===undefined){
      parentChromeId = '1'; // Панель закладок
    } else {
      parentChromeId = mapFolderE2C[String(currentFolderId)] || null;
    }
    if (!parentChromeId) return;

    // Собираем целевой порядок только для текущей папки
    const targets = liveOrder.filter(x=> x && (x.type==='link' || x.type==='folder'));
    let index = 0;
    for (const item of targets){
      const isFolder = item.type === 'folder';
      const chromeId = isFolder ? mapFolderE2C[String(item.id)] : mapLinkE2C[String(item.id)];
      if (!chromeId) { index++; continue; }
      try{
        await chrome.bookmarks.move(String(chromeId), { parentId: String(parentChromeId), index });
      }catch(err){ console.warn('bookmarks.move failed', item, err); }
      index++;
    }
  }catch(e){ console.warn('syncChromeOrderForCurrentFolder error', e); }
}
async function openFolderDeleteConfirm(folderId){
  try{
    const folders = await getFolders();
    const folder = folders.find(f=>f.id===folderId);
    if (!folder) return;

    // Компактное сервисное сообщение в стиле панели
    editorOpen = true; editorKind = 'confirm-delete-folder';
    $overlay.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className='panel';
    wrap.style.maxWidth = '420px';
    const msg = document.createElement('div'); msg.style.lineHeight='1.45';
    msg.innerHTML = `Вы хотите удалить папку "${folder.name}"?`;
    const note = document.createElement('div'); note.className='small'; note.style.marginTop='8px'; note.style.color='var(--muted)';
    note.textContent = 'При удалении папки все вложенные закладки переместятся в корневую папку.';

    const actions = document.createElement('div'); actions.className='actions';
    const left = document.createElement('div');
    const right = document.createElement('div'); right.className='actions-right';
    const btnCancel = document.createElement('button'); btnCancel.textContent='Отмена';
    const btnYes = document.createElement('button'); btnYes.className='primary'; btnYes.textContent='Да';
    right.appendChild(btnCancel); right.appendChild(btnYes); actions.appendChild(left); actions.appendChild(right);

    wrap.appendChild(msg); wrap.appendChild(note); wrap.appendChild(actions);
    $overlay.appendChild(wrap); $overlay.classList.add('open');

    const close = ()=>{ editorOpen=false; editorKind=null; $overlay.classList.remove('open'); $overlay.innerHTML=''; };
    btnCancel.addEventListener('click', close);
    document.addEventListener('keydown', function onKey(e){ if(e.key==='Escape'){ document.removeEventListener('keydown', onKey); close(); } }, { once:true });
    btnYes.addEventListener('click', async ()=>{
      btnYes.disabled = btnCancel.disabled = true;
      try{ await deleteFolderKeepContent(folderId); await cleanupFaviconCache(); close(); render(); }catch(e){ console.error(e); close(); }
    });
  }catch(e){ console.error('openFolderDeleteConfirm error', e); }
}

async function deleteFolderKeepContent(folderId){
  const folders = await getFolders();
  const links = await getLinks();
  // Перемещаем закладки из папки в корень
  const updatedLinks = links.map(link => link.folderId === folderId ? { ...link, folderId: null } : link);
  await setLinks(updatedLinks);
  // Поднимаем вложенные папки на уровень выше (их parentFolderId становится родителем удаляемой папки)
  const victim = folders.find(f=>f.id===folderId);
  const parentId = victim ? (victim.parentFolderId ?? null) : null;
  const updatedFolders = folders.filter(f=>f.id!==folderId).map(f=> f.parentFolderId===folderId ? { ...f, parentFolderId: parentId } : f);
  await setFolders(updatedFolders);
}

async function deleteFolderRecursive(folderId){
  // Удаляем все вложенные папки рекурсивно и их закладки
  const folders = await getFolders();
  const childIds = folders.filter(f=>f.parentFolderId===folderId).map(f=>f.id);
  for (const cid of childIds){ await deleteFolderRecursive(cid); }
  // Удаляем закладки внутри папки
  const links = await getLinks();
  const filteredLinks = links.filter(l=> l.folderId !== folderId);
  await setLinks(filteredLinks);
  // Удаляем саму папку
  const newFolders = (await getFolders()).filter(f=>f.id!==folderId);
  await setFolders(newFolders);
}
const LINKS_KEY = "links";
const COPYRIGHT_URL = "https://www.cdek.ru/ru/?utm_referrer=https%3A%2F%2Fwww.google.com%2F";
const ICON_MANIFEST_URL = "icons/manifest-fa-solid.json";
const THEME_KEY = "theme";
const ICON_THEME_KEY = 'iconTheme'; // 'dark' | 'light'
const FAVICON_CACHE_KEY = "faviconCache";
const FOLDERS_KEY = "folders"; // Ключ для хранения папок
const CURRENT_FOLDER_KEY = "currentFolder"; // Ключ для хранения текущей папки
const ROOT_ORDER_KEY = "rootOrder"; // Порядок элементов в корне (папки и закладки)
let ICON_MANIFEST = null;

// Кэш фавиконов для быстрой загрузки
let faviconCache = new Map();
// Кэш дефолтной иконки папки
let defaultFolderIconCache = null;

// Нормализация URL под http(s) для chrome://favicon2
function normalizeHttpUrl(input){
  try{
    const u = new URL(input);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return 'https://' + u.host + (u.pathname || '/');
  }catch{
    return 'https://' + String(input).replace(/^\/+/, '');
  }
}

// Быстрый URL для фавикона из встроенного кеша Chrome (query-форма)
function chromeFaviconUrl(pageUrl, size = 64){
  const qs = new URLSearchParams({ size: String(size), scale_factor: '2x', page_url: normalizeHttpUrl(pageUrl) });
  return 'chrome://favicon2/?' + qs.toString();
}
function chromeFaviconUrlUrlParam(pageUrl, size = 64){
  const qs = new URLSearchParams({ size: String(size), scale_factor: '2x', url: normalizeHttpUrl(pageUrl) });
  return 'chrome://favicon2/?' + qs.toString();
}
function chromeFaviconUrlIconUrl(pageUrl, size = 64){
  const qs = new URLSearchParams({ size: String(size), scale_factor: '2x', icon_url: normalizeHttpUrl(pageUrl) });
  return 'chrome://favicon2/?' + qs.toString();
}

// Runtime endpoint для расширений (работает в popup без схемы chrome:)
function runtimeFaviconUrl(pageUrl, size = 64){
  const qs = new URLSearchParams({ pageUrl: normalizeHttpUrl(pageUrl), size: String(size) }).toString();
  try{ return chrome.runtime.getURL(`_favicon/?${qs}`); }catch{ return `_favicon/?${qs}`; }
}

// Установить фавикон с фолбеком: favicon2 -> favicon -> буква
function setFaviconWithFallback(imgEl, pageUrl, size = 64){
  const httpUrl = normalizeHttpUrl(pageUrl);
  let step = 0;
  imgEl.onerror = () => {
    step++;
    if (step === 1){
      imgEl.src = chromeFaviconUrl(httpUrl, size);
    } else if (step === 2){
      imgEl.src = chromeFaviconUrlUrlParam(httpUrl, size);
    } else if (step === 3){
      imgEl.src = chromeFaviconUrlIconUrl(httpUrl, size);
    } else if (step === 4){
      imgEl.src = `chrome://favicon/size/${size}@2x/${httpUrl}`;
    } else {
      imgEl.src = letterFallback(httpUrl, size);
    }
  };
  // Пытаемся сперва runtime _favicon (самый совместимый путь в расширениях)
  imgEl.src = runtimeFaviconUrl(httpUrl, size);
}

// Буквенный фолбек: генерируем dataURL с первой буквой хоста
function letterFallback(url, size = 64) {
  try {
    const host = new URL(normalizeHttpUrl(String(url || ''))).hostname || '';
    const ch = (host[0] || '•').toUpperCase();
    const canvas = document.createElement('canvas');
    const s = Math.max(16, Number(size) || 64);
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    // Фон — слегка скруглённый квадрат
    const radius = Math.round(s * 0.18);
    ctx.fillStyle = '#2b2d31';
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(s - radius, 0);
    ctx.quadraticCurveTo(s, 0, s, radius);
    ctx.lineTo(s, s - radius);
    ctx.quadraticCurveTo(s, s, s - radius, s);
    ctx.lineTo(radius, s);
    ctx.quadraticCurveTo(0, s, 0, s - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();
    // Буква
    ctx.fillStyle = '#e8eaed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(s * 0.55)}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    ctx.fillText(ch, s / 2, s / 2 + 1);
    return canvas.toDataURL('image/png');
  } catch {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#2b2d31"/><text x="32" y="38" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="700" font-size="34" fill="#e8eaed">•</text></svg>`);
  }
}

// Текущая папка (null = корневая папка)
let currentFolderId = null;

const $card = document.getElementById("card");
const $list = document.getElementById("list");
const $emptyState = document.getElementById("emptyState");
const $overlay = document.getElementById("overlayEditor");
const $btnAdd = document.getElementById("footerAdd");
const $btnEdit = document.getElementById("footerEdit");
const $copyLink = document.getElementById("copyrightLink");
const $btnSettings = document.getElementById("footerSettings");
const $addPanel = document.getElementById("addPanel");
const $editPanel = document.getElementById("editPanel");
const $modeEdit = document.getElementById("modeEdit");
const $contextMenu = document.getElementById("contextMenu");
const $contextEdit = document.getElementById("contextEdit");
const $contextDelete = document.getElementById("contextDelete");
const $contextMoveToggle = document.getElementById("contextMoveToggle");
const $contextMoveSubmenu = document.getElementById("contextMoveSubmenu");
const $modeDelete = document.getElementById("modeDelete");
const $modeSelect = document.getElementById("modeSelect");
const $createBookmark = document.getElementById("createBookmark");
const $addCurrentPage = document.getElementById("addCurrentPage");
const $createFolder = document.getElementById("createFolder");
const $folderHeader = document.getElementById("folderHeader");
const $folderTitle = document.getElementById("folderTitle");
const $backButton = document.getElementById("backButton");
const $closeButton = document.getElementById("closeButton");
const $viewToggle = document.getElementById("viewToggle");
const $viewToggleIcon = document.getElementById("viewToggleIcon");
const $settingsFloat = document.getElementById("settingsFloat");
const $settingsClose = document.getElementById("settingsClose");
const $settingsExport = document.getElementById("settingsExport");
const $settingsImport = document.getElementById("settingsImport");
const $settingsSave = document.getElementById("settingsSave");
const $settingsCancel = document.getElementById("settingsCancel");
const $tileSizeRange = document.getElementById("tileSizeRange");
const $tileSizeInput = document.getElementById("tileSizeInput");
const $listIconSizeRange = document.getElementById("listIconSizeRange");
const $listIconSizeInput = document.getElementById("listIconSizeInput");
const $tileOpacityRange = document.getElementById("tileOpacityRange");
const $tileOpacityInput = document.getElementById("tileOpacityInput");
const $folderOpacityRange = document.getElementById("folderOpacityRange");
const $folderOpacityInput = document.getElementById("folderOpacityInput");
const $faviconSaturationRange = document.getElementById("faviconSaturationRange");
const $faviconSaturationInput = document.getElementById("faviconSaturationInput");
const $tileGapRange = document.getElementById("tileGapRange");
const $tileGapInput = document.getElementById("tileGapInput");
const $maxColsRange = document.getElementById("maxColsRange");
const $maxColsInput = document.getElementById("maxColsInput");
const $rootViewMode = document.getElementById("rootViewMode");
const $folderDefaultViewMode = document.getElementById("folderDefaultViewMode");
const $footerTransparent = document.getElementById("footerTransparent");
const $widgetBgTransparent = document.getElementById("widgetBgTransparent");
const $showTitlesInline = document.getElementById("showTitles");
const $showChromeFolders = document.getElementById("showChromeFolders");
const $themeToggleInline = document.getElementById("themeToggleInline");
const $themeIconToggleInline = document.getElementById("themeIconToggleInline");
const $syncBookmarksInline = null;
const $bulkCancel = document.getElementById("bulkCancel");
const $bulkDelete = document.getElementById("bulkDelete");
const $bulkMove = document.getElementById("bulkMove");

let editMode = false;
let selectMode = false; // режим множественного выбора
let selectedIds = new Set();
const DEFAULT_ICON = chrome.runtime.getURL("no_image_icon.png");
const NO_ICON_URL = chrome.runtime.getURL("no_icon_url.png");
// Глобальный флаг удержания Ctrl
let ctrlPressed = false;
let moveMode = false; // отдельный флаг режима перемещения
let contextMenuVisible = false;
let contextMenuTarget = null; // элемент, на котором вызвано контекстное меню

function updateEditMiniButtonsIcon(){
  const isDelete = ctrlPressed && editMode;
  document.documentElement.classList.toggle('ctrl-delete-mode', isDelete);
  try{
    document.querySelectorAll('.tile .edit-mini').forEach(btn=>{
      if (isDelete){ btn.textContent = '✕'; btn.title = 'Delete'; btn.dataset.mode = 'delete'; }
      else { btn.innerHTML = '<span>✎</span>'; btn.title = 'Edit'; btn.dataset.mode = 'edit'; }
    });
  }catch{}
}

function updateBulkActionsUI(){
  document.documentElement.classList.toggle('select-mode', !!selectMode);
  const hasSelected = selectedIds && selectedIds.size > 0;
  if (selectMode && hasSelected) {
    // Показываем панель bulk actions
    const bulkPanel = document.getElementById('bulkActions');
    if (bulkPanel) bulkPanel.hidden = false;
    // Заполнить список папок
    (async ()=>{
      if (!$bulkMove) return;
      const folders = await getFolders();
      $bulkMove.innerHTML = '';
      // Плейсхолдер первой строкой, disabled
      const ph = document.createElement('option');
      ph.value = '';
      ph.disabled = true;
      ph.selected = true;
      ph.hidden = true;
      ph.textContent = 'Move to folder…';
      $bulkMove.appendChild(ph);
      // Пункт "Без папки" для переноса в общий список
      const optNone = document.createElement('option');
      optNone.value = '__ROOT__';
      optNone.textContent = 'Без папки';
      $bulkMove.appendChild(optNone);
      // Только папки (исключаем папки, которые уже выбраны, чтобы избежать циклических ссылок)
      const selectedIdsArray = Array.from(selectedIds);
      folders.forEach(f => {
        if (!selectedIdsArray.includes(f.id)) {
          const o=document.createElement('option'); o.value=f.id; o.textContent=f.name; $bulkMove.appendChild(o);
        }
      });
    })();
  } else {
    // Скрываем панель bulk actions
    const bulkPanel = document.getElementById('bulkActions');
    if (bulkPanel) bulkPanel.hidden = true;
  }
}

// Ctrl-режим удалён — управление режимами через меню. Оставляем флаг ctrlPressed под меню Delete

/* ---------- размеры карточки ---------- */
const MIN_EDITOR_WIDTH = 420;
function ensureMinCardWidth(minPx = MIN_EDITOR_WIDTH){
  const card = document.getElementById('card');
  if (!card) return;
  const w = card.getBoundingClientRect().width;
  if (w < minPx) {
    card.style.width = `${minPx}px`;
  }
}
function setCardWidthForCols(cols){
  if ($card.classList.contains('freeze-size') && !settingsOpen) return; // не менять ширину, когда заморожена (кроме режима настроек)
  const rs = getComputedStyle(document.documentElement);
  const tile = parseInt(rs.getPropertyValue("--tileSize"));
  const gap  = parseInt(rs.getPropertyValue("--gap"));
  const pad  = parseInt(rs.getPropertyValue("--pad"));
  const w = cols*tile + (cols-1)*gap + 2*pad;
  const min = settingsOpen ? MIN_EDITOR_WIDTH : 0;
  const target = Math.max(min, w);
  $card.style.width = target + "px";
}
function widenForEditor(min=MIN_EDITOR_WIDTH){ ensureMinCardWidth(min); }
function restoreWidthByLinks(){
  const cols = clampMaxCols(userMaxCols);
  $list.style.setProperty("--cols", String(cols));
  setCardWidthForCols(cols);
}

// Форсируем пере-вычисление размеров popup от браузера (хак)
function forcePopupRelayout(){
  try{
    const tmp = document.createElement('div');
    tmp.style.position='absolute'; tmp.style.left='-9999px'; tmp.style.top='-9999px';
    tmp.style.width='1px'; tmp.style.height='1px'; tmp.style.pointerEvents='none';
    document.body.appendChild(tmp);
    // Принудительный reflow
    void tmp.offsetWidth; void tmp.getBoundingClientRect();
    // Дополнительно дергаем layout на самом popover через кнопку настроек
    try{ if ($btnSettings) { void $btnSettings.offsetWidth; $btnSettings.getBoundingClientRect(); } }catch{}
    // Триггер компоновки через временный transform
    try{ document.body.style.transform = 'translateZ(0)'; void document.body.offsetHeight; }catch{}
    requestAnimationFrame(()=>{
      try{ document.body.style.transform = ''; }catch{}
      try{ document.body.removeChild(tmp); }catch{}
    });
  }catch{}
}

/* ---------- storage / utils ---------- */
function newId(){ return crypto?.randomUUID?.() ?? String(Date.now()); }
async function getLinks(){ const { [LINKS_KEY]:x=[] } = await chrome.storage.local.get(LINKS_KEY); return Array.isArray(x)?x:[]; }
async function setLinks(v){ await chrome.storage.local.set({ [LINKS_KEY]: v }); }
function isValidUrl(u){ try{ let x=u.trim(); if(!/^https?:\/\//i.test(x)) x="https://"+x; new URL(x); return true; }catch{ return false; } }

/* ---------- Функции для работы с папками ---------- */
async function getFolders(){ const { [FOLDERS_KEY]:x=[] } = await chrome.storage.local.get(FOLDERS_KEY); return Array.isArray(x)?x:[]; }

// Получение папок для текущей папки (с учетом вложенности)
async function getFoldersForCurrentFolder(){
  const folders = await getFolders();
  if (currentFolderId === null || currentFolderId === undefined) {
    // Корневая папка - показываем папки без родительской папки
    const filtered = folders.filter(folder => !folder.parentFolderId);
    return filtered;
  } else {
    // Показываем папки в конкретной папке
    const filtered = folders.filter(folder => folder.parentFolderId === currentFolderId);
    return filtered;
  }
}
async function setFolders(v){ await chrome.storage.local.set({ [FOLDERS_KEY]: v }); }
async function getCurrentFolder(){ const { [CURRENT_FOLDER_KEY]:x=null } = await chrome.storage.local.get(CURRENT_FOLDER_KEY); return x; }
async function setCurrentFolder(folderId){ await chrome.storage.local.set({ [CURRENT_FOLDER_KEY]: folderId }); }
async function getAutoFaviconSetting(){ const { [AUTO_FAVICON_KEY]:x=true } = await chrome.storage.local.get(AUTO_FAVICON_KEY); return !!x; }

// Получение закладок для текущей папки
async function getLinksForCurrentFolder(){
  const links = await getLinks();
  if (currentFolderId === null || currentFolderId === undefined) {
    // Корневая папка - показываем закладки без папки (folderId === null или undefined)
    const filtered = links.filter(link => !link.folderId);
    return filtered;
  } else {
    // Показываем закладки в конкретной папке
    const filtered = links.filter(link => link.folderId === currentFolderId);
    return filtered;
  }
}

// Получение порядка для текущей папки
async function getFolderOrder(){
  if (currentFolderId === null || currentFolderId === undefined) {
    return await getRootOrder();
  } else {
    const folderOrderKey = `folderOrder_${currentFolderId}`;
    const { [folderOrderKey]: x=[] } = await chrome.storage.local.get(folderOrderKey);
    return Array.isArray(x)?x:[];
  }
}

// Получение/сохранение режима вида для текущей папки (grid/list)
const FOLDER_VIEW_PREFIX = 'folderView_';
async function getFolderViewMode(folderId){
  if (folderId === null || folderId === undefined) return 'grid';
  const key = FOLDER_VIEW_PREFIX + folderId;
  try{
    const { [key]: val } = await chrome.storage.local.get(key);
    if (val === 'list' || val === 'grid') return val;
    // если локально не задано — используем дефолт из настроек
    const st = await chrome.storage.local.get(FOLDER_DEFAULT_VIEW_MODE_KEY);
    return (st?.[FOLDER_DEFAULT_VIEW_MODE_KEY] === 'list') ? 'list' : 'grid';
  }catch{ return 'grid'; }
}
async function setFolderViewMode(folderId, mode){
  if (folderId === null || folderId === undefined) return;
  const key = FOLDER_VIEW_PREFIX + folderId;
  await chrome.storage.local.set({ [key]: (mode === 'list' ? 'list' : 'grid') });
}

// Порядок элементов в корне (папки + корневые закладки)
async function getRootOrder(){ const { [ROOT_ORDER_KEY]:x=[] } = await chrome.storage.local.get(ROOT_ORDER_KEY); return Array.isArray(x)?x:[]; }
async function setRootOrder(v){ await chrome.storage.local.set({ [ROOT_ORDER_KEY]: v }); }

// Создание новой папки
async function createFolder(name, icon = null){
  const folders = await getFolders();
  const parentId = (currentFolderId === null || currentFolderId === undefined) ? null : currentFolderId;
  const newFolder = {
    id: newId(),
    name: name.trim(),
    icon: icon || await getDefaultFolderIcon(),
    createdAt: new Date().toISOString(),
    parentFolderId: parentId
  };
  folders.push(newFolder);
  await setFolders(folders);
  return newFolder;
}

// Получение дефолтной иконки папки
async function getDefaultFolderIcon(){
  // Если иконка уже в кэше, возвращаем её
  if (defaultFolderIconCache) {
    return defaultFolderIconCache;
  }
  
  try {
    // Загружаем PNG файл и конвертируем в data URL
    const response = await fetch(chrome.runtime.getURL('icon_folder.png'));
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    
    // Сохраняем в кэш
    defaultFolderIconCache = dataUrl;
    return dataUrl;
  } catch (error) {
    console.error('Ошибка загрузки иконки папки:', error);
    // Fallback на SVG иконку
    const fallbackIcon = "data:image/svg+xml;utf8," + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
    `);
    defaultFolderIconCache = fallbackIcon;
    return fallbackIcon;
  }
}

// Синхронная версия для получения дефолтной иконки папки (использует кэш)
function getDefaultFolderIconSync(){
  return defaultFolderIconCache || "data:image/svg+xml;utf8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  `);
}

// Переход в папку
async function navigateToFolder(folderId){
  currentFolderId = folderId;
  await setCurrentFolder(folderId);
  await render();
  
  // Больше не предзагружаем вручную: UI полагается на chrome://favicon
}

// Возврат в корневую папку
async function navigateToRoot(){
  currentFolderId = null;
  await setCurrentFolder(null);
  await render();
  
  // Больше не предзагружаем вручную: UI полагается на chrome://favicon
}

/* ---------- Кэш фавиконов ---------- */
// Загрузка кэша фавиконов из хранилища
async function loadFaviconCache() {
  try {
    const { [FAVICON_CACHE_KEY]: cacheData } = await chrome.storage.local.get(FAVICON_CACHE_KEY);
    if (cacheData && typeof cacheData === 'object') {
      faviconCache = new Map(Object.entries(cacheData));
    }
  } catch (error) {
    console.error('Ошибка загрузки кэша фавиконов:', error);
    faviconCache = new Map();
  }
}

// Сохранение кэша фавиконов в хранилище
async function saveFaviconCache() {
  try {
    const cacheData = Object.fromEntries(faviconCache);
    await chrome.storage.local.set({ [FAVICON_CACHE_KEY]: cacheData });
  } catch (error) {
    console.error('Ошибка сохранения кэша фавиконов:', error);
  }
}

// Очистка старых кэшированных фавиконов
async function cleanupFaviconCache() {
  try {
    const links = await getLinks();
    const usedFavicons = new Set();
    
    // Собираем все используемые фавиконы
    links.forEach(link => {
      if (link.favicon && link.favicon !== DEFAULT_ICON && link.favicon !== NO_ICON_URL) {
        usedFavicons.add(link.favicon);
      }
    });
    
    // Удаляем неиспользуемые фавиконы из кэша
    const keysToRemove = [];
    for (const [key, value] of faviconCache.entries()) {
      if (!usedFavicons.has(value)) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => faviconCache.delete(key));
    
    // Сохраняем очищенный кэш
    if (keysToRemove.length > 0) {
      await saveFaviconCache();
      console.log(`Очищено ${keysToRemove.length} неиспользуемых фавиконов из кэша`);
    }
  } catch (error) {
    console.error('Ошибка очистки кэша фавиконов:', error);
  }
}

// Загрузка фавикона и конвертация в data URL для локального кэширования
async function loadFaviconAsDataUrl(url) {
  const startTime = performance.now();
  
  try {
    // Сначала пробуем с CORS
    const response = await fetch(url, { 
      mode: 'cors',
      cache: 'force-cache'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const blob = await response.blob();
    const result = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsDataURL(blob);
    });
    
    // Записываем успешную статистику
    const loadTime = performance.now() - startTime;
    recordFaviconLoadStats(url, true, loadTime);
    
    return result;
  } catch (error) {
    console.error('Ошибка загрузки фавикона с CORS:', error);
    
    // Если CORS не работает, пробуем через img элемент
    try {
      const result = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          try {
            // Создаем canvas для конвертации
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            
            // Рисуем изображение на canvas
            ctx.drawImage(img, 0, 0);
            
            // Конвертируем в data URL
            const dataUrl = canvas.toDataURL('image/png');
            resolve(dataUrl);
          } catch (canvasError) {
            console.error('Ошибка конвертации через canvas:', canvasError);
            reject(canvasError);
          }
        };
        
        img.onerror = () => {
          reject(new Error('Не удалось загрузить изображение'));
        };
        
        // Устанавливаем таймаут
        setTimeout(() => {
          reject(new Error('Таймаут загрузки изображения'));
        }, 5000);
        
        img.src = url;
      });
      
      // Записываем успешную статистику
      const loadTime = performance.now() - startTime;
      recordFaviconLoadStats(url, true, loadTime);
      
      return result;
    } catch (imgError) {
      console.error('Ошибка загрузки фавикона через img:', imgError);
      
      // Записываем неуспешную статистику
      const loadTime = performance.now() - startTime;
      recordFaviconLoadStats(url, false, loadTime);
      
      return null;
    }
  }
}

// Получение фавикона из кэша или загрузка и кэширование локально
async function getFaviconWithCache(url) {
  if (!url) return NO_ICON_URL;
  
  // Проверяем кэш
  if (faviconCache.has(url)) {
    const cachedFavicon = faviconCache.get(url);
    
    // Если в кэше уже data URL, возвращаем его
    if (cachedFavicon.startsWith('data:')) {
      return cachedFavicon;
    }
    
    // Если в кэше URL, загружаем его локально и обновляем кэш
    try {
      const dataUrl = await loadFaviconAsDataUrl(cachedFavicon);
      if (dataUrl) {
        faviconCache.set(url, dataUrl);
        // Сохраняем кэш асинхронно
        saveFaviconCache().catch(() => {});
        return dataUrl;
      }
    } catch (error) {
      console.error('Ошибка конвертации фавикона в data URL:', error);
    }
    
    return cachedFavicon;
  }
  
  // Если нет в кэше, загружаем и кэшируем
  try {
    const favicon = await findWorkingFavicon(url);
    if (favicon && favicon !== NO_ICON_URL) {
      // Загружаем фавикон локально и конвертируем в data URL
      const dataUrl = await loadFaviconAsDataUrl(favicon);
      if (dataUrl) {
        faviconCache.set(url, dataUrl);
        // Сохраняем кэш асинхронно (не блокируем рендеринг)
        saveFaviconCache().catch(() => {});
        return dataUrl;
      } else {
        // Если не удалось загрузить локально, сохраняем URL
        faviconCache.set(url, favicon);
        saveFaviconCache().catch(() => {});
        return favicon;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки фавикона:', error);
  }
  
  return NO_ICON_URL;
}

// Предзагрузка фавиконов для всех ссылок с локальным кэшированием
async function preloadFavicons(links, isPriority = false) {
  // Для приоритетных элементов используем больший размер батча и меньше пауз
  const batchSize = isPriority ? 15 : 5; // Увеличиваем размер батча для приоритетных
  const batches = [];
  
  for (let i = 0; i < links.length; i += batchSize) {
    batches.push(links.slice(i, i + batchSize));
  }
  
  console.log(`Разбито на ${batches.length} батчей по ${batchSize} фавиконов (приоритет: ${isPriority})`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    const promises = batch.map(async (item) => {
      try {
        if (item.favicon && item.favicon !== DEFAULT_ICON && item.favicon !== NO_ICON_URL) {
          // Если фавикон уже есть, проверяем нужно ли его загрузить локально
          if (!faviconCache.has(item.favicon)) {
            // Если это URL, загружаем локально
            if (item.favicon.startsWith('http')) {
              try {
                const dataUrl = await loadFaviconAsDataUrl(item.favicon);
                if (dataUrl) {
                  faviconCache.set(item.favicon, dataUrl);
                } else {
                  faviconCache.set(item.favicon, item.favicon);
                }
              } catch (error) {
                console.error('Ошибка предзагрузки фавикона:', error);
                faviconCache.set(item.favicon, item.favicon);
              }
            } else {
              // Если это уже data URL, просто кэшируем
              faviconCache.set(item.favicon, item.favicon);
            }
          }
        } else if (item.url) {
          // Если фавикона нет, пробуем найти и кэшировать
          const cachedFavicon = await getFaviconWithCache(item.url);
          if (cachedFavicon && cachedFavicon !== NO_ICON_URL) {
            // Фавикон найден и закэширован
          }
        }
      } catch (error) {
        console.error(`Ошибка предзагрузки фавикона для ${item.url || item.favicon}:`, error);
      }
    });
    
    // Обрабатываем батч
    try {
      await Promise.allSettled(promises);
      // Сохраняем кэш после каждого батча
      await saveFaviconCache();
      
      // Для приоритетных элементов делаем меньше пауз
      if (batchIndex < batches.length - 1 && !isPriority) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (error) {
      console.error(`Ошибка при обработке батча ${batchIndex + 1}:`, error);
    }
  }
  
  console.log(`Предзагрузка фавиконов завершена (приоритет: ${isPriority})`);
}

/* ---------- Тема ---------- */
function applyTheme(theme, {save=true}={}) {
  const t = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  if (save) chrome.storage.local.set({ [THEME_KEY]: t });
  // Сбрасываем возможные инлайновые стили от прозрачности, чтобы не появлялись артефакты рамок
  const card = document.querySelector('.card');
  const footer = document.querySelector('.footerbar');
  if (card){ card.style.background=''; card.style.borderColor=''; card.style.boxShadow=''; }
  if (footer){ footer.style.background=''; footer.style.borderColor=''; footer.style.boxShadow=''; }
  // Важно: привести CSS-переменные --bg / --footer-bg к актуальному состоянию темы.
  const bgTransparent = root.classList.contains('bg-transparent');
  const footerTransparent = root.classList.contains('footer-transparent');
  if (bgTransparent) root.style.setProperty('--bg', 'transparent'); else root.style.removeProperty('--bg');
  if (footerTransparent) root.style.setProperty('--footer-bg', 'transparent'); else root.style.removeProperty('--footer-bg');
  // Принудительно обновим фон html/body актуальным значением --bg,
  // чтобы исключить «залипание» старого цвета и артефакты по краям
  try{
    const cssBg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.documentElement.style.background = cssBg || '';
    document.body.style.background = cssBg || '';
  }catch{}
}

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

/* ---------- Тултипы ---------- */
const TOOLTIP_DELAY_MS = 730; // задержка показа тултипа
const TOOLTIP_GAP_PX = 4; // отступ между элементом и тултипом
let __tooltipEl = null;
function ensureTooltipEl(){
  if (__tooltipEl && document.body.contains(__tooltipEl)) return __tooltipEl;
  __tooltipEl = document.createElement('div');
  __tooltipEl.className = 'tooltip';
  __tooltipEl.setAttribute('role','tooltip');
  __tooltipEl.style.pointerEvents='none';
  document.body.appendChild(__tooltipEl);
  return __tooltipEl;
}
function createTooltip(element, text) {
  // Убираем нативный браузерный tooltip, чтобы не дублировался с кастомным
  try{
    if (element && element.hasAttribute('title')){
      if (!element.hasAttribute('aria-label') || !element.getAttribute('aria-label')){
        element.setAttribute('aria-label', element.getAttribute('title') || text || '');
      }
      element.removeAttribute('title');
    }
  }catch{}

  function placeTooltip(){
    // если элемент уже удалён из DOM — скрыть тултип и не позиционировать
    if (!(element && element.isConnected)) {
      if (__tooltipEl) __tooltipEl.classList.remove('show');
      return;
    }
    const tip = ensureTooltipEl();
    const rect = element.getBoundingClientRect();
    const hostRect = ($card && $card.getBoundingClientRect) ? $card.getBoundingClientRect() : { left:0, top:0, right: window.innerWidth, bottom: window.innerHeight };
    // По центру относительно плитки по X
    let left = rect.left + (rect.width - tip.offsetWidth) / 2;
    // Предпочтительно СНИЗУ от плитки
    let top  = rect.bottom + TOOLTIP_GAP_PX;
    const pad = 4;
    // Если снизу не помещается — показываем сверху
    if (top + tip.offsetHeight > hostRect.bottom - pad) {
      top = rect.top - tip.offsetHeight - TOOLTIP_GAP_PX;
    }
    // Кламп внутри карточки (по X и Y)
    left = Math.min(Math.max(hostRect.left + pad, left), hostRect.right - tip.offsetWidth - pad);
    top  = Math.min(Math.max(hostRect.top  + pad, top ), hostRect.bottom - tip.offsetHeight - pad);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function showTooltip() {
    // элемент мог исчезнуть (навигация/перерисовка) пока ждали задержку
    if (!(element && element.isConnected)) return;
    const tip = ensureTooltipEl();
    tip.textContent = text;
    tip.classList.add('show');
    // после показа измеряем и ставим в допустимые границы
    placeTooltip();
  }

  function hideTooltip() {
    if (__tooltipEl) __tooltipEl.classList.remove('show');
  }

  let hoverTimer = 0;
  element.addEventListener('mouseenter', ()=>{ clearTimeout(hoverTimer); hoverTimer = setTimeout(showTooltip, TOOLTIP_DELAY_MS); });
  element.addEventListener('mouseleave', ()=>{ clearTimeout(hoverTimer); hideTooltip(); });
  element.addEventListener('pointerdown', ()=>{ clearTimeout(hoverTimer); hideTooltip(); });
  element.addEventListener('blur', ()=>{ clearTimeout(hoverTimer); hideTooltip(); });
  // Пересчитывать позицию тултипа при прокрутке/resize/изменении layout, пока курсор остаётся над элементом
  const onReflow = ()=>{
    if (!__tooltipEl || !__tooltipEl.classList.contains('show')) return;
    if (!(element && element.isConnected)) { hideTooltip(); return; }
    placeTooltip();
  };
  window.addEventListener('resize', onReflow);
  document.addEventListener('scroll', onReflow, true);
  // Чистка
  element.addEventListener('mouseleave', ()=>{
    window.removeEventListener('resize', onReflow);
    document.removeEventListener('scroll', onReflow, true);
  }, { once:true });
  // Скрывать тултип при любом глобальном клике/скролле карточки
  $card?.addEventListener('scroll', hideTooltip, { passive:true });
  return __tooltipEl;
}

/* ---------- FLIP анимация ---------- */
function captureRects(){
  const m=new Map();
  [...$list.children].forEach(el=>m.set(el.dataset.id, el.getBoundingClientRect()));
  return m;
}

// Захватывает геометрию элементов без учёта текущих CSS-трансформаций.
// Временно отключает transition и transform, чтобы получить «натуральные» позиции,
// затем мгновенно восстанавливает исходные стили в том же кадре (без мерцаний).
function captureRectsUntransformed(){
  const map = new Map();
  const els = [...$list.children];
  const saved = els.map(el=>({ el, tr: el.style.transition, tf: el.style.transform }));
  try{
    els.forEach(({ style })=>{ style.transition = 'none'; style.transform = 'none'; });
    // Форсируем расчёт стилей до чтения
    void $list.offsetWidth;
    els.forEach(el=>{ map.set(el.dataset.id, el.getBoundingClientRect()); });
  } finally {
    // Восстановить стили
    saved.forEach(s=>{ s.el.style.transform = s.tf; s.el.style.transition = s.tr; });
  }
  return map;
}

/* ---------- копирайт: открытие вкладки ---------- */
function openCopyrightTab(){
  chrome.tabs.create({ url: COPYRIGHT_URL });
  window.close();
}
function animateFlip(prev){
  const run = ()=>{
    const dragging = document.documentElement.classList.contains('dragging-global');
    const duration = dragging ? 260 : 520;
    [...$list.children].forEach(el=>{
      const id=el.dataset.id, a=prev.get(id); if(!a) return;
      const b=el.getBoundingClientRect();
      const dx=a.left-b.left, dy=a.top-b.top;
      if(dx || dy){
        // Жёсткий FLIP: переустанавливаем transition и стартуем в ТОМ ЖЕ кадре
        const current = getComputedStyle(el).transform;
        el.style.transition = 'transform 0s';
        el.style.willChange = 'transform';
        el.style.transform = (current && current !== 'none') ? current : 'translate(0px,0px)';
        el.style.transform = `translate(${dx}px,${dy}px)`;
        void el.offsetWidth; // force reflow
        el.style.transition = `transform ${duration}ms cubic-bezier(.2,.6,.2,1)`;
        el.style.transform = 'translate(0,0)';
        if (dragging){ try{ el.style.transform += ' translateZ(0)'; }catch{} }
        el.addEventListener('transitionend', ()=>{ el.style.transition=''; el.style.willChange=''; }, { once:true });
      }
    });
    try{ $list.classList.remove('rendering'); }catch{}
  };
  // Во время DnD запускаем FLIP сразу (без rAF), чтобы избежать промежуточного кадра с «телепортом»
  if (document.documentElement.classList.contains('dragging-global')) run(); else requestAnimationFrame(run);
}

// Переупорядочить существующие DOM-элементы по live-порядку без полного рендера
function applyLiveOrderDom(order, prevRects){
  if (!$list) return;
  // Соберём текущие плитки
  const tilesAll = [...$list.children].filter(el=>el.dataset && (el.dataset.type === 'link' || el.dataset.type === 'folder'));
  const byKey = new Map(tilesAll.map(el=>[String(el.dataset.id)+":"+String(el.dataset.type), el]));
  const frag = document.createDocumentFragment();
  for (const it of order){
    const key = String(it.id)+":"+String(it.type);
    const el = byKey.get(key);
    if (el) frag.appendChild(el);
  }
  $list.appendChild(frag);
  if (prevRects) animateFlip(prevRects);
}

/* ---------- DnD ---------- */
let dragId=null, liveOrder=null;
let dragGhostEl=null;
let lastRenderedLinks = [];
let lastDragEndedAt = 0;
let lastPlanKey = null;
let lastPointerX = 0, lastPointerY = 0;
let reorderRaf = 0;
function addDragHandlers(tile, items){
  tile.draggable = false;
  if (tile._dndAttached) return; // защита от повторного навешивания
  tile._dndAttached = true;
  let pointerDown=false, pointerId=null, startX=0, startY=0, started=false;
  let longPressTimer = 0;
  const LONG_PRESS_MS = 300;
  // На всякий случай блокируем нативный dragstart браузера
  tile.addEventListener('dragstart', (e)=>{ try{ e.preventDefault(); }catch{} });
  function ensureStart(){
    if (started) return; started=true;
    dragId = tile.dataset.id;
    document.documentElement.classList.add('dragging-global');
    tile.classList.add('dragging');
    // Инициализируем первую перераскладку сразу, чтобы надёжно стартовать DnD
    try{ lastPointerX = startX; lastPointerY = startY; reorderByCursor(lastPointerX, lastPointerY, items); }catch{}
  }
  function onMove(e){
    if (!pointerDown) return; const x=e.clientX, y=e.clientY;
    if (!started){ const dx=x-startX, dy=y-startY; if ((dx*dx+dy*dy)<4) return; ensureStart(); }
    // Без фантома: оригинальная плитка остаётся видимой с подсветкой
    lastPointerX = x; lastPointerY = y;
    // Не даём странице/контейнеру скроллиться под пальцем/колёсиком во время DnD
    try{ e.preventDefault(); }catch{}
    if (!reorderRaf){
      reorderRaf = requestAnimationFrame(()=>{ reorderRaf = 0; reorderByCursor(lastPointerX, lastPointerY, items); });
    }
  }
  function onUp(e){
    if (!pointerDown) return; pointerDown=false; tile.releasePointerCapture?.(pointerId);
    document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onUp, true);
    clearTimeout(longPressTimer);
    document.documentElement.classList.remove('dragging-global');
    // Сбросить возможные временные transition (делаем microtask, чтобы не глушить текущие transitionend)
    Promise.resolve().then(()=>{ try{ [...$list.children].forEach(el=>{ el.style.transition=""; el.style.willChange=""; delete el._dragFlipInit; }); }catch{} });
    if (started){ tile.classList.remove('dragging'); lastDragEndedAt=Date.now(); if(liveOrder){ const toSave=liveOrder; liveOrder=null; dragId=null; const isRoot = (currentFolderId === null || currentFolderId === undefined); const p = isRoot ? persistRootMixedOrder(toSave) : persistReorderedSubset(toSave); p.finally(async ()=>{ 
      try{ await syncChromeOrderForCurrentFolder(toSave); }catch(e){ console.warn('syncChromeOrder failed', e); }
      // Финальный рендер не нужен: DOM уже соответствует toSave благодаря live-перестановкам.
      // Это устраняет мерцание при отпускании.
      // Автовыход из Move после дропа
      editMode = false; moveMode = false; ctrlPressed = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
      document.documentElement.classList.remove('move-mode');
    }); return; } 
    // Если перетаскивание начиналось, но порядок не изменился — тоже выходим из Move
    editMode = false; moveMode = false; ctrlPressed = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
    document.documentElement.classList.remove('move-mode'); }
    started=false; dragId=null; liveOrder=null;
  }
  tile.addEventListener('pointerdown', (e)=>{
    if(e.button!==0) return;
    // Не стартуем DnD, если клик пришёл по кнопке редактирования/удаления или мини-чекбоксу
    if ((e.target && e.target.closest && (e.target.closest('.edit-mini') || e.target.closest('.select-mini')))) return;
    // Жёсткий сброс возможного хвоста предыдущего жеста
    try{ document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onUp, true); }catch{}
    clearTimeout(longPressTimer);
    if (reorderRaf){ try{ cancelAnimationFrame(reorderRaf); }catch{} reorderRaf = 0; }
    started=false; dragId=null;
    document.documentElement.classList.remove('dragging-global');
    pointerDown=true; pointerId=e.pointerId; startX=e.clientX; startY=e.clientY;
    tile.setPointerCapture?.(pointerId);
    // Навешиваем обработчики в захваченном режиме, чтобы не терять событие
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    // Если режим Move не включен — включаем его по долгому удержанию
    if (!(editMode && moveMode)){
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(()=>{
        if (!pointerDown) return;
        // Включаем Move
        editMode = true; moveMode = true; ctrlPressed = false; selectMode = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
        document.documentElement.classList.add('move-mode');
        // Мгновенно начинаем DnD
        ensureStart();
      }, LONG_PRESS_MS);
    }
  });
}

// Глобальный DnD на контейнере: можно тащить и бросать где угодно внутри #list
// Вычисляем целевой индекс по координатам курсора, а не только над плиткой
function reorderByCursor(clientX, clientY, items){
  if (!dragId) return;
  // Для стабильности используем фиксированную высоту ячейки в list-view,
  // чтобы стартовая оценка строки не плавала из-за подписи и т.п.
  const prevRects = captureRects();
  // Текущий порядок берём из DOM, чтобы точно включать и папки, и закладки
  const tilesAll = [...$list.children].filter(el=>el.dataset && (el.dataset.type === 'link' || el.dataset.type === 'folder'));
  const domOrder = tilesAll.map(el=>({ id: el.dataset.id, type: el.dataset.type }));
  const order = [...(liveOrder ?? domOrder)];
  const from = order.findIndex(x=>x.id===dragId);
  if (from < 0) return;

  // Соберём DOM-элементы в текущем порядке (папки и ссылки)
  const tiles = tilesAll;
  if (tiles.length === 0) return;
  // Сетка/список: вычислим параметры раскладки
  const rs = getComputedStyle(document.documentElement);
  const tilePx = parseInt(rs.getPropertyValue('--tileSize')) || 56;
  const gapPx  = parseInt(rs.getPropertyValue('--gap')) || 10;
  const isList = $list.classList.contains('list-view');
  const cols   = isList ? 1 : (parseInt(getComputedStyle($list).getPropertyValue('--cols')) || 5);

  // Отдельная логика для list-view: находим первую плитку,
  // середина которой ниже курсора, и вставляем перед ней
  if (isList){
    // FLIP-подход как для сетки: рассчитываем индекс строки и используем центр-правило
    const gridRect = $list.getBoundingClientRect();
    const localY = clientY - gridRect.top;
    const firstRect = tiles[0].getBoundingClientRect();
    const cellH = parseInt(getComputedStyle(tiles[0]).height) || Math.round(firstRect.height);
    const strideY = cellH; // без gap
    const row = Math.max(0, Math.floor(localY / strideY));
    let to = Math.max(0, Math.min(order.length, row));
    // центр-правило
    const cellTop = row * strideY; const centerY = cellTop + cellH/2; const HYST_Y = 2;
    if (localY > centerY + HYST_Y) to = row + 1;
    let toAdj = to; if (from < to) toAdj -= 1; if (toAdj === from) return;
    const moved = order.splice(from,1)[0]; order.splice(toAdj,0,moved); liveOrder = order;
    applyLiveOrderDom(order, prevRects);
    return;
  }

  // Вычислим индекс вставки по координате курсора относительно сетки
  const gridRect = $list.getBoundingClientRect();
  const localX = clientX - gridRect.left;
  const localY = clientY - gridRect.top;
  const firstRect = tiles[0].getBoundingClientRect();
  const cellW = isList ? firstRect.width : tilePx;
  const cellH = isList ? (parseInt(getComputedStyle(tiles[0]).height) || Math.round(firstRect.height)) : (tilePx + (window.userShowTitles ? (parseInt(rs.getPropertyValue('--titleGap')) + parseInt(rs.getPropertyValue('--titleH'))) : 0));
  // Для списка считаем шаг ровно по высоте элемента без учёта gap,
  // иначе при небольшой погрешности координат возникает скачок на несколько строк
  const strideX = (isList ? cellW : (cellW + gapPx));
  const strideY = isList ? cellH : (cellH + gapPx);
  const col = isList ? 0 : Math.max(0, Math.min(cols - 1, Math.floor((localX + gapPx/2) / strideX)));
  // В списке не добавляем половину gap при расчёте индекса строки
  const row = isList ? Math.max(0, Math.floor(localY / strideY)) : Math.max(0, Math.floor((localY + gapPx/2) / strideY));
  // Индекс цели из локальных координат (для list-view учёт скролла уже заложен в gridRect/top)
  let targetIndex = isList ? row : (row * cols + col);
  if (targetIndex > tiles.length) targetIndex = tiles.length;

  // Центр-правило: в списке используем ось Y, в сетке — ось X
  let to = targetIndex;
  if (isList){
    const cellTop = row * strideY;
    const centerY = cellTop + cellH/2;
    const HYST_Y = 2; // минимальный гистерезис для точности
    if (localY > centerY + HYST_Y) to = targetIndex + 1;
  } else {
    const cellLeft = col * strideX;
    const centerX = cellLeft + cellW/2;
    const HYST_X = 8;
    if (localX > centerX + HYST_X) to = targetIndex + 1;
  }
  to = Math.max(0, Math.min(order.length, to));
  let toAdj = to;
  if (from < to) toAdj -= 1;
  if (toAdj === from) return;

  const planKey = dragId + ':' + from + '->' + toAdj;
  if (lastPlanKey === planKey) return;
  lastPlanKey = planKey;

  const moved = order.splice(from,1)[0];
  order.splice(toAdj,0,moved);
  liveOrder = order;
  // Переставляем элементы прямо в DOM без полного рендера, чтобы
  // избежать мерцаний и скачков скролла. Полный рендер будет выполнен
  // при отпускании (persist), а во время DnD только визуальный порядок меняется.
  applyLiveOrderDom(order, prevRects);
}

// Позволим переносить «куда угодно»: предотвращаем default на контейнере и обрабатываем drop
// Удаляем зависимость от HTML5 drag на контейнере — всё делает pointer DnD

// Применяет новый порядок только к текущему подмножеству (корень или конкретная папка),
// сохраняя порядок прочих закладок без изменений
async function persistReorderedSubset(liveOrderSubset){
  // Если мы в корне, используем persistRootMixedOrder
  if (currentFolderId === null || currentFolderId === undefined) {
    return persistRootMixedOrder(liveOrderSubset);
  }
  
  // Если мы внутри папки, работаем точно так же, как persistRootMixedOrder
  const folderOrder = liveOrderSubset.map(x=>({ id: x.id, type: x.type }));
  
  // Сохраняем порядок для текущей папки
  const folderOrderKey = `folderOrder_${currentFolderId}`;
  await chrome.storage.local.set({ [folderOrderKey]: folderOrder });

  // Обновляем порядок папок в текущей папке (точно как в persistRootMixedOrder)
  const folders = await getFolders();
  const folderIndex = new Map(folderOrder.filter(x=>x.type==='folder').map((x,i)=>[x.id,i]));
  const knownFolderIds = new Set(folderIndex.keys());
  const inCurrentFolder = (folder) => folder.parentFolderId === currentFolderId;
  const sortedFoldersKnown = folders.filter(f => inCurrentFolder(f) && knownFolderIds.has(f.id)).sort((a,b)=>{
    return (folderIndex.get(a.id)??0) - (folderIndex.get(b.id)??0);
  });
  const remainingFolders = folders.filter(f => !inCurrentFolder(f) || !knownFolderIds.has(f.id));
  const newFolders = [...remainingFolders, ...sortedFoldersKnown];
  await setFolders(newFolders);

  // Обновляем порядок закладок в текущей папке (точно как в persistRootMixedOrder)
  const all = await getLinks();
  const linkIndex = new Map(folderOrder.filter(x=>x.type==='link').map((x,i)=>[x.id,i]));
  const inCurrentFolderLinks = (link) => link.folderId === currentFolderId;
  const scopedSorted = all.filter(inCurrentFolderLinks).sort((a,b)=>{
    const ai = linkIndex.get(a.id);
    const bi = linkIndex.get(b.id);
    return (ai??0) - (bi??0);
  });
  let k = 0;
  const merged = all.map(item=> inCurrentFolderLinks(item) ? scopedSorted[k++] : item);
  await setLinks(merged);
}

// Сохранение смешанного порядка в корне: папки + корневые закладки
async function persistRootMixedOrder(liveOrderMixed){
  // 1) Сохраняем общий порядок для рендера
  const rootOrder = liveOrderMixed.map(x=>({ id: x.id, type: x.type }));
  await setRootOrder(rootOrder);

  // 2) Обновляем порядок папок
  const folders = await getFolders();
  const folderIndex = new Map(rootOrder.filter(x=>x.type==='folder').map((x,i)=>[x.id,i]));
  const knownFolderIds = new Set(folderIndex.keys());
  const sortedFoldersKnown = folders.filter(f=>knownFolderIds.has(f.id)).sort((a,b)=>{
    return (folderIndex.get(a.id)??0) - (folderIndex.get(b.id)??0);
  });
  const remainingFolders = folders.filter(f=>!knownFolderIds.has(f.id));
  const newFolders = [...sortedFoldersKnown, ...remainingFolders];
  await setFolders(newFolders);

  // 3) Обновляем порядок корневых закладок, не трогая вложенные
  const all = await getLinks();
  const linkIndex = new Map(rootOrder.filter(x=>x.type==='link').map((x,i)=>[x.id,i]));
  const inRoot = (link)=> !link.folderId;
  const scopedSorted = all.filter(inRoot).sort((a,b)=>{
    const ai = linkIndex.get(a.id);
    const bi = linkIndex.get(b.id);
    return (ai??0) - (bi??0);
  });
  let k = 0;
  const merged = all.map(item=> inRoot(item) ? scopedSorted[k++] : item);
  await setLinks(merged);
}

/* ---------- FA manifest + SVG -> data URL ---------- */
async function fetchText(url){ const r=await fetch(chrome.runtime.getURL(url)); if(!r.ok) throw new Error("Failed "+url); return await r.text(); }
async function loadIconManifest(){ if(ICON_MANIFEST) return ICON_MANIFEST; const r=await fetch(chrome.runtime.getURL(ICON_MANIFEST_URL)); if(!r.ok){ console.warn("No icon manifest"); return {icons:[]}; } ICON_MANIFEST=await r.json(); return ICON_MANIFEST; }
async function svgFileToDataUrl(filePath){
  const svg=await fetchText(filePath);
  const fixed = svg.includes("fill=") ? svg : svg.replace("<svg","<svg fill=\"currentColor\"");
  return "data:image/svg+xml;utf8,"+encodeURIComponent(fixed);
}

/* ---------- рендер плиток ---------- */
let renderInProgress = false;
async function render(orderOverride=null, prevRects=null){
  // Защита от множественных вызовов render
  if (renderInProgress) {
    console.log('render уже выполняется, пропускаем вызов');
    return;
  }
  renderInProgress = true;
  
    try {
    // Определяем, является ли вызов рендера перестановкой (DnD)
    const isReorder = Array.isArray(orderOverride) && orderOverride.length && (orderOverride[0].id !== undefined);
    let scroller = null, savedScroll = 0, listH = 0;
    try{
      scroller = $card ? $card.querySelector('.card-body') : null;
      if (scroller) savedScroll = scroller.scrollTop || 0;
      const r = $list?.getBoundingClientRect?.();
      if (r && isFinite(r.height)) listH = r.height;
    }catch{}
    // Для обычного рендера скрываем и очищаем, чтобы избежать флэшинга
    // Для перестановки — держим высоту списка и сохраняем скролл
    try{
      if ($list){
        if (isReorder){
          if (listH > 0) $list.style.minHeight = listH + 'px';
          $list.innerHTML = "";
        } else {
          $list.classList.add('rendering');
          $list.innerHTML = "";
        }
      }
    }catch{}
    // Убеждаемся, что currentFolderId правильно инициализирован
    if (currentFolderId === undefined) {
      currentFolderId = null;
    }
    
    let links = await getLinksForCurrentFolder();
    // orderOverride используется только для сортировки, не переопределяем links
    lastRenderedLinks = links;
  // Когда открыта панель (редактор или настройки), ширину не пересчитываем автоматически,
  // но количество колонок синхронизируем по пользовательскому максимуму
  if (!(editorOpen || settingsOpen)) {
    restoreWidthByLinks();
  } else {
    const cols = clampMaxCols(userMaxCols);
    $list.style.setProperty("--cols", String(cols));
  }
  document.querySelector(".card").classList.toggle("edit-mode", editMode);
  $overlay.classList.remove("open"); $overlay.innerHTML="";

  // Показываем/скрываем заголовок папки и иконку
  if (currentFolderId !== null && currentFolderId !== undefined) {
    const folders = await getFolders();
    const currentFolder = folders.find(f => f.id === currentFolderId);
    if (currentFolder) {
      $folderTitle.innerHTML = '';
      const icon = document.createElement('img');
      icon.className = 'folder-header-icon';
      icon.alt = '';
      icon.src = currentFolder.icon || getDefaultFolderIconSync();
      if ((currentFolder.iconTone||null) === 'mono') icon.classList.add('mono');
      const nameEl = document.createElement('span');
      nameEl.textContent = currentFolder.name;
      $folderTitle.appendChild(icon);
      $folderTitle.appendChild(nameEl);
      $folderHeader.style.display = "flex";

      // Обновляем состояние кнопки вида и контейнера
      try{
        const mode = await getFolderViewMode(currentFolderId);
        $list.classList.toggle('list-view', mode === 'list');
        if ($viewToggleIcon){
          $viewToggleIcon.classList.toggle('view-list', mode === 'list');
          $viewToggleIcon.classList.toggle('view-grid', mode !== 'list');
        }
      }catch{}
    }
  } else {
    $folderHeader.style.display = "none";
    // В корне всегда плитки
    $list.classList.remove('list-view');
  }

  // Список уже очищен в начале render
  
  // Если мы в корневой папке, рендерим смешанный список (папки + закладки)
  let mixedRootRendered = false;
  if ((currentFolderId === null || currentFolderId === undefined)) {
    let folders = await getFoldersForCurrentFolder();
    try{
      const st = await chrome.storage.local.get(SHOW_CHROME_FOLDERS_KEY);
      const showChromeFolders = !!(st?.[SHOW_CHROME_FOLDERS_KEY] ?? true);
      if (!showChromeFolders){
        const maps = await chrome.storage.local.get('map_folder_e2c');
        const extToChrome = maps?.['map_folder_e2c'] || {};
        const HIDE_SET = new Set(['1','2']);
        folders = folders.filter(f => !HIDE_SET.has(String(extToChrome[f.id] || '')));
      }
    }catch{}
    const rootLinks = links; // уже получены выше
    // Применяем вид для корня по настройке
    let rootMode = 'grid';
    try{ const st = await chrome.storage.local.get(ROOT_VIEW_MODE_KEY); rootMode = (st?.[ROOT_VIEW_MODE_KEY]==='list')?'list':'grid'; }catch{}
    $list.classList.toggle('list-view', rootMode==='list');
    // В списке показываем подписи всегда, тултипы – только если обрезано
    if (rootMode==='list'){
      document.documentElement.style.setProperty('--titleExtra','0px');
      document.documentElement.classList.remove('titles-on');
    } else {
      document.documentElement.style.setProperty('--titleExtra', window.userShowTitles ? 'calc(var(--titleGap) + var(--titleH))' : '0px');
      document.documentElement.classList.toggle('titles-on', !!window.userShowTitles);
    }
    // Пустое состояние в корне: нет ни одной папки и ни одной закладки
    if (Array.isArray(folders) && folders.length === 0 && Array.isArray(rootLinks) && rootLinks.length === 0) {
      if ($emptyState) {
        const t = $emptyState.querySelector('.empty-title');
        const s = $emptyState.querySelector('.empty-sub');
        if (t) t.textContent = 'Добавьте первую  закладку';
        if (s) s.textContent = 'Нажмите + чтобы добавить новую закладку или папку';
        $emptyState.style.display = '';
      }
      if ($list) $list.style.display = 'none';
      mixedRootRendered = true;
    } else {
      if ($emptyState) $emptyState.style.display = 'none';
      if ($list) $list.style.display = '';
    }

    // Выбираем порядок: во время DnD используем live order (orderOverride), иначе сохранённый
    let mixedOrdered;
    if (Array.isArray(orderOverride) && orderOverride.length && (orderOverride[0].id !== undefined)) {
      mixedOrdered = orderOverride.map(x => ({ id: x.id, type: x.type }));
    } else {
      const rootOrder = await getRootOrder();
      const orderIndex = new Map(rootOrder.map((x, i) => [x.id + ':' + x.type, i]));
      const mixedDefault = [
        ...folders.map(f => ({ id: f.id, type: 'folder' })),
        ...rootLinks.map(l => ({ id: l.id, type: 'link' }))
      ];
      mixedOrdered = [...mixedDefault].sort((a, b) => {
        const ai = orderIndex.get(a.id + ':' + a.type);
        const bi = orderIndex.get(b.id + ':' + b.type);
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1;
        if (bi == null) return -1;
        return ai - bi;
      });
    }

    // Хелперы для поиска сущностей
    const folderById = new Map(folders.map(f => [f.id, f]));
    const linkById = new Map(rootLinks.map(l => [l.id, l]));

    // Список для DnD
    const mixedItems = mixedOrdered.map(x => ({ id: x.id, type: x.type }));

    // Рендерим по смешанному порядку
    if (!(Array.isArray(folders) && folders.length === 0 && Array.isArray(rootLinks) && rootLinks.length === 0)) {
    mixedOrdered.forEach(entry => {
      if (entry.type === 'folder'){
        const folder = folderById.get(entry.id);
        if (!folder) return;
        const tile = document.createElement("div");
        tile.className = "tile folder-tile";
        tile.dataset.id = folder.id;
        tile.dataset.type = "folder";
        // Кастомный tooltip вместо title
        tile.removeAttribute('title');
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.draggable = false;
        img.src = folder.icon || getDefaultFolderIconSync();
        tile.appendChild(img);
        let rootCaptionFolder = null;
        if (rootMode==='list' || window.userShowTitles) {
          rootCaptionFolder = document.createElement('div');
          rootCaptionFolder.className = 'caption';
          rootCaptionFolder.textContent = folder.name;
          rootCaptionFolder.setAttribute('draggable','false');
          tile.appendChild(rootCaptionFolder);
        }

        if (editMode) {
          const btn = document.createElement("button");
          btn.className = "edit-mini";
          btn.title = "Редактировать";
          btn.innerHTML = '<span>✎</span>';
          btn.draggable = false;
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (ctrlPressed) {
              const linksAll = await getLinks();
              const updatedLinks = linksAll.map(link => link.folderId === folder.id ? { ...link, folderId: null } : link);
              await setLinks(updatedLinks);
              const foldersAll = await getFolders();
              const idx = foldersAll.findIndex(x => x.id === folder.id);
              if (idx >= 0) {
                foldersAll.splice(idx, 1);
                await setFolders(foldersAll);
                await cleanupFaviconCache();
                render();
              }
            } else {
              openFolderEditorOverlay(folder);
            }
          });
          // В Move режиме не показываем мини-кнопки вовсе
          if (!moveMode) tile.appendChild(btn);
          addDragHandlers(tile, mixedItems);
          // В Move режиме только курсор/hover без полосок
          if (moveMode){
            tile.style.cursor = 'grab';
            tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
            tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
          }
          tile.addEventListener("click", (e) => {
            if (selectMode) {
              e.preventDefault?.(); e.stopPropagation?.();
              const id = folder.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              updateBulkActionsUI();
              // Обновить состояние чекбокса, если он есть
              const smBtn = tile.querySelector('.select-mini');
              if (smBtn){ smBtn.classList.toggle('selected', selectedIds.has(id)); }
              return;
            }
            if (!moveMode) navigateToFolder(folder.id);
          });
          
          // В режиме Select добавляем мини-чекбокс для папок
          if (selectMode) {
            const selBtn = document.createElement('button');
            selBtn.className = 'select-mini';
            selBtn.title = 'Select';
            const checked = selectedIds.has(folder.id);
            if (checked) selBtn.classList.add('selected');
            selBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.1 12.4 10 16.3 17.9 8.5" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            selBtn.addEventListener('click', (e)=>{
              e.stopPropagation(); e.preventDefault();
              const id=folder.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              selBtn.classList.toggle('selected', selectedIds.has(id));
              updateBulkActionsUI();
            });
            tile.appendChild(selBtn);
          }
        } else {
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastDragEndedAt < 150) return;
            navigateToFolder(folder.id);
          });
          
        }
        // Навешиваем тултип: в списке только если текст обрезан
        try{
          if (rootMode==='list'){
            const needTip = !!(rootCaptionFolder && (rootCaptionFolder.scrollWidth > rootCaptionFolder.clientWidth + 1));
            if (needTip) createTooltip(tile, folder.name || 'Папка');
          } else {
            createTooltip(tile, folder.name || 'Папка');
          }
        }catch{}
        $list.appendChild(tile);
      } else {
        const item = linkById.get(entry.id);
        if (!item) return;
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.id = item.id;
        tile.dataset.type = "link";
        // Кастомный tooltip вместо title
        tile.removeAttribute('title');
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.draggable = false;
        if (item.iconCustom && item.favicon){
          // Пользовательский URL имеет приоритет
          img.onerror = () => { setFaviconWithFallback(img, item.url, 64); };
          img.src = item.favicon;
        } else if (item.favicon && item.favicon.startsWith('data:')){
          // Локальный data URL — используем напрямую
          img.src = item.favicon;
        } else {
          // Стандартная мгновенная система через chrome://favicon
          setFaviconWithFallback(img, item.url, 64);
        }
        if (item.iconTone === 'mono') img.classList.add('mono');
        tile.appendChild(img);
        let rootCaptionLink = null;
        if (rootMode==='list' || window.userShowTitles) {
          rootCaptionLink = document.createElement('div');
          rootCaptionLink.className = 'caption';
          rootCaptionLink.setAttribute('draggable','false');
          const t = (item.title || "").trim();
          if (t) rootCaptionLink.textContent = t; else { try { const u = new URL(item.url || ""); rootCaptionLink.textContent = u.hostname.replace(/^www\./, ''); } catch { rootCaptionLink.textContent = ""; } }
          tile.appendChild(rootCaptionLink);
        }
        if (editMode) {
          const btn = document.createElement("button");
          btn.className = "edit-mini";
          btn.title = "Редактировать";
          btn.innerHTML = '<span>✎</span>';
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode || (ctrlPressed ? 'delete' : 'edit');
            if (mode === 'delete') {
              const arr = await getLinks();
              const idx = arr.findIndex(x => x.id === item.id);
              if (idx >= 0) { arr.splice(idx,1); await setLinks(arr); await cleanupFaviconCache(); render(); }
            } else {
              openEditorOverlay(item);
            }
          });
          if (!moveMode) tile.appendChild(btn);
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", (e)=>{
            const now = Date.now();
            if (ctrlPressed) { e.preventDefault?.(); e.stopPropagation?.(); return; }
            if (selectMode) {
              e.preventDefault?.(); e.stopPropagation?.();
              const id = item.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              updateBulkActionsUI();
              // Обновить состояние чекбокса, если он есть
              const smBtn = tile.querySelector('.select-mini');
              if (smBtn){ smBtn.classList.toggle('selected', selectedIds.has(id)); }
              return;
            }
            if (now - lastDragEndedAt < 150) { e.preventDefault?.(); e.stopPropagation?.(); return; }
            openEditorOverlay(item);
          });
          
          // В режиме Select добавляем мини-чекбокс
          if (selectMode) {
            const selBtn = document.createElement('button');
            selBtn.className = 'select-mini';
            selBtn.title = 'Select';
            const checked = selectedIds.has(item.id);
            if (checked) selBtn.classList.add('selected');
            selBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.1 12.4 10 16.3 17.9 8.5" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            selBtn.addEventListener('click', (e)=>{
              e.stopPropagation(); e.preventDefault();
              const id=item.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              selBtn.classList.toggle('selected', selectedIds.has(id));
              updateBulkActionsUI();
            });
            tile.appendChild(selBtn);
          }
        } else {
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastDragEndedAt < 150) return;
            if (item.url) chrome.tabs.create({ url: item.url });
          });
        }
        if (dragId && item.id === dragId) tile.classList.add('dragging');
        if (editMode && moveMode){
          tile.style.cursor = 'grab';
          tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
          tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
        } else { tile.style.cursor = ''; tile.classList.remove('hovering'); }
        // Навешиваем тултип: в списке только если текст обрезан
        const tip = item.title && item.title.trim() ? item.title.trim() : (item.url || '').replace(/^https?:\/\//,'');
        try{
          if (rootMode==='list'){
            const needTip = !!(rootCaptionLink && (rootCaptionLink.scrollWidth > rootCaptionLink.clientWidth + 1));
            if (needTip) createTooltip(tile, tip || 'Закладка');
          } else {
            createTooltip(tile, tip || 'Закладка');
          }
        }catch{}
        $list.appendChild(tile);
      }
    });
    }

    mixedRootRendered = true;
  }

  // Рендерим закладки и папки (если не отрисовали смешанный корень)
  if (!mixedRootRendered) {
    // Получаем папки и строим смешанный порядок
    let folders = await getFoldersForCurrentFolder();
    try{
      const st = await chrome.storage.local.get(SHOW_CHROME_FOLDERS_KEY);
      const showChromeFolders = !!(st?.[SHOW_CHROME_FOLDERS_KEY] ?? true);
      if (!showChromeFolders){
        const maps = await chrome.storage.local.get('map_folder_e2c');
        const extToChrome = maps?.['map_folder_e2c'] || {};
        const HIDE_SET = new Set(['1','2']);
        folders = folders.filter(f => !HIDE_SET.has(String(extToChrome[f.id] || '')));
      }
    }catch{}
    // Определяем режим вида для текущей папки
    let __folderViewMode = 'grid';
    try{ __folderViewMode = await getFolderViewMode(currentFolderId); }catch{}
    const __isListView = (__folderViewMode === 'list');
    // Синхронизируем класс контейнера ещё раз (на случай внешних вызовов)
    $list.classList.toggle('list-view', __isListView);
    if (__isListView) { try{ $list.style.setProperty('--cols','1'); }catch{} }
    let mixedOrdered;
    if (Array.isArray(orderOverride) && orderOverride.length && (orderOverride[0].id !== undefined)) {
      mixedOrdered = orderOverride.map(x => ({ id: x.id, type: x.type }));
    } else {
      const folderOrder = await getFolderOrder();
      const orderIndex = new Map(folderOrder.map((x, i) => [x.id + ':' + x.type, i]));
      const mixedDefault = [
        ...folders.map(f => ({ id: f.id, type: 'folder' })),
        ...links.map(l => ({ id: l.id, type: 'link' }))
      ];
      mixedOrdered = [...mixedDefault].sort((a, b) => {
        const ai = orderIndex.get(a.id + ':' + a.type);
        const bi = orderIndex.get(b.id + ':' + b.type);
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1;
        if (bi == null) return -1;
        return ai - bi;
      });
    }

    const folderById = new Map(folders.map(f => [f.id, f]));
    const linkById = new Map(links.map(l => [l.id, l]));
    const mixedItems = mixedOrdered.map(x => ({ id: x.id, type: x.type }));

    // Пустое состояние внутри папки: нет ни папок, ни закладок
    const noItemsInFolder = (Array.isArray(folders) && folders.length === 0 && Array.isArray(links) && links.length === 0);
    if (noItemsInFolder) {
      if ($emptyState) {
        const t = $emptyState.querySelector('.empty-title');
        const s = $emptyState.querySelector('.empty-sub');
        if (t) t.textContent = 'Пустая папка';
        if (s) s.textContent = 'Нажмите + чтобы добавить новую закладку или папку';
        $emptyState.style.display = '';
      }
      if ($list) $list.style.display = 'none';
    } else {
      if ($emptyState) $emptyState.style.display = 'none';
      if ($list) $list.style.display = '';
    }

    if (!noItemsInFolder) {
    mixedOrdered.forEach(entry => {
      if (entry.type === 'folder'){
        const folder = folderById.get(entry.id);
        if (!folder) return;
        const tile = document.createElement("div");
        tile.className = "tile folder-tile";
        tile.dataset.id = folder.id;
        tile.dataset.type = "folder";
        // Кастомный tooltip вместо title
        tile.removeAttribute('title');
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.src = folder.icon || getDefaultFolderIconSync();
        img.draggable = false;
        tile.appendChild(img);

        let captionEl = null;
        if (__isListView || window.userShowTitles) {
          captionEl = document.createElement('div');
          captionEl.className = 'caption';
          captionEl.textContent = folder.name;
          captionEl.setAttribute('draggable','false');
          tile.appendChild(captionEl);
        }

        if (editMode) {
          const btn = document.createElement("button");
          btn.className = "edit-mini";
          btn.title = "Редактировать";
          btn.innerHTML = '<span>✎</span>';
          btn.draggable = false;
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (ctrlPressed) {
              const linksAll = await getLinks();
              const updatedLinks = linksAll.map(link => link.folderId === folder.id ? { ...link, folderId: null } : link);
              await setLinks(updatedLinks);
              const foldersAll = await getFolders();
              const idx = foldersAll.findIndex(x => x.id === folder.id);
              if (idx >= 0) {
                foldersAll.splice(idx, 1);
                await setFolders(foldersAll);
                await cleanupFaviconCache();
                render();
              }
            } else {
              openFolderEditorOverlay(folder);
            }
          });
          if (!moveMode) tile.appendChild(btn);
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", (e) => {
            if (selectMode) {
              e.preventDefault?.(); e.stopPropagation?.();
              const id = folder.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              updateBulkActionsUI();
              const smBtn = tile.querySelector('.select-mini');
              if (smBtn){ smBtn.classList.toggle('selected', selectedIds.has(id)); }
              return;
            }
            if (!moveMode) navigateToFolder(folder.id);
          });
          if (selectMode) {
            const selBtn = document.createElement('button');
            selBtn.className = 'select-mini';
            selBtn.title = 'Select';
            const checked = selectedIds.has(folder.id);
            if (checked) selBtn.classList.add('selected');
            selBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.1 12.4 10 16.3 17.9 8.5" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            selBtn.addEventListener('click', (e)=>{
              e.stopPropagation(); e.preventDefault();
              const id=folder.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              selBtn.classList.toggle('selected', selectedIds.has(id));
              updateBulkActionsUI();
            });
            tile.appendChild(selBtn);
          }
        } else {
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastDragEndedAt < 150) return;
            navigateToFolder(folder.id);
          });
        }
        if (dragId && folder.id === dragId) tile.classList.add('dragging');
        if (editMode && moveMode){
          tile.style.cursor = 'grab';
          tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
          tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
        } else { tile.style.cursor = ''; tile.classList.remove('hovering'); }
        // Добавляем в DOM, затем решаем показывать ли тултип в list-view
        $list.appendChild(tile);
        try{
          if (__isListView) {
            const needTip = !!(captionEl && (captionEl.scrollWidth > captionEl.clientWidth + 1));
            if (needTip) createTooltip(tile, folder.name || 'Папка');
          } else {
            createTooltip(tile, folder.name || 'Папка');
          }
        }catch{}
      } else {
        const item = linkById.get(entry.id);
        if (!item) return;
        if (!item.url) return;
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.id = item.id;
        tile.dataset.type = "link";
        // Кастомный tooltip вместо title
        tile.removeAttribute('title');
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.draggable = false;

        if (item.iconCustom && item.favicon){
          // Пользовательский URL имеет приоритет
          img.onerror = () => { setFaviconWithFallback(img, item.url, 64); };
          img.src = item.favicon;
        } else if (item.favicon && item.favicon.startsWith('data:')){
          // Локальный data URL — используем напрямую
          img.src = item.favicon;
        } else {
          // Стандартная мгновенная система через chrome://favicon
          setFaviconWithFallback(img, item.url, 64);
        }
        if (item.iconTone === 'mono') img.classList.add('mono');
        tile.appendChild(img);
        let captionEl2 = null;
        if (__isListView || window.userShowTitles) {
          captionEl2 = document.createElement('div');
          captionEl2.className = 'caption';
          captionEl2.setAttribute('draggable','false');
          const t = (item.title || "").trim();
          if (t) captionEl2.textContent = t; else { try { const u = new URL(item.url || ""); captionEl2.textContent = u.hostname.replace(/^www\./, ''); } catch { captionEl2.textContent = ""; } }
          tile.appendChild(captionEl2);
        }
        if (editMode) {
          const btn = document.createElement("button");
          btn.className = "edit-mini";
          btn.title = "Редактировать";
          btn.innerHTML = '<span>✎</span>';
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode || (ctrlPressed ? 'delete' : 'edit');
            if (mode === 'delete') {
              const arr = await getLinks();
              const idx = arr.findIndex(x => x.id === item.id);
              if (idx >= 0) { arr.splice(idx,1); await setLinks(arr); await cleanupFaviconCache(); render(); }
            } else {
              openEditorOverlay(item);
            }
          });
          if (!moveMode) tile.appendChild(btn);
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", (e)=>{
            const now = Date.now();
            if (ctrlPressed) { e.preventDefault?.(); e.stopPropagation?.(); return; }
            if (selectMode) {
              e.preventDefault?.(); e.stopPropagation?.();
              const id = item.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              updateBulkActionsUI();
              const smBtn = tile.querySelector('.select-mini');
              if (smBtn){ smBtn.classList.toggle('selected', selectedIds.has(id)); }
              return;
            }
            if (now - lastDragEndedAt < 150) { e.preventDefault?.(); e.stopPropagation?.(); return; }
            openEditorOverlay(item);
          });
          if (selectMode) {
            const selBtn = document.createElement('button');
            selBtn.className = 'select-mini';
            selBtn.title = 'Select';
            const checked = selectedIds.has(item.id);
            if (checked) selBtn.classList.add('selected');
            selBtn.innerHTML = `<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.1 12.4 10 16.3 17.9 8.5\" stroke=\"currentColor\" stroke-width=\"3.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>`;
            selBtn.addEventListener('click', (e)=>{
              e.stopPropagation(); e.preventDefault();
              const id=item.id;
              if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
              selBtn.classList.toggle('selected', selectedIds.has(id));
              updateBulkActionsUI();
            });
            tile.appendChild(selBtn);
          }
        } else {
          addDragHandlers(tile, mixedItems);
          tile.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastDragEndedAt < 150) return;
            if (item.url) chrome.tabs.create({ url: item.url });
          });
          
        }
        if (dragId && item.id === dragId) tile.classList.add('dragging');
        if (editMode && moveMode){
          tile.style.cursor = 'grab';
          tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
          tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
        } else { tile.style.cursor = ''; tile.classList.remove('hovering'); }
        // Добавляем в DOM, затем решаем показывать ли тултип в list-view
        const tip = item.title && item.title.trim() ? item.title.trim() : (item.url || '').replace(/^https?:\/\//,'');
        $list.appendChild(tile);
        try{
          if (__isListView) {
            const needTip = !!(captionEl2 && (captionEl2.scrollWidth > captionEl2.clientWidth + 1));
            if (needTip) createTooltip(tile, tip || 'Закладка');
          } else {
            createTooltip(tile, tip || 'Закладка');
          }
        }catch{}
      }
    });
    }
  }

  // Обновить вид мини-кнопок (✎/✕) с учётом Ctrl
  updateEditMiniButtonsIcon();
  // Восстанавливаем скролл после перестановки
  try{ if (isReorder && scroller) scroller.scrollTop = savedScroll; }catch{}
  // Убираем временную фиксацию высоты
  try{ if (isReorder && $list) $list.style.minHeight = ''; }catch{}
  if (prevRects) {
    animateFlip(prevRects);
  } else {
    // Если FLIP не запущен, показать содержимое на следующий кадр
    try{ requestAnimationFrame(()=>{ try{ $list.classList.remove('rendering'); }catch{} }); }catch{}
  }
  
  // Не предзагружаем внешние фавиконы: используем внутренний кэш Chrome
  } catch (error) {
    console.error('Ошибка в render:', error);
  } finally {
    // На всякий случай снимаем скрытие, чтобы не зависнуть в невидимом состоянии
    try{ $list.classList.remove('rendering'); }catch{}
    renderInProgress = false;
  }
}

/* ---------- ВИРТУАЛИЗИРОВАННЫЙ ПИКЕР ---------- */
function openIconPicker(onPick){
  const $picker   = document.getElementById("iconPicker");
  const $iconGrid = document.getElementById("iconGrid");
  const $iconSearch = document.getElementById("iconSearch");
  const $iconClose  = document.getElementById("iconClose");

  const PAGE_SIZE = 120;
  let full = [];
  let data = [];
  let rendered = 0;
  let loading = false;
  let destroyed = false;

  const debounced = (fn, ms=180) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  function clearGrid(){ $iconGrid.innerHTML=""; rendered=0; }

  async function ensureDataLoaded(){
    if (full.length) return;
    const m = await loadIconManifest();
    full = Array.isArray(m.icons)? m.icons : [];
  }
  function applyFilter(q){
    const s=(q||"").trim().toLowerCase();
    if(!s){ data=full; return; }
    data = full.filter(i =>
      i.id.toLowerCase().includes(s) ||
      (i.tags||[]).some(t => String(t).toLowerCase().includes(s))
    );
  }
  async function renderNext(){
    if (loading||destroyed) return;
    if (rendered >= data.length) return;
    loading = true;

    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + PAGE_SIZE, data.length);
    for (let i=rendered; i<end; i++){
      const icon = data[i];
      const cell = document.createElement("button");
      cell.className="icon-cell"; cell.title=icon.id;

      const img=document.createElement("img");
      img.src=chrome.runtime.getURL(icon.path); img.alt=icon.id;
      cell.appendChild(img);

      cell.addEventListener("click", async ()=>{
        const dataUrl = await svgFileToDataUrl(icon.path);
        onPick({ dataUrl, tone: "mono" });
        closeIconPicker();
      });

      frag.appendChild(cell);
    }
    $iconGrid.appendChild(frag);
    rendered = end;
    loading = false;
  }
  async function renderFromStart(q=""){
    await ensureDataLoaded();
    applyFilter(q);
    clearGrid();
    await renderNext();
    requestAnimationFrame(renderNext);
  }
  function onScroll(){
    if (destroyed) return;
    const nearBottom = $iconGrid.scrollTop + $iconGrid.clientHeight >= $iconGrid.scrollHeight - 200;
    if (nearBottom) renderNext();
  }

  // open
  $picker.classList.add("open");
  $picker.setAttribute("aria-hidden","false");

  const onInput = debounced(()=> renderFromStart($iconSearch.value), 200);
  $iconSearch.value="";
  $iconSearch.addEventListener("input", onInput, { passive:true });
  $iconGrid.addEventListener("scroll", onScroll, { passive:true });

  function closeIconPicker(){
    destroyed = true;
    $iconSearch.removeEventListener("input", onInput);
    $iconGrid.removeEventListener("scroll", onScroll);
    $iconClose.removeEventListener("click", closeIconPicker);
    $picker.classList.remove("open");
    $picker.setAttribute("aria-hidden","true");
  }
  $iconClose.addEventListener("click", closeIconPicker);

  renderFromStart().then(()=> setTimeout(()=> $iconSearch.focus(), 50));
}

/* ---------- редактор ---------- */
function toolBtn(svg, title){
  const b=document.createElement("button");
  b.className="toolbtn"; b.title=title; b.innerHTML=svg; return b;
}
const SVG_GRID   = '<svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z"/></svg>';
const SVG_UPLOAD = '<svg viewBox="0 0 24 24"><path d="M12 3l4 4h-3v6h-2V7H8l4-4Zm-7 9h2v7h12v-7h2v9H5v-9Z"/></svg>';
const SVG_RESET  = '<svg viewBox="0 0 24 24"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-4.9 6.1l-1.95.44A7 7 0 1 0 12 5Z"/></svg>';
const SVG_SEARCH = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';

// Флаги панелей
let editorOpen = false;
let settingsOpen = false;
// Какой именно редактор открыт: 'add' | 'edit' | null
let editorKind = null;

// Теневое состояние Settings и dirty-метка
let settingsBaseline = null;
let settingsDirty = false;
function markDirty(on){
  settingsDirty = !!on;
  if ($settingsSave) $settingsSave.disabled = !settingsDirty;
}
function gatherControlsState(){
  const tilePercent = clampUserPercent($tileSizeInput?.value ?? $tileSizeRange?.value ?? 60);
  const listIconPercent = clampUserPercent($listIconSizeInput?.value ?? $listIconSizeRange?.value ?? 60);
  const rootViewMode = ($rootViewMode?.value === 'list') ? 'list' : 'grid';
  const folderDefaultViewMode = ($folderDefaultViewMode?.value === 'list') ? 'list' : 'grid';
  const tileOpacity = clampOpacityPercent($tileOpacityInput?.value ?? $tileOpacityRange?.value ?? 0);
  const folderOpacity = clampOpacityPercent($folderOpacityInput?.value ?? $folderOpacityRange?.value ?? 60);
  const tileGapPercent = clampGapPercent($tileGapInput?.value ?? $tileGapRange?.value ?? 100);
  const faviconSaturation = clampSaturationPercent($faviconSaturationInput?.value ?? $faviconSaturationRange?.value ?? 100);
  const maxCols = clampMaxCols($maxColsInput?.value ?? $maxColsRange?.value ?? 5);
  const showTitles = !!($showTitlesInline?.checked);
  const showChromeFolders = !!($showChromeFolders?.checked);
  const bgTransparent = !!($widgetBgTransparent?.checked);
  const footerTransparent = !!($footerTransparent?.checked);
  const theme = $themeToggleInline?.checked ? 'light' : 'dark';
  const iconTheme = $themeIconToggleInline?.checked ? 'light' : 'dark';
  return { tilePercent, listIconPercent, rootViewMode, folderDefaultViewMode, tileOpacity, folderOpacity, tileGapPercent, faviconSaturation, maxCols, showTitles, showChromeFolders, bgTransparent, footerTransparent, theme, iconTheme };
}
function shallowEqualSettings(a,b){
  if(!a||!b) return false;
  const keys=["tilePercent","listIconPercent","rootViewMode","folderDefaultViewMode","tileOpacity","folderOpacity","tileGapPercent","faviconSaturation","maxCols","showTitles","showChromeFolders","bgTransparent","footerTransparent","theme","iconTheme"];
  return keys.every(k => (a[k] ?? null) === (b[k] ?? null));
}
async function commitSettings(){
  const s = gatherControlsState();
  await chrome.storage.local.set({
    [TILE_PERCENT_KEY]: s.tilePercent,
    [LIST_ICON_PERCENT_KEY]: s.listIconPercent,
    [ROOT_VIEW_MODE_KEY]: s.rootViewMode,
    [FOLDER_DEFAULT_VIEW_MODE_KEY]: s.folderDefaultViewMode,
    [TILE_OPACITY_KEY]: s.tileOpacity,
    [FOLDER_OPACITY_KEY]: s.folderOpacity,
    [FAVICON_SATURATION_KEY]: s.faviconSaturation,
    [MAX_COLS_KEY]: s.maxCols,
    [SHOW_TITLES_KEY]: !!s.showTitles,
    [SHOW_CHROME_FOLDERS_KEY]: !!s.showChromeFolders,
    [BG_TRANSPARENT_KEY]: !!s.bgTransparent,
    [FOOTER_TRANSPARENT_KEY]: !!s.footerTransparent,
    [THEME_KEY]: s.theme,
    [ICON_THEME_KEY]: s.iconTheme,
  });
  applyTheme(s.theme, {save:false});
  setActionIconByTheme(s.iconTheme);
  applyListIconPercentUser(s.listIconPercent, {save:false});
  settingsBaseline = s;
  markDirty(false);
  try{ await render(); }catch{}
  // Закрыть панель настроек после сохранения
  closeSettingsPanel();
}
async function revertSettings(){
  const st = await chrome.storage.local.get({
    [TILE_PERCENT_KEY]: 60,
    [LIST_ICON_PERCENT_KEY]: 60,
    [ROOT_VIEW_MODE_KEY]: 'grid',
    [FOLDER_DEFAULT_VIEW_MODE_KEY]: 'grid',
    [TILE_OPACITY_KEY]: 0,
    [FOLDER_OPACITY_KEY]: 60,
    [FAVICON_SATURATION_KEY]: 100,
    [MAX_COLS_KEY]: 5,
    [SHOW_TITLES_KEY]: false,
    [SHOW_CHROME_FOLDERS_KEY]: true,
    [BG_TRANSPARENT_KEY]: false,
    [FOOTER_TRANSPARENT_KEY]: false,
    [THEME_KEY]: 'dark',
    [ICON_THEME_KEY]: 'dark',
  });
  const s = {
    tilePercent: clampUserPercent(st[TILE_PERCENT_KEY]),
    listIconPercent: clampUserPercent(st[LIST_ICON_PERCENT_KEY]),
    rootViewMode: (st[ROOT_VIEW_MODE_KEY]==='list') ? 'list' : 'grid',
    folderDefaultViewMode: (st[FOLDER_DEFAULT_VIEW_MODE_KEY]==='list') ? 'list' : 'grid',
    tileOpacity: clampOpacityPercent(st[TILE_OPACITY_KEY]),
    folderOpacity: clampOpacityPercent(st[FOLDER_OPACITY_KEY]),
    tileGapPercent: clampGapPercent(st[TILE_GAP_PERCENT_KEY] ?? 100),
    faviconSaturation: clampSaturationPercent(st[FAVICON_SATURATION_KEY]),
    maxCols: clampMaxCols(st[MAX_COLS_KEY]),
    showTitles: !!st[SHOW_TITLES_KEY],
    showChromeFolders: !!st[SHOW_CHROME_FOLDERS_KEY],
    bgTransparent: !!st[BG_TRANSPARENT_KEY],
    footerTransparent: !!st[FOOTER_TRANSPARENT_KEY],
    theme: st[THEME_KEY] || 'dark',
    iconTheme: st[ICON_THEME_KEY] || 'dark',
  };
  // Применить без записи
  applyTilePercentUser(s.tilePercent, {save:false, recalcWidth: !isSettingsOpen()});
  applyListIconPercentUser(s.listIconPercent, {save:false});
  // Применяем root view (без записи)
  document.documentElement.classList.toggle('root-list-view', s.rootViewMode==='list');
  applyTileOpacityUser(s.tileOpacity, {save:false});
  applyFolderOpacityUser(s.folderOpacity, {save:false});
  applyFaviconSaturationUser(s.faviconSaturation, {save:false});
  applyMaxCols(s.maxCols, {save:false, recalcWidth: !isSettingsOpen()});
  applyShowTitles(s.showTitles, {save:false});
  applyWidgetBgTransparency(s.bgTransparent, {save:false});
  applyFooterTransparency(s.footerTransparent, {save:false});
  if ($themeToggleInline) $themeToggleInline.checked = (s.theme === 'light');
  applyTheme(s.theme, {save:false});
  // Синхронизировать контролы
  if ($tileSizeRange) $tileSizeRange.value = String(s.tilePercent);
  if ($tileSizeInput) $tileSizeInput.value = String(s.tilePercent);
  if ($listIconSizeRange) $listIconSizeRange.value = String(s.listIconPercent);
  if ($listIconSizeInput) $listIconSizeInput.value = String(s.listIconPercent);
  if ($rootViewMode) $rootViewMode.value = s.rootViewMode;
  if ($folderDefaultViewMode) $folderDefaultViewMode.value = s.folderDefaultViewMode;
  if ($listIconSizeRange) $listIconSizeRange.value = String(s.listIconPercent);
  if ($listIconSizeInput) $listIconSizeInput.value = String(s.listIconPercent);
  if ($tileOpacityRange) $tileOpacityRange.value = String(s.tileOpacity);
  if ($tileOpacityInput) $tileOpacityInput.value = String(s.tileOpacity);
  if ($folderOpacityRange) $folderOpacityRange.value = String(s.folderOpacity);
  if ($folderOpacityInput) $folderOpacityInput.value = String(s.folderOpacity);
  if ($tileGapRange) $tileGapRange.value = String(s.tileGapPercent);
  if ($tileGapInput) $tileGapInput.value = String(s.tileGapPercent);
  if ($faviconSaturationRange) $faviconSaturationRange.value = String(s.faviconSaturation);
  if ($faviconSaturationInput) $faviconSaturationInput.value = String(s.faviconSaturation);
  if ($maxColsRange) $maxColsRange.value = String(s.maxCols);
  if ($maxColsInput) $maxColsInput.value = String(s.maxCols);
  if ($showTitlesInline) $showTitlesInline.checked = !!s.showTitles;
  if ($showChromeFolders) $showChromeFolders.checked = !!s.showChromeFolders;
  if ($themeIconToggleInline) $themeIconToggleInline.checked = (s.iconTheme === 'light');
  if ($widgetBgTransparent) $widgetBgTransparent.checked = !!s.bgTransparent;
  if ($footerTransparent) $footerTransparent.checked = !!s.footerTransparent;
  settingsBaseline = s;
  markDirty(false);
}

function openEditorOverlay(item){
  editorOpen = true;
  editorKind = 'edit';
  if ($btnEdit) $btnEdit.classList.add('active');
  if ($btnAdd) { $btnAdd.classList.remove('active'); $btnAdd.setAttribute('aria-pressed','false'); }
  if ($btnSettings) { $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
  // Жёсткая фиксация ширины для режима редактора
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $overlay.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="panel";

  const favWrap=document.createElement("div"); favWrap.className="edit-fav";

  const previewBox=document.createElement("div"); previewBox.className="preview"; previewBox.title="Загрузить файл";
  const prevImg=document.createElement("img"); prevImg.alt="";
  // Предпросмотр должен отражать фактически используемый фавикон
  let useAutoPreview = false;
  if (item.iconCustom && item.favicon){
    prevImg.src = item.favicon;
    prevImg.classList.toggle('mono', (item.iconTone||null)==='mono');
  } else if (item.favicon && String(item.favicon).startsWith('data:')){
    prevImg.src = item.favicon;
    prevImg.classList.toggle('mono', (item.iconTone||null)==='mono');
  } else {
    // Для несохранённых иконок показываем авто-фавикон как в рендере
    useAutoPreview = true;
    prevImg.classList.remove('mono');
    try{ setFaviconWithFallback(prevImg, item.url, 64); }catch{ prevImg.src = DEFAULT_ICON; }
  }

  // Добавляем обработчик ошибок только для не-авто превью, чтобы не ломать fallback
  if (!useAutoPreview){
    prevImg.onerror = () => {
      console.error('Ошибка загрузки иконки:', prevImg.src);
      if (prevImg.src !== DEFAULT_ICON) {
        // Если не удалось загрузить иконку закладки, используем дефолтную
        prevImg.src = DEFAULT_ICON;
      } else {
        // Если не удалось загрузить дефолтную иконку, попробуем загрузить как data URL
        fetch(DEFAULT_ICON)
          .then(response => response.blob())
          .then(blob => {
            const reader = new FileReader();
            reader.onload = () => {
              prevImg.src = reader.result;
            };
            reader.readAsDataURL(blob);
          })
          .catch(err => {
            console.error('Не удалось загрузить дефолтную иконку:', err);
          });
      }
    };
  }
  previewBox.appendChild(prevImg);

  const btnPick = toolBtn(SVG_GRID,   "Выбрать из набора");
  const btnUp   = toolBtn(SVG_UPLOAD, "Загрузить файл");
  const btnRes  = toolBtn(SVG_RESET,  "Сбросить иконку");
  favWrap.appendChild(previewBox); favWrap.appendChild(btnPick); favWrap.appendChild(btnUp); favWrap.appendChild(btnRes);

  const fileInput=document.createElement("input");
  fileInput.type="file"; fileInput.accept="image/*,.ico,.svg"; fileInput.style.display="none";
  previewBox.addEventListener("click", ()=>fileInput.click());
  btnUp.addEventListener("click", ()=>fileInput.click());

  const fr1=document.createElement("div"); fr1.className="form-row";
  fr1.innerHTML='<label>Name</label>';
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Name"; inTitle.value=item.title||"";
  fr1.appendChild(inTitle);

  const fr2=document.createElement("div"); fr2.className="form-row";
  fr2.innerHTML='<label>URL</label>';
  const inUrl=document.createElement("input"); inUrl.type="url"; inUrl.placeholder="https://example.com"; inUrl.value=item.url||"";
  fr2.appendChild(inUrl);

  // Поле выбора папки
  const frFolder=document.createElement("div"); frFolder.className="form-row"; frFolder.innerHTML='<label>Папка</label>';
  const inFolder=document.createElement("select"); inFolder.style.display="none"; // Скрыто по умолчанию
  const defaultOption=document.createElement("option"); defaultOption.value=""; defaultOption.textContent="Без папки"; inFolder.appendChild(defaultOption);
  frFolder.appendChild(inFolder);

  // Поле: Icon URL
  const frIcon=document.createElement("div"); frIcon.className="form-row";
  frIcon.innerHTML='<label>Icon URL</label>';
  const inIconUrl=document.createElement("input"); inIconUrl.type="url"; inIconUrl.placeholder="https://example.com/icon.png";
  frIcon.appendChild(inIconUrl);
  // Предзаполнить URL: если сохранён кастомный http(s) — показываем его, иначе показываем авто-URL для наглядности
  try{
    if(/^https?:\/\//i.test(String(item.favicon||''))){
      inIconUrl.value = String(item.favicon);
    } else {
      try{ inIconUrl.value = runtimeFaviconUrl(item.url, 64); inIconUrl.dataset.autofill = '1'; }catch{}
    }
  }catch{}
  // Если пользователь начнёт редактировать поле — считаем это пользовательским вводом
  inIconUrl.addEventListener('input', ()=>{ try{ delete inIconUrl.dataset.autofill; }catch{} });

  const actions=document.createElement("div"); actions.className="actions";
  const del=document.createElement("button"); del.className="danger"; del.textContent="Delete";
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Cancel";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Save";
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(del); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(fr2); wrap.appendChild(frFolder); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = item.favicon || DEFAULT_ICON;
  let currentIconCustom = !!(item.favicon && /^https?:\/\//i.test(String(item.favicon||'')));
  let currentTone = item.iconTone || null;

  // Загружаем папки и обновляем поле выбора
  async function loadFolders() {
    const folders = await getFolders();
    if (folders.length > 0) {
      inFolder.style.display = "block";
      // Очищаем старые опции (кроме первой)
      while (inFolder.children.length > 1) {
        inFolder.removeChild(inFolder.lastChild);
      }
      // Добавляем папки
      folders.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        option.selected = folder.id === item.folderId;
        inFolder.appendChild(option);
      });
    } else {
      inFolder.style.display = "none";
    }
  }
  loadFolders();

  const validate = ()=>{ const ok=inTitle.value.trim() && inUrl.value.trim() && isValidUrl(inUrl.value); save.disabled=!ok; };
  inTitle.addEventListener("input", validate); inUrl.addEventListener("input", validate); validate();

  fileInput.addEventListener("change", ()=>{
    const f=fileInput.files?.[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{ currentIcon=r.result; currentTone=null; prevImg.src=currentIcon; prevImg.classList.toggle('mono', false); };
    r.readAsDataURL(f);
  });
  // Обработка URL иконки по блюру
  function normalizeHttpUrl(v){
    let x=(v||"").trim(); if(!x) return null;
    if(!/^https?:\/\//i.test(x)) x="https://"+x;
    try{ const u=new URL(x); if(u.protocol==="http:"||u.protocol==="https:") return u.toString(); }catch{}
    return null;
  }
  inIconUrl.addEventListener("blur", ()=>{
    const norm = normalizeHttpUrl(inIconUrl.value);
    if(!norm) return; // опционально; не блокируем сохранение
    inIconUrl.value = norm;
    const testUrl = norm;
    // Пробуем показать превью и только по успешной загрузке фиксируем currentIcon
    const onLoad = ()=>{
      if (prevImg.src === testUrl){
        currentIcon = testUrl; currentTone = null;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    const onError = ()=>{
      if (prevImg.src === testUrl){
        prevImg.src = DEFAULT_ICON; // откат превью
        // currentIcon/currentTone не трогаем
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    prevImg.addEventListener('load', onLoad);
    prevImg.addEventListener('error', onError);
    prevImg.classList.remove('mono');
    prevImg.src = testUrl;
  });
  btnPick.addEventListener("click", ()=>{
    openIconPicker(({dataUrl, tone})=>{
      currentIcon = dataUrl; currentTone = tone || 'mono';
      prevImg.src = dataUrl; prevImg.classList.toggle('mono', currentTone==='mono');
    });
  });
  btnRes.addEventListener("click", ()=>{
    // Сбрасываем к стандартной авто-системе и обновляем предпросмотр так же, как в рендере
    currentIcon = null; currentTone = null; currentIconCustom = false;
    prevImg.classList.remove('mono');
    let u = (inUrl?.value||'').trim(); if(!/^https?:\/\//i.test(u)) u = 'https://'+u;
    try{ new URL(u); setFaviconWithFallback(prevImg, u, 64); }
    catch{ try{ setFaviconWithFallback(prevImg, item.url, 64); }catch{ prevImg.src = DEFAULT_ICON; } }
  });

  del.addEventListener("click", async ()=>{
    if(!confirm("Удалить?")) return;
    const arr=await getLinks(); const i=arr.findIndex(x=>x.id===item.id);
    if(i>=0){
      arr.splice(i,1);
      await setLinks(arr);
      try{ chrome.runtime.sendMessage({ type:'extRemoveLink', linkId: item.id }); }catch{}
      // Очищаем кэш после удаления закладки
      await cleanupFaviconCache();
      // Закрываем редактор и отдаём управление шириной согласно открытому состоянию панелей
      editorOpen = false; editorKind = null;
      await render();
      $overlay.classList.remove("open");
      $overlay.innerHTML="";
      if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
      if (!settingsOpen){
        $card.classList.remove('freeze-size');
        $card.style.width = '';
        restoreWidthByLinks();
      }
    }
  });
  cancel.addEventListener("click", async ()=>{
    $overlay.classList.remove("open"); $overlay.innerHTML="";
    editorOpen = false; editorKind = null;
    if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
    const arr=await getLinks();
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
  save.addEventListener("click", async ()=>{
    let url=inUrl.value.trim(); if(!/^https?:\/\//i.test(url)) url="https://"+url; try{ new URL(url); }catch{ return; }
    // Если введён URL иконки, но не успели выйти из поля, учитываем его
    (function(){
      let v=(inIconUrl?.value||'').trim();
      if(v && String(inIconUrl?.dataset?.autofill) !== '1'){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; currentIconCustom=true; } }catch{} }
    })();
    const arr=await getLinks(); const i=arr.findIndex(x=>x.id===item.id);
    if(i>=0){
      const selectedFolderId = inFolder.value || null;
      arr[i]={...arr[i], title:inTitle.value.trim()||arr[i].title, url, favicon:currentIcon, iconTone: currentTone, iconCustom: !!currentIconCustom, folderId: selectedFolderId};
      await setLinks(arr);
      try{ chrome.runtime.sendMessage({ type:'extUpdateLink', link: arr[i] }); }catch{}
      editorOpen = false; editorKind = null;
      await render();
      $overlay.classList.remove("open");
      $overlay.innerHTML="";
      if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
      if (!settingsOpen){
        $card.classList.remove('freeze-size');
        $card.style.width = '';
        restoreWidthByLinks();
      }
    }
  });
}

/* ---------- редактор папок ---------- */
function openFolderEditorOverlay(folder){
  editorOpen = true;
  editorKind = 'edit';
  if ($btnEdit) $btnEdit.classList.add('active');
  if ($btnAdd) { $btnAdd.classList.remove('active'); $btnAdd.setAttribute('aria-pressed','false'); }
  if ($btnSettings) { $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
  // Жёсткая фиксация ширины для режима редактора
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $overlay.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="panel";

  const favWrap=document.createElement("div"); favWrap.className="edit-fav";

  const previewBox=document.createElement("div"); previewBox.className="preview"; previewBox.title="Загрузить файл";
  const prevImg=document.createElement("img"); prevImg.alt="";
  prevImg.src=folder.icon||getDefaultFolderIconSync();
  prevImg.classList.toggle('mono', (folder.iconTone||null)==='mono');
  previewBox.appendChild(prevImg);

  const btnPick = toolBtn(SVG_GRID,   "Выбрать из набора");
  const btnUp   = toolBtn(SVG_UPLOAD, "Загрузить файл");
  const btnRes  = toolBtn(SVG_RESET,  "Сбросить иконку");
  favWrap.appendChild(previewBox); favWrap.appendChild(btnPick); favWrap.appendChild(btnUp); favWrap.appendChild(btnRes);

  const fileInput=document.createElement("input");
  fileInput.type="file"; fileInput.accept="image/*,.ico,.svg"; fileInput.style.display="none";
  previewBox.addEventListener("click", ()=>fileInput.click());
  btnUp.addEventListener("click", ()=>fileInput.click());

  const fr1=document.createElement("div"); fr1.className="form-row";
  fr1.innerHTML='<label>Название папки</label>';
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Название папки"; inTitle.maxLength=32; inTitle.value=(folder.name||"").slice(0,32);
  fr1.appendChild(inTitle);

  // Поле: Icon URL
  const frIcon=document.createElement("div"); frIcon.className="form-row";
  frIcon.innerHTML='<label>Icon URL</label>';
  const inIconUrl=document.createElement("input"); inIconUrl.type="url"; inIconUrl.placeholder="https://example.com/icon.png";
  // Предзаполнить URL, если текущая иконка — http(s)
  try{ if(/^https?:\/\//i.test(String(folder.icon||''))) inIconUrl.value = String(folder.icon); }catch{}
  frIcon.appendChild(inIconUrl);

  const actions=document.createElement("div"); actions.className="actions";
  const del=document.createElement("button"); del.className="danger"; del.textContent="Удалить";
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Отмена";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Сохранить";
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(del); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = folder.icon || getDefaultFolderIconSync();
  let currentTone = folder.iconTone || null;

  const validate = ()=>{ const ok=inTitle.value.trim(); save.disabled=!ok; };
  inTitle.addEventListener("input", validate); validate();

  // Обработка URL иконки по блюру
  function normalizeHttpUrl_folder(v){
    let x=(v||"").trim(); if(!x) return null;
    if(!/^https?:\/\//i.test(x)) x="https://"+x;
    try{ const u=new URL(x); if(u.protocol==="http:"||u.protocol==="https:") return u.toString(); }catch{}
    return null;
  }
  inIconUrl.addEventListener("blur", ()=>{
    const norm = normalizeHttpUrl_folder(inIconUrl.value);
    if(!norm) return;
    inIconUrl.value = norm;
    const testUrl = norm;
    const onLoad = ()=>{
      if (prevImg.src === testUrl){
        currentIcon = testUrl; currentTone = null;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    const onError = ()=>{
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    prevImg.addEventListener('load', onLoad);
    prevImg.addEventListener('error', onError);
    prevImg.src = testUrl;
  });

  fileInput.addEventListener("change", ()=>{
    const f=fileInput.files?.[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{ currentIcon=r.result; currentTone=null; prevImg.src=currentIcon; prevImg.classList.toggle('mono', false); };
    r.readAsDataURL(f);
  });
  btnPick.addEventListener("click", ()=>{
    openIconPicker(({dataUrl, tone})=>{
      currentIcon = dataUrl; currentTone = tone || 'mono';
      prevImg.src = dataUrl; prevImg.classList.toggle('mono', currentTone==='mono');
    });
  });
  btnRes.addEventListener("click", ()=>{
    currentIcon = getDefaultFolderIconSync(); currentTone=null;
    prevImg.src = getDefaultFolderIconSync(); prevImg.classList.remove('mono');
  });

  del.addEventListener("click", async ()=>{
    if(!confirm("Удалить папку?")) return;
    const folders=await getFolders(); const i=folders.findIndex(x=>x.id===folder.id);
    if(i>=0){
      folders.splice(i,1);
      await setFolders(folders);
      // Очищаем кэш после удаления папки
      await cleanupFaviconCache();
      // Закрываем редактор и отдаём управление шириной согласно открытому состоянию панелей
      editorOpen = false; editorKind = null;
      await render();
      $overlay.classList.remove("open");
      $overlay.innerHTML="";
      if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
      if (!settingsOpen){
        $card.classList.remove('freeze-size');
        $card.style.width = '';
        restoreWidthByLinks();
      }
    }
  });
  cancel.addEventListener("click", async ()=>{
    $overlay.classList.remove("open"); $overlay.innerHTML="";
    editorOpen = false; editorKind = null;
    if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
    const arr=await getLinks();
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
  save.addEventListener("click", async ()=>{
    // Если введён URL иконки, но не успели выйти из поля, учитываем его
    (function(){
      let v=(inIconUrl?.value||'').trim();
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; } }catch{} }
    })();
    const folders=await getFolders(); const i=folders.findIndex(x=>x.id===folder.id);
    if(i>=0){
      folders[i]={...folders[i], name:(inTitle.value||'').slice(0,32).trim()||folders[i].name, icon:currentIcon, iconTone: currentTone};
      await setFolders(folders);
      editorOpen = false; editorKind = null;
      await render();
      $overlay.classList.remove("open");
      $overlay.innerHTML="";
      if ($btnEdit && !editMode) $btnEdit.classList.remove('active');
      if (!settingsOpen){
        $card.classList.remove('freeze-size');
        $card.style.width = '';
        restoreWidthByLinks();
      }
    }
  });
}

/* ---------- создание папки ---------- */
function openCreateFolderOverlay(){
  editorOpen = true;
  editorKind = 'add';
  if ($btnAdd) $btnAdd.classList.add('active');
  if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  if ($btnEdit) { $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
  if ($btnSettings) { $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
  // Жёсткая фиксация ширины для режима редактора (добавления)
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $overlay.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="panel";

  const favWrap=document.createElement("div"); favWrap.className="edit-fav";
  const previewBox=document.createElement("div"); previewBox.className="preview"; previewBox.title="Загрузить файл";
  const prevImg=document.createElement("img"); prevImg.alt=""; prevImg.src=getDefaultFolderIconSync();
  previewBox.appendChild(prevImg);

  const btnPick = toolBtn(SVG_GRID,   "Выбрать из набора");
  const btnUp   = toolBtn(SVG_UPLOAD, "Загрузить файл");
  favWrap.appendChild(previewBox); favWrap.appendChild(btnPick); favWrap.appendChild(btnUp);

  const fileInput=document.createElement("input");
  fileInput.type="file"; fileInput.accept="image/*,.ico,.svg"; fileInput.style.display="none";
  previewBox.addEventListener("click", ()=>fileInput.click());
  btnUp.addEventListener("click", ()=>fileInput.click());

  const fr1=document.createElement("div"); fr1.className="form-row"; fr1.innerHTML='<label>Название папки</label>';
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Название папки"; inTitle.maxLength=32; fr1.appendChild(inTitle);

  // Поле: Icon URL
  const frIcon=document.createElement("div"); frIcon.className="form-row";
  frIcon.innerHTML='<label>Icon URL</label>';
  const inIconUrl=document.createElement("input"); inIconUrl.type="url"; inIconUrl.placeholder="https://example.com/icon.png"; frIcon.appendChild(inIconUrl);

  const actions=document.createElement("div"); actions.className="actions";
  const left=document.createElement("div");
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Отмена";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Создать"; save.disabled=true;
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(left); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = getDefaultFolderIconSync();
  let currentTone = null;

  const update=()=>{ save.disabled=!(inTitle.value.trim()); };
  inTitle.addEventListener("input", update); update();

  fileInput.addEventListener("change", ()=>{
    const f=fileInput.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ currentIcon=r.result; currentTone=null; prevImg.src=currentIcon; prevImg.classList.remove('mono'); };
    r.readAsDataURL(f);
  });

  // Обработка URL иконки по блюру
  function normalizeHttpUrl_folderCreate(v){
    let x=(v||"").trim(); if(!x) return null;
    if(!/^https?:\/\//i.test(x)) x="https://"+x;
    try{ const u=new URL(x); if(u.protocol==="http:"||u.protocol==="https:") return u.toString(); }catch{}
    return null;
  }
  inIconUrl.addEventListener("blur", ()=>{
    const norm = normalizeHttpUrl_folderCreate(inIconUrl.value);
    if(!norm) return;
    inIconUrl.value = norm;
    const testUrl = norm;
    const onLoad = ()=>{
      if (prevImg.src === testUrl){
        currentIcon = testUrl; currentTone = null;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    const onError = ()=>{
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    prevImg.addEventListener('load', onLoad);
    prevImg.addEventListener('error', onError);
    prevImg.src = testUrl;
  });
  btnPick.addEventListener("click", ()=>openIconPicker(({dataUrl, tone})=>{
    currentIcon=dataUrl; currentTone=tone||'mono'; prevImg.src=dataUrl; prevImg.classList.toggle('mono', currentTone==='mono');
  }));

  cancel.addEventListener("click", async ()=>{
    $overlay.classList.remove("open"); $overlay.innerHTML="";
    editorOpen = false; editorKind = null;
    if ($btnAdd) $btnAdd.classList.remove('active');
    const arr=await getLinks();
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
  save.addEventListener("click", async ()=>{
    // Если введён URL иконки, но не успели выйти из поля, учитываем его
    (function(){
      let v=(inIconUrl?.value||'').trim();
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; } }catch{} }
    })();
    const newFolder = await createFolder(inTitle.value.trim(), currentIcon);
    editorOpen = false; editorKind = null;
    try{ chrome.runtime.sendMessage({ type:'extAddFolder', folder: newFolder }); }catch{}
    await render();
    $overlay.classList.remove("open");
    $overlay.innerHTML="";
    if ($btnAdd) $btnAdd.classList.remove('active');
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
}

/* ---------- добавление ---------- */
function openAddOverlay(){
  editorOpen = true;
  editorKind = 'add';
  if ($btnAdd) $btnAdd.classList.add('active');
  if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  if ($btnEdit) { $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
  if ($btnSettings) { $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
  // Жёсткая фиксация ширины для режима редактора (добавления)
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $overlay.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="panel";

  const favWrap=document.createElement("div"); favWrap.className="edit-fav";
  const previewBox=document.createElement("div"); previewBox.className="preview"; previewBox.title="Загрузить файл";
  const prevImg=document.createElement("img"); prevImg.alt=""; prevImg.src=DEFAULT_ICON;
  prevImg.onerror = () => {
    console.error('Ошибка загрузки дефолтной иконки:', DEFAULT_ICON);
    // Попробуем загрузить иконку как data URL
    fetch(DEFAULT_ICON)
      .then(response => response.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onload = () => {
          prevImg.src = reader.result;
        };
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        console.error('Не удалось загрузить дефолтную иконку:', err);
      });
  };
  previewBox.appendChild(prevImg);

  const btnPick = toolBtn(SVG_GRID,   "Выбрать из набора");
  const btnUp   = toolBtn(SVG_UPLOAD, "Загрузить файл");
  favWrap.appendChild(previewBox); favWrap.appendChild(btnPick); favWrap.appendChild(btnUp);

  const fileInput=document.createElement("input");
  fileInput.type="file"; fileInput.accept="image/*,.ico,.svg"; fileInput.style.display="none";
  previewBox.addEventListener("click", ()=>fileInput.click());
  btnUp.addEventListener("click", ()=>fileInput.click());

  const fr1=document.createElement("div"); fr1.className="form-row"; fr1.innerHTML='<label>Name</label>';
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Name"; fr1.appendChild(inTitle);

  const fr2=document.createElement("div"); fr2.className="form-row"; fr2.innerHTML='<label>URL</label>';
  const inUrl=document.createElement("input"); inUrl.type="url"; inUrl.placeholder="https://example.com"; fr2.appendChild(inUrl);

  // Поле выбора папки
  const frFolder=document.createElement("div"); frFolder.className="form-row"; frFolder.innerHTML='<label>Папка</label>';
  const inFolder=document.createElement("select"); inFolder.style.display="none"; // Скрыто по умолчанию
  const defaultOption=document.createElement("option"); defaultOption.value=""; defaultOption.textContent="Без папки"; inFolder.appendChild(defaultOption);
  frFolder.appendChild(inFolder);

  // Поле: Icon URL
  const frIcon=document.createElement("div"); frIcon.className="form-row";
  frIcon.innerHTML='<label>Icon URL</label>';
  const inIconUrl=document.createElement("input"); inIconUrl.type="url"; inIconUrl.placeholder="https://example.com/icon.png"; frIcon.appendChild(inIconUrl);

  const actions=document.createElement("div"); actions.className="actions";
  const left=document.createElement("div");
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Cancel";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Save"; save.disabled=true;
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(left); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(fr2); wrap.appendChild(frFolder); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = DEFAULT_ICON;
  let currentIconCustom = false;
  let currentTone = null;

  // Загружаем папки и обновляем поле выбора
  async function loadFolders() {
    const folders = await getFolders();
    if (folders.length > 0) {
      inFolder.style.display = "block";
      // Очищаем старые опции (кроме первой)
      while (inFolder.children.length > 1) {
        inFolder.removeChild(inFolder.lastChild);
      }
      // Добавляем папки
      folders.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        inFolder.appendChild(option);
      });
      
      // Устанавливаем текущую папку по умолчанию, если мы находимся в папке
      if (currentFolderId) {
        inFolder.value = currentFolderId;
      }
    } else {
      inFolder.style.display = "none";
    }
  }
  loadFolders();

  const update=()=>{ save.disabled=!(inTitle.value.trim() && inUrl.value.trim() && isValidUrl(inUrl.value)); };
  inTitle.addEventListener("input", update); inUrl.addEventListener("input", update); update();

  fileInput.addEventListener("change", ()=>{
    const f=fileInput.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ currentIcon=r.result; currentTone=null; prevImg.src=currentIcon; prevImg.classList.remove('mono'); };
    r.readAsDataURL(f);
  });
  btnPick.addEventListener("click", ()=>openIconPicker(({dataUrl, tone})=>{
    currentIcon=dataUrl; currentTone=tone||'mono'; prevImg.src=dataUrl; prevImg.classList.toggle('mono', currentTone==='mono');
  }));

  // Обработка URL иконки по блюру
  function normalizeHttpUrl(v){
    let x=(v||"").trim(); if(!x) return null;
    if(!/^https?:\/\//i.test(x)) x="https://"+x;
    try{ const u=new URL(x); if(u.protocol==="http:"||u.protocol==="https:") return u.toString(); }catch{}
    return null;
  }
  inIconUrl.addEventListener("blur", ()=>{
    const norm = normalizeHttpUrl(inIconUrl.value);
    if(!norm) return; // опционально; не блокируем сохранение
    inIconUrl.value = norm;
    const testUrl = norm;
    const onLoad = ()=>{
      if (prevImg.src === testUrl){
        currentIcon = testUrl; currentTone = null;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    const onError = ()=>{
      if (prevImg.src === testUrl){
        prevImg.src = DEFAULT_ICON;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    prevImg.addEventListener('load', onLoad);
    prevImg.addEventListener('error', onError);
    prevImg.classList.remove('mono');
    prevImg.src = testUrl;
  });

  cancel.addEventListener("click", async ()=>{
    $overlay.classList.remove("open"); $overlay.innerHTML="";
    editorOpen = false; editorKind = null;
    if ($btnAdd) $btnAdd.classList.remove('active');
    const arr=await getLinks();
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
  // Авто‑подстановка визуального URL в Icon URL при вводе URL сайта
  inUrl.addEventListener('blur', ()=>{
    try{
      const v = (inUrl.value||'').trim(); if(!v) return;
      let u = v; if(!/^https?:\/\//i.test(u)) u = 'https://'+u;
      new URL(u);
      // показываем авто‑favicon в поле (визуально), но помечаем как autofill
      inIconUrl.value = runtimeFaviconUrl(u, 64);
      inIconUrl.dataset.autofill = '1';
    }catch{}
  });

  save.addEventListener("click", async ()=>{
    let url=inUrl.value.trim(); if(!/^https?:\/\//i.test(url)) url="https://"+url; try{ new URL(url); }catch{ return; }
    
    // Если введён URL иконки, но не успели выйти из поля, учитываем его
    (function(){
      let v=(inIconUrl?.value||'').trim();
      if(v && String(inIconUrl?.dataset?.autofill) !== '1'){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; currentIconCustom=true; } }catch{} }
    })();
    
    // Единая система: не подставляем авто-фавикон в сохранённые данные;
    // если пользователь ввёл свой URL — он остаётся, иначе сохраняем null
    let finalIcon = (currentIconCustom && typeof currentIcon === 'string')
      ? currentIcon
      : (typeof currentIcon === 'string' && currentIcon.startsWith('data:') ? currentIcon : null);

    const arr=await getLinks();
    const selectedFolderId = inFolder.value || null;
    arr.push({ 
      id:newId(), 
      title:inTitle.value.trim()||url, 
      url, 
      kind:"custom", 
      favicon:finalIcon, 
      iconCustom: !!currentIconCustom,
      iconTone: currentTone,
      folderId: selectedFolderId,
      // Синхронизацию с браузером включаем только если выбрана папка (не корень)
      syncToChrome: !!selectedFolderId
    });
    await setLinks(arr);
    try{ chrome.runtime.sendMessage({ type:'extAddLink', link: arr[arr.length-1] }); }catch{}
    editorOpen = false; editorKind = null;
    await render();
    $overlay.classList.remove("open");
    $overlay.innerHTML="";
    if ($btnAdd) $btnAdd.classList.remove('active');
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
}

// Универсальное закрытие редактора (добавление/редактирование)
function closeEditorOverlay(){
  try{
    $overlay.classList.remove('open');
    $overlay.innerHTML = '';
  }catch{}
  editorOpen = false;
  editorKind = null;
  if ($btnAdd){ $btnAdd.classList.remove('active'); $btnAdd.setAttribute('aria-pressed','false'); }
  // Закрываем панельку добавления при закрытии редактора
  hideAddPanel();
  if (!settingsOpen){
    $card.classList.remove('freeze-size');
    $card.style.width = '';
    restoreWidthByLinks();
  }
}

/* ---------- Панелька добавления ---------- */
let addPanelVisible = false;

function showAddPanel(x = null, y = null) {
  if ($addPanel) {
    // Если переданы координаты, позиционируем панель
    if (x !== null && y !== null) {
      $addPanel.style.position = 'fixed';
      $addPanel.style.left = x + 'px';
      $addPanel.style.top = y + 'px';
      $addPanel.style.bottom = 'auto';
      $addPanel.style.right = 'auto';
      
      // Показываем панель и измеряем её размеры
      $addPanel.classList.add('show');
      addPanelVisible = true;
      
      // Получаем размеры панели и окна
      const panelRect = $addPanel.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      // Проверяем, не выходит ли панель за правый край
      if (panelRect.right > windowWidth) {
        $addPanel.style.left = (x - panelRect.width) + 'px';
      }
      
      // Проверяем, не выходит ли панель за нижний край
      if (panelRect.bottom > windowHeight) {
        $addPanel.style.top = (y - panelRect.height) + 'px';
      }
      
      // Проверяем, не выходит ли панель за левый край
      const newLeft = parseInt($addPanel.style.left);
      if (newLeft < 0) {
        $addPanel.style.left = '8px';
      }
      
      // Проверяем, не выходит ли панель за верхний край
      const newTop = parseInt($addPanel.style.top);
      if (newTop < 0) {
        $addPanel.style.top = '8px';
      }
    } else {
      // Стандартное позиционирование (для кнопки + в футере)
      $addPanel.style.position = '';
      $addPanel.style.left = '';
      $addPanel.style.top = '';
      $addPanel.style.bottom = '';
      $addPanel.style.right = '';
      $addPanel.classList.add('show');
      addPanelVisible = true;
    }
  }
}

function hideAddPanel() {
  if ($addPanel) {
    $addPanel.classList.remove('show');
    addPanelVisible = false;
    // Сбрасываем позиционирование
    $addPanel.style.position = '';
    $addPanel.style.left = '';
    $addPanel.style.top = '';
    $addPanel.style.bottom = '';
    $addPanel.style.right = '';
  }
}

/* ---------- Панелька режимов ---------- */
let editPanelVisible = false;
function showEditPanel(){ if($editPanel){ $editPanel.classList.add('show'); editPanelVisible=true; } }
function hideEditPanel(){ if($editPanel){ $editPanel.classList.remove('show'); editPanelVisible=false; } }

// Функции для контекстного меню
function showContextMenu(x, y, target) {
  if (!$contextMenu) return;
  contextMenuTarget = target;
  contextMenuVisible = true;
  
  // Показываем меню сначала скрытым, чтобы измерить его размеры
  $contextMenu.style.left = x + 'px';
  $contextMenu.style.top = y + 'px';
  // Подготовим кнопку Move и подменю
  (async ()=>{
    if ($contextMoveToggle && $contextMoveSubmenu){
      const folders = await getFolders();
      const hasFolders = Array.isArray(folders) && folders.length > 0;
      $contextMoveToggle.hidden = !hasFolders;
      $contextMoveSubmenu.classList.remove('show');
      $contextMoveSubmenu.innerHTML = '';
      if (hasFolders){
        const targetType = target?.dataset?.type;
        const targetId = target?.dataset?.id;
        // Построим карту вложенности
        const byParent = new Map();
        const byId = new Map();
        folders.forEach(f=>{ byId.set(f.id, f); const p = f.parentFolderId || null; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(f); });
        byParent.forEach(list=>list.sort((a,b)=> a.name.localeCompare(b.name)));

        // Скрываем текущую папку и её потомков при переносе папки
        const skipIds = new Set();
        if (targetType === 'folder' && targetId){
          skipIds.add(targetId);
          const stack = [targetId];
          while(stack.length){
            const node = stack.pop();
            const children = byParent.get(node) || [];
            for(const ch of children){ skipIds.add(ch.id); stack.push(ch.id); }
          }
        }

        // Запрещаем показывать пункт назначения, совпадающий с текущим местоположением
        const hideDestIds = new Set();
        if (targetType === 'link' && targetId){
          try { const linksAll = await getLinks(); const ln = linksAll.find(l=>l.id===targetId); if (ln && ln.folderId) hideDestIds.add(ln.folderId); } catch {}
          if (currentFolderId !== null && currentFolderId !== undefined) hideDestIds.add(currentFolderId);
        } else if (targetType === 'folder' && targetId){
          const cur = byId.get(targetId);
          if (cur && cur.parentFolderId) hideDestIds.add(cur.parentFolderId);
          if (currentFolderId !== null && currentFolderId !== undefined) hideDestIds.add(currentFolderId);
        }

        function addItems(parentId, depth, isLastBranch=true){
          const arr = byParent.get(parentId||null) || [];
          arr.forEach((f, idx)=>{
            if (skipIds.has(f.id)) return;
            if (hideDestIds.has(f.id)) return;
            const isLast = idx === arr.length - 1;
            const btn = document.createElement('button');
            btn.className = 'context-move-item';
            // отступ на ширину иконки на каждый уровень вложенности
            btn.style.setProperty('--indent', `${depth * 20}px`);
            // Иконка папки + текст
            const icon = document.createElement('img');
            icon.className = 'context-folder-icon';
            icon.alt = '';
            icon.src = f.icon || getDefaultFolderIconSync();
            if ((f.iconTone||null)==='mono') icon.classList.add('mono');
            const label = document.createElement('span');
            label.textContent = f.name;
            btn.appendChild(icon);
            btn.appendChild(label);
            btn.addEventListener('click', async ()=>{
              await performContextMove(targetId, targetType, f.id);
            });
            $contextMoveSubmenu.appendChild(btn);
            addItems(f.id, depth+1, isLast);
          });
        }
        // Сначала корневая опция (показываем только если мы находимся внутри какой-то папки)
        if (!(currentFolderId === null || currentFolderId === undefined)) {
          const rootBtn = document.createElement('button');
          rootBtn.className = 'context-move-item';
          const rootLabel = document.createElement('span'); rootLabel.textContent = 'Без папки';
          rootBtn.appendChild(rootLabel);
          rootBtn.addEventListener('click', async ()=>{ await performContextMove(targetId, targetType, '__ROOT__'); });
          $contextMoveSubmenu.appendChild(rootBtn);
        }

        addItems(null, 0, true);

        // Тоггл подменю
        $contextMoveToggle.onclick = ()=>{
          // Переход в режим выбора папки: скрываем обычные пункты, показываем Back и подменю
          if ($contextEdit) $contextEdit.style.display='none';
          if ($contextDelete) $contextDelete.style.display='none';
          $contextMoveToggle.style.display='none';
          $contextMoveSubmenu.classList.add('show');
          // Добавляем в конец кнопку Back как обычный пункт
          const divider = document.createElement('div'); divider.className='divider';
          const backBtn = document.createElement('button'); backBtn.className='context-btn'; backBtn.style.width='100%';
          const backIco = document.createElement('span'); backIco.className='ico back';
          const backText = document.createElement('span'); backText.textContent='Back';
          backBtn.appendChild(backIco); backBtn.appendChild(backText);
          const wrapper = document.createElement('div'); wrapper.appendChild(divider); wrapper.appendChild(backBtn);
          $contextMoveSubmenu.appendChild(wrapper);
          backBtn.onclick = (ev)=>{
            ev.preventDefault(); ev.stopPropagation();
            if ($contextEdit) $contextEdit.style.display='';
            if ($contextDelete) $contextDelete.style.display='';
            $contextMoveToggle.style.display='';
            $contextMoveSubmenu.classList.remove('show');
            // очистим хвост (divider+back)
            wrapper.remove();
            requestAnimationFrame(()=>repositionContextMenuInsideBounds());
          };
          // Пересчёт позиции
          requestAnimationFrame(()=>repositionContextMenuInsideBounds());
        };
      }
    }
    // Показываем меню
    $contextMenu.classList.add('show');
    $contextMenu.hidden = false;

    // После наполнения — рассчитать позицию
    const menuRect = $contextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    if (menuRect.right > windowWidth) { $contextMenu.style.left = (x - menuRect.width) + 'px'; }
    if (menuRect.bottom > windowHeight) { $contextMenu.style.top = (y - menuRect.height) + 'px'; }
  const newLeft = parseInt($contextMenu.style.left);
    if (newLeft < 0) { $contextMenu.style.left = '8px'; }
    const newTop = parseInt($contextMenu.style.top);
    if (newTop < 0) { $contextMenu.style.top = '8px'; }
  })();
}

function repositionContextMenuInsideBounds(){
  if (!$contextMenu) return;
  try{
    const pad = 8;
    const menuRect = $contextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let left = parseInt($contextMenu.style.left)||menuRect.left;
    let top  = parseInt($contextMenu.style.top)||menuRect.top;
    if (menuRect.right > windowWidth - pad) left = Math.max(pad, windowWidth - menuRect.width - pad);
    if (menuRect.bottom > windowHeight - pad) top = Math.max(pad, windowHeight - menuRect.height - pad);
    if (menuRect.left < pad) left = pad;
    if (menuRect.top < pad) top = pad;
    $contextMenu.style.left = left + 'px';
    $contextMenu.style.top  = top + 'px';
  }catch{}
}

function hideContextMenu() {
  if (!$contextMenu) return;
  contextMenuVisible = false;
  contextMenuTarget = null;
  $contextMenu.classList.remove('show');
  $contextMenu.hidden = true;
  // Сброс режима Move UI, чтобы при повторном открытии меню работало
  try{
    if ($contextEdit) $contextEdit.style.display='';
    if ($contextDelete) $contextDelete.style.display='';
    if ($contextMoveToggle) $contextMoveToggle.style.display='';
    if ($contextMoveSubmenu){ $contextMoveSubmenu.classList.remove('show'); $contextMoveSubmenu.innerHTML=''; }
  }catch{}
}

// Генерация стандартных путей к фавиконам
function generateFaviconUrls(url) {
  try {
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
    const domain = urlObj.hostname;
    
    return [
      `${baseUrl}/favicon.ico`,
      `${baseUrl}/favicon.png`,
      `${baseUrl}/apple-touch-icon.png`,
      `${baseUrl}/apple-touch-icon-precomposed.png`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=32`,
      `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=64`
    ];
  } catch (error) {
    console.error('Ошибка генерации путей к фавиконам:', error);
    return [];
  }
}

// Проверка доступности изображения
async function testImageUrl(url) {
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      mode: 'no-cors' // Позволяет обойти CORS для проверки
    });
    return true;
  } catch (error) {
    // Если HEAD не работает, пробуем через img
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
      // Таймаут на случай, если изображение не загружается
      setTimeout(() => resolve(false), 3000);
    });
  }
}

// Поиск рабочего фавикона
async function findWorkingFavicon(url, originalFavicon = null) {
  // Сначала проверяем оригинальный фавикон
  if (originalFavicon && await testImageUrl(originalFavicon)) {
    return originalFavicon;
  }
  
  // Генерируем список возможных путей
  const faviconUrls = generateFaviconUrls(url);
  
  // Проверяем каждый путь
  for (const faviconUrl of faviconUrls) {
    if (await testImageUrl(faviconUrl)) {
      return faviconUrl;
    }
  }
  
  // Если ничего не найдено, возвращаем Google Favicon Service
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return NO_ICON_URL;
  }
}

// Функция для поиска фавикона по URL сайта
async function searchFaviconForUrl(url, prevImg, inIconUrl, currentIconRef) {
  if (!url || !url.trim()) return;
  
  // Показываем индикатор загрузки
  prevImg.src = DEFAULT_ICON;
  prevImg.classList.remove('mono');
  
  try {
    // Нормализуем URL
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    
    // Ищем рабочий фавикон
    const workingFavicon = await findWorkingFavicon(normalizedUrl);
    
    if (workingFavicon && workingFavicon !== NO_ICON_URL) {
      // Обновляем поля
      inIconUrl.value = workingFavicon;
      currentIconRef.currentIcon = workingFavicon;
      currentIconRef.currentTone = null;
      prevImg.src = workingFavicon;
      prevImg.classList.remove('mono');
      
      // Показываем уведомление об успехе
      showToast('Фавикон найден!', 'success');
    } else {
      // Если фавикон не найден, используем NO_ICON_URL
      inIconUrl.value = '';
      currentIconRef.currentIcon = NO_ICON_URL;
      currentIconRef.currentTone = null;
      prevImg.src = NO_ICON_URL;
      prevImg.classList.remove('mono');
      showToast('Фавикон не найден', 'error');
    }
  } catch (error) {
    console.error('Ошибка при поиске фавикона:', error);
    showToast('Ошибка при поиске фавикона', 'error');
  }
}

// Функция для показа уведомлений
function showToast(message, type = 'info') {
  // Удаляем существующие уведомления
  const existingToasts = document.querySelectorAll('.toast');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Показываем уведомление
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Скрываем через 3 секунды
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 3000);
  }, 3000);
}

// Получение данных текущей активной вкладки
async function getCurrentTabData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    
    // Ищем рабочий фавикон
    const workingFavicon = await findWorkingFavicon(tab.url, tab.favIconUrl);
    
    return {
      url: tab.url,
      title: tab.title,
      favicon: workingFavicon || NO_ICON_URL
    };
  } catch (error) {
    console.error('Ошибка получения данных текущей вкладки:', error);
    return null;
  }
}

// Открытие редактора с предзаполненными данными текущей страницы
async function openAddCurrentPageOverlay() {
  const currentTabData = await getCurrentTabData();
  
  editorOpen = true;
  editorKind = 'add';
  if ($btnAdd) $btnAdd.classList.add('active');
  if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  if ($btnEdit) { $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
  if ($btnSettings) { $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
  
  // Жёсткая фиксация ширины для режима редактора (добавления)
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $overlay.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="panel";

  const favWrap=document.createElement("div"); favWrap.className="edit-fav";
  const previewBox=document.createElement("div"); previewBox.className="preview"; previewBox.title="Загрузить файл";
  const prevImg=document.createElement("img"); prevImg.alt="";
  
  // Предзаполняем иконку текущей страницы, если доступна
  if (currentTabData && currentTabData.favicon) {
    prevImg.src = currentTabData.favicon;
  } else {
    prevImg.src = DEFAULT_ICON;
  }
  
  // Добавляем обработчик ошибок для изображения
  prevImg.onerror = () => {
    console.error('Ошибка загрузки иконки:', prevImg.src);
    if (prevImg.src !== DEFAULT_ICON) {
      // Если не удалось загрузить иконку текущей страницы, используем дефолтную
      prevImg.src = DEFAULT_ICON;
    } else {
      // Если не удалось загрузить дефолтную иконку, попробуем загрузить как data URL
      fetch(DEFAULT_ICON)
        .then(response => response.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            prevImg.src = reader.result;
          };
          reader.readAsDataURL(blob);
        })
        .catch(err => {
          console.error('Не удалось загрузить дефолтную иконку:', err);
        });
    }
  };
  previewBox.appendChild(prevImg);

  const btnPick = toolBtn(SVG_GRID,   "Выбрать из набора");
  const btnUp   = toolBtn(SVG_UPLOAD, "Загрузить файл");
  favWrap.appendChild(previewBox); favWrap.appendChild(btnPick); favWrap.appendChild(btnUp);

  const fileInput=document.createElement("input");
  fileInput.type="file"; fileInput.accept="image/*,.ico,.svg"; fileInput.style.display="none";
  previewBox.addEventListener("click", ()=>fileInput.click());
  btnUp.addEventListener("click", ()=>fileInput.click());

  const fr1=document.createElement("div"); fr1.className="form-row"; fr1.innerHTML='<label>Name</label>';
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Name";
  
  // Предзаполняем название текущей страницы
  if (currentTabData && currentTabData.title) {
    inTitle.value = currentTabData.title;
  }
  fr1.appendChild(inTitle);

  const fr2=document.createElement("div"); fr2.className="form-row"; fr2.innerHTML='<label>URL</label>';
  const inUrl=document.createElement("input"); inUrl.type="url"; inUrl.placeholder="https://example.com";
  
  // Предзаполняем URL текущей страницы
  if (currentTabData && currentTabData.url) {
    inUrl.value = currentTabData.url;
  }
  fr2.appendChild(inUrl);

  // Поле выбора папки
  const frFolder=document.createElement("div"); frFolder.className="form-row"; frFolder.innerHTML='<label>Папка</label>';
  const inFolder=document.createElement("select"); inFolder.style.display="none"; // Скрыто по умолчанию
  const defaultOption=document.createElement("option"); defaultOption.value=""; defaultOption.textContent="Без папки"; inFolder.appendChild(defaultOption);
  frFolder.appendChild(inFolder);

  // Поле: Icon URL
  const frIcon=document.createElement("div"); frIcon.className="form-row";
  frIcon.innerHTML='<label>Icon URL</label>';
  const inIconUrl=document.createElement("input"); inIconUrl.type="url"; inIconUrl.placeholder="https://example.com/icon.png";
  
  // Поле Icon URL оставляем пустым — пользователь заполнит вручную при желании
  frIcon.appendChild(inIconUrl);

  const actions=document.createElement("div"); actions.className="actions";
  const left=document.createElement("div");
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Cancel";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Save"; save.disabled=true;
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(left); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(fr2); wrap.appendChild(frFolder); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = currentTabData && currentTabData.favicon ? currentTabData.favicon : DEFAULT_ICON;
  let currentIconCustom = false;
  let currentTone = null;

  // Загружаем папки и обновляем поле выбора
  async function loadFolders() {
    const folders = await getFolders();
    if (folders.length > 0) {
      inFolder.style.display = "block";
      // Очищаем старые опции (кроме первой)
      while (inFolder.children.length > 1) {
        inFolder.removeChild(inFolder.lastChild);
      }
      // Добавляем папки
      folders.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        inFolder.appendChild(option);
      });
      
      // Устанавливаем текущую папку по умолчанию, если мы находимся в папке
      if (currentFolderId) {
        inFolder.value = currentFolderId;
      }
    } else {
      inFolder.style.display = "none";
    }
  }
  loadFolders();

  const update=()=>{ save.disabled=!(inTitle.value.trim() && inUrl.value.trim() && isValidUrl(inUrl.value)); };
  inTitle.addEventListener("input", update); inUrl.addEventListener("input", update); update();

  fileInput.addEventListener("change", ()=>{
    const f=fileInput.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ currentIcon=r.result; currentTone=null; prevImg.src=currentIcon; prevImg.classList.remove('mono'); };
    r.readAsDataURL(f);
  });
  btnPick.addEventListener("click", ()=>openIconPicker(({dataUrl, tone})=>{
    currentIcon=dataUrl; currentTone=tone||'mono'; prevImg.src=dataUrl; prevImg.classList.toggle('mono', currentTone==='mono');
  }));

  // Обработка URL иконки по блюру
  function normalizeHttpUrl(v){
    let x=(v||"").trim(); if(!x) return null;
    if(!/^https?:\/\//i.test(x)) x="https://"+x;
    try{ const u=new URL(x); if(u.protocol==="http:"||u.protocol==="https:") return u.toString(); }catch{}
    return null;
  }
  inIconUrl.addEventListener("blur", ()=>{
    const norm = normalizeHttpUrl(inIconUrl.value);
    if(!norm) return; // опционально; не блокируем сохранение
    inIconUrl.value = norm;
    const testUrl = norm;
    const onLoad = ()=>{
      if (prevImg.src === testUrl){
        currentIcon = testUrl; currentTone = null;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    const onError = ()=>{
      if (prevImg.src === testUrl){
        prevImg.src = DEFAULT_ICON;
        prevImg.classList.remove('mono');
      }
      prevImg.removeEventListener('load', onLoad);
      prevImg.removeEventListener('error', onError);
    };
    prevImg.addEventListener('load', onLoad);
    prevImg.addEventListener('error', onError);
    prevImg.classList.remove('mono');
    prevImg.src = testUrl;
  });

  cancel.addEventListener("click", async ()=>{
    $overlay.classList.remove("open"); $overlay.innerHTML="";
    editorOpen = false; editorKind = null;
    if ($btnAdd) $btnAdd.classList.remove('active');
    const arr=await getLinks();
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
  save.addEventListener("click", async ()=>{
    let url=inUrl.value.trim(); if(!/^https?:\/\//i.test(url)) url="https://"+url; try{ new URL(url); }catch{ return; }
    
    // Если введён URL иконки, но не успели выйти из поля, учитываем его
    (function(){
      let v=(inIconUrl?.value||'').trim();
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; currentIconCustom=true; } }catch{} }
    })();
    
    // Единая система: не подставляем авто-фавикон в сохранённые данные
    let finalIcon = (currentIconCustom && typeof currentIcon === 'string')
      ? currentIcon
      : (typeof currentIcon === 'string' && currentIcon.startsWith('data:') ? currentIcon : null);

    const arr=await getLinks();
    const selectedFolderId = inFolder.value || null;
    arr.push({ 
      id:newId(), 
      title:inTitle.value.trim()||url, 
      url, 
      kind:"custom", 
      favicon:finalIcon, 
      iconCustom: !!currentIconCustom,
      iconTone: currentTone,
      folderId: selectedFolderId,
      syncToChrome: !!selectedFolderId
    });
    await setLinks(arr);
    editorOpen = false; editorKind = null;
    await render();
    $overlay.classList.remove("open");
    $overlay.innerHTML="";
    if ($btnAdd) $btnAdd.classList.remove('active');
    if (!settingsOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
    }
  });
}

/* ---------- Обработчики навигации по папкам ---------- */
async function navigateToParent(){
  // Если мы уже в корне — остаёмся в корне
  if (currentFolderId === null || currentFolderId === undefined) {
    await navigateToRoot();
    return;
  }
  // Находим родителя текущей папки
  const folders = await getFolders();
  const current = folders.find(f => f.id === currentFolderId);
  const parentId = current?.parentFolderId ?? null;
  if (parentId === null || parentId === undefined) {
    await navigateToRoot();
  } else {
    await navigateToFolder(parentId);
  }
}

if ($backButton) {
  $backButton.addEventListener("click", async () => {
    await navigateToParent();
  });
}

if ($closeButton) {
  $closeButton.addEventListener("click", async () => {
    await navigateToRoot();
  });
}

// Переключение вида в папке
if ($viewToggle){
  $viewToggle.addEventListener('click', async (e)=>{
    if (currentFolderId === null || currentFolderId === undefined) return;
    const mode = await getFolderViewMode(currentFolderId);
    const next = (mode === 'list') ? 'grid' : 'list';
    // Захватываем текущую геометрию для FLIP и скрываем содержимое на время переключения
    const prev = captureRects();
    // Зафиксируем текущую высоту списка, чтобы не было схлопывания контейнера
    try{ const r = $list.getBoundingClientRect(); if (r && isFinite(r.height) && r.height>0) { $list.style.minHeight = Math.ceil(r.height) + 'px'; } }catch{}
    $list.classList.add('rendering');
    // Эксперимент: MORPH-анимация содержимого плиток
    $list.classList.add('switching-morph');
    await setFolderViewMode(currentFolderId, next);
    // Обновляем класс/иконку без пересборки, затем рендерим и проигрываем FLIP
    $list.classList.toggle('list-view', next === 'list');
    if ($viewToggleIcon){
      $viewToggleIcon.classList.toggle('view-list', next === 'list');
      $viewToggleIcon.classList.toggle('view-grid', next !== 'list');
    }
    await render(null, prev);
    // Снять экспериментальный класс и фиксацию высоты после кадра
    requestAnimationFrame(()=>{ try{ $list.classList.remove('switching-morph'); $list.style.minHeight=''; }catch{} });
  });
}

// Инлайн-редактирование названия папки в header
if ($folderTitle) {
  $folderTitle.addEventListener('dblclick', async () => {
    // Редактируем только если мы в папке
    if (currentFolderId === null || currentFolderId === undefined) return;
    const folders = await getFolders();
    const current = folders.find(f => f.id === currentFolderId);
    if (!current) return;

    // Создаем input поверх заголовка
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-title-input';
    input.value = (current.name || '').slice(0, 32);
    input.maxLength = 32;

    // Заменяем содержимое и помечаем состояние
    $folderTitle.classList.add('editing');
    $folderTitle.innerHTML = '';
    $folderTitle.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit) => {
      $folderTitle.classList.remove('editing');
      if (commit) {
        const newName = (input.value || '').slice(0,32).trim();
        if (newName && newName !== current.name) {
          const all = await getFolders();
          const idx = all.findIndex(f => f.id === currentFolderId);
          if (idx >= 0) {
            all[idx] = { ...all[idx], name: newName };
            await setFolders(all);
          }
        }
      }
      render();
    };

    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', ()=> finish(true));
  });
}

/* ---------- кнопки футера ---------- */
if ($btnAdd) {
  $btnAdd.addEventListener("click", ()=>{
    // Переключаем видимость панельки
    if (addPanelVisible) {
      hideAddPanel();
    } else {
      // При открытии панельки — закрыть другие режимы
      if (settingsOpen) closeSettingsPanel();
      if (editorOpen) closeEditorOverlay();
      if (editMode){
        editMode = false;
        if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
        render();
      }
      showAddPanel();
      if ($btnSettings){ $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
    }
  });
  createTooltip($btnAdd, "Добавить");
}

// Обработчики кнопок в панельке
if ($createBookmark) {
  $createBookmark.addEventListener("click", ()=>{
    hideAddPanel();
    // При открытии добавления — закрыть другие режимы
    if (settingsOpen) closeSettingsPanel();
    if (editorOpen) closeEditorOverlay();
    if (editMode){
      editMode = false;
      if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
      render();
    }
    openAddOverlay();
    if ($btnSettings){ $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
    if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  });
}

if ($addCurrentPage) {
  $addCurrentPage.addEventListener("click", ()=>{
    hideAddPanel();
    // При открытии добавления — закрыть другие режимы
    if (settingsOpen) closeSettingsPanel();
    if (editorOpen) closeEditorOverlay();
    if (editMode){
      editMode = false;
      if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
      render();
    }
    openAddCurrentPageOverlay();
    if ($btnSettings){ $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
    if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  });
}

if ($createFolder) {
  $createFolder.addEventListener("click", ()=>{
    hideAddPanel();
    // При открытии добавления — закрыть другие режимы
    if (settingsOpen) closeSettingsPanel();
    if (editorOpen) closeEditorOverlay();
    if (editMode){
      editMode = false;
      if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
      render();
    }
    openCreateFolderOverlay();
    if ($btnSettings){ $btnSettings.classList.remove('active'); $btnSettings.setAttribute('aria-pressed','false'); }
    if ($btnAdd) $btnAdd.setAttribute('aria-pressed','true');
  });
}

// Закрытие панельки при клике вне её
document.addEventListener('click', (e) => {
  if (addPanelVisible && $addPanel && !$addPanel.contains(e.target) && !$btnAdd.contains(e.target)) {
    hideAddPanel();
  }
});
// Меню режимов: обработчики
if ($modeEdit){
  $modeEdit.addEventListener('click', ()=>{
    hideEditPanel();
    // Тоггл Edit: если уже не Move и не Delete — выключаем; иначе включаем
    const isEditNow = editMode && !moveMode && !ctrlPressed;
    editMode = !isEditNow; moveMode = false; ctrlPressed = false; selectMode = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
    document.documentElement.classList.remove('move-mode');
    if ($btnEdit){ $btnEdit.classList.toggle('active', editMode); $btnEdit.setAttribute('aria-pressed', editMode?'true':'false'); }
    render();
  });
}
if ($modeSelect){
  $modeSelect.addEventListener('click', ()=>{
    hideEditPanel();
    const turningOn = !(editMode && selectMode);
    editMode = turningOn; selectMode = turningOn; moveMode = false; ctrlPressed = false; updateEditMiniButtonsIcon();
    document.documentElement.classList.remove('move-mode');
    if ($btnEdit){ $btnEdit.classList.toggle('active', editMode); $btnEdit.setAttribute('aria-pressed', editMode?'true':'false'); }
    selectedIds.clear();
    updateBulkActionsUI();
    render();
  });
}

if ($modeDelete){
  $modeDelete.addEventListener('click', ()=>{
    hideEditPanel();
    const turningOn = !(editMode && ctrlPressed && !moveMode);
    editMode = turningOn; ctrlPressed = turningOn; moveMode = false; selectMode = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
    document.documentElement.classList.remove('move-mode');
    if ($btnEdit){ $btnEdit.classList.toggle('active', editMode); $btnEdit.setAttribute('aria-pressed', editMode?'true':'false'); }
    render();
  });
}

// Закрытие панели режимов по клику вне
document.addEventListener('click', (e)=>{
  if (editPanelVisible && $editPanel && !$editPanel.contains(e.target) && !$btnEdit.contains(e.target)){
    hideEditPanel();
  }
});
if ($btnEdit) {
  $btnEdit.addEventListener("click", ()=>{ 
    // Открываем меню режимов редактирования вместо мгновенного тумблера
    if (settingsOpen) closeSettingsPanel();
    if (editorOpen) closeEditorOverlay();
    hideAddPanel();
    // Если любой режим активен — одно нажатие по футерному карандашу выходит из режима
    if (editMode){ editMode=false; moveMode=false; ctrlPressed=false; selectMode=false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI(); document.documentElement.classList.remove('move-mode'); hideEditPanel(); if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); } render(); return; }
    if (editPanelVisible) { hideEditPanel(); }
    else { showEditPanel(); }
  });
  createTooltip($btnEdit, "Режим редактирования");
}

// копирайт
if ($copyLink) {
  $copyLink.addEventListener("click", (e)=>{ e.preventDefault?.(); openCopyrightTab(); });
  $copyLink.addEventListener("keydown", (e)=>{
    const key = e.key || e.code;
    if (key === "Enter" || key === " " || key === "Space" || key === "Spacebar") {
      e.preventDefault();
      openCopyrightTab();
    }
  });
}

// Bulk actions handlers
if ($bulkCancel){
  $bulkCancel.addEventListener('click', ()=>{
    // Закрыть режим выбора
    selectMode = false; editMode = false; moveMode = false; ctrlPressed = false; selectedIds.clear();
    updateEditMiniButtonsIcon(); updateBulkActionsUI();
    if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
    hideEditPanel();
    render();
  });
}
if ($bulkDelete){
  $bulkDelete.addEventListener('click', async ()=>{
    try{
      const ids = new Set(selectedIds);
      if (!ids.size) return;
      
      // Удаляем закладки
      const arr = await getLinks();
      const filtered = arr.filter(x => !ids.has(x.id));
      await setLinks(filtered);
      
      // Удаляем папки
      const folders = await getFolders();
      const filteredFolders = folders.filter(x => !ids.has(x.id));
      await setFolders(filteredFolders);
      
      // Перемещаем закладки из удаленных папок в корень
      const updatedLinks = filtered.map(link => {
        if (ids.has(link.folderId)) {
          return { ...link, folderId: null };
        }
        return link;
      });
      await setLinks(updatedLinks);
      
      await cleanupFaviconCache();
      selectedIds.clear();
      updateBulkActionsUI();
      render();
    }catch(e){ console.error('Bulk delete error:', e); }
  });
}
if ($bulkMove){
  $bulkMove.addEventListener('change', async (e)=>{
    try{
      const val = $bulkMove.value;
      if (!val) return;
      const ids = new Set(selectedIds);
      if (!ids.size) return;
      
      // Перемещаем закладки
      const arr = await getLinks();
      const updated = arr.map(x => ids.has(x.id) ? { ...x, folderId: val === '__ROOT__' ? null : val } : x);
      await setLinks(updated);
      
      // Перемещаем папки (если выбрана папка, а не корень)
      if (val !== '__ROOT__') {
        const folders = await getFolders();
        const updatedFolders = folders.map(folder => {
          if (ids.has(folder.id)) {
            return { ...folder, parentFolderId: val };
          }
          return folder;
        });
        await setFolders(updatedFolders);
      } else {
        // Перемещаем папки в корень (убираем parentFolderId)
        const folders = await getFolders();
        const updatedFolders = folders.map(folder => {
          if (ids.has(folder.id)) {
            const { parentFolderId, ...folderWithoutParent } = folder;
            return folderWithoutParent;
          }
          return folder;
        });
        await setFolders(updatedFolders);
      }
      
      selectedIds.clear();
      updateBulkActionsUI();
      $bulkMove.value = '';
      render();
    }catch(e){ console.error('Bulk move error:', e); }
  });
}

/* ---------- init ---------- */
const TILE_PERCENT_KEY = "tilePercent"; // user-facing 10..100
const LIST_ICON_PERCENT_KEY = "listIconPercent"; // user-facing 10..100 (list mode icon size)
const ROOT_VIEW_MODE_KEY = "rootViewMode"; // 'grid' | 'list'
const FOLDER_DEFAULT_VIEW_MODE_KEY = "folderDefaultViewMode"; // 'grid' | 'list'
const TILE_OPACITY_KEY = "tileOpacity"; // user-facing 0..100
const FOLDER_OPACITY_KEY = "folderOpacity"; // user-facing 0..100
const AUTO_FAVICON_KEY = "autoFavicon"; // legacy, kept for import/export compat
const SHOW_CHROME_FOLDERS_KEY = "showChromeFolders"; // boolean, default true
const FAVICON_SATURATION_KEY = "faviconSaturation"; // user-facing 0..100
const TILE_GAP_PERCENT_KEY = "tileGapPercent"; // user-facing 0..100
const TILE_GAP_DEFAULT = 50; // 50% = базовый отступ
const BG_TRANSPARENT_KEY = "bgTransparent"; // boolean
const FOOTER_TRANSPARENT_KEY = "footerTransparent"; // boolean
const MAX_COLS_KEY = "maxCols"; // user-facing 3..10
const SHOW_TITLES_KEY = "showTitles"; // boolean
const BASE_TILE_PX = 56;
// внутренний комфортный интервал (оставляем как было ранее 70..140)
const MIN_INTERNAL = 0.7; // 70%
const MAX_INTERNAL = 1.4; // 140%
function clampUserPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(10, n));
}
function mapRange(x, inMin, inMax, outMin, outMax){
  const t = (x - inMin) / (inMax - inMin);
  const cl = Math.min(1, Math.max(0, t));
  return outMin + (outMax - outMin) * cl;
}
function applyTilePercentUser(userPercent, {save=true, recalcWidth=true}={}){
  const user = clampUserPercent(userPercent);
  const internal = mapRange(user, 10, 100, MIN_INTERNAL, MAX_INTERNAL);
  const px = Math.round(BASE_TILE_PX * internal);
  document.documentElement.style.setProperty('--tileSize', px+"px");
  if (save) chrome.storage.local.set({ [TILE_PERCENT_KEY]: user }).catch(()=>{});
  if (recalcWidth) recalcCardWidthPreserveCols();
}

// Отдельное масштабирование для иконок в списке: делаем минимальное значение реально компактным
const MIN_LIST_INTERNAL = 0.28; // ~16px при BASE_TILE_PX=56
const MAX_LIST_INTERNAL = 0.95; // ~53px при BASE_TILE_PX=56
function applyListIconPercentUser(userPercent, {save=true}={}){
  const user = clampUserPercent(userPercent);
  const internal = mapRange(user, 10, 100, MIN_LIST_INTERNAL, MAX_LIST_INTERNAL);
  const px = Math.round(BASE_TILE_PX * internal);
  document.documentElement.style.setProperty('--listIconSizePx', px+"px");
  if (save) chrome.storage.local.set({ [LIST_ICON_PERCENT_KEY]: user }).catch(()=>{});
}

function clampOpacityPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
function applyTileOpacityUser(userPercent, {save=true}={}){
  const user = clampOpacityPercent(userPercent);
  const val = Math.min(1, Math.max(0, user/100));
  document.documentElement.style.setProperty('--tileOpacity', String(val));
  // Маркер для особого hover-режима при 0%
  document.documentElement.classList.toggle('tile-opacity-zero', user===0);
  if (save) chrome.storage.local.set({ [TILE_OPACITY_KEY]: user }).catch(()=>{});
}

function applyFolderOpacityUser(userPercent, {save=true}={}){
  const user = clampOpacityPercent(userPercent);
  const val = Math.min(1, Math.max(0, user/100));
  document.documentElement.style.setProperty('--folderOpacity', String(val));
  // Маркер для особого hover-режима при 0%
  document.documentElement.classList.toggle('folder-opacity-zero', user===0);
  if (save) chrome.storage.local.set({ [FOLDER_OPACITY_KEY]: user }).catch(()=>{});
}

function clampSaturationPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
function applyFaviconSaturationUser(userPercent, {save=true}={}){
  const user = clampSaturationPercent(userPercent);
  const cssVal = `${user}%`;
  document.documentElement.style.setProperty('--faviconSaturation', cssVal);
  if (save) chrome.storage.local.set({ [FAVICON_SATURATION_KEY]: user }).catch(()=>{});
}

function clampGapPercent(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
function applyTileGapUser(userPercent, {save=true, recalcWidth=true}={}){
  const user = clampGapPercent(userPercent);
  const rs = getComputedStyle(document.documentElement);
  const baseGap = parseInt(rs.getPropertyValue('--gap-base') || '10') || 10;
  // 0% => 0px, 50% => baseGap, 100% => 2*baseGap (линейно от 0..2x)
  const scale = user / 50; // 0..2
  const px = Math.round(baseGap * scale);
  document.documentElement.style.setProperty('--tilesGap', px + 'px');
  if (save) chrome.storage.local.set({ [TILE_GAP_PERCENT_KEY]: user }).catch(()=>{});
  if (recalcWidth) restoreWidthByLinks();
}

function clampMaxCols(v){
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(3, n));
}
let userMaxCols = 5;
function applyMaxCols(cols, {save=true, recalcWidth=true}={}){
  userMaxCols = clampMaxCols(cols);
  document.documentElement.style.setProperty('--cols', String(userMaxCols));
  if (save) chrome.storage.local.set({ [MAX_COLS_KEY]: userMaxCols }).catch(()=>{});
  if (isSettingsOpen()){
    // В настройках: пересчитываем сразу ширину и CSS-переменную сетки
    setCardWidthForCols(userMaxCols);
    // Принудительно обновим грид, чтобы плитки переложились
    if ($list){
      $list.style.setProperty('--cols', String(userMaxCols));
    }
  } else if (recalcWidth){
    restoreWidthByLinks();
  }
}

function applyWidgetBgTransparency(on, {save=true}={}){
  // Меняем значение CSS переменной --bg, используемой как фон страницы/карточки
  if (on) {
    document.documentElement.style.setProperty('--bg', 'transparent');
  } else {
    // Убираем инлайновую переопределённую переменную, чтобы работало значение из CSS
    document.documentElement.style.removeProperty('--bg');
  }
  document.documentElement.classList.toggle('bg-transparent', !!on);
  // Убираем визуальную рамку у карточки/футера, когда фон полностью прозрачный
  const card = document.querySelector('.card');
  const footer = document.querySelector('.footerbar');
  if (card){
    if (on){
      card.style.background = 'transparent';
      card.style.borderColor = 'transparent';
      card.style.boxShadow = 'none';
    } else {
      card.style.background = '';
      card.style.borderColor = '';
      card.style.boxShadow = '';
    }
  }
  if (footer){
    if (on){
      footer.style.background = 'transparent';
      footer.style.borderColor = 'transparent';
    } else {
      footer.style.background = '';
      footer.style.borderColor = '';
    }
  }
  if (save) chrome.storage.local.set({ [BG_TRANSPARENT_KEY]: !!on }).catch(()=>{});
}

function applyFooterTransparency(on, {save=true}={}){
  const fb = document.querySelector('.footerbar');
  if (fb){
    fb.style.opacity = on ? '0' : '1';
  }
  if (save){
    chrome.storage.local.set({ [FOOTER_TRANSPARENT_KEY]: !!on }).catch(()=>{});
  }
}

// Отображение названий
window.userShowTitles = false;
function applyShowTitles(on, {save=true}={}){
  window.userShowTitles = !!on;
  const inList = $list && $list.classList.contains('list-view');
  const effective = inList ? false : window.userShowTitles;
  document.documentElement.style.setProperty('--titleExtra', effective ? 'calc(var(--titleGap) + var(--titleH))' : '0px');
  document.documentElement.classList.toggle('titles-on', effective);
  if (save) chrome.storage.local.set({ [SHOW_TITLES_KEY]: window.userShowTitles }).catch(()=>{});
  render();
}
function recalcCardWidthPreserveCols(){
  if ($card.classList.contains('freeze-size')) return; // при открытых настройках ширину не менять
  const rs = getComputedStyle(document.documentElement);
  const tile = parseInt(rs.getPropertyValue("--tileSize"));
  const gap  = parseInt(rs.getPropertyValue("--tilesGap"));
  const pad  = parseInt(rs.getPropertyValue("--pad"));
  let cols = parseInt(getComputedStyle($list).getPropertyValue("--cols"));
  if (!Number.isFinite(cols) || cols<=0) cols = 3;
  const w = cols*tile + (cols-1)*gap + 2*pad;
  $card.style.width = w + "px";
}
async function init(){
  try{
    // Проверяем, была ли уже инициализация
    const { initialized_v2: inited = false } = await chrome.storage.local.get('initialized_v2');
    
    if (!inited) {
      // Первая установка - устанавливаем значения по умолчанию
      console.log('Первая установка расширения - устанавливаем значения по умолчанию');
      
      // Tile size 60%
      await chrome.storage.local.set({ [TILE_PERCENT_KEY]: 60 });
      
      // Bookmark opacity 0%
      await chrome.storage.local.set({ [TILE_OPACITY_KEY]: 0 });
      
      // Folder opacity 60%
      await chrome.storage.local.set({ [FOLDER_OPACITY_KEY]: 60 });
      
      // Favicon saturation 100%
      await chrome.storage.local.set({ [FAVICON_SATURATION_KEY]: 100 });
      
      // Max columns 5
      await chrome.storage.local.set({ [MAX_COLS_KEY]: 5 });
      
      // Show titles выкл
      await chrome.storage.local.set({ [SHOW_TITLES_KEY]: false });
      
      // Show Chrome folders вкл (по умолчанию показываем)
      await chrome.storage.local.set({ [SHOW_CHROME_FOLDERS_KEY]: true });
      
      // Theme и Theme icon автоматически подстраиваются под браузер
      // Определяем тему браузера
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const defaultTheme = prefersDark ? 'dark' : 'light';
      await chrome.storage.local.set({ [THEME_KEY]: defaultTheme });
      await chrome.storage.local.set({ [ICON_THEME_KEY]: defaultTheme });
      
      // Отмечаем, что инициализация завершена
      await chrome.storage.local.set({ initialized_v2: true });
      
      // Применяем настройки по умолчанию сразу после установки
      applyTilePercentUser(60, {save:false});
      applyTileOpacityUser(0, {save:false});
      applyFolderOpacityUser(60, {save:false});
      applyFaviconSaturationUser(100, {save:false});
      applyMaxCols(5, {save:false, recalcWidth:false});
      applyShowTitles(false, {save:false});
      applyWidgetBgTransparency(false, {save:false});
      applyFooterTransparency(false, {save:false});
      applyTheme(defaultTheme, {save:false});
      setActionIconByTheme(defaultTheme);
    }
  }catch(e){
    console.error('Ошибка при инициализации настроек по умолчанию:', e);
  }
  
  try{
    const data = await chrome.storage.local.get(THEME_KEY);
    const theme = data?.[THEME_KEY] || 'dark';
    applyTheme(theme);
  }catch{}
  try{
    const data = await chrome.storage.local.get(ICON_THEME_KEY);
    const iconTheme = data?.[ICON_THEME_KEY] || 'dark';
    setActionIconByTheme(iconTheme);
  }catch{}
  try{
    // Загружаем кэш фавиконов
    await loadFaviconCache();
    // Загружаем статистику загрузки фавиконов
    await loadFaviconLoadStats();
    // Очищаем старые неиспользуемые фавиконы из кэша
    await cleanupFaviconCache();
    // Очищаем старую статистику загрузки
    await cleanupFaviconLoadStats();
  }catch{}
  try{
    // Принудительно предзагружаем все фавиконы при инициализации
    const allLinks = await getLinks();
    if (allLinks.length > 0) {
      console.log(`Начинаем предзагрузку ${allLinks.length} фавиконов...`);
      
      // Сначала загружаем фавиконы для первых 15 элементов (видимые при открытии)
      const priorityLinks = allLinks.slice(0, 15);
      // Убираем предзагрузку фавиконов — chrome://favicon покрывает мгновенную отрисовку
      
      // Убираем любые фоновые механики предзагрузки/мониторинга фавиконов
      
      // Никакой дальнейшей предзагрузки не требуется
    }
  }catch{}
  try{
    // Предзагружаем дефолтную иконку папки
    await getDefaultFolderIcon();
  }catch{}
  try{
    // Загружаем текущую папку
    const currentFolder = await getCurrentFolder();
    currentFolderId = currentFolder;
    // Убеждаемся, что currentFolderId не undefined
    if (currentFolderId === undefined) {
      currentFolderId = null;
    }

  }catch{}
  try{
    const data = await chrome.storage.local.get(TILE_PERCENT_KEY);
    const pUser = clampUserPercent(data?.[TILE_PERCENT_KEY] ?? 60);
    applyTilePercentUser(pUser, {save:false});
  }catch{}
  try{
    const data = await chrome.storage.local.get(TILE_OPACITY_KEY);
    const opUser = clampOpacityPercent(data?.[TILE_OPACITY_KEY] ?? 0);
    applyTileOpacityUser(opUser, {save:false});
  }catch{}
  try{
    const data = await chrome.storage.local.get(FOLDER_OPACITY_KEY);
    const foUser = clampOpacityPercent(data?.[FOLDER_OPACITY_KEY] ?? 60);
    applyFolderOpacityUser(foUser, {save:false});
  }catch{}
  try{
    const data = await chrome.storage.local.get(TILE_GAP_PERCENT_KEY);
    const gpUser = clampGapPercent(data?.[TILE_GAP_PERCENT_KEY] ?? TILE_GAP_DEFAULT);
    applyTileGapUser(gpUser, {save:false, recalcWidth:false});
  }catch{}
  try{
    const data = await chrome.storage.local.get(FAVICON_SATURATION_KEY);
    const fsUser = clampSaturationPercent(data?.[FAVICON_SATURATION_KEY] ?? 100);
    applyFaviconSaturationUser(fsUser, {save:false});
  }catch{}
  try{
    // Форсируем отключение прозрачности фона: сбрасываем флаг в хранилище и применяем непрозрачный фон
    await chrome.storage.local.set({ [BG_TRANSPARENT_KEY]: false });
    applyWidgetBgTransparency(false, {save:false});
    if ($widgetBgTransparent) $widgetBgTransparent.checked = false;
  }catch{}
  try{
    const data = await chrome.storage.local.get(FOOTER_TRANSPARENT_KEY);
    const on = !!(data?.[FOOTER_TRANSPARENT_KEY]);
    applyFooterTransparency(on, {save:false});
    if ($footerTransparent) $footerTransparent.checked = on;
  }catch{}
  try{
    const data = await chrome.storage.local.get(MAX_COLS_KEY);
    const mcUser = clampMaxCols(data?.[MAX_COLS_KEY] ?? 5);
    applyMaxCols(mcUser, {save:false, recalcWidth:false});
  }catch{}
  try{
    const data = await chrome.storage.local.get(SHOW_TITLES_KEY);
    const on = !!(data?.[SHOW_TITLES_KEY]);
    applyShowTitles(on, {save:false});
    if ($showTitlesInline) $showTitlesInline.checked = on;
  }catch{}
      await render();
  // В этом режиме панель настроек открывается в отдельном окне, внутри виджета её нет
}
init();

// Реакция на изменения из внешнего settings окна
try{
  chrome.runtime.onMessage.addListener(async (msg)=>{
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'tilePercentChanged'){
      const user = clampUserPercent(msg.user);
      applyTilePercentUser(user, {save:false, recalcWidth: !isSettingsOpen()});
      if ($tileSizeRange) $tileSizeRange.value = String(user);
      if ($tileSizeInput) $tileSizeInput.value = String(user);
    }
    if (msg.type === 'tileOpacityChanged'){
      const user = clampOpacityPercent(msg.user);
      applyTileOpacityUser(user, {save:false});
      if ($tileOpacityRange) $tileOpacityRange.value = String(user);
      if ($tileOpacityInput) $tileOpacityInput.value = String(user);
    }
    if (msg.type === 'folderOpacityChanged'){
      const user = clampOpacityPercent(msg.user);
      applyFolderOpacityUser(user, {save:false});
      if ($folderOpacityRange) $folderOpacityRange.value = String(user);
      if ($folderOpacityInput) $folderOpacityInput.value = String(user);
    }
    if (msg.type === 'faviconSaturationChanged'){
      const user = clampSaturationPercent(msg.user);
      applyFaviconSaturationUser(user, {save:false});
      if ($faviconSaturationRange) $faviconSaturationRange.value = String(user);
      if ($faviconSaturationInput) $faviconSaturationInput.value = String(user);
    }
    if (msg.type === 'tileGapPercentChanged'){
      const user = clampGapPercent(msg.user);
      applyTileGapUser(user, {save:false, recalcWidth: !isSettingsOpen()});
      if ($tileGapRange) $tileGapRange.value = String(user);
      if ($tileGapInput) $tileGapInput.value = String(user);
    }
    if (msg.type === 'maxColsChanged'){
      const cols = clampMaxCols(msg.cols);
      applyMaxCols(cols, {save:true, recalcWidth: !isSettingsOpen()});
      if ($maxColsRange) $maxColsRange.value = String(cols);
      if ($maxColsInput) $maxColsInput.value = String(cols);
    }
    if (msg.type === 'footerTransparencyChanged'){
      applyFooterTransparency(!!msg.on, {save:false});
      if ($footerTransparent) $footerTransparent.checked = !!msg.on;
    }
    if (msg.type === 'widgetBgTransparencyChanged'){
      applyWidgetBgTransparency(!!msg.on, {save:false});
      if ($widgetBgTransparent) $widgetBgTransparent.checked = !!msg.on;
    }
    if (msg.type === 'showTitlesChanged'){
      applyShowTitles(!!msg.on, {save:false});
      if ($showTitlesInline) $showTitlesInline.checked = !!msg.on;
    }
    if (msg.type === 'themeChanged'){
      applyTheme(msg.theme);
    }
    if (msg.type === 'iconThemeChanged'){
      setActionIconByTheme(msg.iconTheme);
    }
    if (msg.type === 'bookmarksSynced'){
      try{ await render(); }catch(e){ console.error(e); }
    }
  });
}catch{}

/* ---------- Settings inline panel (inside card) ---------- */
function isSettingsOpen(){ return !!$settingsFloat && !$settingsFloat.hasAttribute('hidden'); }

async function syncSettingsInputsFromStorage(){
  try{
    const st = await chrome.storage.local.get(TILE_PERCENT_KEY);
    const user = clampUserPercent(st?.[TILE_PERCENT_KEY] ?? 60);
    if ($tileSizeRange) $tileSizeRange.value = String(user);
    if ($tileSizeInput) $tileSizeInput.value = String(user);
  }catch{}
  try{
    const st = await chrome.storage.local.get(TILE_OPACITY_KEY);
    const op = clampOpacityPercent(st?.[TILE_OPACITY_KEY] ?? 0);
    if ($tileOpacityRange) $tileOpacityRange.value = String(op);
    if ($tileOpacityInput) $tileOpacityInput.value = String(op);
  }catch{}
  try{
    const st = await chrome.storage.local.get(FOLDER_OPACITY_KEY);
    const fo = clampOpacityPercent(st?.[FOLDER_OPACITY_KEY] ?? 60);
    if ($folderOpacityRange) $folderOpacityRange.value = String(fo);
    if ($folderOpacityInput) $folderOpacityInput.value = String(fo);
  }catch{}
  try{
    const st = await chrome.storage.local.get(TILE_GAP_PERCENT_KEY);
    const gp = clampGapPercent(st?.[TILE_GAP_PERCENT_KEY] ?? TILE_GAP_DEFAULT);
    if ($tileGapRange) $tileGapRange.value = String(gp);
    if ($tileGapInput) $tileGapInput.value = String(gp);
  }catch{}
  try{
    const st = await chrome.storage.local.get(FAVICON_SATURATION_KEY);
    const fs = clampSaturationPercent(st?.[FAVICON_SATURATION_KEY] ?? 100);
    if ($faviconSaturationRange) $faviconSaturationRange.value = String(fs);
    if ($faviconSaturationInput) $faviconSaturationInput.value = String(fs);
  }catch{}
  try{
    const st = await chrome.storage.local.get(MAX_COLS_KEY);
    const mc = clampMaxCols(st?.[MAX_COLS_KEY] ?? 5);
    if ($maxColsRange) $maxColsRange.value = String(mc);
    if ($maxColsInput) $maxColsInput.value = String(mc);
  }catch{}
  try{
    const st = await chrome.storage.local.get(BG_TRANSPARENT_KEY);
    const on = !!(st?.[BG_TRANSPARENT_KEY]);
    if ($widgetBgTransparent) $widgetBgTransparent.checked = on;
  }catch{}
  try{
    const st = await chrome.storage.local.get(FOOTER_TRANSPARENT_KEY);
    const on = !!(st?.[FOOTER_TRANSPARENT_KEY]);
    if ($footerTransparent) $footerTransparent.checked = on;
  }catch{}
  try{
    const st = await chrome.storage.local.get(SHOW_TITLES_KEY);
    const on = !!(st?.[SHOW_TITLES_KEY]);
    if ($showTitlesInline) $showTitlesInline.checked = on;
  }catch{}
  try{
    const st = await chrome.storage.local.get(SHOW_CHROME_FOLDERS_KEY);
    const on = !!(st?.[SHOW_CHROME_FOLDERS_KEY] ?? true);
    if ($showChromeFolders) $showChromeFolders.checked = on;
  }catch{}
  try{
    const st = await chrome.storage.local.get(THEME_KEY);
    const theme = st?.[THEME_KEY] || 'dark';
    if ($themeToggleInline) $themeToggleInline.checked = (theme === 'light');
  }catch{}
  // убран syncBookmarksInline
}
function openSettingsPanel(){
  if (!$settingsFloat) return;
  // синхронизируем контролы с сохранёнными значениями
  syncSettingsInputsFromStorage();
  // расширить карточку до комфортного минимума (как в редакторе), затем заморозить
  settingsOpen = true;
  // Начальная ширина: минимум 420px либо текущая ширина сетки, что больше
  try { setCardWidthForCols(clampMaxCols(userMaxCols)); } catch {}
  $card.classList.add('freeze-size');
  $settingsFloat.removeAttribute('hidden');
  requestAnimationFrame(()=> $settingsFloat.classList.add('open'));
  if ($btnSettings) { $btnSettings.classList.add('active'); $btnSettings.setAttribute('aria-pressed','true'); }
  if ($btnAdd) { $btnAdd.classList.remove('active'); $btnAdd.setAttribute('aria-pressed','false'); }
  if ($btnEdit) { $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
  // baseline
  revertSettings();
  // Подсказки к названиям настроек (англ. описание)
  try{
    const attach = (sel, text)=>{ const el=document.querySelector(sel); if(el && !el.dataset.tipAttached){ el.dataset.tipAttached='1'; createTooltip(el, text); } };
    attach('label[for="tileSizeRange"]', 'Adjusts tile icon size.');
    attach('label[for="listIconSizeRange"]', 'Icon size in list view.');
    attach('label[for="tileOpacityRange"]', 'Opacity of bookmark tiles background.');
    attach('label[for="folderOpacityRange"]', 'Opacity of folder tiles background.');
    attach('label[for="faviconSaturationRange"]', 'Color saturation for favicons (0–100%).');
    attach('label[for="maxColsRange"]', 'Maximum number of columns in the grid.');
    attach('label[for="rootViewMode"]', 'Default view for root (main screen).');
    attach('label[for="folderDefaultViewMode"]', 'Default view for new folders.');
    attach('label[for="showTitles"]', 'Show text captions under tiles.');
    attach('label[for="showChromeFolders"]', 'Show Chrome-synced root folders in the root view.');
    attach('label[for="themeIconToggleInline"]', 'Switch the extension toolbar icon theme.');
    attach('label[for="themeToggleInline"]', 'Switch between light and dark theme.');
  }catch{}
}
function closeSettingsPanel(){
  if (!$settingsFloat) return;
  $settingsFloat.classList.remove('open');
  // дождаться анимации
  setTimeout(async ()=>{
    settingsOpen = false;
    if ($settingsFloat) $settingsFloat.setAttribute('hidden','');
    // Закрываем панельку добавления при закрытии настроек
    hideAddPanel();
    // Если редактор не открыт — возвращаем управление шириной в «авто» и пересчитываем по ссылкам
    if (!editorOpen){
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
      // Дополнительно дёрнем вычисление ширины по текущим колонкам, как при save
      try{ setCardWidthForCols(clampMaxCols(userMaxCols)); }catch{}
      $card.classList.remove('freeze-size');
      $card.style.width = '';
      restoreWidthByLinks();
      // Форсируем перерисовку контейнера popup'а, чтобы размеры восстановились сразу
      try{ void $card.offsetWidth; }catch{}
      try{ requestAnimationFrame(()=>{ window.dispatchEvent(new Event('resize')); forcePopupRelayout(); if($btnSettings){ $btnSettings.dispatchEvent(new Event('mouseenter', {bubbles:false})); $btnSettings.dispatchEvent(new Event('mouseleave', {bubbles:false})); } }); }catch{}
    }
    if ($btnSettings) { 
      $btnSettings.classList.remove('active');
      $btnSettings.setAttribute('aria-pressed','false');
    }
  }, 240);
}
function toggleSettingsPanel(){
  if (!$settingsFloat) return;
  const hidden = $settingsFloat.hasAttribute('hidden');
  if (hidden) openSettingsPanel(); else closeSettingsPanel();
}
function onTileSizeRangeInput(){
  const v = clampUserPercent($tileSizeRange?.value ?? 100);
  // синхронизируем number немедленно и применяем через mapRange
  if ($tileSizeInput) $tileSizeInput.value = String(v);
  applyTilePercentUser(v, {save:true, syncInputs:false});
}
function parseNumberFieldValueAllowEmpty(){
  const raw = ($tileSizeInput?.value ?? "").trim();
  if (raw === "") return null; // временно пусто, не применяем
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return clampUserPercent(num);
}
function onTileSizeNumberInput(){
  // не срываем ввод: если пусто — ничего не делаем
  const v = parseNumberFieldValueAllowEmpty();
  if (v==null) return;
  // не применяем на каждый символ, оставим на change/Enter
}
function onTileSizeNumberCommit(){
  let v = parseNumberFieldValueAllowEmpty();
  if (v==null) v = clampUserPercent(60);
  // записать обратно отклампленное
  if ($tileSizeInput) $tileSizeInput.value = String(v);
  if ($tileSizeRange) $tileSizeRange.value = String(v);
  applyTilePercentUser(v, {save:true, syncInputs:false});
}

function clampOpacityFieldAllow(v){ return clampOpacityPercent(v); }
function onTileOpacityRangeInput(){
  const v = clampOpacityPercent($tileOpacityRange?.value ?? 100);
  if ($tileOpacityInput) $tileOpacityInput.value = String(v);
  applyTileOpacityUser(v, {save:true});
}
function parseOpacityNumberFieldAllowEmpty(){
  const raw = ($tileOpacityInput?.value ?? "").trim();
  if (raw === "") return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return clampOpacityPercent(num);
}
function onTileOpacityNumberCommit(){
  let v = parseOpacityNumberFieldAllowEmpty();
  if (v==null) v = clampOpacityPercent(0);
  if ($tileOpacityInput) $tileOpacityInput.value = String(v);
  if ($tileOpacityRange) $tileOpacityRange.value = String(v);
  applyTileOpacityUser(v, {save:true});
}

function clampFaviconSaturationFieldAllow(v){ return clampSaturationPercent(v); }
function onFaviconSaturationRangeInput(){
  const v = clampSaturationPercent($faviconSaturationRange?.value ?? 100);
  if ($faviconSaturationInput) $faviconSaturationInput.value = String(v);
  applyFaviconSaturationUser(v, {save:true});
}
function parseFaviconSaturationNumberFieldAllowEmpty(){
  const raw = ($faviconSaturationInput?.value ?? "").trim();
  if (raw === "") return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return clampSaturationPercent(num);
}
function onFaviconSaturationNumberCommit(){
  let v = parseFaviconSaturationNumberFieldAllowEmpty();
  if (v==null) v = clampSaturationPercent(100);
  if ($faviconSaturationInput) $faviconSaturationInput.value = String(v);
  if ($faviconSaturationRange) $faviconSaturationRange.value = String(v);
  applyFaviconSaturationUser(v, {save:true});
}

async function exportLinks(){
  try{
    const linksAll = await getLinks();
    // Only root-level custom links (exclude Chrome-synced and nested)
    let mapLinkE2C = {};
    try{ const st = await chrome.storage.local.get('map_link_e2c'); mapLinkE2C = st?.['map_link_e2c'] || {}; }catch{}
    const links = linksAll.filter(x=> !x?.folderId && !mapLinkE2C[x?.id]);
    let tilePercent = 60;
    try{
      const st = await chrome.storage.local.get(TILE_PERCENT_KEY);
      tilePercent = clampUserPercent(st?.[TILE_PERCENT_KEY] ?? ($tileSizeInput?.value ?? $tileSizeRange?.value ?? 60));
    }catch{}
    let tileOpacity = 0;
    try{
      const st = await chrome.storage.local.get(TILE_OPACITY_KEY);
      tileOpacity = clampOpacityPercent(st?.[TILE_OPACITY_KEY] ?? ($tileOpacityInput?.value ?? $tileOpacityRange?.value ?? 0));
    }catch{}
      let folderOpacity = 60;
  try{
    const st = await chrome.storage.local.get(FOLDER_OPACITY_KEY);
    folderOpacity = clampOpacityPercent(st?.[FOLDER_OPACITY_KEY] ?? ($folderOpacityInput?.value ?? $folderOpacityRange?.value ?? 60));
  }catch{}
  let autoFavicon = true;
  try{
    const st = await chrome.storage.local.get(AUTO_FAVICON_KEY);
    autoFavicon = !!(st?.[AUTO_FAVICON_KEY] ?? true);
  }catch{}
    let faviconSaturation = 100;
    try{
      const st = await chrome.storage.local.get(FAVICON_SATURATION_KEY);
      faviconSaturation = clampSaturationPercent(st?.[FAVICON_SATURATION_KEY] ?? ($faviconSaturationInput?.value ?? $faviconSaturationRange?.value ?? 100));
    }catch{}
    let maxCols = 5;
    try{
      const st = await chrome.storage.local.get(MAX_COLS_KEY);
      maxCols = clampMaxCols(st?.[MAX_COLS_KEY] ?? ($maxColsInput?.value ?? $maxColsRange?.value ?? 5));
    }catch{}
    let showTitles = false;
    try{
      const st = await chrome.storage.local.get(SHOW_TITLES_KEY);
      showTitles = !!(st?.[SHOW_TITLES_KEY]);
    }catch{}
    // Additional settings
    let listIconPercent = 60;
    try{ const st = await chrome.storage.local.get(LIST_ICON_PERCENT_KEY); listIconPercent = clampUserPercent(st?.[LIST_ICON_PERCENT_KEY] ?? 60); }catch{}
    let rootViewMode = 'grid';
    try{ const st = await chrome.storage.local.get(ROOT_VIEW_MODE_KEY); rootViewMode = (st?.[ROOT_VIEW_MODE_KEY]==='list')?'list':'grid'; }catch{}
    let folderDefaultViewMode = 'grid';
    try{ const st = await chrome.storage.local.get(FOLDER_DEFAULT_VIEW_MODE_KEY); folderDefaultViewMode = (st?.[FOLDER_DEFAULT_VIEW_MODE_KEY]==='list')?'list':'grid'; }catch{}
    let tileGapPercent = 50;
    try{ const st = await chrome.storage.local.get(TILE_GAP_PERCENT_KEY); tileGapPercent = clampGapPercent(st?.[TILE_GAP_PERCENT_KEY] ?? TILE_GAP_DEFAULT); }catch{}
    let theme = 'dark';
    try{ const st = await chrome.storage.local.get(THEME_KEY); theme = st?.[THEME_KEY] || 'dark'; }catch{}
    let iconTheme = 'dark';
    try{ const st = await chrome.storage.local.get(ICON_THEME_KEY); iconTheme = st?.[ICON_THEME_KEY] || 'dark'; }catch{}
    // Folders are not exported per new rules
    // Заглушки для групп и lastGroupId (будущие сущности)
    const { groups = [], lastGroupId = null } = await chrome.storage.local.get(["groups","lastGroupId"]).catch(()=>({}));
    const groupsArr = Array.isArray(groups) ? groups : [];
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: {
        tilePercent,
        tileOpacity,
        folderOpacity,
        // autoFavicon removed from UI but kept in export for backward compat
        autoFavicon,
        faviconSaturation,
        maxCols,
        showTitles,
        listIconPercent,
        rootViewMode,
        folderDefaultViewMode,
        tileGapPercent,
        theme,
        iconTheme,
        bgTransparent: !!(await chrome.storage.local.get(BG_TRANSPARENT_KEY).then(x=>x?.[BG_TRANSPARENT_KEY]).catch(()=>false)),
        footerTransparent: !!(await chrome.storage.local.get(FOOTER_TRANSPARENT_KEY).then(x=>x?.[FOOTER_TRANSPARENT_KEY]).catch(()=>false)),
      },
      links: links.map((x, index)=> ({ ...x, index })),
      folders: [],
      groups: groupsArr.map(g=>({ id:g.id, name:g.name, index:g.index })),
      lastGroupId
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links-widget-export.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }catch(err){
    console.error(err);
    alert('Не удалось выполнить экспорт: ' + (err?.message || String(err)));
  }
}

function importLinks(){
  try{
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', ()=>{
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = ()=> alert('Ошибка чтения файла.');
      reader.onload = async ()=>{
        try{
          const text = String(reader.result||'');
          const data = JSON.parse(text);
          // Backward-compat v1/v2 -> v3
          let linksArr = [];
          let foldersArr = [];
          let settings = {};
          let groups = [];
          let lastGroupId = null;
          if (Array.isArray(data.links)){
            linksArr = data.links;
          } else if (Array.isArray(data.items)){
            linksArr = data.items; // гипотетически
          }
          if (Array.isArray(data.folders)){
            foldersArr = data.folders;
          }
          // settings
          if (data.settings && typeof data.settings === 'object'){
            settings = data.settings;
          } else {
            settings = {
              tilePercent: data.tilePercent,
              tileOpacity: data.tileOpacity,
              folderOpacity: data.folderOpacity,
              autoFavicon: data.autoFavicon,
              faviconSaturation: data.faviconSaturation,
              maxCols: data.maxCols,
              showTitles: data.showTitles,
              bgTransparent: data.bgTransparent,
              footerTransparent: data.footerTransparent,
            };
          }
          groups = Array.isArray(data.groups)? data.groups : [];
          lastGroupId = data.lastGroupId ?? null;

          if (!linksArr.length){
            alert('Неверный формат: отсутствует массив "links".');
            return;
          }
          if (!confirm('Импорт заменит корневые пользовательские ссылки. Продолжить?')) return;
          // Replace only root-level custom links; keep Chrome-synced and nested
          const stNow = await chrome.storage.local.get([LINKS_KEY, 'map_link_e2c']);
          const current = Array.isArray(stNow[LINKS_KEY]) ? stNow[LINKS_KEY] : [];
          const mapE2C = stNow['map_link_e2c'] || {};
          const kept = current.filter(x => x?.folderId || mapE2C[x?.id]);
          const sanitized = linksArr.map(x => ({ ...x, folderId: null }));
          await setLinks([...kept, ...sanitized]);
          // применяем настройки
          if (typeof settings.tilePercent !== 'undefined'){
            const user = clampUserPercent(settings.tilePercent);
            applyTilePercentUser(user, {save:true, syncInputs:true});
          }
          if (typeof settings.tileOpacity !== 'undefined'){
            const op = clampOpacityPercent(settings.tileOpacity);
            applyTileOpacityUser(op, {save:true});
            if ($tileOpacityRange) $tileOpacityRange.value = String(op);
            if ($tileOpacityInput) $tileOpacityInput.value = String(op);
          }
          if (typeof settings.folderOpacity !== 'undefined'){
            const fo = clampOpacityPercent(settings.folderOpacity);
            applyFolderOpacityUser(fo, {save:true});
            if ($folderOpacityRange) $folderOpacityRange.value = String(fo);
            if ($folderOpacityInput) $folderOpacityInput.value = String(fo);
          }
          // legacy: settings.autoFavicon is ignored in UI; preserve value silently
          if (typeof settings.autoFavicon !== 'undefined'){
            const af = !!settings.autoFavicon;
            chrome.storage.local.set({ [AUTO_FAVICON_KEY]: af }).catch(()=>{});
          }
          if (typeof settings.faviconSaturation !== 'undefined'){
            const fs = clampSaturationPercent(settings.faviconSaturation);
            applyFaviconSaturationUser(fs, {save:true});
            if ($faviconSaturationRange) $faviconSaturationRange.value = String(fs);
            if ($faviconSaturationInput) $faviconSaturationInput.value = String(fs);
          }
          if (typeof settings.maxCols !== 'undefined'){
            const mc = clampMaxCols(settings.maxCols);
            applyMaxCols(mc, {save:true, recalcWidth:false});
            if ($maxColsRange) $maxColsRange.value = String(mc);
            if ($maxColsInput) $maxColsInput.value = String(mc);
          }
          if (typeof settings.listIconPercent !== 'undefined'){
            const lp = clampUserPercent(settings.listIconPercent);
            applyListIconPercentUser(lp, {save:true});
            if ($listIconSizeRange) $listIconSizeRange.value = String(lp);
            if ($listIconSizeInput) $listIconSizeInput.value = String(lp);
          }
          if (typeof settings.rootViewMode !== 'undefined'){
            const rv = (settings.rootViewMode === 'list') ? 'list' : 'grid';
            await chrome.storage.local.set({ [ROOT_VIEW_MODE_KEY]: rv });
            if ($rootViewMode) $rootViewMode.value = rv;
            if (currentFolderId === null || currentFolderId === undefined) await render();
          }
          if (typeof settings.folderDefaultViewMode !== 'undefined'){
            const fv = (settings.folderDefaultViewMode === 'list') ? 'list' : 'grid';
            await chrome.storage.local.set({ [FOLDER_DEFAULT_VIEW_MODE_KEY]: fv });
            if ($folderDefaultViewMode) $folderDefaultViewMode.value = fv;
          }
          if (typeof settings.tileGapPercent !== 'undefined'){
            const tg = clampGapPercent(settings.tileGapPercent);
            await chrome.storage.local.set({ [TILE_GAP_PERCENT_KEY]: tg });
          }
          if (typeof settings.showTitles !== 'undefined'){
            const on = !!settings.showTitles;
            applyShowTitles(on, {save:true, rerender:true});
            if ($showTitlesInline) $showTitlesInline.checked = on;
          }
          if (typeof settings.theme !== 'undefined'){
            const theme = settings.theme === 'light' ? 'light' : 'dark';
            await chrome.storage.local.set({ [THEME_KEY]: theme });
            applyTheme(theme, {save:false});
          }
          if (typeof settings.iconTheme !== 'undefined'){
            const iconTheme = settings.iconTheme === 'light' ? 'light' : 'dark';
            await chrome.storage.local.set({ [ICON_THEME_KEY]: iconTheme });
            setActionIconByTheme(iconTheme);
            try{ chrome.runtime.sendMessage({ type:'iconThemeChanged', iconTheme }); }catch{}
          }
          if (typeof settings.bgTransparent !== 'undefined'){
            applyWidgetBgTransparency(!!settings.bgTransparent, {save:true});
          }
          if (typeof settings.footerTransparent !== 'undefined'){
            applyFooterTransparency(!!settings.footerTransparent, {save:true});
          }
          // сохранить группы и lastGroupId как есть
          await chrome.storage.local.set({ groups, lastGroupId });
          await render();
          // Mark settings as dirty so Save becomes enabled in settings panel
          try{ if (typeof markDirty === 'function') markDirty(true); }catch{}
          restoreWidthByLinks();
        }catch(parseErr){
          console.error(parseErr);
          alert('Не удалось импортировать: ' + (parseErr?.message || String(parseErr)));
        }
      };
      reader.readAsText(file);
    }, { once:true });
    input.click();
  }catch(err){
    console.error(err);
    alert('Не удалось начать импорт: ' + (err?.message || String(err)));
  }
}

// Hooks
if ($btnSettings) {
  $btnSettings.addEventListener('click', async ()=>{
    const willOpen = $settingsFloat ? $settingsFloat.hasAttribute('hidden') : true;
    if (willOpen){
      // При открытии настроек — закрыть редактор и выйти из режима редактирования
      if (editorOpen) closeEditorOverlay();
      if (editMode){
        editMode = false;
        if ($btnEdit){ $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
        render();
      }
      // Закрываем панельку добавления при открытии настроек
      hideAddPanel();
      openSettingsPanel();
    } else {
      // Откатываем настройки без пересчёта ширины в открытом режиме
      const prevOpen = settingsOpen; settingsOpen = false;
      try{ await revertSettings(); }catch{}
      settingsOpen = prevOpen;
      closeSettingsPanel();
      // Доп. триггеры перерисовки контейнера
      try{ void $card.offsetWidth; }catch{}
      try{ requestAnimationFrame(()=>{ window.dispatchEvent(new Event('resize')); forcePopupRelayout(); if($btnSettings){ $btnSettings.dispatchEvent(new Event('mouseenter', {bubbles:false})); $btnSettings.dispatchEvent(new Event('mouseleave', {bubbles:false})); } }); }catch{}
    }
  });
  createTooltip($btnSettings, "Settings");
}
if ($settingsClose) $settingsClose.addEventListener('click', async ()=>{
  // Откатываем без динамического режима настроек
  const prevOpen = settingsOpen; settingsOpen = false;
  try{ await revertSettings(); }catch{}
  settingsOpen = prevOpen;
  closeSettingsPanel();
  try{ void $card.offsetWidth; }catch{}
  try{ requestAnimationFrame(()=>{ window.dispatchEvent(new Event('resize')); }); }catch{}
});
if ($settingsExport) $settingsExport.addEventListener('click', exportLinks);
if ($settingsImport) $settingsImport.addEventListener('click', importLinks);
if (typeof $settingsSave !== 'undefined' && $settingsSave)
  $settingsSave.addEventListener('click', ()=>{ commitSettings(); });
if (typeof $settingsCancel !== 'undefined' && $settingsCancel)
  $settingsCancel.addEventListener('click', async ()=>{ await revertSettings(); closeSettingsPanel(); });
if ($tileSizeRange) $tileSizeRange.addEventListener('input', ()=>{
  const v = clampUserPercent($tileSizeRange.value);
  if ($tileSizeInput) $tileSizeInput.value = String(v);
  applyTilePercentUser(v, {save:false, recalcWidth: !isSettingsOpen()});
  if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
});
if ($tileSizeInput){
  const commit=()=>{ let v=($tileSizeInput.value||'').trim(); v=v===''?100:Number(v); v=clampUserPercent(v); $tileSizeInput.value=String(v); if($tileSizeRange) $tileSizeRange.value=String(v); applyTilePercentUser(v,{save:false, recalcWidth: !isSettingsOpen()}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $tileSizeInput.addEventListener('change', commit);
  $tileSizeInput.addEventListener('blur', commit);
  $tileSizeInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}

// List icon size handlers
if ($listIconSizeRange) $listIconSizeRange.addEventListener('input', ()=>{
  const v = clampUserPercent($listIconSizeRange.value);
  if ($listIconSizeInput) $listIconSizeInput.value = String(v);
  applyListIconPercentUser(v, {save:false});
  if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
});
if ($listIconSizeInput){
  const commit=()=>{ let v=($listIconSizeInput.value||'').trim(); v=v===''?100:Number(v); v=clampUserPercent(v); $listIconSizeInput.value=String(v); if($listIconSizeRange) $listIconSizeRange.value=String(v); applyListIconPercentUser(v,{save:false}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $listIconSizeInput.addEventListener('change', commit);
  $listIconSizeInput.addEventListener('blur', commit);
  $listIconSizeInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}

// Root/folder default view handlers
if ($rootViewMode){
  $rootViewMode.addEventListener('change', ()=>{
    const v = ($rootViewMode.value==='list')?'list':'grid';
    chrome.storage.local.set({ [ROOT_VIEW_MODE_KEY]: v }).catch(()=>{});
    if (currentFolderId === null || currentFolderId === undefined){
      render();
    }
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($folderDefaultViewMode){
  $folderDefaultViewMode.addEventListener('change', async ()=>{
    const v = ($folderDefaultViewMode.value==='list')?'list':'grid';
    // Предупреждение о том, что изменение затронет только новые папки
    try{
      const folders = await getFolders();
      // проверим, есть ли хотя бы одна папка с локальным переопределением
      let hasLocal = false;
      for (const f of folders){
        const key = FOLDER_VIEW_PREFIX + f.id;
        const val = (await chrome.storage.local.get(key))?.[key];
        if (val === 'list' || val === 'grid'){ hasLocal = true; break; }
      }
      if (hasLocal){
        alert('Новое значение по умолчанию применится только к НОВЫМ папкам. У существующих папок останутся их индивидуальные настройки вида.');
      }
    }catch{}
    chrome.storage.local.set({ [FOLDER_DEFAULT_VIEW_MODE_KEY]: v }).catch(()=>{});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($tileOpacityRange){
  $tileOpacityRange.addEventListener('input', ()=>{
    const v = clampOpacityPercent($tileOpacityRange.value);
    if ($tileOpacityInput) $tileOpacityInput.value = String(v);
    applyTileOpacityUser(v, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($tileOpacityInput){
  const commit=()=>{ let v=($tileOpacityInput.value||'').trim(); v=v===''?100:Number(v); v=clampOpacityPercent(v); $tileOpacityInput.value=String(v); if($tileOpacityRange) $tileOpacityRange.value=String(v); applyTileOpacityUser(v,{save:false}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $tileOpacityInput.addEventListener('change', commit);
  $tileOpacityInput.addEventListener('blur', commit);
  $tileOpacityInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}
if ($folderOpacityRange){
  $folderOpacityRange.addEventListener('input', ()=>{
    const v = clampOpacityPercent($folderOpacityRange.value);
    if ($folderOpacityInput) $folderOpacityInput.value = String(v);
    applyFolderOpacityUser(v, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($folderOpacityInput){
  const commit=()=>{ let v=($folderOpacityInput.value||'').trim(); v=v===''?100:Number(v); v=clampOpacityPercent(v); $folderOpacityInput.value=String(v); if($folderOpacityRange) $folderOpacityRange.value=String(v); applyFolderOpacityUser(v,{save:false}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $folderOpacityInput.addEventListener('change', commit);
  $folderOpacityInput.addEventListener('blur', commit);
  $folderOpacityInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}
if ($faviconSaturationRange){
  $faviconSaturationRange.addEventListener('input', ()=>{
    const v = clampSaturationPercent($faviconSaturationRange.value);
    if ($faviconSaturationInput) $faviconSaturationInput.value = String(v);
    applyFaviconSaturationUser(v, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($faviconSaturationInput){
  const commit=()=>{ let v=($faviconSaturationInput.value||'').trim(); v=v===''?100:Number(v); v=clampSaturationPercent(v); $faviconSaturationInput.value=String(v); if($faviconSaturationRange) $faviconSaturationRange.value=String(v); applyFaviconSaturationUser(v,{save:false}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $faviconSaturationInput.addEventListener('change', commit);
  $faviconSaturationInput.addEventListener('blur', commit);
  $faviconSaturationInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}
if ($tileGapRange){
  $tileGapRange.addEventListener('input', ()=>{
    const v = clampGapPercent($tileGapRange.value);
    if ($tileGapInput) $tileGapInput.value = String(v);
    applyTileGapUser(v, {save:false, recalcWidth: !isSettingsOpen()});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($tileGapInput){
  const commit=()=>{ let v=($tileGapInput.value||'').trim(); v=v===''?100:Number(v); v=clampGapPercent(v); $tileGapInput.value=String(v); if($tileGapRange) $tileGapRange.value=String(v); applyTileGapUser(v,{save:false, recalcWidth: !isSettingsOpen()}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $tileGapInput.addEventListener('change', commit);
  $tileGapInput.addEventListener('blur', commit);
  $tileGapInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}
if ($maxColsRange){
  $maxColsRange.addEventListener('input', ()=>{
    const v = clampMaxCols($maxColsRange.value);
    if ($maxColsInput) $maxColsInput.value = String(v);
    applyMaxCols(v, {save:false, recalcWidth: !isSettingsOpen()});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($maxColsInput){
  const commit=()=>{ let v=($maxColsInput.value||'').trim(); v=v===''?5:Number(v); v=clampMaxCols(v); $maxColsInput.value=String(v); if($maxColsRange) $maxColsRange.value=String(v); applyMaxCols(v,{save:false, recalcWidth: !isSettingsOpen()}); if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline)); };
  $maxColsInput.addEventListener('change', commit);
  $maxColsInput.addEventListener('blur', commit);
  $maxColsInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') commit(); });
}
if ($footerTransparent){
  $footerTransparent.addEventListener('change', ()=>{
    const on = !!$footerTransparent.checked;
    applyFooterTransparency(on, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($widgetBgTransparent){
  $widgetBgTransparent.addEventListener('change', ()=>{
    const on = !!$widgetBgTransparent.checked;
    applyWidgetBgTransparency(on, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
  });
}
if ($showTitlesInline){
  $showTitlesInline.addEventListener('change', ()=>{
    const on = !!$showTitlesInline.checked;
    applyShowTitles(on, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
    try{ chrome.runtime.sendMessage({ type:'showTitlesChanged', on }); }catch{}
  });
}
if ($showChromeFolders){
  $showChromeFolders.addEventListener('change', ()=>{
    const on = !!$showChromeFolders.checked;
    chrome.storage.local.set({ [SHOW_CHROME_FOLDERS_KEY]: on }).catch(()=>{});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
    try{ render(); }catch{}
  });
}
if ($themeToggleInline){
  $themeToggleInline.addEventListener('change', ()=>{
    const theme = $themeToggleInline.checked ? 'light' : 'dark';
    applyTheme(theme, {save:false});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
    try{ chrome.runtime.sendMessage({ type:'themeChanged', theme }); }catch{}
  });
}
if ($themeIconToggleInline){
  $themeIconToggleInline.addEventListener('change', ()=>{
    const iconTheme = $themeIconToggleInline.checked ? 'light' : 'dark';
    setActionIconByTheme(iconTheme);
    chrome.storage.local.set({ [ICON_THEME_KEY]: iconTheme }).catch(()=>{});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
    try{ chrome.runtime.sendMessage({ type:'iconThemeChanged', iconTheme }); }catch{}
  });
}
// удалён тумблер Sync Chrome bookmarks
// inline-панели не требуется пере-позиционирование на resize

// Принудительное обновление кэша конкретного фавикона
async function forceUpdateFaviconCache(faviconUrl) {
  if (!faviconUrl || faviconUrl === DEFAULT_ICON || faviconUrl === NO_ICON_URL) {
    return null;
  }
  
  try {
    console.log(`Принудительное обновление кэша для: ${faviconUrl}`);
    const dataUrl = await loadFaviconAsDataUrl(faviconUrl);
    if (dataUrl) {
      faviconCache.set(faviconUrl, dataUrl);
      await saveFaviconCache();
      console.log(`Кэш обновлен для: ${faviconUrl}`);
      return dataUrl;
    }
  } catch (error) {
    console.error(`Ошибка обновления кэша для ${faviconUrl}:`, error);
  }
  
  return null;
}

// Функция для проверки и исправления проблемных фавиконов
async function fixProblematicFavicons(links) {
  const problematicFavicons = [];
  
  for (const item of links) {
    if (item.favicon && item.favicon !== DEFAULT_ICON && item.favicon !== NO_ICON_URL) {
      // Проверяем, есть ли фавикон в кэше как data URL
      const cachedFavicon = faviconCache.get(item.favicon);
      if (!cachedFavicon || !cachedFavicon.startsWith('data:')) {
        problematicFavicons.push(item.favicon);
      }
    }
  }
  
  if (problematicFavicons.length > 0) {
    console.log(`Найдено ${problematicFavicons.length} проблемных фавиконов, исправляем...`);
    
    for (const faviconUrl of problematicFavicons) {
      await forceUpdateFaviconCache(faviconUrl);
    }
  }
}

// Быстрая предзагрузка конкретных фавиконов
async function quickPreloadFavicons(faviconUrls) {
  const promises = faviconUrls.map(async (url) => {
    if (!faviconCache.has(url)) {
      try {
        // Проверяем, является ли это потенциально проблемным фавиконом
        const isProblematic = isPotentiallyProblematicFavicon(url);
        
        // Для проблемных фавиконов используем повторные попытки
        const loadFunction = isProblematic ? loadFaviconAsDataUrlWithRetry : loadFaviconAsDataUrl;
        
        const dataUrl = await loadFunction(url);
        if (dataUrl) {
          faviconCache.set(url, dataUrl);
          return true;
        }
      } catch (error) {
        console.error(`Ошибка быстрой загрузки фавикона ${url}:`, error);
      }
    }
    return false;
  });
  
  const results = await Promise.allSettled(promises);
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`Быстрая предзагрузка: ${successCount}/${faviconUrls.length} фавиконов загружено`);
  
  if (successCount > 0) {
    await saveFaviconCache();
  }
}

// Функция для предзагрузки фавиконов при открытии папки
async function preloadFaviconsForFolder(folderId) {
  try {
    const allLinks = await getLinks();
    // Для корневой папки (folderId = null) берем ссылки без folderId
    const folderLinks = folderId === null 
      ? allLinks.filter(link => !link.folderId || link.folderId === null)
      : allLinks.filter(link => link.folderId === folderId);
    
    if (folderLinks.length > 0) {
      const faviconUrls = folderLinks
        .map(link => link.favicon)
        .filter(favicon => favicon && favicon !== DEFAULT_ICON && favicon !== NO_ICON_URL && favicon.startsWith('http'))
        .filter(favicon => !faviconCache.has(favicon));
      
      if (faviconUrls.length > 0) {
        console.log(`Предзагрузка ${faviconUrls.length} фавиконов для папки ${folderId || 'root'}`);
        quickPreloadFavicons(faviconUrls);
      }
    }
  } catch (error) {
    console.error('Ошибка предзагрузки фавиконов для папки:', error);
  }
}

// Принудительная предзагрузка проблемных фавиконов
async function forcePreloadProblematicFavicons() {
  const problematicUrls = [
    'https://miro.com/app/static/951b806349b39191.png',
    'https://imgs2.imgsmail.ru/static/octavius/favicons/rebranding-2024/32-fav_mail.png',
    'https://app.spline.design/_assets/_icons/icon_favicon16x16.png'
  ];
  
  console.log('Принудительная предзагрузка проблемных фавиконов...');
  
  const promises = problematicUrls.map(async (url) => {
    if (!faviconCache.has(url)) {
      try {
        console.log(`Принудительно загружаем: ${url}`);
        const dataUrl = await loadFaviconAsDataUrl(url);
        if (dataUrl) {
          faviconCache.set(url, dataUrl);
          console.log(`Успешно загружен: ${url}`);
          return true;
        }
      } catch (error) {
        console.error(`Ошибка принудительной загрузки ${url}:`, error);
      }
    }
    return false;
  });
  
  const results = await Promise.allSettled(promises);
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`Принудительная предзагрузка: ${successCount}/${problematicUrls.length} фавиконов загружено`);
  
  if (successCount > 0) {
    await saveFaviconCache();
  }
}

// Улучшенная функция загрузки фавикона с повторными попытками
async function loadFaviconAsDataUrlWithRetry(url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Попытка ${attempt}/${maxRetries} загрузки: ${url}`);
      const dataUrl = await loadFaviconAsDataUrl(url);
      if (dataUrl) {
        console.log(`Успешно загружен с попытки ${attempt}: ${url}`);
        return dataUrl;
      }
    } catch (error) {
      console.error(`Ошибка попытки ${attempt} для ${url}:`, error);
      if (attempt === maxRetries) {
        throw error;
      }
      // Небольшая пауза перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
  return null;
}

// Автоматическое обнаружение проблемных фавиконов
const problematicFaviconPatterns = [
  'miro.com',
  'mail.ru',
  'spline.design',
  'imgsmail.ru',
  'rutracker.org'
];

// Функция для проверки, является ли фавикон проблемным
function isProblematicFavicon(url) {
  return problematicFaviconPatterns.some(pattern => url.includes(pattern));
}

// Система автоматического обучения для определения проблемных фавиконов
const faviconLoadStats = new Map(); // Статистика загрузки фавиконов

// Функция для записи статистики загрузки фавикона
function recordFaviconLoadStats(url, success, loadTime) {
  if (!faviconLoadStats.has(url)) {
    faviconLoadStats.set(url, {
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLoadTime: 0,
      averageLoadTime: 0,
      lastAttempt: 0
    });
  }
  
  const stats = faviconLoadStats.get(url);
  stats.attempts++;
  stats.lastAttempt = Date.now();
  stats.totalLoadTime += loadTime;
  stats.averageLoadTime = stats.totalLoadTime / stats.attempts;
  
  if (success) {
    stats.successes++;
  } else {
    stats.failures++;
  }
  
  // Сохраняем статистику в хранилище
  saveFaviconLoadStats();
}

// Функция для сохранения статистики загрузки
async function saveFaviconLoadStats() {
  try {
    const statsData = Object.fromEntries(faviconLoadStats);
    await chrome.storage.local.set({ faviconLoadStats: statsData });
  } catch (error) {
    console.error('Ошибка сохранения статистики загрузки фавиконов:', error);
  }
}

// Функция для загрузки статистики загрузки
async function loadFaviconLoadStats() {
  try {
    const { faviconLoadStats: statsData } = await chrome.storage.local.get('faviconLoadStats');
    if (statsData && typeof statsData === 'object') {
      faviconLoadStats.clear();
      Object.entries(statsData).forEach(([url, stats]) => {
        faviconLoadStats.set(url, stats);
      });
    }
  } catch (error) {
    console.error('Ошибка загрузки статистики загрузки фавиконов:', error);
  }
}

// Улучшенная функция для определения проблемных фавиконов с учетом статистики
function isPotentiallyProblematicFavicon(url) {
  try {
    const urlObj = new URL(url);
    
    // Проверяем статистику загрузки
    const stats = faviconLoadStats.get(url);
    if (stats) {
      // Если у фавикона есть история проблем, считаем его проблемным
      if (stats.failures > stats.successes || stats.averageLoadTime > 2000) {
        return true;
      }
      
      // Если фавикон загружался успешно и быстро, считаем его не проблемным
      if (stats.successes > 2 && stats.averageLoadTime < 500) {
        return false;
      }
    }
    
    // Проверяем различные характеристики, которые могут указывать на проблемные фавиконы
    const checks = [
      // Проверяем известные проблемные домены
      () => problematicFaviconPatterns.some(pattern => url.includes(pattern)),
      
      // Проверяем .ico файлы (часто проблемные)
      () => url.toLowerCase().includes('.ico'),
      
      // Проверяем домены с потенциально медленными серверами
      () => ['rutracker.org', 'torrent', 'tracker', 'forum', 'board'].some(term => url.toLowerCase().includes(term)),
      
      // Проверяем домены с потенциальными CORS проблемами
      () => ['cdn', 'static', 'assets', 'img', 'images', 'media'].some(term => url.toLowerCase().includes(term)),
      
      // Проверяем длинные URL (могут быть медленными)
      () => url.length > 100,
      
      // Проверяем домены с потенциальными проблемами сети
      () => ['ru', 'cn', 'br', 'in', 'ua', 'by'].some(cc => urlObj.hostname.endsWith('.' + cc)),
      
      // Проверяем домены с потенциальными проблемами SSL/HTTPS
      () => urlObj.protocol === 'http:' && !urlObj.hostname.includes('localhost'),
      
      // Проверяем домены с потенциальными проблемами DNS
      () => urlObj.hostname.split('.').length > 3
    ];
    
    // Если хотя бы одна проверка вернула true, считаем фавикон потенциально проблемным
    return checks.some(check => check());
  } catch (error) {
    // Если не удалось распарсить URL, считаем проблемным
    return true;
  }
}

// Функция для мониторинга и улучшения загрузки проблемных фавиконов
async function monitorAndImproveFaviconLoading() {
  try {
    const allLinks = await getLinks();
    const problematicLinks = allLinks.filter(link => 
      link.favicon && isPotentiallyProblematicFavicon(link.favicon) && !faviconCache.has(link.favicon)
    );
    
    if (problematicLinks.length > 0) {
      console.log(`Обнаружено ${problematicLinks.length} потенциально проблемных фавиконов, улучшаем загрузку...`);
      
      const faviconUrls = problematicLinks.map(link => link.favicon);
      await quickPreloadFavicons(faviconUrls);
    }
  } catch (error) {
    console.error('Ошибка мониторинга проблемных фавиконов:', error);
  }
}

// Функция для очистки старой статистики загрузки
async function cleanupFaviconLoadStats() {
  try {
    const allLinks = await getLinks();
    const usedFaviconUrls = new Set();
    
    // Собираем все используемые фавиконы
    allLinks.forEach(link => {
      if (link.favicon && link.favicon !== DEFAULT_ICON && link.favicon !== NO_ICON_URL) {
        usedFaviconUrls.add(link.favicon);
      }
    });
    
    // Удаляем статистику для неиспользуемых фавиконов
    const keysToRemove = [];
    for (const [url, stats] of faviconLoadStats.entries()) {
      if (!usedFaviconUrls.has(url)) {
        keysToRemove.push(url);
      }
    }
    
    keysToRemove.forEach(key => faviconLoadStats.delete(key));
    
    // Сохраняем очищенную статистику
    if (keysToRemove.length > 0) {
      await saveFaviconLoadStats();
      console.log(`Очищено ${keysToRemove.length} записей статистики для неиспользуемых фавиконов`);
    }
  } catch (error) {
    console.error('Ошибка очистки статистики загрузки фавиконов:', error);
  }
}

// Функция для получения отчета о статистике загрузки
function getFaviconLoadStatsReport() {
  const report = {
    total: faviconLoadStats.size,
    problematic: 0,
    fast: 0,
    slow: 0,
    failed: 0
  };
  
  for (const [url, stats] of faviconLoadStats.entries()) {
    if (stats.failures > stats.successes || stats.averageLoadTime > 2000) {
      report.problematic++;
    } else if (stats.averageLoadTime < 500) {
      report.fast++;
    } else if (stats.averageLoadTime > 1000) {
      report.slow++;
    }
    
    if (stats.failures > 0) {
      report.failed++;
    }
  }
  
  return report;
}

// Обработчики контекстного меню
if ($contextEdit) {
  $contextEdit.addEventListener('click', async () => {
    if (!contextMenuTarget) return;
    
    const tileId = contextMenuTarget.dataset.id;
    const tileType = contextMenuTarget.dataset.type;
    
    hideContextMenu();
    
    if (tileType === 'folder') {
      const folders = await getFolders();
      const folder = folders.find(f => f.id === tileId);
      if (folder) {
        openFolderEditorOverlay(folder);
      }
    } else if (tileType === 'link') {
      const links = await getLinks();
      const link = links.find(l => l.id === tileId);
      if (link) {
        openEditorOverlay(link);
      }
    }
  });
}

if ($contextDelete) {
  $contextDelete.addEventListener('click', async () => {
    if (!contextMenuTarget) return;
    
    const tileId = contextMenuTarget.dataset.id;
    const tileType = contextMenuTarget.dataset.type;
    
    hideContextMenu();
    
    if (tileType === 'folder') {
      await openFolderDeleteConfirm(tileId);
    } else if (tileType === 'link') {
      const links = await getLinks();
      const idx = links.findIndex(x => x.id === tileId);
      if (idx >= 0) {
        links.splice(idx, 1);
        await setLinks(links);
        await cleanupFaviconCache();
        render();
      }
    }
  });
}

// Обработчик перемещения из контекстного меню
async function performContextMove(targetId, targetType, dest){
  try{
    if (!targetId || !targetType) return;
    if (targetType === 'link'){
      const arr = await getLinks();
      const idx = arr.findIndex(x=>x.id===targetId);
      if (idx>=0){
        arr[idx] = { ...arr[idx], folderId: dest==='__ROOT__'? null : dest };
        await setLinks(arr);
      }
    } else if (targetType === 'folder'){
      const folders = await getFolders();
      const idx = folders.findIndex(x=>x.id===targetId);
      if (idx>=0){
        if (dest==='__ROOT__'){
          const { parentFolderId, ...rest } = folders[idx];
          folders[idx] = rest;
        } else {
          // Защита от перемещения в потомка (цикл)
          const isDescendant = (candidateId, maybeChildId)=>{
            const byId = new Map(folders.map(f=>[f.id, f]));
            let cur = byId.get(candidateId);
            while(cur){
              if (cur.parentFolderId === maybeChildId) return true;
              cur = byId.get(cur.parentFolderId);
            }
            return false;
          };
          if (dest === targetId || isDescendant(dest, targetId)){
            showToast('Нельзя переместить папку в саму себя или своего потомка', 'error');
            return;
          }
          folders[idx] = { ...folders[idx], parentFolderId: dest };
        }
        await setFolders(folders);
      }
    }
    hideContextMenu();
    render();
  }catch(e){ console.error('Context move error:', e); }
}

// Закрытие контекстного меню при клике вне его
document.addEventListener('click', (e) => {
  if (contextMenuVisible && $contextMenu && !$contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Закрытие контекстного меню при нажатии Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && contextMenuVisible) {
    hideContextMenu();
  }
});

// Перехватываем правый клик на уровне документа для предотвращения браузерного меню
document.addEventListener('contextmenu', (e) => {
  const withinCard = e.target.closest('#card');
  if (!withinCard) return; // вне виджета не трогаем

  // Не показывать меню поверх настроек или редакторов
  const inSettings = e.target.closest('#settingsFloat');
  if (inSettings || settingsOpen) return;
  const inOverlay = e.target.closest('#overlayEditor');
  if (inOverlay || editorOpen) return;

  const inFooter = e.target.closest('.footerbar');
  const tile = e.target.closest('.tile');

  // ПКМ по плитке → контекстное меню Edit/Delete
  if (tile) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    showContextMenu(e.clientX, e.clientY, tile);
    return;
  }

  // ПКМ по пустому месту внутри карточки (но не в футере) → показать панель добавления
  if (!inFooter) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    hideContextMenu();
    showAddPanel(e.clientX, e.clientY);
  }
});
