'use strict';
const path = require('node:path');
const express = require('express');
const { db, getSettings, setSetting } = require('./src/db');
const { seedDemo } = require('./src/demo');

// Dados de demonstração (fictícios) na primeira execução do template
if (getSettings().demo_mode === '1' && !getSettings().demo_seeded && !db.prepare('SELECT COUNT(*) c FROM bookings').get().c) {
  seedDemo();
  setSetting('demo_seeded', '1');
}
const { loadSession } = require('./src/auth');
const { securityHeaders } = require('./src/security-mw');
const time = require('./src/time');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
const UPLOADS = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'app.db')), 'uploads');
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));

app.use((req, res, next) => {
  res.locals.site = getSettings();
  res.locals.brandCss = require('./src/brand').brandVars(res.locals.site.brand_signal);
  res.locals.baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.locals.canonical = res.locals.baseUrl + req.path;
  res.locals.t = time;
  res.locals.path = req.path;
  next();
});
app.use(securityHeaders);
app.use(require('./src/i18n').middleware);
app.use(loadSession);

// App instalável do back office (PWA)
app.get('/admin/manifest.webmanifest', (req, res) => {
  const st = getSettings();
  res.type('application/manifest+json').send(JSON.stringify({
    name: `${st.business_name} · Back office`,
    short_name: st.business_name.slice(0, 12),
    description: 'Agenda e marcações',
    lang: 'pt-PT',
    start_url: '/admin',
    scope: '/admin',
    display: 'standalone',
    background_color: '#12171d',
    theme_color: '#12171d',
    icons: [
      { src: '/static/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/static/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Nova marcação', url: '/admin/marcacoes/nova' },
      { name: 'Agenda', url: '/admin/agenda' },
    ],
  }));
});
// o service worker tem de ser servido a partir de /admin para controlar o back office
app.get('/admin/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/admin');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'js', 'sw.js'));
});
app.get('/admin/offline', (req, res) => res.render('admin/offline'));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('public/message', { code: '404', title: 'Esta página não existe', text: 'Pode ter sido removida ou o endereço está incompleto.' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('public/message', { code: '500', title: 'Algo correu mal', text: 'Não foi culpa sua. Tente novamente dentro de instantes ou ligue-nos.' });
});

const PORT = +process.env.PORT || 3000;
if (require.main === module) {
  require('./src/scheduler').start();
  app.listen(PORT, () => console.log(`Site:        http://localhost:${PORT}\nBack office: http://localhost:${PORT}/admin`));
}
module.exports = app;
