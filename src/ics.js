'use strict';
/* Gerador .ics único (bilhete do cliente e calendário pessoal de cada profissional). */
const { minToTime } = require('./time');

const stamp = (date, min) => `${date.replace(/-/g, '')}T${minToTime(min).replace(':', '')}00`;
// RFC 5545: escapar \ ; , e qualquer quebra de linha (\r\n, \r ou \n), para o texto não criar propriedades novas
const esc = (v) => String(v ?? '').replace(/([,;\\])/g, '\\$1').replace(/\r\n|\r|\n/g, '\\n');

function calendar({ name, timezone, events, publish = false }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bookingapp//PT', 'CALSCALE:GREGORIAN'];
  if (publish) lines.push('METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${esc(timezone)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M');
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}@bookingapp`, `DTSTAMP:${now}`,
      `DTSTART;TZID=${timezone}:${stamp(e.date, e.start)}`, `DTEND;TZID=${timezone}:${stamp(e.date, e.end)}`,
      `SUMMARY:${esc(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { calendar, esc };
