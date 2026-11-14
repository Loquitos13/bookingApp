'use strict';
/**
 * Dados de demonstração FICTÍCIOS. As datas são relativas a hoje, para a demo nunca parecer desatualizada.
 * Nenhum nome, contacto ou mensagem corresponde a pessoas reais.
 */
const { db, getSettings, tx } = require('./db');
const { nowIn, addDays, weekday } = require('./time');
const { bookingRef, randomToken } = require('./security');

const FIRST = ['Rita', 'João', 'Marta', 'Tiago', 'Sofia', 'Pedro', 'Beatriz', 'Rui', 'Carolina', 'Nuno', 'Leonor', 'André', 'Inês', 'Hugo', 'Mariana', 'Duarte', 'Catarina', 'Filipe'];
const LAST = ['Almeida', 'Fonseca', 'Martins', 'Lopes', 'Carvalho', 'Teixeira', 'Moreira', 'Pinto', 'Gomes', 'Barbosa', 'Rocha', 'Correia'];
const NOTES = ['', '', '', 'Dor lombar há duas semanas.', 'Pós-operatório ao joelho.', 'Primeira vez, vem por recomendação.', '', 'Prefere fim do dia.'];

/** gerador pseudo-aleatório determinístico (a demo é sempre igual) */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function seedDemo() {
  const st = getSettings();
  const today = nowIn(st.timezone).date;
  const rand = rng(20261114);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const services = db.prepare('SELECT * FROM services WHERE active = 1').all();
  const links = db.prepare('SELECT * FROM staff_services').all();
  const hours = Object.fromEntries(db.prepare('SELECT * FROM hours').all().map((h) => [h.weekday, h]));
  const step = +st.slot_step || 15;

  const ins = db.prepare(
    `INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, price_cents, customer_name,
      customer_email, customer_phone, notes, status, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', ?))`
  );

  tx(() => {
    db.exec('DELETE FROM bookings; DELETE FROM messages; DELETE FROM blocks;');
    for (let off = -12; off <= 21; off++) {
      const date = addDays(today, off);
      const h = hours[weekday(date)];
      if (!h || h.closed) continue;
      const windows = h.break_start != null ? [[h.open_min, h.break_start], [h.break_end, h.close_min]] : [[h.open_min, h.close_min]];
      // ocupação: mais cheia nos próximos dias, a esvaziar ao longo das semanas
      const fill = off < 0 ? 0.55 : off <= 3 ? 0.45 : off <= 10 ? 0.3 : 0.15;
      const busy = {};
      const attempts = Math.round(18 * fill);
      for (let n = 0; n < attempts; n++) {
        const svc = pick(services);
        const staffIds = links.filter((l) => l.service_id === svc.id).map((l) => l.staff_id);
        if (!staffIds.length) continue;
        const staffId = pick(staffIds);
        const [ws, we] = pick(windows);
        const slots = Math.floor((we - ws - svc.duration_min) / step);
        if (slots < 0) continue;
        const start = ws + Math.floor(rand() * (slots + 1)) * step;
        const end = start + svc.duration_min;
        const list = (busy[staffId] ||= []);
        if (list.some(([a, b]) => start < b && end > a)) continue;
        if (off === 0 && start < nowIn(st.timezone).min - 60 && rand() < 0.2) continue;
        list.push([start, end]);

        let status = 'confirmed';
        if (off < 0) status = rand() < 0.86 ? 'completed' : rand() < 0.5 ? 'no_show' : 'cancelled';
        else if (rand() < 0.12) status = 'pending';
        else if (rand() < 0.06) status = 'cancelled';
        const first = pick(FIRST), last = pick(LAST);
        const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemplo.pt';
        const phone = `9${Math.floor(10000000 + rand() * 89999999)}`.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
        ins.run(
          bookingRef(), randomToken(), svc.id, staffId, date, start, end, svc.price_cents, `${first} ${last}`,
          email, phone, pick(NOTES), status, rand() < 0.7 ? 'online' : 'admin', `${Math.min(off, 0) - Math.ceil(rand() * 6)} days`
        );
      }
    }

    // um dia quase cheio para um profissional: a demo mostra o aviso "Última vaga" no painel
    const busiest = db.prepare('SELECT id FROM staff WHERE active = 1 ORDER BY sort LIMIT 1 OFFSET 1').get();
    let fullDay = addDays(today, 1);
    while (!hours[weekday(fullDay)] || hours[weekday(fullDay)].closed) fullDay = addDays(fullDay, 1);
    if (busiest) {
      const h = hours[weekday(fullDay)];
      const mine = services.filter((sv) => links.some((l) => l.staff_id === busiest.id && l.service_id === sv.id));
      db.prepare('DELETE FROM bookings WHERE staff_id = ? AND date = ?').run(busiest.id, fullDay);
      const windows = h.break_start != null ? [[h.open_min, h.break_start], [h.break_end, h.close_min]] : [[h.open_min, h.close_min]];
      const gapStart = windows[0][0] + 60; // só fica livre uma hora a meio da manhã
      const bySize = [...mine].sort((a, b) => b.duration_min - a.duration_min);
      for (const [ws, we] of windows) {
        let t = ws;
        while (t < we) {
          if (t >= gapStart && t < gapStart + 60) { t = gapStart + 60; continue; }
          const limit = t < gapStart ? Math.min(we, gapStart) : we;
          const svc = bySize.find((sv) => t + sv.duration_min <= limit);
          if (!svc) break;
          const first = pick(FIRST), last = pick(LAST);
          ins.run(bookingRef(), randomToken(), svc.id, busiest.id, fullDay, t, t + svc.duration_min, svc.price_cents, `${first} ${last}`,
            `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '@exemplo.pt', '910 000 000', '', 'confirmed', 'online', '-2 days');
          t += svc.duration_min;
        }
      }
    }

    const msg = db.prepare("INSERT INTO messages(name, email, phone, message, read, created_at) VALUES (?,?,?,?,?, datetime('now', ?))");
    msg.run('Helena Vaz', 'helena.vaz@exemplo.pt', '', 'Bom dia, aceitam o seguro de saúde da minha empresa? Obrigada.', 0, '-3 hours');
    msg.run('Carlos Moura', 'carlos.moura@exemplo.pt', '913 000 111', 'É possível marcar duas sessões seguidas para mim e para o meu filho?', 0, '-1 day');
    msg.run('Joana Reis', 'joana.reis@exemplo.pt', '', 'Têm estacionamento perto? Vou de carro na próxima semana.', 1, '-4 days');

    const block = db.prepare('INSERT INTO blocks(staff_id, date_from, date_to, start_min, end_min, reason) VALUES (?,?,?,?,?,?)');
    let d = addDays(today, 16);
    while (weekday(d) !== 1) d = addDays(d, 1);
    block.run(null, d, d, null, null, 'Feriado (exemplo)');
    const staff2 = db.prepare('SELECT id FROM staff ORDER BY sort LIMIT 1 OFFSET 1').get();
    if (staff2) block.run(staff2.id, addDays(today, 24), addDays(today, 30), null, null, 'Férias (exemplo)');
  });
}

module.exports = { seedDemo };
