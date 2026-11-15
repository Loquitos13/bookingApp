/* Service worker do back office: abre como app, funciona com rede fraca e mostra a última agenda vista sem rede. */
const V = 'bo-v1';
const STATIC = `${V}-static`;
const PAGES = `${V}-pages`;
const PRECACHE = [
  '/admin/offline',
  '/static/css/tokens.css', '/static/css/admin.css', '/static/js/agenda.js',
  '/static/fonts/barlow-latin-400-normal.woff2', '/static/fonts/barlow-latin-600-normal.woff2',
  '/static/fonts/barlow-condensed-latin-600-normal.woff2', '/static/fonts/barlow-condensed-latin-700-normal.woff2',
  '/static/fonts/big-shoulders-display-latin-800-normal.woff2', '/static/pwa/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(V)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ao sair da conta, apaga as páginas guardadas (têm dados de clientes)
self.addEventListener('message', (e) => { if (e.data === 'logout') e.waitUntil(caches.delete(PAGES)); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/static/')) {
    // stale-while-revalidate
    e.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (req.mode === 'navigate' && url.pathname.startsWith('/admin') && !url.pathname.startsWith('/admin/login')) {
    // network-first; sem rede, a última versão vista dessa página (ou a página offline)
    e.respondWith(fetch(req).then((r) => {
      if (r.ok && !r.redirected) caches.open(PAGES).then((c) => c.put(req, r.clone()));
      return r;
    }).catch(async () => (await caches.match(req, { cacheName: PAGES })) || caches.match('/admin/offline')));
  }
});
