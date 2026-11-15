'use strict';
/* Traduções do site público. PT é a língua base; EN é opcional (Definições → idiomas).
   Os conteúdos do negócio (nomes de serviços, descrições) vêm da base de dados e não são traduzidos. */
const { parseCookies } = require('./security');
const { getSettings } = require('./db');

const EN = {};
const PT = {};
function def(key, pt, en) { PT[key] = pt; EN[key] = en; }

module.exports.def = def;
module.exports.dict = { pt: PT, en: EN };

function middleware(req, res, next) {
  const st = getSettings();
  let lang = 'pt';
  if (st.lang_en === '1') {
    const q = String(req.query.lang || '');
    if (q === 'en' || q === 'pt') {
      lang = q;
      res.cookie('lang', q, { maxAge: 365 * 864e5, sameSite: 'lax', httpOnly: true, path: '/' });
    } else {
      lang = parseCookies(req.headers.cookie).lang === 'en' ? 'en' : 'pt';
    }
  }
  req.lang = lang;
  res.locals.lang = lang;
  const src = lang === 'en' ? EN : PT;
  res.locals.jsDict = Object.fromEntries(Object.keys(PT).filter((k) => k.startsWith('js.')).map((k) => [k.slice(3), src[k] ?? PT[k]]));
  if (!req.path.startsWith('/admin')) {
    // datas, preços e dias da semana no idioma da página
    const time = require('./time');
    res.locals.t = {
      ...time,
      formatDateLong: (d) => time.formatDateLong(d, lang),
      formatDateShort: (d) => time.formatDateShort(d, lang),
      euros: (c) => time.euros(c, lang),
      WEEKDAYS: lang === 'en' ? time.WEEKDAYS_EN : time.WEEKDAYS,
    };
  }
  res.locals.L = (key, vars) => {
    let s = (lang === 'en' ? EN[key] : PT[key]) ?? PT[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  };
  next();
}
module.exports.middleware = middleware;

require('./i18n-strings');
