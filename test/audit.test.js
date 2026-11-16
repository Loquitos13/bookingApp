'use strict';
// Regressões das auditorias (segurança Cloudflare + Ponytail). Cada teste reproduz um problema encontrado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-audit-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
process.env.ADMIN_EMAIL = 'dono@teste.pt';
process.env.ADMIN_PASSWORD = 'segredo123';
delete process.env.TRUST_PROXY;
process.env.RATE_LIMIT = '0';

const app = require('../server');
const { db, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const { timeToMin } = require('../src/time');
const payments = require('../src/payments');
const jobs = require('../src/scheduler');
const mailer = require('../src/mailer');

let server, base;
const sent = [];
before(async () => {
  console.log = () => {};
  mailer.send = async (m) => { sent.push(m); return true; };
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
  db.prepare("INSERT INTO users(name, email, password_hash, role) VALUES ('Rece', 'rece@teste.pt', ?, 'reception')").run(hashPassword('segredo123'));
  db.prepare("INSERT INTO users(name, email, password_hash, role, staff_id) VALUES ('Ana', 'ana@teste.pt', ?, 'staff', 1)").run(hashPassword('segredo123'));
  const ins = db.prepare("INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, notes, status) VALUES (?,?,1,?,?,600,660,?,?,'9',?,'confirmed')");
  ins.run('A1', 'ta1', 1, '2030-01-07', 'Da Ana', 'ana-cli@t.pt', 'linha 1\rEND:VEVENT\rBEGIN:VEVENT');
  ins.run('A2', 'ta2', 2, '2030-01-07', 'Do Miguel', 'miguel-cli@t.pt', '');
  ins.run('A3', 'ta3', 1, '2030-01-08', '=HYPERLINK("http://x")', 'formula@t.pt', '');
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function loginAs(email, headers = {}) {
  const r = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: `email=${encodeURIComponent(email)}&password=segredo123` });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const csrf = db.prepare('SELECT s.csrf FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ? ORDER BY s.expires_at DESC').get(email).csrf;
  const get = (u, opts = {}) => fetch(base + u, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.headers || {}) } });
  const post = (u, body) => get(u, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...body }).toString() });
  return { get, post };
}

test('receção não chega às páginas do dono mudando maiúsculas ou com barra final', async () => {
  const { get, post } = await loginAs('rece@teste.pt');
  for (const u of ['/admin/definicoes', '/admin/DEFINICOES', '/admin/Utilizadores', '/admin/utilizadores/', '/admin/Estatisticas']) {
    assert.notEqual((await get(u)).status, 200, u);
  }
  const r = await post('/admin/Utilizadores', { name: 'X', email: 'x@x.pt', role: 'owner' });
  assert.notEqual(r.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'x@x.pt'").get().c, 0);
});

test('profissional: barra final e CSV só com as suas marcações', async () => {
  const { get } = await loginAs('ana@teste.pt');
  for (const u of ['/admin/marcacoes/?from=2030-01-01', '/admin/agenda/?data=2030-01-07', '/admin/agenda?data=2030-01-07&staff=2']) {
    const r = await get(u);
    if (r.status === 200) assert.doesNotMatch(await r.text(), /Do Miguel/, u);
  }
  const csv = await (await get('/admin/marcacoes/exportar.csv')).text();
  assert.match(csv, /Da Ana/);
  assert.doesNotMatch(csv, /miguel-cli@t\.pt/);
});

test('CSV não deixa passar fórmulas para o Excel', async () => {
  const { get } = await loginAs('dono@teste.pt');
  const csv = await (await get('/admin/marcacoes/exportar.csv')).text();
  assert.match(csv, /"'=HYPERLINK/);
});

test('cookie malformado não parte o site', async () => {
  assert.equal((await fetch(base + '/', { headers: { cookie: 'x=%E0%A4%A' } })).status, 200);
});

test('notas com CR não injetam eventos no calendário .ics', async () => {
  const tok = db.prepare('SELECT ics_token FROM staff WHERE id = 1').get().ics_token;
  const ics = await (await fetch(`${base}/cal/${tok}.ics`)).text();
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/^UID:/gm) || []).length);
  assert.doesNotMatch(ics, /\r(?!\n)/);
});

test('mensagem com % no nome do cliente não dá erro 500', async () => {
  const { get } = await loginAs('dono@teste.pt');
  assert.equal((await get('/admin?ok=' + encodeURIComponent('100% Saúde: confirmada.'))).status, 200);
});

