'use strict';
const express = require('express');
const { db, getSettings, setSetting, DEFAULT_SETTINGS } = require('../db');
const { login, logout, requireAuth } = require('../auth');
const { getSlots, availableDays, createBooking, getBooking, busyIntervals, rescheduleBooking, dayHours, BookingError, ACTIVE_STATUSES } = require('../availability');
const { holidayName } = require('../holidays');
const { ensureStaffTokens } = require('../db');
const path = require('node:path');
const fs = require('node:fs');
const { notifyStatusChange, notifyNewBooking } = require('../mailer');
const { hashPassword, verifyPassword } = require('../security');
const { isDate, nowIn, addDays, timeToMin, weekday } = require('../time');

const router = express.Router();

const STATUS = {
  pending: 'Pendente',
  confirmed: 'Confirmada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  no_show: 'Faltou',
};
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const today = () => nowIn(getSettings().timezone).date;

router.use((req, res, next) => {
  res.locals.STATUS = STATUS;
  res.locals.flash = req.query.ok ? decodeURIComponent(req.query.ok) : null;
  res.locals.unread = req.user ? db.prepare('SELECT COUNT(*) c FROM messages WHERE read = 0').get().c : 0;
  res.locals.pendingCount = req.user ? db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'pending'").get().c : 0;
  next();
});
const back = (res, url, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(msg));

// ---------- Autenticação ----------
const attempts = new Map();
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('admin/login', { error: null, next: req.query.next || '/admin' });
});
router.post('/login', (req, res) => {
  const key = req.ip;
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) Object.assign(a, { n: 0, t: Date.now() });
  const nextUrl = String(req.body.next || '/admin').startsWith('/admin') ? req.body.next : '/admin';
  if (a.n >= 10) return res.status(429).render('admin/login', { error: 'Demasiadas tentativas. Aguarde 15 minutos.', next: nextUrl });
  if (login(res, req.body.email, req.body.password)) {
    attempts.delete(key);
    return res.redirect(nextUrl);
  }
  a.n++;
  attempts.set(key, a);
  res.status(401).render('admin/login', { error: 'Email ou palavra-passe incorretos.', next: nextUrl });
});
router.post('/logout', (req, res) => {
  logout(req, res);
  res.redirect('/admin/login');
});

router.use(requireAuth);

