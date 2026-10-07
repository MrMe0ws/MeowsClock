const $ = (sel) => document.querySelector(sel);
const { zoneTime, localTime, formatClock, formatDiff, dayLabel, isDaytime, formatLocalDate, escapeHtml } = window.MCL;

const MAX_CITIES = 12;
const ICON_SUN = '<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zm11.4 11.4 1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4-2.8 2.8z"/></svg>';
const ICON_MOON = '<svg class="moon" viewBox="0 0 24 24"><path d="M12.3 2a9 9 0 1 0 9.7 11.6A7.5 7.5 0 0 1 12.3 2z"/></svg>';
const ICON_HANDLE = '<svg viewBox="0 0 24 24"><path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11H7v-2h10v2z"/></svg>';

const state = { settings: null, editing: false, picker: false, query: '', focus: 0 };

// ---------- Высота окна ----------

// getBoundingClientRect считает раскладку сразу, не дожидаясь кадра: ResizeObserver срабатывает
// только при отрисовке, а перекрытое окно может не рисоваться.
let lastHeight = 0;
function reportHeight() {
  const h = Math.ceil($('#widget').getBoundingClientRect().height);
  if (h === lastHeight) return;
  lastHeight = h;
  window.api.widgetResize(h);
}

// ---------- Данные ----------

function cityIds() {
  return state.settings.cities.filter((id) => window.CITIES[id]);
}

function flag(country) {
  return `<span class="fi fis flag fi-${country}"></span>`;
}

function setCities(cities) {
  state.settings.cities = cities;
  render();
  window.api.setSettings({ cities });
}

// ---------- Список ----------

function renderRows() {
  const ids = cityIds();
  $('#rows').innerHTML = ids
    .map((id) => {
      const [name, country, code, tz] = window.CITIES[id];
      return `
        <div class="row" data-id="${id}" data-tz="${escapeHtml(tz)}" draggable="${state.editing}">
          <div class="handle" title="Перетащите, чтобы изменить порядок">${ICON_HANDLE}</div>
          <div class="chip" title="${escapeHtml(`${name}, ${country} · ${tz}`)}">
            ${flag(code)}
            <div class="chip-text">
              <span class="city">${escapeHtml(name)}</span>
              <span class="country">${escapeHtml(country)}</span>
            </div>
          </div>
          <div class="field">
            <div class="time"></div>
            <div class="hint"></div>
          </div>
          <button class="remove" title="Убрать">${ICON_REMOVE}</button>
        </div>`;
    })
    .join('');
  $('#rows').classList.toggle('editing', state.editing);
  $('#empty').hidden = ids.length > 0 && !state.editing;
  $('#empty').disabled = ids.length >= MAX_CITIES;
  $('#empty').textContent = ids.length >= MAX_CITIES ? `Не больше ${MAX_CITIES} городов` : '+ Добавить город';
}

function tickRows(now, local) {
  const seconds = state.settings.showSeconds;
  for (const row of $('#rows').children) {
    const t = zoneTime(row.dataset.tz, now);
    const timeEl = row.querySelector('.time');
    const text = formatClock(t, seconds);
    if (timeEl.textContent !== text) timeEl.textContent = text;
    timeEl.classList.toggle('sec', seconds);

    const diff = t.offset - local.offset;
    row.classList.toggle('here', diff === 0);
    const label = diff === 0 ? 'Как у вас' : `${dayLabel(t, local)}, ${formatDiff(diff)}`;
    const hint = `${isDaytime(t) ? ICON_SUN : ICON_MOON}<span>${label}</span>`;
    const hintEl = row.querySelector('.hint');
    if (hintEl.dataset.html !== hint) {
      hintEl.dataset.html = hint;
      hintEl.innerHTML = hint;
    }
  }
}

$('#rows').addEventListener('click', (e) => {
  const btn = e.target.closest('.remove');
  if (!btn) return;
  const id = btn.closest('.row').dataset.id;
  setCities(state.settings.cities.filter((c) => c !== id));
});

// Перетаскивание строк в режиме редактирования
let dragId = null;

function clearDropMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
}

$('#rows').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row || !state.editing) return;
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});

$('#rows').addEventListener('dragover', (e) => {
  const row = e.target.closest('.row');
  if (!dragId || !row) return;
  e.preventDefault();
  clearDropMarks();
  if (row.dataset.id === dragId) return;
  const r = row.getBoundingClientRect();
  row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});

$('#rows').addEventListener('drop', (e) => {
  const row = e.target.closest('.row');
  if (!dragId || !row || row.dataset.id === dragId) return;
  e.preventDefault();
  const r = row.getBoundingClientRect();
  const after = e.clientY >= r.top + r.height / 2;
  const list = state.settings.cities.filter((c) => c !== dragId);
  list.splice(list.indexOf(row.dataset.id) + (after ? 1 : 0), 0, dragId);
  setCities(list);
});

$('#rows').addEventListener('dragend', () => {
  dragId = null;
  clearDropMarks();
  for (const el of document.querySelectorAll('.dragging')) el.classList.remove('dragging');
});

// ---------- Выбор города ----------

const normalize = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s\-_]+/g, ' ').trim();

