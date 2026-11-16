'use strict';
const express = require('express');
const { db, getSettings } = require('../db');
const { getSlots, availableDays, firstSlot, nextDepartures, createBooking, getBooking, canCustomerCancel, rescheduleBooking, BookingError } = require('../availability');
const { notifyNewBooking, notifyStatusChange, notifyRescheduled, send } = require('../mailer');
const { isDate, nowIn, timeToMin, minToTime, weekday, formatDateLong } = require('../time');

const { rateLimit, verifyTurnstile } = require('../security-mw');

const payments = require('../payments');
const router = express.Router();
const HOUR = 60 * 60 * 1000;
router.use('/api', rateLimit('api', 90, 60 * 1000));

const activeServices = () => {
  const list = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all();
  const packs = db.prepare('SELECT * FROM packages WHERE active = 1 ORDER BY sessions').all();
  for (const sv of list) sv.packages = packs.filter((p) => p.service_id === sv.id);
  return list;
};
const activeStaff = () => db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all();
const staffServiceMap = () =>
  db.prepare('SELECT ss.staff_id, ss.service_id FROM staff_services ss JOIN staff s ON s.id = ss.staff_id WHERE s.active = 1').all();

router.get('/', (req, res) => {
  const hours = db.prepare('SELECT * FROM hours ORDER BY weekday').all();
  const now = nowIn(getSettings().timezone);
  const services = activeServices();
  const st = getSettings();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const spec = [];
  for (const h of hours) {
    if (h.closed) continue;
    const parts = h.break_start != null ? [[h.open_min, h.break_start], [h.break_end, h.close_min]] : [[h.open_min, h.close_min]];
    for (const [a, b] of parts) spec.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayNames[h.weekday], opens: minToTime(a), closes: minToTime(b) });
  }
  const base = res.locals.baseUrl;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: st.business_name,
    description: st.tagline,
    url: base + '/',
    telephone: st.phone,
    email: st.email,
    address: { '@type': 'PostalAddress', streetAddress: st.address, addressCountry: 'PT' },
    image: base + '/static/og.png',
    openingHoursSpecification: spec,
    potentialAction: { '@type': 'ReserveAction', target: base + '/marcar' },
    makesOffer: services.map((sv) => ({ '@type': 'Offer', price: (sv.price_cents / 100).toFixed(2), priceCurrency: 'EUR', itemOffered: { '@type': 'Service', name: sv.name, description: sv.description } })),
  };
  res.render('public/home', {
    jsonLd,
    services,
    staff: activeStaff(),
    hours,
    departures: nextDepartures(4),
    status: openStatus(hours, now, res.locals.L),
    today: now.date,
    sent: req.query.enviado === '1',
  });
});

