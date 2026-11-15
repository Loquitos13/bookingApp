'use strict';
/* Feriados nacionais obrigatórios em Portugal (fixos + móveis calculados a partir da Páscoa). */
const pad = (n) => String(n).padStart(2, '0');

function easter(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const plus = (d, n) => new Date(d.getTime() + n * 864e5);

const cache = new Map();
function ptHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const e = easter(year);
  const list = {
    [`${year}-01-01`]: 'Ano Novo',
    [iso(plus(e, -2))]: 'Sexta-feira Santa',
    [iso(e)]: 'Páscoa',
    [`${year}-04-25`]: 'Dia da Liberdade',
    [`${year}-05-01`]: 'Dia do Trabalhador',
    [iso(plus(e, 60))]: 'Corpo de Deus',
    [`${year}-06-10`]: 'Dia de Portugal',
    [`${year}-08-15`]: 'Assunção de Nossa Senhora',
    [`${year}-10-05`]: 'Implantação da República',
    [`${year}-11-01`]: 'Dia de Todos os Santos',
    [`${year}-12-01`]: 'Restauração da Independência',
    [`${year}-12-08`]: 'Imaculada Conceição',
    [`${year}-12-25`]: 'Natal',
  };
  cache.set(year, list);
  return list;
}
const holidayName = (date) => ptHolidays(+date.slice(0, 4))[date] || null;

module.exports = { ptHolidays, holidayName, easter };
