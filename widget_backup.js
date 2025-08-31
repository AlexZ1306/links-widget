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

// Текущая папка (null = корневая папка)
let currentFolderId = null;

const $card = document.getElementById("card");
const $list = document.getElementById("list");
const $overlay = document.getElementById("overlayEditor");
const $btnAdd = document.getElementById("footerAdd");
const $btnEdit = document.getElementById("footerEdit");
const $copyLink = document.getElementById("copyrightLink");
const $btnSettings = document.getElementById("footerSettings");
const $addPanel = document.getElementById("addPanel");
const $editPanel = document.getElementById("editPanel");
const $modeEdit = document.getElementById("modeEdit");
const $modeMove = document.getElementById("modeMove");
const $modeDelete = document.getElementById("modeDelete");
const $modeSelect = document.getElementById("modeSelect");
const $createBookmark = document.getElementById("createBookmark");
const $addCurrentPage = document.getElementById("addCurrentPage");
const $createFolder = document.getElementById("createFolder");
const $folderHeader = document.getElementById("folderHeader");
const $folderTitle = document.getElementById("folderTitle");
const $backButton = document.getElementById("backButton");
const $closeButton = document.getElementById("closeButton");
const $settingsFloat = document.getElementById("settingsFloat");
const $settingsClose = document.getElementById("settingsClose");
const $settingsExport = document.getElementById("settingsExport");
const $settingsImport = document.getElementById("settingsImport");
const $settingsSave = document.getElementById("settingsSave");
const $settingsCancel = document.getElementById("settingsCancel");
const $tileSizeRange = document.getElementById("tileSizeRange");
const $tileSizeInput = document.getElementById("tileSizeInput");
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
const $footerTransparent = document.getElementById("footerTransparent");
const $widgetBgTransparent = document.getElementById("widgetBgTransparent");
const $showTitlesInline = document.getElementById("showTitles");
const $autoFavicon = document.getElementById("autoFavicon");
const $themeToggleInline = document.getElementById("themeToggleInline");
const $themeIconToggleInline = document.getElementById("themeIconToggleInline");
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
const MIN_EDITOR_WIDTH = 520;
function ensureMinCardWidth(minPx = MIN_EDITOR_WIDTH){
  const card = document.getElementById('card');
  if (!card) return;
  const w = card.getBoundingClientRect().width;
  if (w < minPx) {
    card.style.width = `${minPx}px`;
  }
}
function setCardWidthForCols(cols){
  if ($card.classList.contains('freeze-size')) return; // не менять ширину, когда заморожена
  const rs = getComputedStyle(document.documentElement);
  const tile = parseInt(rs.getPropertyValue("--tileSize"));
  const gap  = parseInt(rs.getPropertyValue("--gap"));
  const pad  = parseInt(rs.getPropertyValue("--pad"));
  const w = cols*tile + (cols-1)*gap + 2*pad;
  $card.style.width = w + "px";
}
function widenForEditor(min=MIN_EDITOR_WIDTH){ ensureMinCardWidth(min); }
function restoreWidthByLinks(){
  const cols = clampMaxCols(userMaxCols);
  $list.style.setProperty("--cols", String(cols));
  setCardWidthForCols(cols);
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

// Порядок элементов в корне (папки + корневые закладки)
async function getRootOrder(){ const { [ROOT_ORDER_KEY]:x=[] } = await chrome.storage.local.get(ROOT_ORDER_KEY); return Array.isArray(x)?x:[]; }
async function setRootOrder(v){ await chrome.storage.local.set({ [ROOT_ORDER_KEY]: v }); }

// Создание новой папки
async function createFolder(name, icon = null){
  const folders = await getFolders();
  const newFolder = {
    id: newId(),
    name: name.trim(),
    icon: icon || await getDefaultFolderIcon(),
    createdAt: new Date().toISOString()
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
  
  // Предзагружаем фавиконы для новой папки
  preloadFaviconsForFolder(folderId);
}

// Возврат в корневую папку
async function navigateToRoot(){
  currentFolderId = null;
  await setCurrentFolder(null);
  await render();
  
  // Предзагружаем фавиконы для корневой папки (без folderId)
  preloadFaviconsForFolder(null);
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
function createTooltip(element, text) {
  // Удаляем существующие тултипы
  const existingTooltips = document.querySelectorAll('.tooltip');
  existingTooltips.forEach(tooltip => tooltip.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.textContent = text;
  document.body.appendChild(tooltip);

  function showTooltip() {
    const rect = element.getBoundingClientRect();
    tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
    tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';
    tooltip.classList.add('show');
  }

  function hideTooltip() {
    tooltip.classList.remove('show');
  }

  element.addEventListener('mouseenter', showTooltip);
  element.addEventListener('mouseleave', hideTooltip);

  return tooltip;
}

/* ---------- FLIP анимация ---------- */
function captureRects(){
  const m=new Map();
  [...$list.children].forEach(el=>m.set(el.dataset.id, el.getBoundingClientRect()));
  return m;
}

/* ---------- копирайт: открытие вкладки ---------- */
function openCopyrightTab(){
  chrome.tabs.create({ url: COPYRIGHT_URL });
  window.close();
}
function animateFlip(prev){
  requestAnimationFrame(()=>{
    const duration = 400; // мс, чуть дольше для плавности
    [...$list.children].forEach(el=>{
      const id=el.dataset.id, a=prev.get(id); if(!a) return;
      const b=el.getBoundingClientRect();
      const dx=a.left-b.left, dy=a.top-b.top;
      if(dx || dy){
        el.style.willChange = 'transform';
        el.style.transform=`translate(${dx}px,${dy}px)`; el.getBoundingClientRect();
        el.style.transition=`transform ${duration}ms cubic-bezier(.2,.6,.2,1)`; el.style.transform="translate(0,0)";
        el.addEventListener("transitionend", ()=>{ el.style.transition=""; el.style.willChange=''; }, { once:true });
      }
    });
  });
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
  let pointerDown=false, pointerId=null, startX=0, startY=0, started=false;
  function ensureStart(){
    if (started) return; started=true;
    dragId = tile.dataset.id;
    document.documentElement.classList.add('dragging-global');
    tile.classList.add('dragging');
  }
  function onMove(e){
    if (!pointerDown) return; const x=e.clientX, y=e.clientY;
    if (!started){ const dx=x-startX, dy=y-startY; if ((dx*dx+dy*dy)<9) return; ensureStart(); }
    // Без фантома: оригинальная плитка остаётся видимой с подсветкой
    lastPointerX = x; lastPointerY = y;
    if (!reorderRaf){
      reorderRaf = requestAnimationFrame(()=>{ reorderRaf = 0; reorderByCursor(lastPointerX, lastPointerY, items); });
    }
    e.preventDefault();
  }
  function onUp(){
    if (!pointerDown) return; pointerDown=false; tile.releasePointerCapture?.(pointerId);
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
    document.documentElement.classList.remove('dragging-global');
    if (started){ tile.classList.remove('dragging'); lastDragEndedAt=Date.now(); if(liveOrder){ const toSave=liveOrder; liveOrder=null; dragId=null; const isRoot = (currentFolderId === null || currentFolderId === undefined); console.log('onUp - isRoot:', isRoot, 'toSave:', toSave); // Отладка const p = isRoot ? persistRootMixedOrder(toSave) : persistReorderedSubset(toSave); p.finally(()=>{ const prev=captureRects(); render(toSave, prev); }); return; } }
    started=false; dragId=null; liveOrder=null;
  }
  tile.addEventListener('pointerdown', (e)=>{
    if(!editMode || !moveMode) return; if(e.button!==0) return;
    // Не стартуем DnD, если клик пришёл по кнопке редактирования/удаления
    if ((e.target && e.target.closest && e.target.closest('.edit-mini'))) return;
    pointerDown=true; pointerId=e.pointerId; startX=e.clientX; startY=e.clientY;
    tile.setPointerCapture?.(pointerId);
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  });
}

// Глобальный DnD на контейнере: можно тащить и бросать где угодно внутри #list
// Вычисляем целевой индекс по координатам курсора, а не только над плиткой
function reorderByCursor(clientX, clientY, items){
  if (!dragId) return;
  console.log('reorderByCursor - dragId:', dragId, 'items:', items); // Отладка
  const prevRects = captureRects();
  const order = [...(liveOrder ?? items)];
  const from = order.findIndex(x=>x.id===dragId);
  if (from < 0) return;

  // Соберём DOM-элементы в текущем порядке (папки и ссылки)
  const tilesAll = [...$list.children].filter(el=>el.dataset && (el.dataset.type === 'link' || el.dataset.type === 'folder'));
  const tiles = tilesAll;
  if (tiles.length === 0) return;
  // Сетка: вычислим размер ячеек и кол-во колонок из CSS
  const rs = getComputedStyle(document.documentElement);
  const tilePx = parseInt(rs.getPropertyValue('--tileSize')) || 56;
  const gapPx  = parseInt(rs.getPropertyValue('--gap')) || 10;
  const cols   = parseInt(getComputedStyle($list).getPropertyValue('--cols')) || 5;

  // Вычислим индекс вставки по координате курсора относительно сетки
  const gridRect = $list.getBoundingClientRect();
  const localX = clientX - gridRect.left;
  const localY = clientY - gridRect.top;
  const cellW = tilePx;
  const cellH = tilePx + (window.userShowTitles ? (parseInt(rs.getPropertyValue('--titleGap')) + parseInt(rs.getPropertyValue('--titleH'))) : 0);
  const strideX = cellW + gapPx;
  const strideY = cellH + gapPx;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((localX + gapPx/2) / strideX)));
  const row = Math.max(0, Math.floor((localY + gapPx/2) / strideY));
  let targetIndex = row * cols + col;
  if (targetIndex > tiles.length) targetIndex = tiles.length;

  // Центр-правило по X внутри ячейки
  const cellLeft = col * strideX;
  const centerX = cellLeft + cellW/2;
  const HYST_X = 8;
  let to = targetIndex;
  if (localX > centerX + HYST_X) to = targetIndex + 1;
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
  render(order, prevRects);
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

  // Обновляем порядок папок в текущей папке
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

  // Обновляем порядок закладок в текущей папке
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

  // Показываем/скрываем заголовок папки
  if (currentFolderId !== null && currentFolderId !== undefined) {
    const folders = await getFolders();
    const currentFolder = folders.find(f => f.id === currentFolderId);
    if (currentFolder) {
      $folderTitle.textContent = currentFolder.name;
      $folderHeader.style.display = "flex";
    }
  } else {
    $folderHeader.style.display = "none";
  }

  $list.innerHTML="";
  
  // Если мы в корневой папке, рендерим смешанный список (папки + закладки)
  let mixedRootRendered = false;
  if ((currentFolderId === null || currentFolderId === undefined)) {
    const folders = await getFoldersForCurrentFolder();
    const rootLinks = links; // уже получены выше

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
    mixedOrdered.forEach(entry => {
      if (entry.type === 'folder'){
        const folder = folderById.get(entry.id);
        if (!folder) return;
        const tile = document.createElement("div");
        tile.className = "tile folder-tile";
        tile.dataset.id = folder.id;
        tile.dataset.type = "folder";
        tile.title = folder.name;
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.src = folder.icon;
        img.draggable = false;
        tile.appendChild(img);

        if (window.userShowTitles) {
          const caption = document.createElement('div');
          caption.className = 'caption';
          caption.textContent = folder.name;
          caption.setAttribute('draggable','false');
          tile.appendChild(caption);
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
          if (moveMode) addDragHandlers(tile, mixedItems);
          // В Move режиме добавляем визуальные подсказки и курсор и для папок
          if (moveMode){
            tile.style.cursor = 'grab';
            tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
            tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
            const bar=document.createElement('div');
            bar.style.position='absolute'; bar.style.left='50%';
            bar.style.top='calc(50% + (var(--tileSize) * 0.52)/2 + 6px)';
            bar.style.transform='translateX(-50%)'; bar.style.width='12px'; bar.style.height='2px';
            bar.style.borderRadius='3px';
            bar.style.background='color-mix(in srgb, var(--icon-color) 60%, transparent)';
            tile.appendChild(bar);
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
          tile.addEventListener("click", () => navigateToFolder(folder.id));
        }
        $list.appendChild(tile);
      } else {
        const item = linkById.get(entry.id);
        if (!item) return;
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.id = item.id;
        tile.dataset.type = "link";
        tile.title = item.title || "";
        tile.draggable = !!editMode;

        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.draggable = false;
        let faviconUrl = item.favicon || DEFAULT_ICON;
        if (faviconUrl === DEFAULT_ICON && item.url) {
          const cachedFavicon = faviconCache.get(item.url);
          faviconUrl = cachedFavicon ? cachedFavicon : NO_ICON_URL;
        }
        if (faviconUrl && faviconUrl !== DEFAULT_ICON && faviconUrl !== NO_ICON_URL) {
          const cachedFavicon = faviconCache.get(faviconUrl);
          if (cachedFavicon && cachedFavicon.startsWith('data:')) faviconUrl = cachedFavicon;
        }
        img.src = faviconUrl;
        if (faviconUrl && faviconUrl !== DEFAULT_ICON && faviconUrl !== NO_ICON_URL && faviconUrl.startsWith('http') && !faviconCache.has(faviconUrl)){
          const isProblematic = isPotentiallyProblematicFavicon(faviconUrl);
          const loadFunction = isProblematic ? loadFaviconAsDataUrlWithRetry : loadFaviconAsDataUrl;
          loadFunction(faviconUrl).then(dataUrl => { if (dataUrl){ faviconCache.set(faviconUrl, dataUrl); if (img.src === faviconUrl) img.src = dataUrl; saveFaviconCache().catch(()=>{}); } }).catch(()=>{});
        }
        if (item.url && !faviconCache.has(item.url)){
          getFaviconWithCache(item.url).then(cachedFavicon => { if (cachedFavicon && cachedFavicon !== NO_ICON_URL){ if (img.src === DEFAULT_ICON || img.src === NO_ICON_URL) img.src = cachedFavicon; } }).catch(()=>{});
        }
        if (item.iconTone === 'mono') img.classList.add('mono');
        tile.appendChild(img);
        if (window.userShowTitles) {
          const caption = document.createElement('div');
          caption.className = 'caption';
          caption.setAttribute('draggable','false');
          const t = (item.title || "").trim();
          if (t) caption.textContent = t; else { try { const u = new URL(item.url || ""); caption.textContent = u.hostname.replace(/^www\./, ''); } catch { caption.textContent = ""; } }
          tile.appendChild(caption);
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
          if (moveMode) addDragHandlers(tile, mixedItems);
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
          tile.addEventListener("click", () => { if (item.url) chrome.tabs.create({ url: item.url }); });
        }
        if (dragId && item.id === dragId) tile.classList.add('dragging');
        if (editMode && moveMode){
          tile.style.cursor = 'grab';
          tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
          tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
          const bar=document.createElement('div');
          bar.style.position='absolute'; bar.style.left='50%';
          bar.style.top='calc(50% + (var(--tileSize) * 0.52)/2 + 6px)';
          bar.style.transform='translateX(-50%)'; bar.style.width='12px'; bar.style.height='2px';
          bar.style.borderRadius='3px';
          bar.style.background='color-mix(in srgb, var(--icon-color) 60%, transparent)';
          tile.appendChild(bar);
        } else { tile.style.cursor = ''; tile.classList.remove('hovering'); }
        $list.appendChild(tile);
      }
    });

    mixedRootRendered = true;
  }

  // Рендерим закладки и папки (если не отрисовали смешанный корень)
  if (!mixedRootRendered) {
    // Получаем папки и закладки с учетом сохраненного порядка
    let folders = await getFoldersForCurrentFolder();
    let orderedLinks = links;
    
    // Выбираем порядок: во время DnD используем live order (orderOverride), иначе сохранённый
    if (Array.isArray(orderOverride) && orderOverride.length && (orderOverride[0].id !== undefined)) {
      // Используем orderOverride для сортировки
      const folderOrder = orderOverride.filter(x => x.type === 'folder');
      const linkOrder = orderOverride.filter(x => x.type === 'link');
      
      if (folderOrder.length > 0) {
        const orderIndex = new Map(folderOrder.map((x, i) => [x.id, i]));
        folders = folders.sort((a, b) => {
          const ai = orderIndex.get(a.id);
          const bi = orderIndex.get(b.id);
          if (ai == null && bi == null) return 0;
          if (ai == null) return 1;
          if (bi == null) return -1;
          return ai - bi;
        });
      }
      
      if (linkOrder.length > 0) {
        const orderIndex = new Map(linkOrder.map((x, i) => [x.id, i]));
        orderedLinks = links.sort((a, b) => {
          const ai = orderIndex.get(a.id);
          const bi = orderIndex.get(b.id);
          if (ai == null && bi == null) return 0;
          if (ai == null) return 1;
          if (bi == null) return -1;
          return ai - bi;
        });
      }
    } else {
      // Используем сохраненный порядок
      const folderOrder = await getFolderOrder();
      const orderIndex = new Map(folderOrder.map((x, i) => [x.id + ':' + x.type, i]));
      const mixedDefault = [
        ...folders.map(f => ({ id: f.id, type: 'folder' })),
        ...links.map(l => ({ id: l.id, type: 'link' }))
      ];
      const mixedOrdered = [...mixedDefault].sort((a, b) => {
        const ai = orderIndex.get(a.id + ':' + a.type);
        const bi = orderIndex.get(b.id + ':' + b.type);
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1;
        if (bi == null) return -1;
        return ai - bi;
      });
      
      // Разделяем обратно на папки и закладки
      const folderById = new Map(folders.map(f => [f.id, f]));
      const linkById = new Map(links.map(l => [l.id, l]));
      
      folders = mixedOrdered.filter(x => x.type === 'folder').map(x => folderById.get(x.id)).filter(Boolean);
      orderedLinks = mixedOrdered.filter(x => x.type === 'link').map(x => linkById.get(x.id)).filter(Boolean);
    }
    folders.forEach(folder => {
      const tile = document.createElement("div");
      tile.className = "tile folder-tile";
      tile.dataset.id = folder.id;
      tile.dataset.type = "folder";
      tile.title = folder.name;
      tile.draggable = !!editMode;

      const img = document.createElement("img");
      img.className = "favicon";
      img.alt = "";
      img.src = folder.icon;
      img.draggable = false;
      tile.appendChild(img);

      if (window.userShowTitles) {
        const caption = document.createElement('div');
        caption.className = 'caption';
        caption.textContent = folder.name;
        caption.setAttribute('draggable','false');
        tile.appendChild(caption);
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
        if (moveMode) {
          // Создаем смешанный массив для перетаскивания (папки + закладки)
          const mixedItems = [
            ...folders.map(f => ({ id: f.id, type: 'folder' })),
            ...orderedLinks.map(l => ({ id: l.id, type: 'link' }))
          ];
          addDragHandlers(tile, mixedItems);
        }
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
        tile.addEventListener("click", () => navigateToFolder(folder.id));
      }
      
      // Если сейчас идёт перетаскивание этого элемента, сохраняем подсветку
      if (dragId && folder.id === dragId) {
        tile.classList.add('dragging');
      }
      
      // В Move режиме добавляем визуальные "две полоски" под иконкой для подсказки
      if (editMode && moveMode){
        // Явно курсор-ладонь на всю плитку
        tile.style.cursor = 'grab';
        // Подложка на наведение 50%: добавляем/удаляем класс hovering
        tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
        tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
        const bar=document.createElement('div');
        bar.style.position='absolute'; bar.style.left='50%';
        bar.style.top='calc(50% + (var(--tileSize) * 0.52)/2 + 6px)';
        bar.style.transform='translateX(-50%)'; bar.style.width='12px'; bar.style.height='2px';
        bar.style.borderRadius='3px';
        bar.style.background='color-mix(in srgb, var(--icon-color) 60%, transparent)';
        tile.appendChild(bar);
      } else {
        tile.style.cursor = '';
        tile.classList.remove('hovering');
      }
      
      $list.appendChild(tile);
    });

    // Затем рендерим закладки (orderedLinks уже определен выше)
    orderedLinks.forEach(item => {
      // Пропускаем элементы, которые не являются закладками
      if (!item.url) return;
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.id = item.id;
    tile.dataset.type = "link";
    tile.title = item.title || "";
    tile.draggable = !!editMode;

    const img = document.createElement("img");
    img.className = "favicon";
    img.alt = "";
    img.draggable = false;
    
    // Используем кэшированный фавикон или загружаем новый
    let faviconUrl = item.favicon || DEFAULT_ICON;
    
    // Сначала проверяем кэш для URL сайта
    if (faviconUrl === DEFAULT_ICON && item.url) {
      const cachedFavicon = faviconCache.get(item.url);
      if (cachedFavicon) {
        faviconUrl = cachedFavicon;
      } else {
        faviconUrl = NO_ICON_URL;
      }
    }
    
    // Затем проверяем кэш для самого фавикона
    if (faviconUrl && faviconUrl !== DEFAULT_ICON && faviconUrl !== NO_ICON_URL) {
      const cachedFavicon = faviconCache.get(faviconUrl);
      if (cachedFavicon && cachedFavicon.startsWith('data:')) {
        faviconUrl = cachedFavicon;
      }
    }
    
    // Устанавливаем фавикон немедленно
    img.src = faviconUrl;
    
    // Если фавикон не в кэше, загружаем его в фоне и обновляем
    if (faviconUrl && faviconUrl !== DEFAULT_ICON && faviconUrl !== NO_ICON_URL && 
        faviconUrl.startsWith('http') && !faviconCache.has(faviconUrl)) {
      // Проверяем, является ли это потенциально проблемным фавиконом
      const isProblematic = isPotentiallyProblematicFavicon(faviconUrl);
      
      // Для проблемных фавиконов используем повторные попытки
      const loadFunction = isProblematic ? loadFaviconAsDataUrlWithRetry : loadFaviconAsDataUrl;
      
      // Загружаем в фоне без блокировки UI
      loadFunction(faviconUrl).then(dataUrl => {
        if (dataUrl) {
          faviconCache.set(faviconUrl, dataUrl);
          // Обновляем изображение если оно еще отображается
          if (img.src === faviconUrl) {
            img.src = dataUrl;
          }
          saveFaviconCache().catch(() => {});
        }
      }).catch(() => {
        // Игнорируем ошибки загрузки в фоне
      });
    }
    
    // Дополнительно проверяем и загружаем фавиконы для URL сайта
    if (item.url && !faviconCache.has(item.url)) {
      getFaviconWithCache(item.url).then(cachedFavicon => {
        if (cachedFavicon && cachedFavicon !== NO_ICON_URL) {
          // Обновляем изображение если оно еще отображается и использует дефолтную иконку
          if (img.src === DEFAULT_ICON || img.src === NO_ICON_URL) {
            img.src = cachedFavicon;
          }
        }
      }).catch(() => {
        // Игнорируем ошибки
      });
    }
    if (item.iconTone === 'mono') img.classList.add('mono');
    tile.appendChild(img);

    // подпись под иконкой
    if (window.userShowTitles) {
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.setAttribute('draggable','false');
      const t = (item.title || "").trim();
      if (t) {
        caption.textContent = t;
      } else {
        try {
          const u = new URL(item.url || "");
          caption.textContent = u.hostname.replace(/^www\./, '');
        } catch {
          caption.textContent = "";
        }
      }
      tile.appendChild(caption);
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
          if (idx >= 0) {
            arr.splice(idx, 1);
            await setLinks(arr);
            // Очищаем кэш после удаления закладки
            await cleanupFaviconCache();
            render();
          }
        } else {
          openEditorOverlay(item);
        }
      });
      // В Move режиме не показываем мини-кнопки вовсе
      if (!moveMode) tile.appendChild(btn);
      // Drag & drop для закладок и папок в режиме Move
      if (moveMode) {
        // Создаем смешанный массив для перетаскивания (папки + закладки)
        const mixedItems = [
          ...folders.map(f => ({ id: f.id, type: 'folder' })),
          ...orderedLinks.map(l => ({ id: l.id, type: 'link' }))
        ];
        console.log('Link drag handlers - mixedItems:', mixedItems); // Отладка
        addDragHandlers(tile, mixedItems);
      }
      // Клик по плитке в режиме редактирования: открыть редактор (если это не завершившийся drag)
      tile.addEventListener("click", (e)=>{
        const now = Date.now();
        // Если удерживается Ctrl — не открываем редактор кликом по плитке
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
      tile.addEventListener("click", () => {
        if (item.url) chrome.tabs.create({ url: item.url });
      });
    }
    // Если сейчас идёт перетаскивание этого элемента, сохраняем подсветку
    if (dragId && item.id === dragId) {
      tile.classList.add('dragging');
    }
    // В Move режиме добавляем визуальные "две полоски" под иконкой для подсказки
    if (editMode && moveMode){
      // Явно курсор-ладонь на всю плитку
      tile.style.cursor = 'grab';
      // Подложка на наведение 50%: добавляем/удаляем класс hovering
      tile.addEventListener('mouseenter', ()=> tile.classList.add('hovering'));
      tile.addEventListener('mouseleave', ()=> tile.classList.remove('hovering'));
      const bar=document.createElement('div');
      bar.style.position='absolute'; bar.style.left='50%';
      bar.style.top='calc(50% + (var(--tileSize) * 0.52)/2 + 6px)';
      bar.style.transform='translateX(-50%)'; bar.style.width='12px'; bar.style.height='2px';
      bar.style.borderRadius='3px';
      bar.style.background='color-mix(in srgb, var(--icon-color) 60%, transparent)';
      tile.appendChild(bar);
    } else {
      tile.style.cursor = '';
      tile.classList.remove('hovering');
    }
    $list.appendChild(tile);
  });
  }

  // Обновить вид мини-кнопок (✎/✕) с учётом Ctrl
  updateEditMiniButtonsIcon();
  if (prevRects) animateFlip(prevRects);
  
  // Предзагружаем фавиконы для быстрой загрузки при следующем открытии
  preloadFavicons(links);
  } catch (error) {
    console.error('Ошибка в render:', error);
  } finally {
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
  const tileOpacity = clampOpacityPercent($tileOpacityInput?.value ?? $tileOpacityRange?.value ?? 0);
  const folderOpacity = clampOpacityPercent($folderOpacityInput?.value ?? $folderOpacityRange?.value ?? 60);
  const tileGapPercent = clampGapPercent($tileGapInput?.value ?? $tileGapRange?.value ?? 100);
  const faviconSaturation = clampSaturationPercent($faviconSaturationInput?.value ?? $faviconSaturationRange?.value ?? 100);
  const maxCols = clampMaxCols($maxColsInput?.value ?? $maxColsRange?.value ?? 5);
  const showTitles = !!($showTitlesInline?.checked);
  const autoFavicon = !!($autoFavicon?.checked);
  const bgTransparent = !!($widgetBgTransparent?.checked);
  const footerTransparent = !!($footerTransparent?.checked);
  const theme = $themeToggleInline?.checked ? 'light' : 'dark';
  const iconTheme = $themeIconToggleInline?.checked ? 'light' : 'dark';
  return { tilePercent, tileOpacity, folderOpacity, tileGapPercent, faviconSaturation, maxCols, showTitles, autoFavicon, bgTransparent, footerTransparent, theme, iconTheme };
}
function shallowEqualSettings(a,b){
  if(!a||!b) return false;
  const keys=["tilePercent","tileOpacity","folderOpacity","tileGapPercent","faviconSaturation","maxCols","showTitles","autoFavicon","bgTransparent","footerTransparent","theme","iconTheme"];
  return keys.every(k => (a[k] ?? null) === (b[k] ?? null));
}
async function commitSettings(){
  const s = gatherControlsState();
  await chrome.storage.local.set({
    [TILE_PERCENT_KEY]: s.tilePercent,
    [TILE_OPACITY_KEY]: s.tileOpacity,
    [FOLDER_OPACITY_KEY]: s.folderOpacity,
    [FAVICON_SATURATION_KEY]: s.faviconSaturation,
    [MAX_COLS_KEY]: s.maxCols,
    [SHOW_TITLES_KEY]: !!s.showTitles,
    [AUTO_FAVICON_KEY]: !!s.autoFavicon,
    [BG_TRANSPARENT_KEY]: !!s.bgTransparent,
    [FOOTER_TRANSPARENT_KEY]: !!s.footerTransparent,
    [THEME_KEY]: s.theme,
    [ICON_THEME_KEY]: s.iconTheme,
  });
  applyTheme(s.theme, {save:false});
  setActionIconByTheme(s.iconTheme);
  settingsBaseline = s;
  markDirty(false);
  // Закрыть панель настроек после сохранения
  closeSettingsPanel();
}
async function revertSettings(){
  const st = await chrome.storage.local.get({
    [TILE_PERCENT_KEY]: 60,
    [TILE_OPACITY_KEY]: 0,
    [FOLDER_OPACITY_KEY]: 60,
    [FAVICON_SATURATION_KEY]: 100,
    [MAX_COLS_KEY]: 5,
    [SHOW_TITLES_KEY]: false,
    [AUTO_FAVICON_KEY]: true,
    [BG_TRANSPARENT_KEY]: false,
    [FOOTER_TRANSPARENT_KEY]: false,
    [THEME_KEY]: 'dark',
    [ICON_THEME_KEY]: 'dark',
  });
  const s = {
    tilePercent: clampUserPercent(st[TILE_PERCENT_KEY]),
    tileOpacity: clampOpacityPercent(st[TILE_OPACITY_KEY]),
    folderOpacity: clampOpacityPercent(st[FOLDER_OPACITY_KEY]),
    tileGapPercent: clampGapPercent(st[TILE_GAP_PERCENT_KEY] ?? 100),
    faviconSaturation: clampSaturationPercent(st[FAVICON_SATURATION_KEY]),
    maxCols: clampMaxCols(st[MAX_COLS_KEY]),
    showTitles: !!st[SHOW_TITLES_KEY],
    autoFavicon: !!st[AUTO_FAVICON_KEY],
    bgTransparent: !!st[BG_TRANSPARENT_KEY],
    footerTransparent: !!st[FOOTER_TRANSPARENT_KEY],
    theme: st[THEME_KEY] || 'dark',
    iconTheme: st[ICON_THEME_KEY] || 'dark',
  };
  // Применить без записи
  applyTilePercentUser(s.tilePercent, {save:false, recalcWidth: !isSettingsOpen()});
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
  if ($autoFavicon) $autoFavicon.checked = !!s.autoFavicon;
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
  prevImg.src=item.favicon||DEFAULT_ICON;
  prevImg.classList.toggle('mono', (item.iconTone||null)==='mono');
  
  // Добавляем обработчик ошибок для изображения
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
  // Предзаполнить URL, если текущая иконка — http(s)
  try{ if(/^https?:\/\//i.test(String(item.favicon||''))) inIconUrl.value = String(item.favicon); }catch{}

  const actions=document.createElement("div"); actions.className="actions";
  const del=document.createElement("button"); del.className="danger"; del.textContent="Delete";
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Cancel";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Save";
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(del); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(fr2); wrap.appendChild(frFolder); wrap.appendChild(frIcon); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = item.favicon || DEFAULT_ICON;
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
    currentIcon = DEFAULT_ICON; currentTone=null;
    prevImg.src = DEFAULT_ICON; prevImg.classList.remove('mono');
  });

  del.addEventListener("click", async ()=>{
    if(!confirm("Удалить?")) return;
    const arr=await getLinks(); const i=arr.findIndex(x=>x.id===item.id);
    if(i>=0){
      arr.splice(i,1);
      await setLinks(arr);
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
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; } }catch{} }
    })();
    const arr=await getLinks(); const i=arr.findIndex(x=>x.id===item.id);
    if(i>=0){
      const selectedFolderId = inFolder.value || null;
      arr[i]={...arr[i], title:inTitle.value.trim()||arr[i].title, url, favicon:currentIcon, iconTone: currentTone, folderId: selectedFolderId};
      await setLinks(arr);
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
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Название папки"; inTitle.value=folder.name||"";
  fr1.appendChild(inTitle);

  const actions=document.createElement("div"); actions.className="actions";
  const del=document.createElement("button"); del.className="danger"; del.textContent="Удалить";
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Отмена";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Сохранить";
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(del); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(actions);
  $overlay.appendChild(wrap); $overlay.classList.add("open");

  let currentIcon = folder.icon || getDefaultFolderIconSync();
  let currentTone = folder.iconTone || null;

  const validate = ()=>{ const ok=inTitle.value.trim(); save.disabled=!ok; };
  inTitle.addEventListener("input", validate); validate();

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
    const folders=await getFolders(); const i=folders.findIndex(x=>x.id===folder.id);
    if(i>=0){
      folders[i]={...folders[i], name:inTitle.value.trim()||folders[i].name, icon:currentIcon, iconTone: currentTone};
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
  const inTitle=document.createElement("input"); inTitle.type="text"; inTitle.placeholder="Название папки"; fr1.appendChild(inTitle);

  const actions=document.createElement("div"); actions.className="actions";
  const left=document.createElement("div");
  const right=document.createElement("div"); right.className="actions-right";
  const cancel=document.createElement("button"); cancel.textContent="Отмена";
  const save=document.createElement("button"); save.className="primary"; save.textContent="Создать"; save.disabled=true;
  right.appendChild(cancel); right.appendChild(save); actions.appendChild(left); actions.appendChild(right);

  wrap.appendChild(favWrap); wrap.appendChild(fileInput); wrap.appendChild(fr1); wrap.appendChild(actions);
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
    await createFolder(inTitle.value.trim(), currentIcon);
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
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; } }catch{} }
    })();
    
    // Определяем финальную иконку
    let finalIcon = currentIcon;
    
    // Если пользователь не указал URL иконки вручную, проверяем настройку autoFavicon
    if (!inIconUrl.value.trim()) {
      const autoFaviconEnabled = await getAutoFaviconSetting();
      if (!autoFaviconEnabled) {
        // Если autoFavicon отключен, используем дефолтную иконку
        finalIcon = DEFAULT_ICON;
      } else {
        // Если autoFavicon включен, пытаемся подтянуть фавикон
        try {
          const favicon = await getFaviconWithCache(url);
          if (favicon && favicon !== NO_ICON_URL) {
            finalIcon = favicon;
            // Дополнительно кэшируем URL сайта для быстрого доступа
            faviconCache.set(url, favicon);
            saveFaviconCache().catch(() => {});
          } else {
            // Если не удалось подтянуть фавикон, используем NO_ICON_URL
            finalIcon = NO_ICON_URL;
          }
        } catch (error) {
          console.error('Ошибка при получении фавикона:', error);
          finalIcon = NO_ICON_URL;
        }
      }
    }
    
    const arr=await getLinks();
    const selectedFolderId = inFolder.value || null;
    arr.push({ 
      id:newId(), 
      title:inTitle.value.trim()||url, 
      url, 
      kind:"custom", 
      favicon:finalIcon, 
      iconTone: currentTone,
      folderId: selectedFolderId
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

function showAddPanel() {
  if ($addPanel) {
    $addPanel.classList.add('show');
    addPanelVisible = true;
  }
}

function hideAddPanel() {
  if ($addPanel) {
    $addPanel.classList.remove('show');
    addPanelVisible = false;
  }
}

/* ---------- Панелька режимов ---------- */
let editPanelVisible = false;
function showEditPanel(){ if($editPanel){ $editPanel.classList.add('show'); editPanelVisible=true; } }
function hideEditPanel(){ if($editPanel){ $editPanel.classList.remove('show'); editPanelVisible=false; } }

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
  
  // Предзаполняем URL иконки текущей страницы
  if (currentTabData && currentTabData.favicon) {
    inIconUrl.value = currentTabData.favicon;
  }
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
      if(v){ if(!/^https?:\/\//i.test(v)) v='https://'+v; try{ const u=new URL(v); if(u.protocol==='http:'||u.protocol==='https:'){ currentIcon=u.toString(); currentTone=null; } }catch{} }
    })();
    
    // Определяем финальную иконку
    let finalIcon = currentIcon;
    
    // Если пользователь не указал URL иконки вручную, проверяем настройку autoFavicon
    if (!inIconUrl.value.trim()) {
      const autoFaviconEnabled = await getAutoFaviconSetting();
      if (!autoFaviconEnabled) {
        // Если autoFavicon отключен, используем дефолтную иконку
        finalIcon = DEFAULT_ICON;
      } else {
        // Если autoFavicon включен, пытаемся подтянуть фавикон
        try {
          const favicon = await getFaviconWithCache(url);
          if (favicon && favicon !== NO_ICON_URL) {
            finalIcon = favicon;
            // Дополнительно кэшируем URL сайта для быстрого доступа
            faviconCache.set(url, favicon);
            saveFaviconCache().catch(() => {});
          } else {
            // Если не удалось подтянуть фавикон, используем NO_ICON_URL
            finalIcon = NO_ICON_URL;
          }
        } catch (error) {
          console.error('Ошибка при получении фавикона:', error);
          finalIcon = NO_ICON_URL;
        }
      }
    }
    
    const arr=await getLinks();
    const selectedFolderId = inFolder.value || null;
    arr.push({ 
      id:newId(), 
      title:inTitle.value.trim()||url, 
      url, 
      kind:"custom", 
      favicon:finalIcon, 
      iconTone: currentTone,
      folderId: selectedFolderId
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
if ($backButton) {
  $backButton.addEventListener("click", async () => {
    await navigateToRoot();
  });
}

if ($closeButton) {
  $closeButton.addEventListener("click", async () => {
    await navigateToRoot();
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
if ($modeMove){
  $modeMove.addEventListener('click', ()=>{
    hideEditPanel();
    const turningOn = !(editMode && moveMode);
    editMode = turningOn; moveMode = turningOn; ctrlPressed = false; selectMode = false; selectedIds.clear(); updateEditMiniButtonsIcon(); updateBulkActionsUI();
    document.documentElement.classList.toggle('move-mode', turningOn);
    if ($btnEdit){ $btnEdit.classList.toggle('active', editMode); $btnEdit.setAttribute('aria-pressed', editMode?'true':'false'); }
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
const TILE_OPACITY_KEY = "tileOpacity"; // user-facing 0..100
const FOLDER_OPACITY_KEY = "folderOpacity"; // user-facing 0..100
const AUTO_FAVICON_KEY = "autoFavicon"; // boolean, default true
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
  if (recalcWidth) restoreWidthByLinks();
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
  document.documentElement.style.setProperty('--titleExtra', window.userShowTitles ? 'calc(var(--titleGap) + var(--titleH))' : '0px');
  document.documentElement.classList.toggle('titles-on', window.userShowTitles);
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
      
      // Auto favicon вкл
      await chrome.storage.local.set({ [AUTO_FAVICON_KEY]: true });
      
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
      if (priorityLinks.length > 0) {
        console.log('Приоритетная загрузка фавиконов для видимых элементов...');
        // Ждем загрузки приоритетных фавиконов, но с увеличенным таймаутом
        await Promise.race([
          preloadFavicons(priorityLinks, true), // Приоритетный режим
          new Promise(resolve => setTimeout(resolve, 800)) // Увеличиваем до 800мс на приоритетные
        ]);
      }
      
      // Принудительно предзагружаем проблемные фавиконы
      forcePreloadProblematicFavicons().catch(error => {
        console.error('Ошибка принудительной предзагрузки проблемных фавиконов:', error);
      });
      
      // Мониторинг и улучшение загрузки проблемных фавиконов
      monitorAndImproveFaviconLoading().catch(error => {
        console.error('Ошибка мониторинга проблемных фавиконов:', error);
      });
      
      // Затем загружаем остальные в фоне
      setTimeout(() => {
        preloadFavicons(allLinks).then(() => {
          console.log('Предзагрузка фавиконов завершена');
          // После предзагрузки проверяем проблемные фавиконы
          return fixProblematicFavicons(allLinks);
        }).catch(error => {
          console.error('Ошибка при предзагрузке фавиконов:', error);
        });
      }, 50); // Уменьшаем задержку
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
  chrome.runtime.onMessage.addListener((msg)=>{
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
    const st = await chrome.storage.local.get(AUTO_FAVICON_KEY);
    const on = !!(st?.[AUTO_FAVICON_KEY] ?? true); // По умолчанию true
    if ($autoFavicon) $autoFavicon.checked = on;
  }catch{}
  try{
    const st = await chrome.storage.local.get(THEME_KEY);
    const theme = st?.[THEME_KEY] || 'dark';
    if ($themeToggleInline) $themeToggleInline.checked = (theme === 'light');
  }catch{}
}
function openSettingsPanel(){
  if (!$settingsFloat) return;
  // синхронизируем контролы с сохранёнными значениями
  syncSettingsInputsFromStorage();
  // расширить карточку до комфортного минимума (как в редакторе), затем заморозить
  settingsOpen = true;
  // Жёсткая фиксация ширины для панели настроек
  $card.style.width = `${MIN_EDITOR_WIDTH}px`;
  $card.classList.add('freeze-size');
  $settingsFloat.removeAttribute('hidden');
  requestAnimationFrame(()=> $settingsFloat.classList.add('open'));
  if ($btnSettings) { $btnSettings.classList.add('active'); $btnSettings.setAttribute('aria-pressed','true'); }
  if ($btnAdd) { $btnAdd.classList.remove('active'); $btnAdd.setAttribute('aria-pressed','false'); }
  if ($btnEdit) { $btnEdit.classList.remove('active'); $btnEdit.setAttribute('aria-pressed','false'); }
  // baseline
  revertSettings();
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
    const links = await getLinks();
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
    // Получаем папки
    const folders = await getFolders();
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
        autoFavicon,
        faviconSaturation,
        maxCols,
        showTitles,
        bgTransparent: !!(await chrome.storage.local.get(BG_TRANSPARENT_KEY).then(x=>x?.[BG_TRANSPARENT_KEY]).catch(()=>false)),
        footerTransparent: !!(await chrome.storage.local.get(FOOTER_TRANSPARENT_KEY).then(x=>x?.[FOOTER_TRANSPARENT_KEY]).catch(()=>false)),
      },
      links: links.map((x, index)=> ({ ...x, index })),
      folders: folders.map((f, index)=> ({ ...f, index })),
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
          if (!confirm('Импорт заменит текущие ссылки и папки. Продолжить?')) return;
          await setLinks(linksArr);
          if (foldersArr.length > 0) {
            await setFolders(foldersArr);
          }
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
          if (typeof settings.autoFavicon !== 'undefined'){
            const af = !!settings.autoFavicon;
            chrome.storage.local.set({ [AUTO_FAVICON_KEY]: af }).catch(()=>{});
            if ($autoFavicon) $autoFavicon.checked = af;
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
          if (typeof settings.showTitles !== 'undefined'){
            const on = !!settings.showTitles;
            applyShowTitles(on, {save:true, rerender:true});
            if ($showTitlesInline) $showTitlesInline.checked = on;
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
  $btnSettings.addEventListener('click', ()=>{
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
      closeSettingsPanel();
    }
  });
  createTooltip($btnSettings, "Settings");
}
if ($settingsClose) $settingsClose.addEventListener('click', closeSettingsPanel);
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
if ($autoFavicon){
  $autoFavicon.addEventListener('change', ()=>{
    const on = !!$autoFavicon.checked;
    chrome.storage.local.set({ [AUTO_FAVICON_KEY]: on }).catch(()=>{});
    if (settingsBaseline) markDirty(!shallowEqualSettings(gatherControlsState(), settingsBaseline));
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
