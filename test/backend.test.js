'use strict';
// Regressões da revisão de backend: cada teste reproduz um problema encontrado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-backend-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
process.env.ADMIN_EMAIL = 'dono@teste.pt';
process.env.ADMIN_PASSWORD = 'segredo123';
process.env.RATE_LIMIT = '0';
process.env.BACKUPS = '0';

const app = require('../server');
const { db, setSetting } = require('../src/db');
const { isDate, nowIn, addDays, weekday } = require('../src/time');
const mailer = require('../src/mailer');
const jobs = require('../src/scheduler');

let server, base, csrf, cookie;
before(async () => {
  console.log = () => {};
  console.error = () => {};
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=dono%40teste.pt&password=segredo123' });
  cookie = r.headers.get('set-cookie').split(';')[0];
  csrf = db.prepare('SELECT csrf FROM sessions ORDER BY expires_at DESC').get().csrf;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const form = (o) => new URLSearchParams(o).toString();
const pub = (u, body) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
const adm = (u, body) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: form({ _csrf: csrf, ...body }) });
const ins = (o) => db.prepare(`INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, status)
  VALUES (@ref, @ref, 1, 1, @date, @start, @end, 'Teste', @email, '9', @status)`).run({ start: 600, end: 660, email: 'c@t.pt', status: 'confirmed', ...o }).lastInsertRowid;
function nextWeekday(n = 3) {
  let d = addDays(nowIn().date, n);
  while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
  return d;
}

test('um pedido com dados inválidos não derruba o servidor', async () => {
  const r = await pub('/lista-espera', { serviceId: 1, staffId: 9999, date: nextWeekday(), name: 'Ana', email: 'a@t.pt' });
  assert.equal(r.status, 422);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('datas impossíveis (31 de fevereiro) são recusadas', async () => {
  assert.equal(isDate('2027-02-31'), false);
  assert.equal(isDate('2027-02-28'), true);
  const before = db.prepare('SELECT COUNT(*) c FROM bookings').get().c;
  await pub('/marcar', { serviceId: 1, staffId: 1, date: '2027-02-31', time: '10:00', name: 'Ana', email: 'a@t.pt', phone: '912345678', consent: '1' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bookings').get().c, before);
});

test('apagar uma marcação concluída devolve a sessão do pacote', async () => {
  const pk = db.prepare('SELECT * FROM packages LIMIT 1').get();
  db.prepare("INSERT INTO client_packages(email, package_id, sessions_total, sessions_used) VALUES ('pk@t.pt', ?, 5, 1)").run(pk.id);
  const cp = db.prepare("SELECT id FROM client_packages WHERE email = 'pk@t.pt'").get().id;
  const id = ins({ ref: 'PKDEL', date: '2030-01-07', email: 'pk@t.pt', status: 'completed' });
  db.prepare('UPDATE bookings SET service_id = ?, client_package_id = ? WHERE id = ?').run(pk.service_id, cp, id);
  await adm(`/admin/marcacoes/${id}`, { action: 'delete' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bookings WHERE id = ?').get(id).c, 0);
  assert.equal(db.prepare('SELECT sessions_used FROM client_packages WHERE id = ?').get(cp).sessions_used, 0);
});

test('reativar uma marcação cancelada não a põe por cima de outra', async () => {
  const d = '2030-01-08';
  const cancelled = ins({ ref: 'RA1', date: d, status: 'cancelled' });
  ins({ ref: 'RA2', date: d });
  const r = await adm(`/admin/marcacoes/${cancelled}`, { action: 'status', status: 'confirmed' });
  assert.match(r.headers.get('location'), /erro=/);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(cancelled).status, 'cancelled');
});

test('série semanal: todas com o mesmo series_id, numa só operação', async () => {
  const d = nextWeekday(7);
  const r = await adm('/admin/marcacoes', { serviceId: 1, staffId: 1, date: d, time: '18:00', name: 'Série', email: 'serie@t.pt', repeat: 'semanal', repeat_count: 4, force: '1' });
  assert.equal(r.status, 302);
  const rows = db.prepare("SELECT series_id FROM bookings WHERE customer_email = 'serie@t.pt'").all();
  assert.equal(rows.length, 4);
  assert.ok(rows[0].series_id && rows.every((x) => x.series_id === rows[0].series_id));
});

test('marcação manual recusa email inválido', async () => {
  const r = await adm('/admin/marcacoes', { serviceId: 1, staffId: 1, date: nextWeekday(), time: '17:00', name: 'X', email: 'isto-nao-e-email', force: '1' });
  assert.equal(r.status, 422);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM bookings WHERE customer_email = 'isto-nao-e-email'").get().c, 0);
});

test('horário: fecho depois da meia-noite e pausa fora do dia são corrigidos', async () => {
  const body = {};
  for (let d = 0; d < 7; d++) Object.assign(body, { [`open_${d}`]: '09:00', [`close_${d}`]: '18:00', [`bstart_${d}`]: '19:00', [`bend_${d}`]: '20:00' });
  body.open_1 = '23:50'; body.close_1 = '23:55';
  await adm('/admin/horario', body);
  const mon = db.prepare('SELECT * FROM hours WHERE weekday = 1').get();
  assert.ok(mon.close_min <= 1440 && mon.close_min > mon.open_min);
  assert.equal(db.prepare('SELECT break_start FROM hours WHERE weekday = 2').get().break_start, null);
});

test('preço negativo fica a zero; nome vazio mantém o anterior', async () => {
  const s = db.prepare('SELECT * FROM services LIMIT 1').get();
  await adm(`/admin/servicos/${s.id}`, { name: '', description: '', duration_min: 30, price: '-20', active: '1' });
  const n = db.prepare('SELECT * FROM services WHERE id = ?').get(s.id);
  assert.equal(n.price_cents, 0);
  assert.equal(n.name, s.name);
});

test('utilizador profissional com profissional inexistente não dá erro 500', async () => {
  const r = await adm('/admin/utilizadores', { name: 'Pro', email: 'pro@t.pt', role: 'staff', staff_id: 9999 });
  assert.notEqual(r.status, 500);
});

test('uma tarefa automática que falha não impede as outras', () => {
  setSetting('review_url', 'https://g.page/r/x/review');
  setSetting('review_delay_hours', '0');
  ins({ ref: 'JOB1', date: addDays(nowIn().date, -1), email: 'job@t.pt', status: 'completed' });
  const orig = mailer.sendReviewRequest;
  mailer.sendReviewRequest = () => { throw new Error('SMTP em baixo'); };
  try {
    const out = jobs.runJobs();
    assert.equal(out.reviews, null);
    assert.equal(typeof out.waitlist, 'number');
  } finally { mailer.sendReviewRequest = orig; }
});

test('aviso de lista de espera que falha volta a "à espera"', async () => {
  const d = nextWeekday(5);
  db.prepare("INSERT INTO waitlist(token, service_id, staff_id, date, name, email) VALUES ('wlf', 1, NULL, ?, 'W', 'w@t.pt')").run(d);
  const orig = mailer.send;
  mailer.send = async () => false;
  try {
    jobs.waitlist(nowIn());
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(db.prepare("SELECT status FROM waitlist WHERE token = 'wlf'").get().status, 'waiting');
  } finally { mailer.send = orig; }
});

test('.ics em UTC: 10:00 em Lisboa no verão é 09:00Z', () => {
  assert.equal(require('../src/ics').utcStamp('2030-07-15', 600, 'Europe/Lisbon'), '20300715T090000Z');
});