// ---------- Painel ----------
router.get('/', (req, res) => {
  const d = today();
  const q = (sql, ...p) => db.prepare(sql).get(...p).c;
  const monthStart = d.slice(0, 8) + '01';
  const stats = {
    today: q(`SELECT COUNT(*) c FROM bookings WHERE date = ? AND status IN ${ACTIVE_STATUSES}`, d),
    week: q(`SELECT COUNT(*) c FROM bookings WHERE date BETWEEN ? AND ? AND status IN ${ACTIVE_STATUSES}`, d, addDays(d, 6)),
    pending: q("SELECT COUNT(*) c FROM bookings WHERE status = 'pending'"),
    month: db
      .prepare(`SELECT COALESCE(SUM(price_cents),0) c FROM bookings WHERE date BETWEEN ? AND ? AND status IN ('confirmed','completed')`)
      .get(monthStart, monthStart.slice(0, 8) + '31').c,
    online30: q("SELECT COUNT(*) c FROM bookings WHERE source = 'online' AND created_at >= datetime('now','-30 days')"),
  };
  const upcoming = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE (b.date > ? OR (b.date = ? AND b.end_min >= ?)) AND b.status IN ('pending','confirmed')
       ORDER BY b.date, b.start_min LIMIT 12`
    )
    .all(d, d, nowIn(getSettings().timezone).min);
  const nowMin = nowIn(getSettings().timezone).min;
  const todayList = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE b.date = ? AND b.status != 'cancelled' ORDER BY b.start_min, st.sort`
    )
    .all(d);
  const pendingList = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE b.status = 'pending' AND b.date >= ? ORDER BY b.date, b.start_min LIMIT 8`
    )
    .all(d);
  const recent = db
    .prepare(
      `SELECT b.*, s.name service_name FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.source = 'online' ORDER BY b.created_at DESC LIMIT 6`
    )
    .all();
  res.render('admin/dashboard', { stats, upcoming: upcoming.filter((b) => b.date !== d), recent, d, todayList, pendingList, nowMin });
});

// ---------- Agenda (vista diária por profissional) ----------
router.get('/agenda', (req, res) => {
  const date = isDate(req.query.data) ? req.query.data : today();
  const view = ['dia', 'semana', 'mes'].includes(req.query.vista) ? req.query.vista : 'dia';
  const allStaff = db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all();
  const staffId = +req.query.staff || null;
  const staff = staffId ? allStaff.filter((p) => p.id === staffId) : allStaff;
  const hoursBy = Object.fromEntries(db.prepare('SELECT * FROM hours').all().map((h) => [h.weekday, h]));
  const monday = addDays(date, -((weekday(date) + 6) % 7));

  let rangeFrom = date, rangeTo = date;
  if (view === 'semana') { rangeFrom = monday; rangeTo = addDays(monday, 6); }
  if (view === 'mes') {
    const first = date.slice(0, 8) + '01';
    rangeFrom = addDays(first, -((weekday(first) + 6) % 7));
    rangeTo = addDays(rangeFrom, 41);
  }
  const bookings = db.prepare(
    `SELECT b.*, s.name service_name, st.color staff_color, st.name staff_name FROM bookings b
     JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE b.date BETWEEN ? AND ? AND b.status != 'cancelled' ${staffId ? 'AND b.staff_id = ' + staffId : ''} ORDER BY b.date, b.start_min`
  ).all(rangeFrom, rangeTo);
  const blocks = db.prepare('SELECT * FROM blocks WHERE date_from <= ? AND date_to >= ?').all(rangeTo, rangeFrom);

  // colunas: dia = uma por profissional; semana = uma por dia
  const columns = view === 'dia'
    ? staff.map((p) => ({ key: `${date}|${p.id}`, date, staffId: p.id, label: p.name, color: p.color }))
    : view === 'semana'
      ? [0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(monday, i); return { key: d, date: d, staffId, label: d, isDay: true }; })
      : [];
  const autoHol = getSettings().auto_holidays === '1';
  const holidays = {};
  for (let d = rangeFrom; d <= rangeTo; d = addDays(d, 1)) { const n = autoHol && holidayName(d); if (n) holidays[d] = n; }
  for (const c of columns) { c.h = holidays[c.date] ? { closed: 1 } : dayHours(c.date, c.staffId); c.holiday = holidays[c.date] || null; }
  let from = 24 * 60, to = 0;
  for (const c of columns) {
    const h = dayHours(c.date, c.staffId);
    if (h && !h.closed) { from = Math.min(from, h.open_min); to = Math.max(to, h.close_min); }
  }
  for (const bk of bookings) { from = Math.min(from, bk.start_min); to = Math.max(to, bk.end_min); }
  if (from >= to) { from = 8 * 60; to = 20 * 60; }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;

  res.render('admin/agenda', {
    view, date, monday, staff, allStaff, staffId, columns, bookings, blocks, hoursBy, holidays, from, to, today: today(),
    rangeFrom, step: +getSettings().slot_step || 15,
  });
});

// folha do dia para imprimir
router.get('/agenda/imprimir', (req, res) => {
  const date = isDate(req.query.data) ? req.query.data : today();
  const staffId = +req.query.staff || null;
  const rows = db.prepare(
    `SELECT b.*, s.name service_name, st.name staff_name FROM bookings b JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE b.date = ? AND b.status IN ('pending','confirmed','completed') ${staffId ? 'AND b.staff_id = ' + staffId : ''} ORDER BY st.sort, st.name, b.start_min`
  ).all(date);
  const groups = {};
  for (const r of rows) (groups[r.staff_name] = groups[r.staff_name] || []).push(r);
  res.render('admin/print-day', { date, groups, holiday: holidayName(date) });
});

// arrastar para reagendar (agenda): valida conflitos, a não ser que force=true (desfazer)
router.post('/api/reagendar', (req, res) => {
  const b = getBooking(+req.body.id);
  if (!b) return res.status(404).json({ error: 'Marcação não encontrada.' });
  const date = String(req.body.date || '');
  const start = +req.body.start;
  const staffId = +req.body.staffId || b.staff_id;
  if (!isDate(date) || !Number.isInteger(start) || start < 0 || start + b.duration_min > 24 * 60) return res.status(400).json({ error: 'Data ou hora inválida.' });
  const end = start + b.duration_min;
  if (!req.body.force && busyIntervals(staffId, date, { ignoreBookingId: b.id }).some(([s0, e0]) => start < e0 && end > s0)) {
    return res.status(409).json({ error: 'Colide com outra marcação ou bloqueio.' });
  }
  db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ?, updated_at = datetime('now') WHERE id = ?").run(date, start, end, staffId, b.id);
  const nb = getBooking(b.id);
  res.json({ ok: true, booking: { id: nb.id, date: nb.date, start: nb.start_min, staffId: nb.staff_id, staffName: nb.staff_name }, before: { date: b.date, start: b.start_min, staffId: b.staff_id } });
});

// ---------- Marcações ----------
router.get('/marcacoes', (req, res) => {
  const f = {
    q: clean(req.query.q, 80),
    status: STATUS[req.query.status] ? req.query.status : '',
    staff: +req.query.staff || '',
    from: isDate(req.query.from) ? req.query.from : '',
    to: isDate(req.query.to) ? req.query.to : '',
  };
  if (!req.query.from && !req.query.to && !req.query.q && !req.query.status) f.from = today();
  const where = [], p = [];
  if (f.q) { where.push('(b.customer_name LIKE ? OR b.customer_email LIKE ? OR b.customer_phone LIKE ? OR b.ref LIKE ?)'); p.push(...Array(4).fill(`%${f.q}%`)); }
  if (f.status) { where.push('b.status = ?'); p.push(f.status); }
  if (f.staff) { where.push('b.staff_id = ?'); p.push(f.staff); }
  if (f.from) { where.push('b.date >= ?'); p.push(f.from); }
  if (f.to) { where.push('b.date <= ?'); p.push(f.to); }
  const rows = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY b.date ${f.from ? 'ASC' : 'DESC'}, b.start_min LIMIT 300`
    )
    .all(...p);
  const staff = db.prepare('SELECT id, name FROM staff ORDER BY sort, name').all();
  res.render('admin/bookings', { rows, f, staff });
});

