'use strict';
/* Cor da marca: a partir de uma única cor calcula a variante "pressionada" e a cor do texto por cima (contraste). */
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function luminance(h) {
  const [r, g, b] = rgb(h).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function brandVars(signal) {
  const s = hex(signal);
  if (!s || s === '#f5c518') return '';
  const ink = '#12171d';
  const onSignal = contrast(s, ink) >= contrast(s, '#ffffff') ? ink : '#ffffff';
  const press = toHex(rgb(s).map((c) => c * 0.88));
  return `:root{--signal:${s};--signal-press:${press};--on-signal:${onSignal}}`;
}
module.exports = { brandVars, contrast, hex };
