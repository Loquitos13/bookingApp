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

// rotas sensíveis a maiúsculas e à barra final: o controlo de papéis compara caminhos exatos
const router = express.Router({ caseSensitive: true, strict: true });

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
  res.locals.flash = req.query.ok ? String(req.query.ok) : null; // já vem descodificado pelo Express
  res.locals.unread = req.user ? db.prepare('SELECT COUNT(*) c FROM messages WHERE read = 0').get().c : 0;
  res.locals.pendingCount = req.user ? db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'pending'").get().c : 0;
  next();
});
const back = (res, url, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(msg));

// ---------- Autenticação ----------
const attempts = new Map();
setInterval(() => { const t = Date.now() - 15 * 60 * 1000; for (const [k, v] of attempts) if (v.t < t) attempts.delete(k); }, 10 * 60 * 1000).unref();
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

// ---------- papéis ----------
// dono: tudo · receção: sem definições do negócio, serviços, equipa, horário, utilizadores e estatísticas
// profissional: só a sua agenda e as suas marcações
const ROLE_LABEL = { owner: 'Dono / gestor', reception: 'Receção', staff: 'Profissional' };
const OWNER_ONLY = ['/definicoes', '/servicos', '/pacotes', '/equipa', '/horario', '/utilizadores', '/estatisticas'];
const STAFF_ALLOWED = ['/agenda', '/marcacoes', '/api/slots', '/api/days', '/api/reagendar', '/conta'];
const ownStaff = (req) => (req.user.role === 'staff' ? +req.user.staff_id || -1 : null);
router.use((req, res, next) => {
  const role = req.user.role;
  res.locals.role = role;
  res.locals.ROLE_LABEL = ROLE_LABEL;
  // caminho normalizado (minúsculas, sem barra final) para o controlo não poder ser contornado
  const p = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  const deny = () => (req.method === 'GET' && !p.startsWith('/api') ? res.status(403).render('admin/forbidden') : res.status(403).json({ error: 'Sem permissão.' }));
  if (role === 'reception' && OWNER_ONLY.some((x) => p === x || p.startsWith(x + '/'))) return deny();
  if (role === 'staff') {
    if (!(p === '/' || STAFF_ALLOWED.some((x) => p === x || p.startsWith(x + '/')))) return deny();
    // o profissional só vê a sua coluna, em qualquer listagem
    req.query.staff = String(ownStaff(req));
  }
  next();
});
router.param('id', (req, res, next, id) => {
  const own = ownStaff(req);
  if (own && req.path.toLowerCase().startsWith('/marcacoes/')) {
    const b = db.prepare('SELECT staff_id FROM bookings WHERE id = ?').get(+id);
    if (b && b.staff_id !== own) return res.status(403).render('admin/forbidden');
  }
  next();
});