/** "Aberto agora · fecha às 19:30" / "Fechado · abre amanhã às 09:00" */
function openStatus(hours, now, L) {
  const byDay = Object.fromEntries(hours.map((h) => [h.weekday, h]));
  const wd = weekday(now.date);
  const h = byDay[wd];
  if (h && !h.closed) {
    const inBreak = h.break_start != null && now.min >= h.break_start && now.min < h.break_end;
    if (now.min >= h.open_min && now.min < h.close_min && !inBreak) {
      const closes = h.break_start != null && now.min < h.break_start ? h.break_start : h.close_min;
      return { open: true, text: L('os.open', { t: minToTime(closes) }) };
    }
    if (inBreak) return { open: false, text: L('os.break', { t: minToTime(h.break_end) }) };
    if (now.min < h.open_min) return { open: false, text: L('os.today', { t: minToTime(h.open_min) }) };
  }
  for (let i = 1; i <= 7; i++) {
    const n = byDay[(wd + i) % 7];
    if (n && !n.closed) return { open: false, text: L('os.next', { day: i === 1 ? L('os.tomorrow') : L('os.wd' + ((wd + i) % 7)), t: minToTime(n.open_min) }) };
  }
  return { open: false, text: L('os.closed') };
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

  const L = res.locals.L;
  const errors = [];
  let errorStep = 4;
  if (!form.serviceId) { errors.push(L('e.service')); errorStep = 1; }
  else if (!isDate(form.date) || timeToMin(form.time) == null) { errors.push(L('e.when')); errorStep = 3; }
  if (form.name.length < 2) errors.push(L('e.name'));
  if (!EMAIL_RE.test(form.email)) errors.push(L('e.email'));
  if (form.phone.replace(/\D/g, '').length < 9) errors.push(L('e.phone'));
  if (!req.body.consent) errors.push(L('e.consent'));
  if (!errors.length && !(await verifyTurnstile(req))) errors.push(L('e.robot'));
  if (!errors.length) {
    // limite de marcações futuras por pessoa (evita encher a agenda)
    const max = +getSettings().max_online_per_email || 4;
    const n = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE lower(customer_email) = ? AND source = 'online' AND status IN ('pending','confirmed') AND date >= ?`)
      .get(form.email, nowIn(getSettings().timezone).date).c;
    if (n >= max) errors.push(L('e.limit', { n }));
  }
  if (errors.length) {
    res.status(422);
    return renderBooking(res, { error: errors.join(' '), errorStep, form });
  }

  try {
    const b = createBooking({ ...form, start: timeToMin(form.time), staffId: form.staffId || null, lang: req.lang });
    const deposit = payments.enabled() ? payments.depositFor(b.price_cents) : 0;
    if (deposit) {
      // a marcação fica reservada (pendente) até o pagamento ser confirmado pela Stripe
      db.prepare("UPDATE bookings SET status = 'pending', payment_status = 'pending', deposit_cents = ? WHERE id = ?").run(deposit, b.id);
      try {
        return res.redirect(303, await payments.createCheckout(getBooking(b.id), res.locals.baseUrl));
      } catch (e) {
        console.error('[pagamentos]', e.message);
        return res.redirect(`/marcacao/${b.token}?nova=1&pago=erro`);
      }
    }
    notifyNewBooking(b);
    res.redirect(`/marcacao/${b.token}?nova=1`);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
    res.status(409);
    renderBooking(res, { error: L('e.taken'), errorStep: 3, form: { ...form, time: '' } });
  }
});

router.get('/marcacao/:token', (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(req.params.token);
  if (!row) return next();
  const b = getBooking(row.id);
  res.render('public/booking', { b, isNew: req.query.nova === '1', canCancel: canCustomerCancel(b), cancelled: req.query.cancelada === '1', moved: req.query.reagendada === '1', payState: String(req.query.pago || '') });
});

router.get('/marcacao/:token.ics', (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(req.params.token);
  if (!row) return next();
  const b = getBooking(row.id);
  const st = getSettings();
  const ics = require('../ics').calendar({
    timezone: st.timezone,
    events: [{ uid: b.ref, date: b.date, start: b.start_min, end: b.end_min, summary: `${b.service_name} · ${st.business_name}`, location: st.address, description: `${b.staff_name} · Ref. ${b.ref}` }],
  });
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="marcacao-${b.ref}.ics"`);
  res.send(ics);
});

