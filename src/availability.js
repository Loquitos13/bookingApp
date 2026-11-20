'use strict';
const { db, stmt, getSettings, tx } = require('./db');
const { weekday, nowIn, addDays, diffDays, minToTime } = require('./time');
const { bookingRef, randomToken } = require('./security');

const ACTIVE_STATUSES = "('pending','confirmed','completed')";

function staffForService(serviceId) {
  return stmt(
      `SELECT s.* FROM staff s JOIN staff_services ss ON ss.staff_id = s.id
       WHERE ss.service_id = ? AND s.active = 1 ORDER BY s.sort, s.name`
    )
    .all(serviceId);
}

const { holidayName } = require('./holidays');

/** Horário de um dia: o do profissional (se tiver horário próprio) ou o geral do negócio. */
function dayHours(date, staffId = null) {
  const wd = weekday(date);
  if (staffId) {
    const sh = stmt('SELECT * FROM staff_hours WHERE staff_id = ? AND weekday = ?').get(staffId, wd);
    if (sh) return sh;
  }
  return stmt('SELECT * FROM hours WHERE weekday = ?').get(wd);
}
const isHolidayClosed = (date) => getSettings().auto_holidays === '1' && !!holidayName(date);

/** Janelas de trabalho [início, fim] num dia (sem pausa de almoço), por profissional quando aplicável. */
function workWindows(date, staffId = null) {
  if (isHolidayClosed(date)) return [];
  const h = dayHours(date, staffId);
  if (!h || h.closed) return [];
  const { open_min: o, close_min: c, break_start: bs, break_end: be } = h;
  if (bs != null && be != null && bs > o && be < c && be > bs) return [[o, bs], [be, c]];
  return [[o, c]];
}

/** Intervalos ocupados (marcações + bloqueios) de um profissional num dia. */
function busyIntervals(staffId, date, { ignoreBookingId = null } = {}) {
  const buffer = +getSettings().buffer_min || 0;
  const out = stmt(
      `SELECT start_min, end_min FROM bookings
       WHERE staff_id = ? AND date = ? AND status IN ${ACTIVE_STATUSES} AND id IS NOT ?`
    )
    .all(staffId, date, ignoreBookingId)
    .map((b) => [b.start_min, b.end_min + buffer]);
  const blocks = stmt(
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
function getSlots({ serviceId, staffId = null, date, forAdmin = false, ignoreBookingId = null }) {
  const st = getSettings();
  const svc = stmt('SELECT * FROM services WHERE id = ?').get(serviceId);
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
  const busy = new Map(staff.map((s) => [s.id, busyIntervals(s.id, date, { ignoreBookingId })]));

  const byStart = new Map();
  for (const s of staff) {
    for (const [ws, we] of workWindows(date, s.id)) {
      for (let t = ws; t + svc.duration_min <= we; t += step) {
        if (!forAdmin && dayOffsetMin + t < noticeAbs) continue;
        if (overlaps(t, t + svc.duration_min + buffer, busy.get(s.id))) continue;
        if (!byStart.has(t)) byStart.set(t, []);
        byStart.get(t).push(s.id);
      }
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([t, ids]) => ({ start: t, time: minToTime(t), staff: ids }));
}

/** Próximos dias (até `days`) com pelo menos um horário livre — para o calendário público. */
function availableDays({ serviceId, staffId = null, from, days = 42, ignoreBookingId = null, forAdmin = false }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (getSlots({ serviceId, staffId, date: d, ignoreBookingId, forAdmin }).length) out.push(d);
  }
  return out;
}

/** Primeiro horário livre (a partir de hoje) para um serviço/profissional. */
function firstSlot({ serviceId, staffId = null, horizon = null }) {
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  const max = horizon ?? +st.max_days_ahead;
  for (let i = 0; i <= max; i++) {
    const date = addDays(today, i);
    const s = getSlots({ serviceId, staffId, date })[0];
    if (s) return { date, start: s.start, time: s.time, staff: s.staff };
  }
  return null;
}

/** "Próximas partidas": uma vaga por serviço, sem repetir o mesmo dia+hora, ordenadas por data/hora. */
function nextDepartures(limit = 4) {
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all();
  const staffName = Object.fromEntries(db.prepare('SELECT id, name FROM staff').all().map((s) => [s.id, s.name]));
  const used = new Set();
  const out = [];
  for (const svc of services) {
    for (let i = 0; i <= 14; i++) {
      const date = addDays(today, i);
      const slots = getSlots({ serviceId: svc.id, date });
      // afasta-se das horas já mostradas (mínimo 30 min) para o painel mostrar a variedade real
      const s = slots.find((x) => ![...used].some((u) => u.date === date && Math.abs(u.start - x.start) < 30));
      if (!s) continue;
      used.add({ date, start: s.start });
      out.push({ date, start: s.start, time: s.time, service: svc, staffId: s.staff[0], staffName: staffName[s.staff[0]], others: s.staff.length - 1, left: slots.length });
      break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).slice(0, limit);
}

class BookingError extends Error {}

/** Reagenda uma marcação (cliente ou back office), revalidando a disponibilidade de forma atómica. */
function rescheduleBooking(id, { date, start, staffId = null, strictStaff = false }, { forAdmin = false } = {}) {
  return tx(() => {
    const b = getBooking(id);
    if (!b) throw new BookingError('Marcação não encontrada.');
    const slot = getSlots({ serviceId: b.service_id, staffId, date, forAdmin, ignoreBookingId: b.id }).find((s) => s.start === start);
    if (!slot || (strictStaff && !slot.staff.includes(+staffId))) throw new BookingError('Esse horário acabou de ficar indisponível. Escolha outro.');
    const newStaff = staffId && slot.staff.includes(+staffId) ? +staffId : slot.staff.includes(b.staff_id) ? b.staff_id : slot.staff[0];
    db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(date, start, start + b.duration_min, newStaff, b.id);
    return getBooking(b.id);
  });
}

/** Cria uma marcação de forma atómica, revalidando a disponibilidade. */
function createBooking(input, { source = 'online', force = false } = {}) {
  const st = getSettings();
  return tx(() => {
    const svc = stmt('SELECT * FROM services WHERE id = ?').get(input.serviceId);
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
          customer_name, customer_email, customer_phone, notes, internal_notes, status, source, lang)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        ref, token, svc.id, staffId, input.date, input.start, input.start + svc.duration_min, svc.price_cents,
        input.name, input.email, input.phone, input.notes || '', input.internalNotes || '', status, source, input.lang === 'en' ? 'en' : 'pt'
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
  workWindows, dayHours, isHolidayClosed,
  getSlots, availableDays, firstSlot, nextDepartures, createBooking, getBooking, staffForService, busyIntervals,
  canCustomerCancel, rescheduleBooking, BookingError, ACTIVE_STATUSES,
};