// ---------- Painel ----------
router.get('/', (req, res) => {
  const d = today();
  const own = ownStaff(req);
  const SF = own ? ` AND staff_id = ${own}` : '';
  const BSF = own ? ` AND b.staff_id = ${own}` : '';
  const q = (sql, ...p) => db.prepare(sql + SF).get(...p).c;
  const monthStart = d.slice(0, 8) + '01';
  const stats = {
    today: q(`SELECT COUNT(*) c FROM bookings WHERE date = ? AND status IN ${ACTIVE_STATUSES}`, d),
    week: q(`SELECT COUNT(*) c FROM bookings WHERE date BETWEEN ? AND ? AND status IN ${ACTIVE_STATUSES}`, d, addDays(d, 6)),
    pending: q("SELECT COUNT(*) c FROM bookings WHERE status = 'pending'"),
    month: db
      .prepare(`SELECT COALESCE(SUM(price_cents),0) c FROM bookings WHERE date BETWEEN ? AND ? AND status IN ('confirmed','completed')`)
      .get(monthStart, monthStart.slice(0, 8) + '31').c * (own ? 0 : 1),
    online30: q("SELECT COUNT(*) c FROM bookings WHERE source = 'online' AND created_at >= datetime('now','-30 days')"),
  };
  const upcoming = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE (b.date > ? OR (b.date = ? AND b.end_min >= ?)) AND b.status IN ('pending','confirmed')${BSF}
       ORDER BY b.date, b.start_min LIMIT 12`
    )
    .all(d, d, nowIn(getSettings().timezone).min);
  const nowMin = nowIn(getSettings().timezone).min;
  const todayList = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name, st.color staff_color FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE b.date = ? AND b.status != 'cancelled'${BSF} ORDER BY b.start_min, st.sort`
    )
    .all(d);
  const pendingList = db
    .prepare(
      `SELECT b.*, s.name service_name, st.name staff_name FROM bookings b
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE b.status = 'pending' AND b.date >= ?${BSF} ORDER BY b.date, b.start_min LIMIT 8`
    )
    .all(d);
  const recent = db
    .prepare(
      `SELECT b.*, s.name service_name FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.source = 'online'${BSF} ORDER BY b.created_at DESC LIMIT 6`
    )
    .all();
  const waitingList = db.prepare(
    `SELECT w.*, s.name service_name, st.name staff_name FROM waitlist w JOIN services s ON s.id = w.service_id
     LEFT JOIN staff st ON st.id = w.staff_id WHERE w.status IN ('waiting','notified') AND w.date >= ? ORDER BY w.date, w.created_at LIMIT 10`
  ).all(d);
  res.render('admin/dashboard', { waitingList: own ? [] : waitingList, stats, upcoming: upcoming.filter((b) => b.date !== d), recent, d, todayList, pendingList, nowMin });
});

router.post('/lista-espera/:id/remover', (req, res) => {
  db.prepare("UPDATE waitlist SET status = 'removed' WHERE id = ?").run(+req.params.id);
  back(res, '/admin', 'Removido da lista de espera.');
});