router.post('/marcacao/:token/pagar', rateLimit('pay', 10, HOUR), async (req, res, next) => {
  const row = db.prepare('SELECT id FROM bookings WHERE token = ?').get(String(req.params.token));
  if (!row) return next();
  const b = getBooking(row.id);
  if (b.payment_status !== 'pending' || b.status === 'cancelled' || !process.env.STRIPE_SECRET_KEY) return res.redirect(`/marcacao/${b.token}`);
  try { res.redirect(303, await payments.createCheckout(b, res.locals.baseUrl)); }
  catch (e) { console.error('[pagamentos]', e.message); res.redirect(`/marcacao/${b.token}?pago=erro`); }
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
    back(res.locals.L('e.taken'));
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

// calendário pessoal de um profissional (subscrição .ics privada)
router.get('/cal/:token.ics', rateLimit('cal', 60, HOUR), (req, res, next) => {
  const p = db.prepare('SELECT * FROM staff WHERE ics_token = ?').get(String(req.params.token));
  if (!p) return next();
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  const rows = db.prepare(
    `SELECT b.*, s.name service_name FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.staff_id = ? AND b.status IN ('pending','confirmed','completed') AND b.date BETWEEN date(?, '-30 days') AND date(?, '+180 days')`
  ).all(p.id, today, today);
  const ics = require('../ics').calendar({
    publish: true,
    name: `${st.business_name} · ${p.name}`,
    timezone: st.timezone,
    events: rows.map((b) => ({
      uid: b.ref, date: b.date, start: b.start_min, end: b.end_min,
      summary: `${b.service_name} · ${b.customer_name}${b.status === 'pending' ? ' (por confirmar)' : ''}`,
      description: `Ref. ${b.ref}${b.notes ? ' · ' + b.notes : ''}`,
      status: b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
    })),
  });
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(ics);
});

// ---- lista de espera ----
router.post('/lista-espera', rateLimit('waitlist', 10, HOUR), async (req, res) => {
  if (req.body.website) return res.redirect('/');
  const serviceId = +req.body.serviceId;
  const staffId = +req.body.staffId || null;
  const date = clean(req.body.date, 10);
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 160).toLowerCase();
  const phone = clean(req.body.phone, 30);
  const L = res.locals.L;
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!svc || !isDate(date) || date < nowIn(getSettings().timezone).date || name.length < 2 || !EMAIL_RE.test(email)) {
    return res.status(422).render('public/message', { code: '422', title: L('wl.bad.title'), text: L('wl.bad.text') });
  }
  if (!(await verifyTurnstile(req))) return res.status(422).render('public/message', { code: '422', title: L('wl.bad.title'), text: L('wl.bad.text') });
  const dup = db.prepare("SELECT 1 FROM waitlist WHERE lower(email) = ? AND service_id = ? AND date = ? AND status = 'waiting'").get(email, serviceId, date);
  if (!dup) {
    db.prepare('INSERT INTO waitlist(token, service_id, staff_id, date, name, email, phone, lang) VALUES (?,?,?,?,?,?,?,?)')
      .run(require('../security').randomToken(), serviceId, staffId, date, name, email, phone, req.lang || 'pt');
  }
  res.render('public/message', { code: 'OK', title: L('wl.ok.title'), text: L('wl.ok.text', { service: svc.name, date: formatDateLong(date) }) });
});
router.get('/lista-espera/:token/sair', (req, res, next) => {
  const r = db.prepare("UPDATE waitlist SET status = 'removed' WHERE token = ?").run(String(req.params.token));
  if (!r.changes) return next();
  res.render('public/message', { code: 'OK', title: res.locals.L('wl.out.title'), text: res.locals.L('wl.out.text') });
});

router.get('/privacidade', (req, res) => res.render('public/privacy'));

const baseUrlOf = (req) => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /marcacao/\nDisallow: /api/\nDisallow: /cal/\n\nSitemap: ${baseUrlOf(req)}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
  const base = baseUrlOf(req);
  const en = getSettings().lang_en === '1';
  const urls = ['/', '/marcar', '/privacidade'];
  const today = nowIn(getSettings().timezone).date;
  const entry = (u) => `<url><loc>${base}${u}</loc><lastmod>${today}</lastmod>${en ? `<xhtml:link rel="alternate" hreflang="pt" href="${base}${u}?lang=pt"/><xhtml:link rel="alternate" hreflang="en" href="${base}${u}?lang=en"/>` : ''}</url>`;
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.map(entry).join('')}</urlset>`);
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