router.get('/marcacoes/exportar.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.ref, b.date, b.start_min, b.end_min, s.name service, st.name staff, b.customer_name, b.customer_email,
              b.customer_phone, b.status, b.source, b.price_cents, b.notes FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id ORDER BY b.date, b.start_min`
    )
    .all();
  const { minToTime } = require('../time');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Referência', 'Data', 'Início', 'Fim', 'Serviço', 'Profissional', 'Cliente', 'Email', 'Telefone', 'Estado', 'Origem', 'Preço', 'Notas'].map(esc).join(';')];
  for (const r of rows) {
    lines.push([r.ref, r.date, minToTime(r.start_min), minToTime(r.end_min), r.service, r.staff, r.customer_name, r.customer_email, r.customer_phone, STATUS[r.status], r.source, (r.price_cents / 100).toFixed(2).replace('.', ','), r.notes].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="marcacoes.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

function formData() {
  return {
    services: db.prepare('SELECT * FROM services ORDER BY active DESC, sort, name').all(),
    staff: db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all(),
    links: db.prepare('SELECT * FROM staff_services').all(),
  };
}

router.get('/marcacoes/nova', (req, res) => {
  res.render('admin/booking-new', {
    ...formData(), error: null,
    form: {
      date: isDate(req.query.data) ? req.query.data : today(), staffId: +req.query.staff || '', time: req.query.hora || '',
      name: clean(req.query.nome, 120), email: clean(req.query.email, 160), phone: clean(req.query.tel, 30),
    },
  });
});

router.get('/api/slots', (req, res) => {
  if (!isDate(req.query.date)) return res.json({ slots: [] });
  res.json({ slots: getSlots({ serviceId: +req.query.service, staffId: +req.query.staff || null, date: req.query.date, forAdmin: true, ignoreBookingId: +req.query.ignore || null }).map(({ start, time }) => ({ start, time })) });
});
router.get('/api/days', (req, res) => {
  const t0 = today();
  const days = 120;
  res.json({ today: t0, maxDays: days, days: availableDays({ serviceId: +req.query.service, staffId: +req.query.staff || null, from: t0, days: days + 1, ignoreBookingId: +req.query.ignore || null, forAdmin: true }) });
});

router.post('/marcacoes', (req, res) => {
  const form = {
    serviceId: +req.body.serviceId, staffId: +req.body.staffId || null, date: clean(req.body.date, 10), time: clean(req.body.time, 5),
    name: clean(req.body.name, 120), email: clean(req.body.email, 160).toLowerCase(), phone: clean(req.body.phone, 30),
    notes: clean(req.body.notes, 1000), internalNotes: clean(req.body.internal_notes, 2000), force: req.body.force === '1', notify: req.body.notify === '1',
  };
  const start = timeToMin(form.time);
  let error = null;
  if (!form.serviceId || !isDate(form.date) || start == null) error = 'Escolha o serviço, o dia e a hora.';
  else if (!form.name) error = 'Indique o nome do cliente.';
  if (!error) {
    try {
      const b = createBooking({ ...form, start, email: form.email || '—', phone: form.phone || '—' }, { source: 'admin', force: form.force });
      if (form.notify && form.email) notifyNewBooking(b);
      return back(res, `/admin/marcacoes/${b.id}`, 'Marcação criada.');
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      error = e.message + ' Pode marcar mesmo assim ativando "Ignorar disponibilidade".';
    }
  }
  res.status(422).render('admin/booking-new', { ...formData(), error, form });
});

router.get('/marcacoes/:id', (req, res, next) => {
  const b = getBooking(+req.params.id);
  if (!b) return next();
  const history = db
    .prepare(
      `SELECT b.*, s.name service_name FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.customer_email = ? AND b.id != ? ORDER BY b.date DESC LIMIT 10`
    )
    .all(b.customer_email, b.id);
  res.render('admin/booking', { b, history, ...formData(), error: req.query.erro || null });
});

router.post('/marcacoes/:id', (req, res, next) => {
  const b = getBooking(+req.params.id);
  if (!b) return next();
  const action = req.body.action;

  if (action === 'status' && STATUS[req.body.status]) {
    db.prepare("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.status, b.id);
    if (req.body.notify === '1') notifyStatusChange(getBooking(b.id));
    const ret = String(req.body.back || '');
    if (ret.startsWith('/admin') && !ret.startsWith('//')) return back(res, ret, `${b.customer_name}: ${STATUS[req.body.status].toLowerCase()}.`);
    return back(res, `/admin/marcacoes/${b.id}`, `Estado alterado para "${STATUS[req.body.status]}".`);
  }

  if (action === 'details') {
    db.prepare(
      `UPDATE bookings SET customer_name = ?, customer_email = ?, customer_phone = ?, notes = ?, internal_notes = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(clean(req.body.name, 120) || b.customer_name, clean(req.body.email, 160), clean(req.body.phone, 30), clean(req.body.notes, 1000), clean(req.body.internal_notes, 2000), b.id);
    return back(res, `/admin/marcacoes/${b.id}`, 'Dados guardados.');
  }

  if (action === 'move') {
    const date = clean(req.body.date, 10);
    const start = timeToMin(req.body.time);
    if (!isDate(date) || start == null) return res.redirect(`/admin/marcacoes/${b.id}?erro=` + encodeURIComponent('Escolha o dia e a hora.'));
    try {
      const nb = rescheduleBooking(b.id, { date, start, staffId: +req.body.staffId || null }, { forAdmin: true });
      if (req.body.notify === '1') require('../mailer').notifyRescheduled(nb, { date: b.date, start: b.start_min }, { byBusiness: true });
      return back(res, `/admin/marcacoes/${b.id}`, 'Marcação reagendada.');
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      return res.redirect(`/admin/marcacoes/${b.id}?erro=` + encodeURIComponent(e.message));
    }
  }

  if (action === 'reschedule') {
    const date = clean(req.body.date, 10);
    const start = timeToMin(req.body.time);
    const staffId = +req.body.staffId || b.staff_id;
    if (!isDate(date) || start == null) return res.redirect(`/admin/marcacoes/${b.id}?erro=` + encodeURIComponent('Data/hora inválida.'));
    const end = start + b.duration_min;
    const conflict = busyIntervals(staffId, date, { ignoreBookingId: b.id }).some(([s, e]) => start < e && end > s);
    if (conflict && req.body.force !== '1') {
      return res.redirect(`/admin/marcacoes/${b.id}?erro=` + encodeURIComponent('Esse horário colide com outra marcação ou bloqueio. Ative "Ignorar conflitos" para forçar.'));
    }
    db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ?, updated_at = datetime('now') WHERE id = ?").run(date, start, end, staffId, b.id);
    return back(res, `/admin/marcacoes/${b.id}`, 'Marcação reagendada.');
  }

  if (action === 'delete') {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(b.id);
    return back(res, '/admin/marcacoes', 'Marcação apagada.');
  }
  res.redirect(`/admin/marcacoes/${b.id}`);
});

