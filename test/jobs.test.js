'use strict';
// Testes das tarefas automáticas: lembretes, avaliações, lista de espera, pagamentos expirados, cópias de segurança.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-jobs-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
process.env.RATE_LIMIT = '0';

const { db, setSetting } = require('../src/db');
const mailer = require('../src/mailer');
const jobs = require('../src/scheduler');
const { nowIn, addDays, minToTime, weekday } = require('../src/time');
const { holidayName } = require('../src/holidays');

const sent = [];
before(() => {
  console.log = () => {};
  mailer.send = (m) => sent.push(m); // intercepta os emails
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
function insert({ date, start, status = 'confirmed', email = 'cli@teste.pt', created = '-2 days', extra = {} }) {
  n++;
  const cols = { ref: 'T' + n, token: 'tok' + n, service_id: 1, staff_id: 1, date, start_min: start, end_min: start + 60, price_cents: 5000, customer_name: 'Cliente ' + n, customer_email: email, customer_phone: '912345678', status, source: 'online', ...extra };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO bookings(${keys.join(',')}, created_at) VALUES (${keys.map(() => '?').join(',')}, datetime('now', ?))`).run(...Object.values(cols), created);
  return db.prepare('SELECT * FROM bookings WHERE ref = ?').get('T' + n);
}
const now = () => nowIn('Europe/Lisbon');

test('lembrete: enviado uma vez, só dentro da janela e não para marcações acabadas de fazer', () => {
  setSetting('reminder_hours', '24');
  const t = now();
  const inWindow = insert({ date: addDays(t.date, 1), start: t.min }); // daqui a ~24h menos um pouco
  db.prepare('UPDATE bookings SET start_min = ? WHERE id = ?').run(Math.max(0, t.min - 30), inWindow.id);
  const far = insert({ date: addDays(t.date, 5), start: 600 });
  const fresh = insert({ date: addDays(t.date, 1), start: Math.max(0, t.min - 30), created: '-10 minutes' });
  sent.length = 0;
  jobs.reminders(t);
  const got = (id) => db.prepare('SELECT reminder_sent_at FROM bookings WHERE id = ?').get(id).reminder_sent_at;
  assert.ok(got(inWindow.id), 'deve enviar o lembrete');
  assert.equal(got(far.id), null);
  assert.equal(got(fresh.id), null);
  assert.equal(sent.filter((m) => /Lembrete/.test(m.subject)).length, 1);
  jobs.reminders(t);
  assert.equal(sent.filter((m) => /Lembrete/.test(m.subject)).length, 1, 'não repete');
});

test('avaliação: só para concluídas, depois do atraso, no máximo uma por pessoa a cada 6 meses', () => {
  const t = now();
  setSetting('review_url', 'https://g.page/r/exemplo/review');
  setSetting('review_delay_hours', '0');
  const y = addDays(t.date, -1);
  insert({ date: y, start: 600, status: 'completed', email: 'rev@teste.pt' });
  insert({ date: y, start: 720, status: 'completed', email: 'rev@teste.pt' });
  insert({ date: y, start: 600, status: 'no_show', email: 'falta@teste.pt' });
  sent.length = 0;
  jobs.reviews(t);
  const reviews = sent.filter((m) => /Como correu/.test(m.subject));
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].to, 'rev@teste.pt');
});

test('lista de espera: avisa quando há vaga e não volta a avisar', () => {
  const t = now();
  let d = addDays(t.date, 3);
  while ([0, 6].includes(weekday(d)) || holidayName(d)) d = addDays(d, 1);
  db.prepare("INSERT INTO waitlist(token, service_id, staff_id, date, name, email) VALUES ('w1', 1, NULL, ?, 'Espera', 'espera@teste.pt')").run(d);
  sent.length = 0;
  jobs.waitlist(t);
  assert.equal(sent.filter((m) => /Vagou/.test(m.subject)).length, 1);
  assert.equal(db.prepare("SELECT status FROM waitlist WHERE token = 'w1'").get().status, 'notified');
  jobs.waitlist(t);
  assert.equal(sent.filter((m) => /Vagou/.test(m.subject)).length, 1);
});

test('pagamento não concluído liberta o horário', () => {
  setSetting('payment_timeout_min', '30');
  const t = now();
  const b = insert({ date: addDays(t.date, 2), start: 600, status: 'pending', created: '-45 minutes', extra: { payment_status: 'pending' } });
  const ok = insert({ date: addDays(t.date, 2), start: 720, status: 'pending', created: '-5 minutes', extra: { payment_status: 'pending' } });
  jobs.expirePayments();
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(b.id).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(ok.id).status, 'pending');
});

test('cópia de segurança da base de dados', () => {
  const file = jobs.backup({ force: true });
  assert.ok(fs.existsSync(file));
  assert.ok(fs.statSync(file).size > 1000);
});

test('feriados nacionais calculados (incluindo móveis)', () => {
  assert.equal(holidayName('2026-04-03'), 'Sexta-feira Santa');
  assert.equal(holidayName('2027-03-28'), 'Páscoa');
  assert.equal(holidayName('2026-06-04'), 'Corpo de Deus');
  assert.equal(holidayName('2026-12-08'), 'Imaculada Conceição');
  assert.equal(holidayName('2026-12-09'), null);
  assert.equal(minToTime(0), '00:00');
});