// ---------- Estatísticas ----------
router.get('/estatisticas', (req, res) => {
  const period = [30, 90, 365].includes(+req.query.periodo) ? +req.query.periodo : 30;
  const to = today();
  const from = addDays(to, -(period - 1));
  const { workWindows } = require('../availability');
  const rows = db.prepare(
    `SELECT b.*, s.name service_name FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.date BETWEEN ? AND ?`
  ).all(from, to);
  const live = rows.filter((b) => b.status !== 'cancelled');
  const count = (st) => rows.filter((b) => b.status === st).length;
  const completed = count('completed'), noShow = count('no_show'), cancelled = count('cancelled');
  const revenue = rows.filter((b) => b.status === 'completed').reduce((a, b) => a + b.price_cents, 0);
  const online = live.filter((b) => b.source === 'online').length;

  // ocupação por profissional (minutos marcados / minutos de trabalho, já sem bloqueios e feriados)
  const staff = db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY sort, name').all();
  const blocks = db.prepare('SELECT * FROM blocks WHERE date_from <= ? AND date_to >= ?').all(to, from);
  const occupancy = staff.map((p) => {
    let avail = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const bl = blocks.filter((x) => (!x.staff_id || x.staff_id === p.id) && x.date_from <= d && x.date_to >= d);
      for (const [a, z] of workWindows(d, p.id)) {
        let m = z - a;
        for (const x of bl) { const s0 = x.start_min ?? 0, e0 = x.end_min ?? 1440; m -= Math.max(0, Math.min(z, e0) - Math.max(a, s0)); }
        avail += Math.max(0, m);
      }
    }
    const booked = live.filter((b) => b.staff_id === p.id).reduce((acc, b) => acc + (b.end_min - b.start_min), 0);
    return { name: p.name, color: p.color, booked, avail, pct: avail ? Math.round((booked / avail) * 100) : 0, n: live.filter((b) => b.staff_id === p.id).length };
  });
  const totalAvail = occupancy.reduce((a, o) => a + o.avail, 0);
  const totalBooked = occupancy.reduce((a, o) => a + o.booked, 0);

  // série temporal: por semana (ou por mês no período de 1 ano)
  const monthly = period === 365;
  const buckets = [];
  if (monthly) {
    for (let i = 11; i >= 0; i--) { const dt = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1 - i, 1)); buckets.push({ key: dt.toISOString().slice(0, 7), label: t0month(dt) }); }
  } else {
    let m = addDays(from, -((weekday(from) + 6) % 7));
    while (m <= to) { buckets.push({ key: m, label: m.slice(8) + '/' + m.slice(5, 7) }); m = addDays(m, 7); }
  }
  for (const bk of buckets) bk.n = 0;
  for (const b of live) {
    const key = monthly ? b.date.slice(0, 7) : addDays(b.date, -((weekday(b.date) + 6) % 7));
    const bk = buckets.find((x) => x.key === key);
    if (bk) bk.n++;
  }

  const bySvc = {};
  for (const b of live) { const o = (bySvc[b.service_name] ||= { name: b.service_name, n: 0, rev: 0 }); o.n++; if (b.status === 'completed') o.rev += b.price_cents; }
  const services = Object.values(bySvc).sort((a, b) => b.n - a.n);
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, n: 0 }));
  for (const b of live) { const h = hours[Math.floor(b.start_min / 60)]; if (h) h.n++; }
  const hourRange = hours.filter((h) => h.n);
  const hMin = hourRange.length ? hourRange[0].h : 9, hMax = hourRange.length ? hourRange[hourRange.length - 1].h : 18;

  const emails = [...new Set(live.map((b) => b.customer_email.toLowerCase()).filter((e) => e.includes('@') && !e.endsWith('@removido.invalid')))];
  const firstSeen = db.prepare('SELECT lower(customer_email) e, MIN(date) d FROM bookings GROUP BY lower(customer_email)').all();
  const firstMap = Object.fromEntries(firstSeen.map((r) => [r.e, r.d]));
  const newClients = emails.filter((e) => firstMap[e] >= from).length;

  res.render('admin/stats', {
    period, from, to, monthly,
    k: { total: live.length, completed, noShow, cancelled, revenue, online, noShowRate: completed + noShow ? Math.round((noShow / (completed + noShow)) * 100) : 0,
      cancelRate: rows.length ? Math.round((cancelled / rows.length) * 100) : 0, occupancy: totalAvail ? Math.round((totalBooked / totalAvail) * 100) : 0,
      clients: emails.length, newClients, avg: completed ? Math.round(revenue / completed) : 0 },
    occupancy, buckets, services, hours: hours.filter((h) => h.h >= hMin && h.h <= hMax),
  });
});
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function t0month(dt) { return MONTHS_SHORT[dt.getUTCMonth()]; }

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
/** Mover uma marcação (arrastar na agenda ou encaixe manual): mesmas validações nos dois caminhos. */
function moveBooking(req, b, { date, start, staffId, force }) {
  const own = ownStaff(req);
  if (own && (b.staff_id !== own || staffId !== own)) return { ok: false, code: 403, error: 'Só pode mover as suas marcações.' };
  if (!isDate(date) || !Number.isInteger(start) || start < 0 || start + b.duration_min > 24 * 60) return { ok: false, code: 400, error: 'Data ou hora inválida.' };
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) return { ok: false, code: 400, error: 'Profissional inválido.' };
  const end = start + b.duration_min;
  if (!force && busyIntervals(staffId, date, { ignoreBookingId: b.id }).some(([s0, e0]) => start < e0 && end > s0)) {
    return { ok: false, code: 409, error: 'Colide com outra marcação ou bloqueio.' };
  }
  db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ?, updated_at = datetime('now') WHERE id = ?").run(date, start, end, staffId, b.id);
  return { ok: true };
}

