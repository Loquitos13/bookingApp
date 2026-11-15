'use strict';
const express = require('express');
const { db, getSettings } = require('../db');
const { getSlots, availableDays, firstSlot, nextDepartures, createBooking, getBooking, canCustomerCancel, rescheduleBooking, BookingError } = require('../availability');
const { notifyNewBooking, notifyStatusChange, notifyRescheduled, send } = require('../mailer');
const { isDate, nowIn, timeToMin, minToTime, weekday } = require('../time');

const { rateLimit, verifyTurnstile } = require('../security-mw');

const router = express.Router();
const HOUR = 60 * 60 * 1000;
router.use('/api', rateLimit('api', 240, 60 * 1000));

const activeServices = () => db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all();
const activeStaff = () => db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all();
const staffServiceMap = () =>
  db.prepare('SELECT ss.staff_id, ss.service_id FROM staff_services ss JOIN staff s ON s.id = ss.staff_id WHERE s.active = 1').all();

router.get('/', (req, res) => {
  const hours = db.prepare('SELECT * FROM hours ORDER BY weekday').all();
  const now = nowIn(getSettings().timezone);
  res.render('public/home', {
    services: activeServices(),
    staff: activeStaff(),
    hours,
    departures: nextDepartures(4),
    status: openStatus(hours, now),
    today: now.date,
    sent: req.query.enviado === '1',
  });
});

/** "Aberto agora · fecha às 19:30" / "Fechado · abre amanhã às 09:00" */
function openStatus(hours, now) {
  const byDay = Object.fromEntries(hours.map((h) => [h.weekday, h]));
  const wd = weekday(now.date);
  const h = byDay[wd];
  if (h && !h.closed) {
    const inBreak = h.break_start != null && now.min >= h.break_start && now.min < h.break_end;
    if (now.min >= h.open_min && now.min < h.close_min && !inBreak) {
      const closes = h.break_start != null && now.min < h.break_start ? h.break_start : h.close_min;
      return { open: true, text: `Aberto agora · fecha às ${minToTime(closes)}` };
    }
    if (inBreak) return { open: false, text: `Pausa · reabre às ${minToTime(h.break_end)}` };
    if (now.min < h.open_min) return { open: false, text: `Fechado · abre hoje às ${minToTime(h.open_min)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const n = byDay[(wd + i) % 7];
    if (n && !n.closed) return { open: false, text: `Fechado · abre ${i === 1 ? 'amanhã' : ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][(wd + i) % 7]} às ${minToTime(n.open_min)}` };
  }
  return { open: false, text: 'Fechado' };
}

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

router.get('/marcar', (req, res) =>
  renderBooking(res, {
    form: {
      serviceId: req.query.servico || '',
      staffId: req.query.profissional || '',
      date: isDate(req.query.dia) ? req.query.dia : '',
      time: timeToMin(req.query.hora) != null ? req.query.hora : '',
    },
  })
);

// primeira vaga de cada profissional para um serviço (passo "Profissional")
router.get('/api/first', (req, res) => {
  const serviceId = +req.query.service;
  if (!serviceId) return res.status(400).json({ error: 'service obrigatório' });
  const staffIds = db.prepare('SELECT staff_id FROM staff_services ss JOIN staff s ON s.id = ss.staff_id WHERE ss.service_id = ? AND s.active = 1').all(serviceId).map((r) => r.staff_id);
  const out = { any: firstSlot({ serviceId }) };
  for (const id of staffIds) out[id] = firstSlot({ serviceId, staffId: id });
  for (const k of Object.keys(out)) if (out[k]) delete out[k].staff;
  res.json({ today: nowIn(getSettings().timezone).date, first: out });
});

// ---- API usada pelo formulário de marcação ----
// ?token= (link pessoal) faz a própria marcação não contar como ocupada, para o reagendamento
const ignoreFor = (token) => (token ? (db.prepare('SELECT id FROM bookings WHERE token = ?').get(String(token)) || {}).id || null : null);
router.get('/api/days', (req, res) => {
  const serviceId = +req.query.service;
  const staffId = req.query.staff ? +req.query.staff : null;
  if (!serviceId) return res.status(400).json({ error: 'service obrigatório' });
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  res.json({ today, maxDays: +st.max_days_ahead, days: availableDays({ serviceId, staffId, from: today, days: +st.max_days_ahead + 1, ignoreBookingId: ignoreFor(req.query.token) }) });
});

router.get('/api/slots', (req, res) => {
  const serviceId = +req.query.service;
  const staffId = req.query.staff ? +req.query.staff : null;
  if (!serviceId || !isDate(req.query.date)) return res.status(400).json({ error: 'parâmetros inválidos' });
  res.json({ slots: getSlots({ serviceId, staffId, date: req.query.date, ignoreBookingId: ignoreFor(req.query.token) }).map(({ start, time }) => ({ start, time })) });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

router.post('/marcar', rateLimit('book', 12, HOUR), async (req, res) => {
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
  if (!errors.length && !(await verifyTurnstile(req))) errors.push('Não foi possível confirmar que não é um robô. Tente novamente.');
  if (!errors.length) {
    // limite de marcações futuras por pessoa (evita encher a agenda)
    const max = +getSettings().max_online_per_email || 4;
    const n = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE lower(customer_email) = ? AND source = 'online' AND status IN ('pending','confirmed') AND date >= ?`)
      .get(form.email, nowIn(getSettings().timezone).date).c;
    if (n >= max) errors.push(`Já tem ${n} marcações futuras. Para marcar mais, contacte-nos por telefone.`);
  }
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
  res.render('public/booking', { b, isNew: req.query.nova === '1', canCancel: canCustomerCancel(b), cancelled: req.query.cancelada === '1', moved: req.query.reagendada === '1' });
});

