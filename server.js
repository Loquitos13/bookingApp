'use strict';
const path = require('node:path');
const express = require('express');
const { getSettings } = require('./src/db');
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

app.use((req, res) => res.status(404).render('public/message', { title: 'Página não encontrada', text: 'A página que procura não existe.' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('public/message', { title: 'Ocorreu um erro', text: 'Tente novamente dentro de instantes.' });
});

const PORT = +process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Site:        http://localhost:${PORT}\nBack office: http://localhost:${PORT}/admin`));
}
module.exports = app;