test('palavra-passe temporária não vai no URL', async () => {
  const { post } = await loginAs('dono@teste.pt');
  const r = await post('/admin/utilizadores', { name: 'Nova', email: 'nova@teste.pt', role: 'reception' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('location'), null);
  assert.match(await r.text(), /palavra-passe temporária/);
});

test('pagamento: eventos de sessões antigas ignorados; pago depois de cancelada avisa o negócio', () => {
  db.prepare("INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, status, payment_status, payment_ref) VALUES ('P1','tp1',1,1,'2030-02-01',600,660,'Paga','p@t.pt','9','pending','pending','cs_new')").run();
  const id = db.prepare("SELECT id FROM bookings WHERE ref = 'P1'").get().id;
  payments.applyEvent({ type: 'checkout.session.expired', data: { object: { id: 'cs_old', metadata: { booking_id: id } } } });
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'pending');
  payments.applyEvent({ type: 'checkout.session.expired', data: { object: { id: 'cs_new', metadata: { booking_id: id } } } });
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'cancelled');
  const r = payments.applyEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_new', metadata: { booking_id: id } } } });
  assert.deepEqual(r, { id, late: true });
});

test('horas inválidas como 24:15 são recusadas', () => {
  assert.equal(timeToMin('24:15'), null);
  assert.equal(timeToMin('23:45'), 23 * 60 + 45);
});

test('avaliação saltada não reinicia a janela de 6 meses', () => {
  setSetting('review_url', 'https://g.page/r/x/review');
  setSetting('review_delay_hours', '0');
  const now = require('../src/time').nowIn('Europe/Lisbon');
  const y = require('../src/time').addDays(now.date, -1);
  const ins = db.prepare("INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, status) VALUES (?,?,1,1,?,?,?,'Rev','rev@t.pt','9','completed')");
  ins.run('R1', 'tr1', y, 540, 600);
  ins.run('R2', 'tr2', y, 600, 660);
  jobs.reviews(now);
  const marks = db.prepare("SELECT review_sent_at FROM bookings WHERE ref IN ('R1','R2') ORDER BY ref").all().map((r) => r.review_sent_at);
  assert.equal(marks.filter((m) => m === '0').length, 1);
  assert.equal(marks.filter((m) => m && m !== '0').length, 1);
});

test('pacote apagado não volta a ser criado e consumo de sessões funciona', async () => {
  const pk = db.prepare('SELECT * FROM packages LIMIT 1').get();
  assert.ok(pk, 'pacote de exemplo criado na primeira instalação');
  db.prepare("INSERT INTO client_packages(email, package_id, sessions_total) VALUES ('pk@t.pt', ?, 2)").run(pk.id);
  db.prepare("INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, status) VALUES ('K1','tk1',?,1,'2030-03-01',600,660,'Pk','pk@t.pt','9','confirmed')").run(pk.service_id);
  const { post } = await loginAs('dono@teste.pt');
  const bid = db.prepare("SELECT id FROM bookings WHERE ref = 'K1'").get().id;
  await post(`/admin/marcacoes/${bid}`, { action: 'status', status: 'completed' });
  assert.equal(db.prepare("SELECT sessions_used FROM client_packages WHERE email = 'pk@t.pt'").get().sessions_used, 1);
  await post(`/admin/marcacoes/${bid}`, { action: 'status', status: 'confirmed' });
  assert.equal(db.prepare("SELECT sessions_used FROM client_packages WHERE email = 'pk@t.pt'").get().sessions_used, 0);
});

test('RGPD: apagar anonimiza marcações e remove notas', async () => {
  const { post } = await loginAs('dono@teste.pt');
  db.prepare("INSERT INTO client_notes(email, notes) VALUES ('ana-cli@t.pt', 'nota')").run();
  await post('/admin/clientes/apagar', { email: 'ana-cli@t.pt', confirm: 'ana-cli@t.pt' });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM bookings WHERE customer_email = 'ana-cli@t.pt'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_notes WHERE email = 'ana-cli@t.pt'").get().c, 0);
  assert.equal(db.prepare("SELECT customer_name FROM bookings WHERE ref = 'A1'").get().customer_name, 'Cliente removido');
});

// no fim: bloqueia o IP dos testes
test('X-Forwarded-For não contorna o bloqueio de login sem proxy configurado', async () => {
  const bad = (h = {}) => fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...h }, body: 'email=dono%40teste.pt&password=errada' });
  for (let i = 0; i < 11; i++) await bad();
  assert.equal((await bad({ 'x-forwarded-for': '203.0.113.9' })).status, 429);
});