// ---------- Clientes (agregados a partir das marcações, pela chave email) ----------
const CLIENT_SQL = `
  SELECT lower(b.customer_email) email,
    (SELECT customer_name FROM bookings x WHERE lower(x.customer_email) = lower(b.customer_email) ORDER BY x.created_at DESC LIMIT 1) name,
    (SELECT customer_phone FROM bookings x WHERE lower(x.customer_email) = lower(b.customer_email) ORDER BY x.created_at DESC LIMIT 1) phone,
    COUNT(*) total,
    SUM(b.status = 'completed') visits,
    SUM(b.status = 'no_show') no_shows,
    SUM(b.status IN ('pending','confirmed') AND b.date >= ?) upcoming,
    MAX(CASE WHEN b.status = 'completed' THEN b.date END) last_visit,
    MIN(CASE WHEN b.status IN ('pending','confirmed') AND b.date >= ? THEN b.date END) next_visit,
    COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.price_cents END), 0) spent
  FROM bookings b WHERE b.customer_email LIKE '%@%' AND b.customer_email NOT LIKE '%@removido.invalid'`;

router.get('/clientes', (req, res) => {
  const q = clean(req.query.q, 80);
  const sort = ['recent', 'visits', 'name', 'no_shows'].includes(req.query.ordem) ? req.query.ordem : 'recent';
  const order = { recent: 'COALESCE(next_visit, last_visit) DESC', visits: 'visits DESC, name', name: 'name COLLATE NOCASE', no_shows: 'no_shows DESC, name' }[sort];
  const d = today();
  const where = q ? ` AND (b.customer_name LIKE ? OR b.customer_email LIKE ? OR b.customer_phone LIKE ?)` : '';
  const rows = db.prepare(`${CLIENT_SQL}${where} GROUP BY lower(b.customer_email) ORDER BY ${order} LIMIT 300`)
    .all(d, d, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));
  res.render('admin/clients', { rows, q, sort, d });
});

