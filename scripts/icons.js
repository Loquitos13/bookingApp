// Gera os ícones da app do back office (public/pwa/*.png) com a inicial do negócio.
// Uso: npm run icons   (requer o Playwright/Chromium instalado: npx playwright install chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
process.env.DEMO = process.env.DEMO || '0';
const { getSettings } = require('../src/db');
const ST = getSettings();
const letter = (ST.business_name.trim()[0] || 'B').toUpperCase();
const esc = (v) => String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const signal = /^#[0-9a-f]{6}$/i.test(ST.brand_signal || '') ? ST.brand_signal : '#f5c518';
const OUT = path.join(__dirname, '..', 'public', 'pwa') + '/';
const font = fs.readFileSync(path.join(__dirname, '..', 'public', 'fonts', 'big-shoulders-display-latin-800-normal.woff2')).toString('base64');
// ícone: placa esmaltada (painel + keyline) com célula split-flap e a letra do negócio em amarelo-sinal
const html = (size, pad) => `<!doctype html><html><head><style>
@font-face{font-family:BS;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:800}
html,body{margin:0;width:${size}px;height:${size}px;background:#12171d}
.p{position:absolute;inset:${pad}px;border-radius:${size*0.16}px;background:#12171d;display:grid;place-items:center}
.k{position:absolute;inset:${size*0.07}px;border:${Math.max(2,size*0.022)}px solid rgba(242,243,238,.85);border-radius:${size*0.1}px}
.c{position:relative;width:${size*0.46}px;height:${size*0.58}px;border-radius:${size*0.05}px;background:linear-gradient(#252e38 0 50%,#1c232b 50% 100%);display:grid;place-items:center;font:800 ${size*0.5}px/1 BS;color:${signal}}
.c:after{content:'';position:absolute;left:0;right:0;top:50%;height:${Math.max(1,size*0.012)}px;background:rgba(0,0,0,.6)}
</style></head><body><div class="p"><div class="k"></div><div class="c">${letter}</div></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(html(size, pad)); await p.waitForTimeout(150);
    await p.screenshot({ path: OUT + name });
  }
  // imagem de partilha (Open Graph) 1200×630: placa esmaltada + promessa + painel
  const og = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<!doctype html><html><head><style>
  @font-face{font-family:BS;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:800}
  body{margin:0;width:1200px;height:630px;background:#f0efe9;font-family:BS,sans-serif;display:grid;grid-template-columns:1.15fr .85fr;gap:48px;padding:64px;box-sizing:border-box}
  .plate{position:relative;background:#12171d;color:#f2f3ee;border-radius:22px;padding:48px 44px;align-self:start}
  .plate:before{content:'';position:absolute;inset:14px;border:4px solid rgba(242,243,238,.85);border-radius:12px}
  h1{margin:0;font-size:120px;line-height:.86;text-transform:uppercase;font-weight:800;overflow-wrap:anywhere}
  .sub{margin-top:18px;font-size:34px;color:${signal};text-transform:uppercase;letter-spacing:.06em}
  .prom{margin-top:34px;font-size:46px;line-height:1.02;color:#12171d;text-transform:uppercase}
  .board{background:#12171d;border-radius:22px;padding:30px;display:grid;gap:18px;align-content:start;align-self:start}
  .row{display:flex;gap:8px}.c{width:52px;height:72px;border-radius:7px;background:linear-gradient(#252e38 0 50%,#1c232b 50% 100%);color:#f2f3ee;font-size:56px;display:grid;place-items:center}
  .sep{color:#a9b3bc;font-size:50px;align-self:center}
  .cta{margin-top:8px;background:${signal};color:#12171d;border-radius:12px;padding:20px;font-size:40px;text-align:center;text-transform:uppercase}
  </style></head><body><div><div class="plate"><h1>${esc(ST.business_name)}</h1><div class="sub">${esc(ST.business_subtitle)}</div></div><div class="prom">${esc(ST.tagline)}</div></div>
  <div class="board">${['09:00', '10:30', '16:15'].map((t) => `<div class="row">${t.split('').map((ch) => ch === ':' ? '<span class="sep">:</span>' : `<span class="c">${ch}</span>`).join('')}</div>`).join('')}<div class="cta">Marcar online</div></div></body></html>`);
  await og.waitForTimeout(200);
  await og.screenshot({ path: path.join(__dirname, '..', 'public', 'og.png') });
  await b.close();
  // origem embutida nos PNG (proveniência), quando a skill Impeccable está disponível
  try { const { execFileSync } = require('child_process'); const bin = process.env.IMPECCABLE_BIN; if (bin) for (const f of fs.readdirSync(OUT)) execFileSync(bin, ['embed-prompt', OUT + f, '--prompt', 'Origin: rendered by scripts/icons.js from authored HTML/CSS (enamel plate + split-flap cell with business initial).']); } catch (e) { /* opcional */ }
  console.log('Ícones gerados em', OUT, 'com a letra', letter);
})();
