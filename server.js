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
// Só confiar em X-Forwarded-For quando há um proxy à frente (ex.: TRUST_PROXY=1 atrás de Nginx/Caddy/Cloudflare).
// Sem proxy, confiar nele deixaria qualquer cliente escolher o próprio IP e contornar os limites de pedidos.
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', !tp || tp === '0' || tp === 'false' ? false : /^\d+$/.test(tp) ? +tp : tp);
app.disable('x-powered-by');

// webhook da Stripe: precisa do corpo em bruto para verificar a assinatura (antes dos outros parsers)
app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const payments = require('./src/payments');
  const raw = req.body.toString('utf8');
  if (!payments.verifySignature(raw, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) return res.status(400).send('assinatura inválida');
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).send('json inválido'); }
  const paid = payments.applyEvent(event);
  if (paid) {
    const { getBooking } = require('./src/availability');
    const mailer = require('./src/mailer');
    const b = getBooking(paid.id);
    if (!paid.late) mailer.notifyNewBooking(b);
    else {
      const st = getSettings();
      mailer.send({
        to: process.env.NOTIFY_EMAIL || st.email,
        subject: `Atenção: pagamento recebido para a marcação cancelada ${b.ref}`,
        text: `${b.customer_name} pagou ${(b.deposit_cents / 100).toFixed(2)} € depois de a marcação ${b.ref} (${b.date}) ter sido cancelada por falta de pagamento.\nReative a marcação se o horário ainda estiver livre, ou faça o reembolso na Stripe.\n\n${(process.env.BASE_URL || '')}/admin/marcacoes/${b.id}`,
      });
    }
  }
  res.json({ received: true });
});
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

app.use((req, res) => res.status(404).render('public/message', { code: '404', title: res.locals.L ? res.locals.L('e.notfound.title') : 'Esta página não existe', text: res.locals.L ? res.locals.L('e.notfound.text') : '' }));
app.use((err, req, res, _next) => {
  console.error(err);
  // o erro pode ter acontecido antes de o idioma e o resto do contexto estarem prontos
  const L = { 'msg.book': 'Marcar', 'msg.home': 'Página inicial', 'nav.book': 'Marcar' };
  res.locals.L ||= (k) => L[k] || '';
  res.locals.lang ||= 'pt';
  res.locals.jsDict ||= {};
  res.locals.nonce ||= '';
  res.locals.canonical ||= '/';
  res.locals.baseUrl ||= '';
  res.status(500).render('public/message', { code: '500', title: 'Algo correu mal', text: 'Não foi culpa sua. Tente novamente dentro de instantes ou ligue-nos.' });
});

const PORT = +process.env.PORT || 3000;
if (require.main === module) {
  require('./src/scheduler').start();
  app.listen(PORT, () => console.log(`Site:        http://localhost:${PORT}\nBack office: http://localhost:${PORT}/admin`));
}
// nenhuma promessa rejeitada esquecida deve derrubar o servidor (e com ele os limites de pedidos em memória)
process.on('unhandledRejection', (e) => console.error('[erro não tratado]', e));

module.exports = app;
