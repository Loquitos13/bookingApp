'use strict';
const { db, getSettings, tx } = require('./db');
const { weekday, nowIn, addDays, diffDays, minToTime } = require('./time');
const { bookingRef, randomToken } = require('./security');

const ACTIVE_STATUSES = "('pending','confirmed','completed')";

function staffForService(serviceId) {
  return db
    .prepare(
      `SELECT s.* FROM staff s JOIN staff_services ss ON ss.staff_id = s.id
       WHERE ss.service_id = ? AND s.active = 1 ORDER BY s.sort, s.name`
    )
    .all(serviceId);
}

/** Janelas de trabalho [início, fim] num dia, já sem a pausa de almoço. */
function workWindows(date) {
  const h = db.prepare('SELECT * FROM hours WHERE weekday = ?').get(weekday(date));
  if (!h || h.closed) return [];
  const { open_min: o, close_min: c, break_start: bs, break_end: be } = h;
  if (bs != null && be != null && bs > o && be < c && be > bs) return [[o, bs], [be, c]];
  return [[o, c]];
}

/** Intervalos ocupados (marcações + bloqueios) de um profissional num dia. */
function busyIntervals(staffId, date, { ignoreBookingId = null } = {}) {
  const buffer = +getSettings().buffer_min || 0;
  const out = db
    .prepare(
      `SELECT start_min, end_min FROM bookings
       WHERE staff_id = ? AND date = ? AND status IN ${ACTIVE_STATUSES} AND id IS NOT ?`
    )
    .all(staffId, date, ignoreBookingId)
    .map((b) => [b.start_min, b.end_min + buffer]);
  const blocks = db
    .prepare(
      `SELECT start_min, end_min FROM blocks
       WHERE (staff_id IS NULL OR staff_id = ?) AND date_from <= ? AND date_to >= ?`
    )
    .all(staffId, date, date);
  for (const b of blocks) out.push(b.start_min == null ? [0, 24 * 60] : [b.start_min, b.end_min]);
  return out;
}

const overlaps = (s, e, list) => list.some(([a, b]) => s < b && e > a);

/**
 * Horários livres para um serviço numa data.
 * @returns {Array<{start:number,time:string,staff:number[]}>}
 */
function getSlots({ serviceId, staffId = null, date, forAdmin = false }) {
  const st = getSettings();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!svc || (!svc.active && !forAdmin)) return [];

  const now = nowIn(st.timezone);
  const ahead = diffDays(now.date, date);
  if (!forAdmin && (ahead < 0 || ahead > +st.max_days_ahead)) return [];

  let staff = staffForService(serviceId);
  if (staffId) staff = staff.filter((s) => s.id === +staffId);
  if (!staff.length) return [];

  const step = Math.max(5, +st.slot_step || 15);
  const buffer = +st.buffer_min || 0;
  // antecedência mínima (pode passar para o(s) dia(s) seguinte(s))
  const noticeAbs = now.min + +st.min_notice_hours * 60;
  const dayOffsetMin = ahead * 1440;
  const busy = new Map(staff.map((s) => [s.id, busyIntervals(s.id, date)]));

  const slots = [];
  for (const [ws, we] of workWindows(date)) {
    for (let t = ws; t + svc.duration_min <= we; t += step) {
      if (!forAdmin && dayOffsetMin + t < noticeAbs) continue;
      const end = t + svc.duration_min;
      const free = staff.filter((s) => !overlaps(t, end + buffer, busy.get(s.id))).map((s) => s.id);
      if (free.length) slots.push({ start: t, time: minToTime(t), staff: free });
    }
  }
  return slots;
}

/** Próximos dias (até `days`) com pelo menos um horário livre — para o calendário público. */
function availableDays({ serviceId, staffId = null, from, days = 42 }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (getSlots({ serviceId, staffId, date: d }).length) out.push(d);
  }
  return out;
}

class BookingError extends Error {}

/** Cria uma marcação de forma atómica, revalidando a disponibilidade. */
function createBooking(input, { source = 'online', force = false } = {}) {
  const st = getSettings();
  return tx(() => {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(input.serviceId);
    if (!svc) throw new BookingError('Serviço inválido.');
    let staffId = input.staffId ? +input.staffId : null;

    if (!force) {
      const slot = getSlots({
        serviceId: svc.id, staffId, date: input.date, forAdmin: source === 'admin',
      }).find((s) => s.start === input.start);
      if (!slot) throw new BookingError('Esse horário acabou de ficar indisponível. Por favor escolha outro.');
      if (!staffId) {
        // distribuir: escolhe o profissional livre com menos marcações nesse dia
        const counts = db
          .prepare(`SELECT staff_id, COUNT(*) c FROM bookings WHERE date = ? AND status IN ${ACTIVE_STATUSES} GROUP BY staff_id`)
          .all(input.date);
        const c = Object.fromEntries(counts.map((r) => [r.staff_id, r.c]));
        staffId = [...slot.staff].sort((a, b) => (c[a] || 0) - (c[b] || 0))[0];
      }
    } else if (!staffId) {
      throw new BookingError('Escolha o profissional.');
    }

    const status = source === 'admin' || st.auto_confirm === '1' ? 'confirmed' : 'pending';
    const ref = bookingRef();
    const token = randomToken();
    const info = db
      .prepare(
        `INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, price_cents,
          customer_name, customer_email, customer_phone, notes, internal_notes, status, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        ref, token, svc.id, staffId, input.date, input.start, input.start + svc.duration_min, svc.price_cents,
        input.name, input.email, input.phone, input.notes || '', input.internalNotes || '', status, source
      );
    return getBooking(Number(info.lastInsertRowid));
  });
}

function getBooking(id) {
  return db
    .prepare(
      `SELECT b.*, s.name service_name, s.duration_min, st.name staff_name, st.color staff_color
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
       WHERE b.id = ?`
    )
    .get(id);
}

/** Pode o cliente cancelar online? (respeita a antecedência mínima de cancelamento) */
function canCustomerCancel(b) {
  if (!['pending', 'confirmed'].includes(b.status)) return false;
  const st = getSettings();
  const now = nowIn(st.timezone);
  const minutesUntil = diffDays(now.date, b.date) * 1440 + b.start_min - now.min;
  return minutesUntil >= +st.cancel_hours * 60;
}

module.exports = {
  getSlots, availableDays, createBooking, getBooking, staffForService, busyIntervals,
  canCustomerCancel, BookingError, ACTIVE_STATUSES,
};
