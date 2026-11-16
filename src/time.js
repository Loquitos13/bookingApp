'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** minutos desde a meia-noite -> "HH:MM" */
const minToTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** "HH:MM" -> minutos (ou null se inválido) */
function timeToMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));

/** dia da semana (0=domingo) de "YYYY-MM-DD" */
function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function diffDays(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** Data e hora atuais no fuso horário do negócio. */
function nowIn(timeZone = 'Europe/Lisbon') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: +parts.hour * 60 + +parts.minute };
}

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDateLong(date, lang = 'pt') {
  const [y, m, d] = date.split('-').map(Number);
  if (lang === 'en') return `${WEEKDAYS_EN[weekday(date)]}, ${d} ${MONTHS_EN[m - 1]} ${y}`;
  return `${WEEKDAYS[weekday(date)]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}
function formatDateShort(date, lang = 'pt') {
  const [, m, d] = date.split('-').map(Number);
  if (lang === 'en') return `${WEEKDAYS_EN[weekday(date)].slice(0, 3)}, ${d} ${MONTHS_EN[m - 1].slice(0, 3)}`;
  return `${WEEKDAYS_SHORT[weekday(date)]}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

const euros = (cents, lang = 'pt') =>
  new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'pt-PT', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);

module.exports = {
  pad, minToTime, timeToMin, isDate, weekday, addDays, diffDays, nowIn,
  formatDateLong, formatDateShort, euros, WEEKDAYS, WEEKDAYS_SHORT, MONTHS, WEEKDAYS_EN, MONTHS_EN,
};