router.get('/clientes/ficha', (req, res, next) => {
  const email = clean(req.query.email, 160).toLowerCase();
  const d = today();
  const c = db.prepare(`${CLIENT_SQL} AND lower(b.customer_email) = ? GROUP BY lower(b.customer_email)`).get(d, d, email);
  if (!c) return next();
  const bookings = db.prepare(
    `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
     JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE lower(b.customer_email) = ? ORDER BY b.date DESC, b.start_min DESC`
  ).all(email);
  const notes = (db.prepare('SELECT notes FROM client_notes WHERE email = ?').get(email) || {}).notes || '';
  res.render('admin/client', { c, bookings, notes, d });
});

router.post('/clientes/ficha', (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  db.prepare(`INSERT INTO client_notes(email, notes) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET notes = excluded.notes, updated_at = datetime('now')`)
    .run(email, clean(req.body.notes, 4000));
  back(res, '/admin/clientes/ficha?email=' + encodeURIComponent(email), 'Notas guardadas.');
});

// RGPD: exportar todos os dados de um cliente (direito de acesso/portabilidade)
router.get('/clientes/exportar', (req, res) => {
  const email = clean(req.query.email, 160).toLowerCase();
  const bookings = db.prepare(
    `SELECT b.ref, b.date, b.start_min, b.end_min, s.name service, st.name staff, b.customer_name, b.customer_email, b.customer_phone,
            b.notes, b.status, b.source, b.price_cents, b.created_at FROM bookings b
     JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id WHERE lower(b.customer_email) = ? ORDER BY b.date`
  ).all(email);
  const data = {
    exported_at: new Date().toISOString(),
    controller: getSettings().privacy_controller || getSettings().business_name,
    email,
    bookings,
    notes: (db.prepare('SELECT notes FROM client_notes WHERE email = ?').get(email) || {}).notes || '',
    packages: db.prepare('SELECT p.name, cp.sessions_total, cp.sessions_used, cp.purchased_at, cp.expires_at FROM client_packages cp JOIN packages p ON p.id = cp.package_id WHERE cp.email = ?').all(email),
    waitlist: db.prepare('SELECT date, name, phone, status, created_at FROM waitlist WHERE lower(email) = ?').all(email),
    messages: db.prepare('SELECT name, phone, message, created_at FROM messages WHERE lower(email) = ?').all(email),
  };
  res.set('Content-Disposition', `attachment; filename="dados-${email.replace(/[^a-z0-9]/g, '_')}.json"`);
  res.json(data);
});

// RGPD: apagar dados pessoais (anonimiza as marcações para manter a contabilidade e estatísticas)
router.post('/clientes/apagar', (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  if (!email || req.body.confirm !== email) return back(res, '/admin/clientes/ficha?email=' + encodeURIComponent(email), 'Para apagar, escreva o email do cliente para confirmar.');
  const anon = `anonimo-${require('node:crypto').randomBytes(4).toString('hex')}@removido.invalid`;
  db.prepare(`UPDATE bookings SET customer_name = 'Cliente removido', customer_email = ?, customer_phone = '', notes = '', internal_notes = '' WHERE lower(customer_email) = ?`).run(anon, email);
  db.prepare('DELETE FROM client_notes WHERE email = ?').run(email);
  db.prepare('DELETE FROM client_packages WHERE email = ?').run(email);
  db.prepare('DELETE FROM waitlist WHERE lower(email) = ?').run(email);
  db.prepare('DELETE FROM messages WHERE lower(email) = ?').run(email);
  back(res, '/admin/clientes', 'Dados pessoais do cliente apagados (marcações anonimizadas).');
});