function pickerResults() {
  const q = normalize(state.query);
  const all = Object.keys(window.CITIES);
  if (!q) {
    const popular = window.POPULAR_CITIES.filter((id) => window.CITIES[id]);
    return [...popular, ...all.filter((id) => !popular.includes(id))];
  }
  const starts = [];
  const contains = [];
  for (const id of all) {
    const [name, country, , tz] = window.CITIES[id];
    const n = normalize(name);
    if (n.startsWith(q)) starts.push(id);
    else if (n.includes(q) || normalize(country).includes(q) || normalize(tz).includes(q) || id.includes(q)) contains.push(id);
  }
  return [...starts, ...contains];
}

function renderPicker() {
  const ids = pickerResults();
  state.focus = Math.min(state.focus, Math.max(0, ids.length - 1));
  const selected = state.settings.cities;
  const scroll = $('#picker-list').scrollTop;
  $('#picker-list').innerHTML = ids.length
    ? ids
        .map((id, i) => {
          const [name, country, code, tz] = window.CITIES[id];
          const on = selected.includes(id);
          return `
            <button class="item${i === state.focus ? ' focus' : ''}" data-id="${id}" data-tz="${escapeHtml(tz)}">
              ${flag(code)}
              <span class="item-text">
                <span class="item-title">${escapeHtml(name)}</span>
                <span class="item-sub">${escapeHtml(country)}</span>
              </span>
              <span class="item-time"></span>
              <span class="check${on ? ' on' : ''}"></span>
            </button>`;
        })
        .join('')
    : '<div class="empty-note">Ничего не найдено</div>';
  $('#picker-list').scrollTop = scroll;
  tickPicker(new Date());
}

function tickPicker(now) {
  for (const el of $('#picker-list').querySelectorAll('.item-time')) {
    el.textContent = formatClock(zoneTime(el.parentElement.dataset.tz, now), false);
  }
}

function toggleCity(id) {
  const list = state.settings.cities;
  if (list.includes(id)) setCities(list.filter((c) => c !== id));
  else if (list.length < MAX_CITIES) setCities([...list, id]);
}

function openPicker() {
  state.picker = true;
  state.query = '';
  state.focus = 0;
  $('#search').value = '';
  render();
  $('#picker-list').scrollTop = 0;
  $('#search').focus();
}

function closePicker() {
  state.picker = false;
  render();
}

$('#picker-list').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  state.focus = [...$('#picker-list').children].indexOf(item);
  toggleCity(item.dataset.id);
  $('#search').focus();
});

$('#search').addEventListener('input', () => {
  state.query = $('#search').value;
  state.focus = 0;
  renderPicker();
  $('#picker-list').scrollTop = 0;
  reportHeight();
});

$('#search').addEventListener('keydown', (e) => {
  const items = $('#picker-list').querySelectorAll('.item');
  if (e.key === 'Escape') {
    closePicker();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    state.focus = (state.focus + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('focus', i === state.focus));
    items[state.focus].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && items[state.focus]) {
    toggleCity(items[state.focus].dataset.id);
  }
});

$('#picker-close').addEventListener('click', closePicker);

// ---------- Общее ----------

function render() {
  if (!state.settings) return;
  $('#list-view').hidden = state.picker;
  $('#picker-view').hidden = !state.picker;
  $('#w-edit').classList.toggle('on', state.editing);
  $('#w-add').classList.toggle('on', state.picker);
  if (state.picker) renderPicker();
  else renderRows();
  tick();
}

function tick() {
  const now = new Date();
  const local = localTime(now);
  $('#today').textContent = `${formatLocalDate(now)} · у вас ${formatClock(local, false)}`;
  if (state.picker) tickPicker(now);
  else tickRows(now, local);
  reportHeight();
}

// Тикаем ровно на границе секунды, чтобы все часы переключались одновременно
function scheduleTick() {
  setTimeout(() => {
    tick();
    scheduleTick();
  }, 1000 - (Date.now() % 1000) + 5);
}

$('#w-add').addEventListener('click', () => (state.picker ? closePicker() : openPicker()));
$('#empty').addEventListener('click', openPicker);
$('#w-edit').addEventListener('click', () => {
  state.editing = !state.editing;
  state.picker = false;
  render();
});
$('#w-menu').addEventListener('click', () => window.api.widgetMenu());
window.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input')) return;
  e.preventDefault();
  window.api.widgetMenu();
});

new ResizeObserver(reportHeight).observe($('#widget'));

// Ширина: тянем за левый или правый край. Смещение считаем по screenX — он не зависит
// от того, что окно под курсором само двигается и меняет размер.
for (const grip of document.querySelectorAll('.grip')) {
  let startX = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.screenX;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('active');
    document.body.classList.add('resizing');
    window.api.widthStart();
  });
  grip.addEventListener('pointermove', (e) => {
    if (startX !== null) window.api.widthMove(grip.dataset.edge, e.screenX - startX);
  });
  const finish = () => {
    if (startX === null) return;
    startX = null;
    grip.classList.remove('active');
    document.body.classList.remove('resizing');
    window.api.widthEnd();
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('lostpointercapture', finish);
  grip.addEventListener('dblclick', () => window.api.setSettings({ widgetWidth: 320 }));
}

(async () => {
  const s = await window.api.getState();
  state.settings = s.settings;
  render();
  scheduleTick();
  window.api.on('settings', (settings) => {
    const listChanged = settings.cities.join() !== state.settings.cities.join();
    state.settings = settings;
    if (listChanged) render();
    else tick();
  });
})();
