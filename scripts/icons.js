// Gera os ícones da app do back office (public/pwa/*.png) com a inicial do negócio.
// Uso: npm run icons   (requer o Playwright/Chromium instalado: npx playwright install chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
process.env.DEMO = process.env.DEMO || '0';
const { getSettings } = require('../src/db');
const letter = (getSettings().business_name.trim()[0] || 'B').toUpperCase();
const OUT = path.join(__dirname, '..', 'public', 'pwa') + '/';
const font = fs.readFileSync(path.join(__dirname, '..', 'public', 'fonts', 'big-shoulders-display-latin-800-normal.woff2')).toString('base64');
// ícone: placa esmaltada (painel + keyline) com célula split-flap e a letra do negócio em amarelo-sinal
const html = (size, pad) => `<!doctype html><html><head><style>
@font-face{font-family:BS;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:800}
html,body{margin:0;width:${size}px;height:${size}px;background:#12171d}
.p{position:absolute;inset:${pad}px;border-radius:${size*0.16}px;background:#12171d;display:grid;place-items:center}
.k{position:absolute;inset:${size*0.07}px;border:${Math.max(2,size*0.022)}px solid rgba(242,243,238,.85);border-radius:${size*0.1}px}
.c{position:relative;width:${size*0.46}px;height:${size*0.58}px;border-radius:${size*0.05}px;background:linear-gradient(#252e38 0 50%,#1c232b 50% 100%);display:grid;place-items:center;font:800 ${size*0.5}px/1 BS;color:#f5c518}
.c:after{content:'';position:absolute;left:0;right:0;top:50%;height:${Math.max(1,size*0.012)}px;background:rgba(0,0,0,.6)}
</style></head><body><div class="p"><div class="k"></div><div class="c">${letter}</div></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(html(size, pad)); await p.waitForTimeout(150);
    await p.screenshot({ path: OUT + name });
  }
  await b.close();
  console.log('Ícones gerados em', OUT, 'com a letra', letter);
})();