// autocompletar clientes no formulário de nova marcação
router.get('/api/clientes', (req, res) => {
  const q = clean(req.query.q, 80);
  if (q.length < 2) return res.json({ clients: [] });
  const d = today();
  const rows = db.prepare(`${CLIENT_SQL} AND (b.customer_name LIKE ? OR b.customer_email LIKE ? OR b.customer_phone LIKE ?) GROUP BY lower(b.customer_email) ORDER BY total DESC LIMIT 6`)
    .all(d, d, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ clients: rows.map(({ name, email, phone, visits }) => ({ name, email, phone, visits })) });
});

// ---------- Serviços ----------
router.get('/servicos', (req, res) => {
  const services = db
    .prepare('SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id) uses FROM services s ORDER BY sort, name')
    .all();
  res.render('admin/services', { services });
});

function serviceFromBody(body) {
  return [
    clean(body.name, 120),
    clean(body.description, 600),
    Math.max(5, Math.min(600, +body.duration_min || 30)),
    Math.round((parseFloat(String(body.price).replace(',', '.')) || 0) * 100),
    body.active ? 1 : 0,
    +body.sort || 0,
  ];
}
router.post('/servicos', (req, res) => {
  const v = serviceFromBody(req.body);
  if (!v[0]) return back(res, '/admin/servicos', 'Indique o nome do serviço.');
  const id = Number(db.prepare('INSERT INTO services(name, description, duration_min, price_cents, active, sort) VALUES (?,?,?,?,?,?)').run(...v).lastInsertRowid);
  // por defeito todos os profissionais ativos prestam o novo serviço
  for (const s of db.prepare('SELECT id FROM staff WHERE active = 1').all()) db.prepare('INSERT OR IGNORE INTO staff_services VALUES (?, ?)').run(s.id, id);
  back(res, '/admin/servicos', 'Serviço criado. Confirme na Equipa quem o presta.');
});
router.post('/servicos/:id', (req, res) => {
  if (req.body.action === 'delete') {
    const used = db.prepare('SELECT COUNT(*) c FROM bookings WHERE service_id = ?').get(+req.params.id).c;
    if (used) {
      db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(+req.params.id);
      return back(res, '/admin/servicos', 'O serviço tem marcações, por isso foi desativado em vez de apagado.');
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(+req.params.id);
    return back(res, '/admin/servicos', 'Serviço apagado.');
  }
  const v = serviceFromBody(req.body);
  db.prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, price_cents = ?, active = ?, sort = ? WHERE id = ?').run(...v, +req.params.id);
  back(res, '/admin/servicos', 'Serviço guardado.');
});

// ---------- Equipa ----------
router.get('/equipa', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff ORDER BY sort, name').all();
  const services = db.prepare('SELECT * FROM services ORDER BY sort, name').all();
  const links = db.prepare('SELECT * FROM staff_services').all();
  res.render('admin/staff', { staff, services, links });
});
function saveStaffServices(staffId, body) {
  const ids = [].concat(body.services || []).map(Number).filter(Boolean);
  db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(staffId);
  for (const sid of ids) db.prepare('INSERT OR IGNORE INTO staff_services VALUES (?, ?)').run(staffId, sid);
}
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#3d7a6a');
router.post('/equipa', (req, res) => {
  const name = clean(req.body.name, 120);
  if (!name) return back(res, '/admin/equipa', 'Indique o nome.');
  const id = Number(
    db.prepare('INSERT INTO staff(name, role, bio, color, active, sort) VALUES (?,?,?,?,?,?)')
      .run(name, clean(req.body.role, 80), clean(req.body.bio, 600), color(req.body.color), req.body.active ? 1 : 0, +req.body.sort || 0).lastInsertRowid
  );
  saveStaffServices(id, req.body);
  ensureStaffTokens();
  back(res, '/admin/equipa', 'Profissional adicionado.');
});
router.post('/equipa/:id', (req, res) => {
  const id = +req.params.id;
  if (req.body.action === 'delete') {
    const used = db.prepare('SELECT COUNT(*) c FROM bookings WHERE staff_id = ?').get(id).c;
    if (used) {
      db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(id);
      return back(res, '/admin/equipa', 'Tem marcações associadas, por isso foi desativado em vez de apagado.');
    }
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    return back(res, '/admin/equipa', 'Profissional removido.');
  }
  db.prepare('UPDATE staff SET name = ?, role = ?, bio = ?, color = ?, active = ?, sort = ? WHERE id = ?')
    .run(clean(req.body.name, 120), clean(req.body.role, 80), clean(req.body.bio, 600), color(req.body.color), req.body.active ? 1 : 0, +req.body.sort || 0, id);
  saveStaffServices(id, req.body);
  back(res, '/admin/equipa', 'Profissional guardado.');
});

