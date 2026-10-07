const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const desktopPin = require('./desktop-pin');
const widgetPlace = require('./widget-place');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('com.meowsclock.app');

// Виджет встроен в рабочий стол и почти всегда перекрыт окнами. Chromium считает такое окно
// невидимым и перестаёт его рисовать, а для дочернего окна рабочего стола это состояние может
// не сняться даже после «Свернуть всё» — виджет застывает. Отключаем расчёт перекрытия.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, 'renderer');
const WIDGET_WIDTH = 320;
const WIDGET_MIN_WIDTH = 250;
const WIDGET_MAX_WIDTH = 640;
const WIDGET_TITLE = 'MeowsClock — виджет';
const APP_ICON = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// ---------- Хранилище ----------

const DEFAULT_SETTINGS = {
  cities: ['moscow', 'danang'],
  showSeconds: false,
  autostart: false,
  widgetEnabled: true,
  widgetOnTop: false,
  widgetOpacity: 1,
  widgetBounds: null,
  widgetPlace: null,
  widgetWidth: WIDGET_WIDTH,
};

const clampWidth = (w) => Math.max(WIDGET_MIN_WIDTH, Math.min(WIDGET_MAX_WIDTH, Math.round(Number(w) || WIDGET_WIDTH)));

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettingsNow, 400);
}

function writeSettingsNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(dataPath('settings.json'), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Не удалось сохранить настройки', e);
  }
}

let settings;

// ---------- Виджет ----------

let widgetWindow = null;
let widgetHeight = 0; // высота по содержимому из последнего widget-resize
let tray = null;
let quitting = false;

function boundsVisible(b) {
  if (!b) return false;
  const area = screen.getDisplayMatching(b).workArea;
  return b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y >= area.y - 10 && b.y < area.y + area.height - 40;
}

function defaultWidgetPosition(height) {
  const area = screen.getPrimaryDisplay().workArea;
  const width = settings.widgetWidth;
  return { x: area.x + area.width - width - 24, y: area.y + 24, width, height };
}

// Запомненное место (монитор + отступ от края) → прямоугольник под текущие экраны
function widgetPosition(height) {
  const width = settings.widgetWidth;
  // Настройки старых версий: только абсолютные x, y
  const saved = settings.widgetBounds && { ...settings.widgetBounds, width, height };
  if (!settings.widgetPlace && boundsVisible(saved)) {
    settings.widgetPlace = widgetPlace.capture(saved);
    saveSettings();
  }
  return widgetPlace.resolve(settings.widgetPlace, width, height) || defaultWidgetPosition(height);
}

// Сохраняется только по действию пользователя (перетащил, растянул); перенастройка экранов место не трогает
function rememberWidgetPlace() {
  if (!widgetWindow) return;
  const b = widgetWindow.getBounds();
  settings.widgetBounds = { x: b.x, y: b.y };
  settings.widgetPlace = widgetPlace.capture(b);
  saveSettings();
}

// После смены мониторов: виджет мог уехать на другой экран или поменять размер — ставим как было
function restoreWidgetPlace() {
  const win = widgetWindow;
  if (!win || win.isDestroyed() || widthDrag) return;
  const b = win.getBounds();
  const target = widgetPosition(widgetHeight || b.height);
  if (target.x !== b.x || target.y !== b.y || target.width !== b.width || target.height !== b.height) {
    desktopPin.setBounds(win, target);
  }
  desktopPin.raise(win);
}

