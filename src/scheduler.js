'use strict';
/* Tarefas automáticas (correm a cada 5 minutos dentro do próprio servidor). */
const path = require('node:path');
const fs = require('node:fs');
const { db, getSettings } = require('./db');
const { nowIn, diffDays, addDays } = require('./time');
const { getSlots, getBooking } = require('./availability');
const mailer = require('./mailer');

const minutesUntil = (now, date, min) => diffDays(now.date, date) * 1440 + min - now.min;

function reminders(now) {
  const hours = +getSettings().reminder_hours || 0;
  if (!hours) return 0;
  const rows = db.prepare(
    `SELECT id, date, start_min, created_at FROM bookings
     WHERE status = 'confirmed' AND reminder_sent_at IS NULL AND date BETWEEN ? AND ?`
  ).all(now.date, addDays(now.date, Math.ceil(hours / 24) + 1));
  let n = 0;
  for (const r of rows) {
    const m = minutesUntil(now, r.date, r.start_min);
    // só se faltar menos do que a antecedência definida, e se a marcação não foi feita há menos de 1 h
    if (m <= 0 || m > hours * 60) continue;
    if (Date.now() - Date.parse(r.created_at.replace(' ', 'T') + 'Z') < 60 * 60 * 1000) continue;
    db.prepare("UPDATE bookings SET reminder_sent_at = datetime('now') WHERE id = ?").run(r.id);
    // se o email falhar (ex.: SMTP em baixo), volta a tentar na próxima ronda
    Promise.resolve(mailer.sendReminder(getBooking(r.id))).then((ok) => { if (ok === false) db.prepare('UPDATE bookings SET reminder_sent_at = NULL WHERE id = ?').run(r.id); });
    n++;
  }
  return n;
}

function reviews(now) {
  const st = getSettings();
  if (!st.review_url) return 0;
  const delay = (+st.review_delay_hours || 0) * 60;
  const rows = db.prepare(
    `SELECT id, date, end_min, customer_email FROM bookings
     WHERE status = 'completed' AND review_sent_at IS NULL AND date BETWEEN ? AND ?`
  ).all(addDays(now.date, -7), now.date);
  let n = 0;
  for (const r of rows) {
    if (-minutesUntil(now, r.date, r.end_min) < delay) continue;
    const recent = db.prepare(
      `SELECT 1 FROM bookings WHERE lower(customer_email) = lower(?) AND review_sent_at >= datetime('now', '-180 days') LIMIT 1`
    ).get(r.customer_email);
    if (recent) { // no máximo um pedido a cada 6 meses por pessoa; '0' marca "saltado" sem contar como enviado
      db.prepare("UPDATE bookings SET review_sent_at = '0' WHERE id = ?").run(r.id);
      continue;
    }
    db.prepare("UPDATE bookings SET review_sent_at = datetime('now') WHERE id = ?").run(r.id);
    mailer.sendReviewRequest(getBooking(r.id));
    n++;
  }
  return n;
}

function waitlist(now) {
  db.prepare("UPDATE waitlist SET status = 'removed' WHERE status IN ('waiting','notified') AND date < ?").run(now.date);
  const rows = db.prepare("SELECT w.*, s.name service_name FROM waitlist w JOIN services s ON s.id = w.service_id WHERE w.status = 'waiting' ORDER BY w.created_at").all();
  let n = 0;
  for (const w of rows) {
    if (!getSlots({ serviceId: w.service_id, staffId: w.staff_id, date: w.date }).length) continue;
    mailer.sendWaitlistOpening(w, w.service_name);
    db.prepare("UPDATE waitlist SET status = 'notified', notified_at = datetime('now') WHERE id = ?").run(w.id);
    n++;
  }
  return n;
}

function expirePayments() {
  const timeout = Math.max(30, +getSettings().payment_timeout_min || 30); // o mesmo prazo da sessão Stripe
  const r = db.prepare(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'expired', updated_at = datetime('now'),
       internal_notes = trim(internal_notes || ' [Cancelada: pagamento não concluído]')
     WHERE payment_status = 'pending' AND status = 'pending' AND created_at <= datetime('now', ?)`
  ).run(`-${timeout} minutes`);
  return r.changes;
}

const BACKUP_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db')), 'backups');
function backup({ force = false, keep = 14 } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `app-${day}.db`);
  if (fs.existsSync(file) && !force) return null;
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(BACKUP_DIR, f));
  return file;
}

function runJobs() {
  const now = nowIn(getSettings().timezone);
  const out = { expired: expirePayments(), reminders: reminders(now), reviews: reviews(now), waitlist: waitlist(now) };
  if (process.env.BACKUPS !== '0') out.backup = backup();
  return out;
}

function start(intervalMs = 5 * 60 * 1000) {
  const tick = () => { try { const r = runJobs(); if (Object.values(r).some(Boolean)) console.log('[tarefas]', r); } catch (e) { console.error('[tarefas] erro:', e); } };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, intervalMs).unref();
}

module.exports = { runJobs, start, backup, reminders, reviews, waitlist, expirePayments, BACKUP_DIR };