router.get('/marcacao/:token.ics', (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(req.params.token);
  if (!row) return next();
  const b = getBooking(row.id);
  const st = getSettings();
  const stamp = (date, min) => `${date.replace(/-/g, '')}T${minToTime(min).replace(':', '')}00`;
  const esc = (v) => String(v).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bookingapp//PT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${b.ref}@bookingapp`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=${st.timezone}:${stamp(b.date, b.start_min)}`, `DTEND;TZID=${st.timezone}:${stamp(b.date, b.end_min)}`,
    `SUMMARY:${esc(`${b.service_name} · ${st.business_name}`)}`, `LOCATION:${esc(st.address)}`,
    `DESCRIPTION:${esc(`Com ${b.staff_name}. Referência ${b.ref}.`)}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="marcacao-${b.ref}.ics"`);
  res.send(ics);
});

function bookingByToken(token) {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(String(token));
  return row ? getBooking(row.id) : null;
}

router.get('/marcacao/:token/reagendar', (req, res, next) => {
  const b = bookingByToken(req.params.token);
  if (!b) return next();
  if (!canCustomerCancel(b)) return res.redirect(`/marcacao/${b.token}`);
  res.render('public/reschedule', { b, error: req.query.erro || null });
});

router.post('/marcacao/:token/reagendar', rateLimit('manage', 20, HOUR), (req, res, next) => {
  const b = bookingByToken(req.params.token);
  if (!b) return next();
  if (!canCustomerCancel(b)) return res.redirect(`/marcacao/${b.token}`);
  const date = clean(req.body.date, 10);
  const start = timeToMin(req.body.time);
  const back = (msg) => res.redirect(`/marcacao/${b.token}/reagendar?erro=` + encodeURIComponent(msg));
  if (!isDate(date) || start == null) return back('Escolha o dia e a hora.');
  try {
    const before = { date: b.date, start: b.start_min };
    const nb = rescheduleBooking(b.id, { date, start, staffId: req.body.anyStaff === '1' ? null : b.staff_id });
    db.prepare("UPDATE bookings SET internal_notes = trim(internal_notes || ' [Reagendada pelo cliente online]') WHERE id = ?").run(b.id);
    notifyRescheduled(nb, before);
    res.redirect(`/marcacao/${b.token}?reagendada=1`);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
    back(e.message);
  }
});

router.post('/marcacao/:token/cancelar', rateLimit('manage', 20, HOUR), (req, res, next) => {
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

router.post('/contacto', rateLimit('contact', 5, HOUR), async (req, res) => {
  if (req.body.website) return res.redirect('/');
  if (!(await verifyTurnstile(req))) return res.redirect('/?enviado=0#contacto');
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 160);
  const message = clean(req.body.message, 3000);
  if (name && EMAIL_RE.test(email) && message) {
    db.prepare('INSERT INTO messages(name, email, phone, message) VALUES (?, ?, ?, ?)').run(name, email, clean(req.body.phone, 30), message);
  }
  res.redirect('/?enviado=1#contacto');
});

module.exports = router;
