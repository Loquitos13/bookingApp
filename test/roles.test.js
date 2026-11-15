'use strict';
// Papéis: dono, receção e profissional.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-roles-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
process.env.RATE_LIMIT = '0';
process.env.ADMIN_EMAIL = 'dono@teste.pt';
process.env.ADMIN_PASSWORD = 'segredo123';

const app = require('../server');
const { db } = require('../src/db');
const { hashPassword } = require('../src/security');

let server, base;
before(async () => {
  console.log = () => {};
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
  db.prepare("INSERT INTO users(name, email, password_hash, role) VALUES ('Rece', 'rece@teste.pt', ?, 'reception')").run(hashPassword('segredo123'));
  db.prepare("INSERT INTO users(name, email, password_hash, role, staff_id) VALUES ('Ana', 'ana@teste.pt', ?, 'staff', 1)").run(hashPassword('segredo123'));
  const ins = db.prepare("INSERT INTO bookings(ref, token, service_id, staff_id, date, start_min, end_min, customer_name, customer_email, customer_phone, status) VALUES (?,?,1,?,?,600,660,?, 'c@t.pt','9','confirmed')");
  ins.run('R1', 't1', 1, '2030-01-07', 'Da Ana');
  ins.run('R2', 't2', 2, '2030-01-07', 'Do Miguel');
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function loginAs(email) {
  const r = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(email)}&password=segredo123` });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return (u, opts = {}) => fetch(base + u, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.headers || {}) } });
}

test('dono acede a tudo e gere utilizadores', async () => {
  const get = await loginAs('dono@teste.pt');
  for (const u of ['/admin/definicoes', '/admin/estatisticas', '/admin/utilizadores', '/admin/equipa', '/admin/servicos']) assert.equal((await get(u)).status, 200, u);
});

test('receção: agenda, marcações e clientes sim; definições, estatísticas e utilizadores não', async () => {
  const get = await loginAs('rece@teste.pt');
  for (const u of ['/admin', '/admin/agenda', '/admin/marcacoes', '/admin/clientes', '/admin/conta']) assert.equal((await get(u)).status, 200, u);
  for (const u of ['/admin/definicoes', '/admin/estatisticas', '/admin/utilizadores', '/admin/servicos', '/admin/equipa']) assert.equal((await get(u)).status, 403, u);
});

test('profissional: só as suas marcações', async () => {
  const get = await loginAs('ana@teste.pt');
  assert.equal((await get('/admin')).status, 200);
  assert.equal((await get('/admin/clientes')).status, 403);
  const list = await (await get('/admin/marcacoes?from=2030-01-01')).text();
  assert.match(list, /Da Ana/);
  assert.doesNotMatch(list, /Do Miguel/);
  const mine = db.prepare("SELECT id FROM bookings WHERE ref = 'R1'").get().id;
  const other = db.prepare("SELECT id FROM bookings WHERE ref = 'R2'").get().id;
  assert.equal((await get(`/admin/marcacoes/${mine}`)).status, 200);
  assert.equal((await get(`/admin/marcacoes/${other}`)).status, 403);
  const agenda = await (await get('/admin/agenda?data=2030-01-07&staff=2')).text();
  assert.doesNotMatch(agenda, /Do Miguel/);
});
