(function () {
  const formatters = {};

  function formatterFor(tz) {
    if (!formatters[tz]) {
      formatters[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    }
    return formatters[tz];
  }

  const pad = (n) => String(n).padStart(2, '0');

  // Время в поясе: часы, минуты, секунды, календарная дата и смещение от UTC в минутах
  function zoneTime(tz, date = new Date()) {
    const p = {};
    for (const part of formatterFor(tz).formatToParts(date)) p[part.type] = Number(part.value);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60e3);
    return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second, offset };
  }

  function localTime(date = new Date()) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      offset: -date.getTimezoneOffset(),
    };
  }

  function formatClock(t, withSeconds) {
    return `${pad(t.hour)}:${pad(t.minute)}${withSeconds ? ':' + pad(t.second) : ''}`;
  }

  // Разница с местным временем: «+4 ч», «−2:30 ч», «±0 ч»
  function formatDiff(minutes) {
    if (minutes === 0) return '±0 ч';
    const sign = minutes > 0 ? '+' : '−';
    const a = Math.abs(minutes);
    const h = Math.floor(a / 60);
    const m = a % 60;
    return `${sign}${h}${m ? ':' + pad(m) : ''} ч`;
  }

  // Какой это день относительно местной даты
  function dayLabel(t, local) {
    const diff = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(local.year, local.month - 1, local.day)) / 864e5);
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчера';
    return diff > 0 ? `+${diff} дн` : `−${-diff} дн`;
  }

  function isDaytime(t) {
    return t.hour >= 6 && t.hour < 21;
  }

  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function formatLocalDate(date = new Date()) {
    const w = WEEKDAYS[date.getDay()];
    return `${w[0].toUpperCase()}${w.slice(1)}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  window.MCL = { zoneTime, localTime, formatClock, formatDiff, dayLabel, isDaytime, formatLocalDate, escapeHtml };
})();