// horário próprio e calendário pessoal de um profissional
router.get('/equipa/:id/horario', (req, res, next) => {
  const p = db.prepare('SELECT * FROM staff WHERE id = ?').get(+req.params.id);
  if (!p) return next();
  ensureStaffTokens();
  const general = db.prepare('SELECT * FROM hours ORDER BY weekday').all();
  const own = db.prepare('SELECT * FROM staff_hours WHERE staff_id = ? ORDER BY weekday').all(p.id);
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.render('admin/staff-hours', { p: db.prepare('SELECT * FROM staff WHERE id = ?').get(p.id), general, own, feed: `${base}/cal/${db.prepare('SELECT ics_token FROM staff WHERE id = ?').get(p.id).ics_token}.ics` });
});
router.post('/equipa/:id/horario', (req, res) => {
  const id = +req.params.id;
  db.prepare('DELETE FROM staff_hours WHERE staff_id = ?').run(id);
  if (req.body.custom === '1') {
    const ins = db.prepare('INSERT INTO staff_hours(staff_id, weekday, closed, open_min, close_min, break_start, break_end) VALUES (?,?,?,?,?,?,?)');
    for (let d = 0; d < 7; d++) {
      const o = timeToMin(req.body[`open_${d}`]) ?? 540;
      const c = timeToMin(req.body[`close_${d}`]) ?? 1140;
      const bs = timeToMin(req.body[`bstart_${d}`]);
      const be = timeToMin(req.body[`bend_${d}`]);
      ins.run(id, d, req.body[`closed_${d}`] ? 1 : 0, o, Math.max(c, o + 15), bs, bs != null ? be : null);
    }
  }
  back(res, `/admin/equipa/${id}/horario`, req.body.custom === '1' ? 'Horário próprio guardado.' : 'Passa a usar o horário geral.');
});
router.post('/equipa/:id/calendario', (req, res) => {
  db.prepare('UPDATE staff SET ics_token = ? WHERE id = ?').run(require('node:crypto').randomBytes(18).toString('hex'), +req.params.id);
  back(res, `/admin/equipa/${+req.params.id}/horario`, 'Novo link criado. O anterior deixou de funcionar.');
});

// ---------- Horário ----------
router.get('/horario', (req, res) => {
  res.render('admin/hours', { hours: db.prepare('SELECT * FROM hours ORDER BY weekday').all() });
});
router.post('/horario', (req, res) => {
  const up = db.prepare('UPDATE hours SET closed = ?, open_min = ?, close_min = ?, break_start = ?, break_end = ? WHERE weekday = ?');
  for (let d = 0; d < 7; d++) {
    const o = timeToMin(req.body[`open_${d}`]) ?? 540;
    const c = timeToMin(req.body[`close_${d}`]) ?? 1140;
    const bs = timeToMin(req.body[`bstart_${d}`]);
    const be = timeToMin(req.body[`bend_${d}`]);
    up.run(req.body[`closed_${d}`] ? 1 : 0, o, Math.max(c, o + 15), bs, bs != null ? be : null, d);
  }
  back(res, '/admin/horario', 'Horário guardado.');
});

// ---------- Bloqueios / férias ----------
router.get('/bloqueios', (req, res) => {
  const blocks = db
    .prepare('SELECT b.*, s.name staff_name FROM blocks b LEFT JOIN staff s ON s.id = b.staff_id WHERE b.date_to >= ? ORDER BY b.date_from')
    .all(addDays(today(), -30));
  const staff = db.prepare('SELECT id, name FROM staff WHERE active = 1 ORDER BY sort, name').all();
  res.render('admin/blocks', { blocks, staff, d: today() });
});
router.post('/bloqueios', (req, res) => {
  const from = clean(req.body.date_from, 10);
  const to = isDate(req.body.date_to) ? req.body.date_to : from;
  if (!isDate(from) || to < from) return back(res, '/admin/bloqueios', 'Datas inválidas.');
  const allDay = !req.body.start_time;
  const s = allDay ? null : timeToMin(req.body.start_time);
  const e = allDay ? null : timeToMin(req.body.end_time);
  if (!allDay && (s == null || e == null || e <= s)) return back(res, '/admin/bloqueios', 'Horas inválidas.');
  db.prepare('INSERT INTO blocks(staff_id, date_from, date_to, start_min, end_min, reason) VALUES (?,?,?,?,?,?)')
    .run(+req.body.staff_id || null, from, to, s, e, clean(req.body.reason, 200));
  back(res, '/admin/bloqueios', 'Bloqueio adicionado.');
});
router.post('/bloqueios/:id/apagar', (req, res) => {
  db.prepare('DELETE FROM blocks WHERE id = ?').run(+req.params.id);
  back(res, '/admin/bloqueios', 'Bloqueio removido.');
});