router.post('/api/reagendar', (req, res) => {
  const b = getBooking(+req.body.id);
  if (!b) return res.status(404).json({ error: 'Marcação não encontrada.' });
  const r = moveBooking(req, b, { date: String(req.body.date || ''), start: +req.body.start, staffId: +req.body.staffId || b.staff_id, force: !!req.body.force });
  if (!r.ok) return res.status(r.code).json({ error: r.error });
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
       JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id ${ownStaff(req) ? 'WHERE b.staff_id = ' + ownStaff(req) : ''} ORDER BY b.date, b.start_min`
    )
    .all();
  const { minToTime } = require('../time');
  // valores que começam por = + - @ (ou tab/CR) seriam fórmulas no Excel: prefixar com '
  const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
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
  if (ownStaff(req)) req.body.staffId = String(ownStaff(req));
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
      // repetição: semanal / de 2 em 2 semanas, com o mesmo profissional
      const every = { semanal: 7, quinzenal: 14 }[req.body.repeat];
      const times = Math.max(1, Math.min(26, +req.body.repeat_count || 1));
      if (every && times > 1) {
        const series = require('node:crypto').randomBytes(8).toString('hex');
        db.prepare('UPDATE bookings SET series_id = ? WHERE id = ?').run(series, b.id);
        const skipped = [];
        let made = 1;
        for (let i = 1; i < times; i++) {
          const d = addDays(form.date, every * i);
          try {
            const nb = createBooking({ ...form, date: d, start, staffId: b.staff_id, email: form.email || '—', phone: form.phone || '—' }, { source: 'admin', force: form.force });
            db.prepare('UPDATE bookings SET series_id = ? WHERE id = ?').run(series, nb.id);
            made++;
          } catch (e) {
            if (!(e instanceof BookingError)) throw e;
            skipped.push(d);
          }
        }
        const msg = `Criadas ${made} marcações em série.` + (skipped.length ? ` Sem vaga (não criadas): ${skipped.map((d) => d.slice(8) + '/' + d.slice(5, 7)).join(', ')}.` : '');
        return back(res, `/admin/marcacoes/${b.id}`, msg);
      }
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
  const series = b.series_id ? db.prepare('SELECT id, date, start_min, status FROM bookings WHERE series_id = ? ORDER BY date').all(b.series_id) : [];
  res.render('admin/booking', { series, b, history, ...formData(), error: req.query.erro || null });
});

router.post('/marcacoes/:id', (req, res, next) => {
  const b = getBooking(+req.params.id);
  if (!b) return next();
  const action = req.body.action;

  if (action === 'status' && STATUS[req.body.status]) {
    db.prepare("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.status, b.id);
    require('../packages').onStatusChange(b, req.body.status);
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
    const r = moveBooking(req, b, { date: clean(req.body.date, 10), start: timeToMin(req.body.time), staffId: +req.body.staffId || b.staff_id, force: req.body.force === '1' });
    if (!r.ok) return res.redirect(`/admin/marcacoes/${b.id}?erro=` + encodeURIComponent(r.code === 409 ? r.error + ' Ative "Ignorar conflitos" para forçar.' : r.error));
    return back(res, `/admin/marcacoes/${b.id}`, 'Marcação reagendada.');
  }

  if (action === 'cancel_series' && b.series_id) {
    const r = db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE series_id = ? AND date >= ? AND status IN ('pending','confirmed')").run(b.series_id, b.date);
    return back(res, `/admin/marcacoes/${b.id}`, `${r.changes} marcações da série canceladas (esta e as seguintes).`);
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
  const cpacks = db.prepare('SELECT cp.*, p.name, s.name service_name FROM client_packages cp JOIN packages p ON p.id = cp.package_id JOIN services s ON s.id = p.service_id WHERE cp.email = ? ORDER BY cp.purchased_at DESC').all(email);
  const packages = db.prepare('SELECT p.*, s.name service_name FROM packages p JOIN services s ON s.id = p.service_id WHERE p.active = 1 ORDER BY s.sort').all();
  res.render('admin/client', { c, bookings, notes, d, cpacks, packages });
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
  const packages = db.prepare('SELECT p.*, s.name service_name, (SELECT COUNT(*) FROM client_packages cp WHERE cp.package_id = p.id) sold FROM packages p JOIN services s ON s.id = p.service_id ORDER BY s.sort, p.sessions').all();
  res.render('admin/services', { services, packages });
});

// pacotes de sessões
function packageFromBody(b) {
  return [clean(b.name, 120), +b.service_id, Math.max(1, Math.min(100, +b.sessions || 1)), Math.round((parseFloat(String(b.price).replace(',', '.')) || 0) * 100), Math.max(1, Math.min(1825, +b.validity_days || 365)), b.active ? 1 : 0];
}
router.post('/pacotes', (req, res) => {
  const v = packageFromBody(req.body);
  if (!v[0] || !v[1]) return back(res, '/admin/servicos#pacotes', 'Indique o nome e o serviço do pacote.');
  db.prepare('INSERT INTO packages(name, service_id, sessions, price_cents, validity_days, active) VALUES (?,?,?,?,?,?)').run(...v);
  back(res, '/admin/servicos#pacotes', 'Pacote criado.');
});
router.post('/pacotes/:id', (req, res) => {
  const id = +req.params.id;
  if (req.body.action === 'delete') {
    const sold = db.prepare('SELECT COUNT(*) c FROM client_packages WHERE package_id = ?').get(id).c;
    if (sold) db.prepare('UPDATE packages SET active = 0 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM packages WHERE id = ?').run(id);
    return back(res, '/admin/servicos#pacotes', sold ? 'Pacote desativado (já foi vendido).' : 'Pacote apagado.');
  }
  db.prepare('UPDATE packages SET name = ?, service_id = ?, sessions = ?, price_cents = ?, validity_days = ?, active = ? WHERE id = ?').run(...packageFromBody(req.body), id);
  back(res, '/admin/servicos#pacotes', 'Pacote guardado.');
});
router.post('/clientes/pacote', (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  const back2 = '/admin/clientes/ficha?email=' + encodeURIComponent(email);
  if (req.body.action === 'remove') {
    db.prepare('DELETE FROM client_packages WHERE id = ? AND email = ?').run(+req.body.id, email);
    return back(res, back2, 'Pacote removido.');
  }
  if (req.body.action === 'adjust') {
    db.prepare('UPDATE client_packages SET sessions_used = MAX(0, MIN(sessions_total, sessions_used + ?)) WHERE id = ? AND email = ?').run(+req.body.delta || 0, +req.body.id, email);
    return back(res, back2, 'Sessões ajustadas.');
  }
  const p = db.prepare('SELECT * FROM packages WHERE id = ?').get(+req.body.package_id);
  if (!p) return back(res, back2, 'Escolha um pacote.');
  db.prepare("INSERT INTO client_packages(email, package_id, sessions_total, price_cents, expires_at, notes) VALUES (?,?,?,?, date('now', ?), ?)")
    .run(email, p.id, p.sessions, p.price_cents, `+${p.validity_days} days`, clean(req.body.notes, 300));
  back(res, back2, `Pacote "${p.name}" atribuído.`);
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
  const base = res.locals.baseUrl;
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

// ---------- Utilizadores (só dono) ----------
// a palavra-passe temporária é mostrada na própria resposta (nunca num URL, que fica no histórico e nos registos)
function renderUsers(req, res, { error = null, created = null } = {}) {
  const users = db.prepare('SELECT u.id, u.name, u.email, u.role, u.staff_id, s.name staff_name FROM users u LEFT JOIN staff s ON s.id = u.staff_id ORDER BY u.role, u.name').all();
  const staff = db.prepare('SELECT id, name FROM staff WHERE active = 1 ORDER BY sort, name').all();
  res.set('Cache-Control', 'no-store');
  res.render('admin/users', { users, staff, error, created });
}
router.get('/utilizadores', (req, res) => {
  const users = db.prepare('SELECT u.id, u.name, u.email, u.role, u.staff_id, s.name staff_name FROM users u LEFT JOIN staff s ON s.id = u.staff_id ORDER BY u.role, u.name').all();
  const staff = db.prepare('SELECT id, name FROM staff WHERE active = 1 ORDER BY sort, name').all();
  res.render('admin/users', { users, staff, error: req.query.erro || null, created: null });
});
router.post('/utilizadores', (req, res) => {
  const name = clean(req.body.name, 120), email = clean(req.body.email, 160).toLowerCase();
  const role = ROLE_LABEL[req.body.role] ? req.body.role : 'reception';
  const staffId = role === 'staff' ? +req.body.staff_id || null : null;
  const fail = (m) => res.redirect('/admin/utilizadores?erro=' + encodeURIComponent(m));
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Indique o nome e um email válido.');
  if (role === 'staff' && !staffId) return fail('Escolha o profissional associado.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('Já existe um utilizador com esse email.');
  const temp = require('node:crypto').randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users(name, email, password_hash, role, staff_id) VALUES (?,?,?,?,?)').run(name, email, hashPassword(temp), role, staffId);
  require('../mailer').send({ to: email, subject: `Acesso ao back office · ${getSettings().business_name}`, text: `Olá ${name},\n\nFoi criado um acesso para si.\n\nEndereço: ${(process.env.BASE_URL || '')}/admin\nEmail: ${email}\nPalavra-passe temporária: ${temp}\n\nAltere-a em "A minha conta" depois de entrar.` });
  renderUsers(req, res, { created: `${email} · palavra-passe temporária: ${temp}` });
});
router.post('/utilizadores/:uid', (req, res) => {
  const uid = +req.params.uid;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) return res.redirect('/admin/utilizadores');
  const owners = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner'").get().c;
  const fail = (m) => res.redirect('/admin/utilizadores?erro=' + encodeURIComponent(m));
  if (req.body.action === 'delete') {
    if (uid === req.user.id) return fail('Não pode remover a sua própria conta.');
    if (u.role === 'owner' && owners <= 1) return fail('Tem de existir pelo menos um dono.');
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    return back(res, '/admin/utilizadores', 'Utilizador removido.');
  }
  if (req.body.action === 'reset') {
    const temp = require('node:crypto').randomBytes(6).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(temp), uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    return renderUsers(req, res, { created: `${u.email} · nova palavra-passe temporária: ${temp}` });
  }
  const role = ROLE_LABEL[req.body.role] ? req.body.role : u.role;
  if (u.role === 'owner' && role !== 'owner' && owners <= 1) return fail('Tem de existir pelo menos um dono.');
  const staffId = role === 'staff' ? +req.body.staff_id || null : null;
  if (role === 'staff' && !staffId) return fail('Escolha o profissional associado.');
  db.prepare('UPDATE users SET name = ?, role = ?, staff_id = ? WHERE id = ?').run(clean(req.body.name, 120) || u.name, role, staffId, uid);
  back(res, '/admin/utilizadores', 'Utilizador guardado.');
});

// a minha conta (todos os papéis)
router.get('/conta', (req, res) => res.render('admin/account', { error: req.query.erro || null }));

// ---------- Definições ----------
router.get('/definicoes', (req, res) => res.render('admin/settings', { error: req.query.erro || null }));
router.post('/definicoes', (req, res) => {
  const numeric = {
    slot_step: [5, 120], min_notice_hours: [0, 720], max_days_ahead: [1, 365], buffer_min: [0, 120], cancel_hours: [0, 720],
    reminder_hours: [0, 168], review_delay_hours: [0, 168], max_online_per_email: [1, 50], deposit_value: [0, 100000], payment_timeout_min: [30, 1440],
  };
  const checkboxes = ['auto_confirm', 'demo_mode', 'auto_holidays', 'reminder_sms', 'lang_en'];
  const urls = ['review_url', 'complaints_url'];
  const section = String(req.body._section || '');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'brand_logo') continue;
    if (checkboxes.includes(key)) { if (section && req.body[`has_${key}`]) setSetting(key, req.body[key] ? '1' : '0'); continue; }
    if (!(key in req.body)) continue;
    let v = clean(req.body[key], 2000);
    if (numeric[key]) {
      const n = key === 'deposit_value' ? parseFloat(v.replace(',', '.')) : parseInt(v, 10);
      v = String(Math.max(numeric[key][0], Math.min(numeric[key][1], Number.isFinite(n) ? n : 0)));
    }
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

router.post('/conta/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.body.current, u.password_hash)) return res.redirect('/admin/conta?erro=' + encodeURIComponent('Palavra-passe atual incorreta.'));
  if (String(req.body.next || '').length < 8) return res.redirect('/admin/conta?erro=' + encodeURIComponent('A nova palavra-passe deve ter pelo menos 8 caracteres.'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.next), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, req.session.token);
  back(res, '/admin/conta', 'Palavra-passe alterada.');
});

module.exports = router;