function createWidget() {
  const bounds = widgetPosition(widgetHeight || 60 + settings.cities.length * 54);

  widgetWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    // При resizable: false Chromium фиксирует размер окна, и SetWindowPos закреплённого виджета
    // не может поменять размер. Системной рамки у прозрачного окна нет — ширину меняют
    // «ручки» по краям в самом виджете (widget-width-*).
    resizable: true,
    minWidth: WIDGET_MIN_WIDTH,
    maxWidth: WIDGET_MAX_WIDTH,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: settings.widgetOnTop,
    title: WIDGET_TITLE,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const win = widgetWindow;
  win.setOpacity(settings.widgetOpacity);
  win.loadFile(path.join(RENDERER, 'widget.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    if (!settings.widgetOnTop) pinWidget(win);
  });
  // Страница меняет <title> — держим постоянный, по нему окно ищется при отладке
  win.on('page-title-updated', (e) => e.preventDefault());

  win.on('moved', rememberWidgetPlace);
  win.on('closed', () => {
    if (widgetWindow === win) widgetWindow = null;
    // Окно закреплено внутри рабочего стола и погибает вместе с Explorer — поднимаем заново
    if (!quitting && settings.widgetEnabled && !widgetWindow) setTimeout(() => setWidgetEnabled(true), 2000);
  });
}

// Explorer может ещё не создать рабочий стол (ранний автозапуск) — пробуем повторно
function pinWidget(win, attempt = 0) {
  if (win.isDestroyed() || settings.widgetOnTop) return;
  if (desktopPin.pin(win)) return;
  if (attempt < 30) setTimeout(() => pinWidget(win, attempt + 1), 2000);
}

function setWidgetEnabled(on) {
  settings.widgetEnabled = on;
  if (on && !widgetWindow) createWidget();
  if (!on && widgetWindow) widgetWindow.close();
}

// Смена режима «на рабочем столе» ↔ «поверх окон» — проще пересоздать окно
function recreateWidget() {
  if (!widgetWindow) return;
  const old = widgetWindow;
  widgetWindow = null;
  old.destroy();
  createWidget();
}

// ---------- Автозапуск ----------

function loginItemOptions() {
  if (app.isPackaged) return { args: ['--autostart'] };
  // В режиме разработки запускаем electron.exe с путём к проекту
  return { path: process.execPath, args: [path.resolve(app.getAppPath()), '--autostart'] };
}

function applyAutostart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: settings.autostart });
}

// ---------- Меню ----------

function commonMenuItems() {
  return [
    {
      label: 'Показывать секунды',
      type: 'checkbox',
      checked: settings.showSeconds,
      click: (item) => updateSettings({ showSeconds: item.checked }),
    },
    {
      label: 'Поверх всех окон',
      type: 'checkbox',
      checked: settings.widgetOnTop,
      click: (item) => updateSettings({ widgetOnTop: item.checked }),
    },
    {
      label: 'Прозрачность',
      submenu: [1, 0.9, 0.8, 0.7, 0.6, 0.5].map((v) => ({
        label: `${Math.round(v * 100)}%`,
        type: 'radio',
        checked: Math.abs(settings.widgetOpacity - v) < 0.01,
        click: () => updateSettings({ widgetOpacity: v }),
      })),
    },
    { label: 'Вернуть в угол экрана', click: () => updateSettings({ widgetBounds: null }) },
    {
      label: 'Стандартная ширина',
      enabled: settings.widgetWidth !== WIDGET_WIDTH,
      click: () => updateSettings({ widgetWidth: WIDGET_WIDTH }),
    },
    { type: 'separator' },
    {
      label: 'Запускать вместе с Windows',
      type: 'checkbox',
      checked: settings.autostart,
      click: (item) => updateSettings({ autostart: item.checked }),
    },
  ];
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Виджет на рабочем столе',
        type: 'checkbox',
        checked: settings.widgetEnabled,
        click: (item) => updateSettings({ widgetEnabled: item.checked }),
      },
      ...commonMenuItems(),
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(path.join(ASSETS, process.platform === 'win32' ? 'tray.ico' : 'icon-small.png'));
  tray.setToolTip('MeowsClock — мировое время');
  tray.on('click', () => updateSettings({ widgetEnabled: true }));
  buildTrayMenu();
}

// ---------- Настройки ----------

