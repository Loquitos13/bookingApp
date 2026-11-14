'use strict';
const express = require('express');
const { db, getSettings } = require('../db');
const { getSlots, availableDays, createBooking, getBooking, canCustomerCancel, BookingError } = require('../availability');
const { notifyNewBooking, notifyStatusChange, send } = require('../mailer');
const { isDate, nowIn, timeToMin } = require('../time');

const router = express.Router();

const activeServices = () => db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all();
const activeStaff = () => db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all();
const staffServiceMap = () =>
  db.prepare('SELECT ss.staff_id, ss.service_id FROM staff_services ss JOIN staff s ON s.id = ss.staff_id WHERE s.active = 1').all();

router.get('/', (req, res) => {
  const hours = db.prepare('SELECT * FROM hours ORDER BY weekday').all();
  res.render('public/home', {
    services: activeServices(),
    staff: activeStaff(),
    hours,
    sent: req.query.enviado === '1',
  });
});

function renderBooking(res, extra = {}) {
  res.render('public/book', {
    services: activeServices(),
    staff: activeStaff(),
    links: staffServiceMap(),
    error: null,
    form: {},
    ...extra,
  });
}

router.get('/marcar', (req, res) => renderBooking(res, { form: { serviceId: req.query.servico || '' } }));

// ---- API usada pelo formulário de marcação ----
router.get('/api/days', (req, res) => {
  const serviceId = +req.query.service;
  const staffId = req.query.staff ? +req.query.staff : null;
  if (!serviceId) return res.status(400).json({ error: 'service obrigatório' });
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  res.json({ today, maxDays: +st.max_days_ahead, days: availableDays({ serviceId, staffId, from: today, days: +st.max_days_ahead + 1 }) });
});

router.get('/api/slots', (req, res) => {
  const serviceId = +req.query.service;
  const staffId = req.query.staff ? +req.query.staff : null;
  if (!serviceId || !isDate(req.query.date)) return res.status(400).json({ error: 'parâmetros inválidos' });
  res.json({ slots: getSlots({ serviceId, staffId, date: req.query.date }).map(({ start, time }) => ({ start, time })) });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

router.post('/marcar', (req, res) => {
  const form = {
    serviceId: +req.body.serviceId || '',
    staffId: +req.body.staffId || '',
    date: clean(req.body.date, 10),
    time: clean(req.body.time, 5),
    name: clean(req.body.name, 120),
    email: clean(req.body.email, 160).toLowerCase(),
    phone: clean(req.body.phone, 30),
    notes: clean(req.body.notes, 1000),
  };
  if (req.body.website) return res.redirect('/'); // honeypot anti-spam

  const errors = [];
  if (!form.serviceId) errors.push('Escolha um serviço.');
  if (!isDate(form.date) || timeToMin(form.time) == null) errors.push('Escolha o dia e a hora.');
  if (form.name.length < 2) errors.push('Indique o seu nome.');
  if (!EMAIL_RE.test(form.email)) errors.push('Indique um email válido.');
  if (form.phone.replace(/\D/g, '').length < 9) errors.push('Indique um telefone válido.');
  if (!req.body.consent) errors.push('É necessário aceitar o tratamento dos dados para a marcação.');
  if (errors.length) {
    res.status(422);
    return renderBooking(res, { error: errors.join(' '), form });
  }

  try {
    const b = createBooking({ ...form, start: timeToMin(form.time), staffId: form.staffId || null });
    notifyNewBooking(b);
    res.redirect(`/marcacao/${b.token}?nova=1`);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
    res.status(409);
    renderBooking(res, { error: e.message, form: { ...form, time: '' } });
  }
});

router.get('/marcacao/:token', (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(req.params.token);
  if (!row) return next();
  const b = getBooking(row.id);
  res.render('public/booking', { b, isNew: req.query.nova === '1', canCancel: canCustomerCancel(b), cancelled: req.query.cancelada === '1' });
});

router.post('/marcacao/:token/cancelar', (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(req.params.token);
  if (!row) return next();
  const b = getBooking(row.id);
  if (canCustomerCancel(b)) {
    db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now'), internal_notes = trim(internal_notes || ' [Cancelada pelo cliente online]') WHERE id = ?").run(b.id);
    const updated = getBooking(b.id);
    notifyStatusChange(updated);
    send({ to: process.env.NOTIFY_EMAIL || getSettings().email, subject: `Marcação ${b.ref} cancelada pelo cliente`, text: `${b.customer_name} cancelou ${b.service_name} em ${b.date}.` });
  }
  res.redirect(`/marcacao/${b.token}?cancelada=1`);
});

router.post('/contacto', (req, res) => {
  if (req.body.website) return res.redirect('/');
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 160);
  const message = clean(req.body.message, 3000);
  if (name && EMAIL_RE.test(email) && message) {
    db.prepare('INSERT INTO messages(name, email, phone, message) VALUES (?, ?, ?, ?)').run(name, email, clean(req.body.phone, 30), message);
  }
  res.redirect('/?enviado=1#contacto');
});

module.exports = router;
