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
const time = require('./src/time');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.locals.site = getSettings();
  res.locals.t = time;
  res.locals.path = req.path;
  next();
});
app.use(loadSession);

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('public/message', { code: '404', title: 'Esta página não existe', text: 'Pode ter sido removida ou o endereço está incompleto.' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('public/message', { code: '500', title: 'Algo correu mal', text: 'Não foi culpa sua. Tente novamente dentro de instantes ou ligue-nos.' });
});

const PORT = +process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Site:        http://localhost:${PORT}\nBack office: http://localhost:${PORT}/admin`));
}
module.exports = app;