// ---------- Mensagens ----------
router.get('/mensagens', (req, res) => {
  res.render('admin/messages', { messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 200').all() });
});
router.post('/mensagens/:id', (req, res) => {
  if (req.body.action === 'delete') db.prepare('DELETE FROM messages WHERE id = ?').run(+req.params.id);
  else db.prepare('UPDATE messages SET read = 1 - read WHERE id = ?').run(+req.params.id);
  res.redirect('/admin/mensagens');
});

// ---------- Definições ----------
router.get('/definicoes', (req, res) => res.render('admin/settings', { error: req.query.erro || null }));
router.post('/definicoes', (req, res) => {
  const numeric = {
    slot_step: [5, 120], min_notice_hours: [0, 720], max_days_ahead: [1, 365], buffer_min: [0, 120], cancel_hours: [0, 720],
    reminder_hours: [0, 168], review_delay_hours: [0, 168], max_online_per_email: [1, 50], deposit_value: [0, 100000], payment_timeout_min: [10, 1440],
  };
  const checkboxes = ['auto_confirm', 'demo_mode', 'auto_holidays', 'reminder_sms', 'lang_en'];
  const urls = ['review_url', 'complaints_url'];
  const section = String(req.body._section || '');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'brand_logo') continue;
    if (checkboxes.includes(key)) { if (section && req.body[`has_${key}`]) setSetting(key, req.body[key] ? '1' : '0'); continue; }
    if (!(key in req.body)) continue;
    let v = clean(req.body[key], 2000);
    if (numeric[key]) v = String(Math.max(numeric[key][0], Math.min(numeric[key][1], parseInt(v, 10) || 0)));
    if (key === 'timezone') { try { new Intl.DateTimeFormat('en', { timeZone: v }); } catch { continue; } }
    if (key === 'brand_signal' && !/^#[0-9a-f]{6}$/i.test(v)) continue;
    if (key === 'deposit_mode' && !['off', 'percent', 'fixed', 'full'].includes(v)) continue;
    if (urls.includes(key) && v && !/^https?:\/\//i.test(v)) continue;
    setSetting(key, v);
  }
  back(res, '/admin/definicoes' + (section ? '#' + section : ''), 'Definições guardadas.');
});

// logótipo (PNG, JPEG ou WebP até 1 MB; SVG não é aceite por segurança)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });
const UPLOADS = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db')), 'uploads');
router.post('/definicoes/logo', (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (req.body?._csrf !== req.session.csrf) return res.status(403).send('Pedido inválido (CSRF).');
    if (err) return res.redirect('/admin/definicoes?erro=' + encodeURIComponent('O ficheiro é demasiado grande (máx. 1 MB).') + '#marca');
    const old = getSettings().brand_logo;
    if (req.body.remove === '1' || !req.file) {
      if (old && old.startsWith('/uploads/')) fs.rm(path.join(UPLOADS, path.basename(old)), () => {});
      setSetting('brand_logo', '');
      return back(res, '/admin/definicoes#marca', 'Logótipo removido.');
    }
    const sig = req.file.buffer.subarray(0, 12);
    const ext = sig[0] === 0x89 && sig[1] === 0x50 ? 'png' : sig[0] === 0xff && sig[1] === 0xd8 ? 'jpg' : sig.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!ext) return res.redirect('/admin/definicoes?erro=' + encodeURIComponent('Use uma imagem PNG, JPEG ou WebP.') + '#marca');
    fs.mkdirSync(UPLOADS, { recursive: true });
    const name = `logo-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS, name), req.file.buffer);
    if (old && old.startsWith('/uploads/')) fs.rm(path.join(UPLOADS, path.basename(old)), () => {});
    setSetting('brand_logo', `/uploads/${name}`);
    back(res, '/admin/definicoes#marca', 'Logótipo atualizado.');
  });
});

router.post('/definicoes/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.body.current, u.password_hash)) return res.redirect('/admin/definicoes?erro=' + encodeURIComponent('Palavra-passe atual incorreta.'));
  if (String(req.body.next || '').length < 8) return res.redirect('/admin/definicoes?erro=' + encodeURIComponent('A nova palavra-passe deve ter pelo menos 8 caracteres.'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.next), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, req.session.token);
  back(res, '/admin/definicoes', 'Palavra-passe alterada.');
});

module.exports = router;
