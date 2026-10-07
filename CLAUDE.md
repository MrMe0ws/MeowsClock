# MeowsClock — заметки для разработки

Виджет мирового времени на Electron. Стиль, механика окна и закрепления на рабочем столе взяты
из соседнего `../MeowsConvert` (там подробный CLAUDE.md про `desktop-pin.js` — правила те же).
Главного окна нет: только виджет и трей.

## Структура

```
src/
  main.js            трей, виджет, автозапуск, настройки, IPC
  desktop-pin.js     встраивание виджета в рабочий стол (SetParent в Progman/WorkerW через koffi)
  preload.js         window.api, белый список каналов main → renderer в CHANNELS
  renderer/
    cities.js        справочник: id → [название, страна, флаг flag-icons, пояс IANA]; POPULAR_CITIES
    clock.js         window.MCL: время в поясе через Intl, разница, «Сегодня/Завтра», дата
    widget.html/js/css  список городов, режим редактирования, выбор города
scripts/
  make-icon.js       рисует иконку кодом (часы с ушками) → assets/*.png|ico, build/icon.ico
  start.js           запуск без ELECTRON_RUN_AS_NODE
```

## Команды

- `npm start` — запуск; `npm run icon` — перерисовать иконки; `npm run dist` — установщик NSIS.
- Логику `clock.js` проверять node-скриптом: `global.window = {}` и `require` файлов.
- UI удобно проверять через `npm start -- --remote-debugging-port=9333` и CDP
  (`Runtime.evaluate` + `Page.captureScreenshot`): закреплённый виджет перекрыт окнами, обычный скриншот экрана его не видит.

## Архитектура

- Настройки (`DEFAULT_SETTINGS` в `main.js`) в `%APPDATA%\MeowsClock\settings.json`; renderer читает их
  через `get-state`, меняет через `set-settings`, main рассылает `settings`. `cities` — массив id из `cities.js`,
  id не переименовывать (хранятся у пользователя), неизвестные id молча пропускаются.
- Виджет тикает на границе каждой секунды; при тике меняется только текст (`tickRows`), DOM
  перестраивается в `render()` при смене списка/режима. Высота окна — из кода (`widget-resize`).
- Подсветка строки (`.here`, цвета активного поля MeowsConvert) — когда смещение пояса совпадает с местным.

## Подводные камни

- **`resizable: true` у виджета обязателен.** При `resizable: false` Chromium фиксирует размер окна, и
  `SetWindowPos` закреплённого окна не меняет высоту — виджет обрезается после добавления города.
  Пределы ширины — `minWidth/maxWidth` (`WIDGET_MIN_WIDTH`/`WIDGET_MAX_WIDTH`).
- **Ширина** (`settings.widgetWidth`) меняется «ручками» `.grip` по краям: renderer шлёт `widget-width-start/move/end`
  со смещением `screenX` от начала перетаскивания, main считает размер от bounds на старте (для левого края
  сдвигает x, правая граница стоит). Системного ресайза у прозрачного безрамочного окна нет.
  Высота — всегда по содержимому.
- Всё остальное — как в MeowsConvert: `CalculateNativeWinOcclusion` отключён, `backgroundThrottling: false`,
  двигать закреплённое окно только через `desktopPin.setBounds`, пересоздание после перезапуска Explorer.
- **ELECTRON_RUN_AS_NODE.** Терминал VS Code выставляет эту переменную, и её учитывает не только
  `npx electron .`, но и собранный `MeowsClock.exe`: он молча завершается, не создав окон. Запускать
  сборку из Проводника или обнулять переменную (`$env:ELECTRON_RUN_AS_NODE = $null`).
- Сборка (`npm run dist`) кладёт `dist\win-unpacked\MeowsClock.exe` и `dist\MeowsClock Setup 1.0.0.exe`.
  Подписи нет — SmartScreen ругается на неизвестного издателя. Путь проекта с кириллицей сборке не мешает.
- Поиск окна при отладке: дочернее окно Progman с заголовком `MeowsClock — виджет` (заголовок страницы не меняется).

## Место виджета при смене мониторов

- `src/widget-place.js` (одинаковый в MeowsClock, MeowsConvert, Notes, TempCPU) хранит в `settings.widgetPlace`
  монитор (`display.id`, запасной ключ — `label`) и отступ от ближайших краёв его рабочей области. Абсолютные
  `widgetBounds` оставлены для совместимости: из них при первом запуске строится `widgetPlace`.
  Без этого смена масштаба/разрешения/расположения экранов уводила виджет на соседний монитор.
- Место сохраняется только по действию пользователя (`moved`, конец растягивания) через `rememberWidgetPlace`.
- `watchDisplays` на `display-added/removed/metrics-changed`, выход из сна и разблокировку вызывает
  `restoreWidgetPlace` трижды (0,3 / 1,5 / 4 с): Explorer растягивает Progman не сразу, а Chromium после смены DPI
  сам двигает и масштабирует дочернее окно. Если монитора нет — тот же угол основного экрана, сохранённое место не меняется.
