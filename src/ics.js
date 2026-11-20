'use strict';
/* Gerador .ics único (bilhete do cliente e calendário pessoal de cada profissional). */

// hora local do negócio -> UTC ("...Z"): todos os calendários a percebem, sem precisar de um bloco VTIMEZONE
function utcStamp(date, min, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, min);
  const asLocal = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }) + ' UTC').getTime();
  return new Date(guess - (asLocal - guess)).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}
// RFC 5545: escapar \ ; , e qualquer quebra de linha (\r\n, \r ou \n), para o texto não criar propriedades novas
const esc = (v) => String(v ?? '').replace(/([,;\\])/g, '\\$1').replace(/\r\n|\r|\n|\u2028|\u2029|\u0085/g, '\\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

function calendar({ name, timezone, events, publish = false }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bookingapp//PT', 'CALSCALE:GREGORIAN'];
  if (publish) lines.push('METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${esc(timezone)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M');
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}@bookingapp`, `DTSTAMP:${now}`,
      `DTSTART:${utcStamp(e.date, e.start, timezone)}`, `DTEND:${utcStamp(e.date, e.end, timezone)}`,
      `SUMMARY:${esc(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { calendar, esc, utcStamp };