function updateSettings(patch) {
  const prev = { ...settings };
  Object.assign(settings, patch);

  if ('autostart' in patch && patch.autostart !== prev.autostart) applyAutostart();
  if ('widgetEnabled' in patch && patch.widgetEnabled !== prev.widgetEnabled) setWidgetEnabled(patch.widgetEnabled);
  if ('widgetOnTop' in patch && patch.widgetOnTop !== prev.widgetOnTop) recreateWidget();
  if ('widgetOpacity' in patch && widgetWindow) widgetWindow.setOpacity(settings.widgetOpacity);
  if ('widgetWidth' in patch) {
    settings.widgetWidth = clampWidth(settings.widgetWidth);
    if (widgetWindow) {
      const b = widgetWindow.getBounds();
      // Сохраняем правый край — виджет по умолчанию стоит у правой стороны экрана
      desktopPin.setBounds(widgetWindow, { ...b, x: b.x + b.width - settings.widgetWidth, width: settings.widgetWidth });
      rememberWidgetPlace();
    }
  }
  if ('widgetBounds' in patch && patch.widgetBounds === null) {
    settings.widgetPlace = null;
    if (widgetWindow) desktopPin.setBounds(widgetWindow, defaultWidgetPosition(widgetWindow.getBounds().height));
  }

  saveSettings();
  buildTrayMenu();
  if (widgetWindow) widgetWindow.webContents.send('settings', settings);
  return settings;
}

// ---------- IPC ----------

ipcMain.handle('get-state', () => ({ settings, version: app.getVersion() }));
ipcMain.handle('set-settings', (_e, patch) => updateSettings(patch));

ipcMain.on('widget-resize', (_e, height) => {
  if (!widgetWindow) return;
  const b = widgetWindow.getBounds();
  const h = Math.max(60, Math.min(1200, Math.round(height)));
  widgetHeight = h;
  const w = settings.widgetWidth;
  if (b.height !== h || b.width !== w) desktopPin.setBounds(widgetWindow, { ...b, width: w, height: h });
});

// Растягивание за край: renderer присылает смещение мыши от начала перетаскивания
let widthDrag = null;

ipcMain.on('widget-width-start', () => {
  if (widgetWindow) widthDrag = widgetWindow.getBounds();
});

ipcMain.on('widget-width-move', (_e, { edge, dx }) => {
  if (!widgetWindow || !widthDrag) return;
  const start = widthDrag;
  const width = clampWidth(start.width + (edge === 'left' ? -dx : dx));
  // Левый край: правая граница остаётся на месте
  const x = edge === 'left' ? start.x + start.width - width : start.x;
  settings.widgetWidth = width;
  desktopPin.setBounds(widgetWindow, { x, y: start.y, width, height: widgetWindow.getBounds().height });
});

ipcMain.on('widget-width-end', () => {
  if (!widgetWindow || !widthDrag) return;
  widthDrag = null;
  rememberWidgetPlace();
  buildTrayMenu();
});

ipcMain.on('widget-menu', () => {
  if (!widgetWindow) return;
  Menu.buildFromTemplate([
    ...commonMenuItems(),
    { type: 'separator' },
    { label: 'Скрыть виджет', click: () => updateSettings({ widgetEnabled: false }) },
    { label: 'Выход', click: () => app.quit() },
  ]).popup({ window: widgetWindow });
});

// ---------- Жизненный цикл ----------

app.on('second-instance', () => updateSettings({ widgetEnabled: true }));

app.on('before-quit', () => {
  quitting = true;
  writeSettingsNow();
});

app.on('window-all-closed', () => {
  // Приложение продолжает жить в трее
});

app.whenReady().then(() => {
  settings = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
  if (!Array.isArray(settings.cities)) settings.cities = [...DEFAULT_SETTINGS.cities];
  settings.widgetWidth = clampWidth(settings.widgetWidth);

  // Синхронизируем флаг с реальной записью автозапуска в системе
  if (process.platform === 'win32') {
    settings.autostart = app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  }

  createTray();
  if (settings.widgetEnabled) createWidget();
  widgetPlace.watchDisplays(restoreWidgetPlace);
});
