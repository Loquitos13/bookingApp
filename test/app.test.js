'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.ADMIN_EMAIL = 'admin@teste.pt';
process.env.ADMIN_PASSWORD = 'segredo123';

const app = require('../server');
const { db } = require('../src/db');
const { nowIn, addDays, weekday } = require('../src/time');

let server, base;
before(async () => {
  console.log = () => {}; // silenciar emails simulados
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** próximo dia útil (seg-sex) a pelo menos 2 dias de distância */
function nextWeekday() {
  let d = addDays(nowIn().date, 2);
  while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
  return d;
}
const form = (o) => new URLSearchParams(o).toString();
const post = (url, body, headers = {}) =>
  fetch(base + url, { method: 'POST', redirect: 'manual', body: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });

test('páginas públicas respondem', async () => {
  for (const u of ['/', '/marcar']) assert.equal((await fetch(base + u)).status, 200);
  assert.equal((await fetch(base + '/nao-existe')).status, 404);
});

test('domingo fechado não tem horários; dia útil tem', async () => {
  let sunday = addDays(nowIn().date, 1);
  while (weekday(sunday) !== 0) sunday = addDays(sunday, 1);
  const s = await (await fetch(`${base}/api/slots?service=1&date=${sunday}`)).json();
  assert.equal(s.slots.length, 0);
  const d = nextWeekday();
  const w = await (await fetch(`${base}/api/slots?service=1&date=${d}`)).json();
  assert.ok(w.slots.length > 0);
  assert.ok(!w.slots.some((x) => x.start > 780 - 60 && x.start < 840), 'não deve sobrepor a pausa de almoço');
});

test('marcação online, conflito e cancelamento', async () => {
  const d = nextWeekday();
  const base1 = { serviceId: 3, staffId: 2, date: d, time: '10:00', name: 'Rita Teste', email: 'rita@teste.pt', phone: '912345678', consent: '1' };
  const r = await post('/marcar', base1);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^\/marcacao\/[a-f0-9]+\?nova=1$/);

  // mesmo profissional, horário sobreposto → recusado
  const r2 = await post('/marcar', { ...base1, time: '10:30', email: 'outro@teste.pt' });
  assert.equal(r2.status, 409);

  // o horário deixou de aparecer
  const s = await (await fetch(`${base}/api/slots?service=3&staff=2&date=${d}`)).json();
  assert.ok(!s.slots.some((x) => x.time === '10:00' || x.time === '10:30'));

  const page = await (await fetch(base + loc)).text();
  assert.match(page, /Marcação confirmada/);

  const token = loc.split('/')[2].split('?')[0];
  const c = await post(`/marcacao/${token}/cancelar`, {});
  assert.equal(c.status, 302);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE token = ?').get(token).status, 'cancelled');
});

test('validação de dados do formulário', async () => {
  const r = await post('/marcar', { serviceId: 1, date: nextWeekday(), time: '09:00', name: '', email: 'x', phone: '1' });
  assert.equal(r.status, 422);
});

test('back office exige login e CSRF', async () => {
  const anon = await fetch(base + '/admin', { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /\/admin\/login/);

  const bad = await post('/admin/login', { email: 'admin@teste.pt', password: 'errada' });
  assert.equal(bad.status, 401);

  const ok = await post('/admin/login', { email: 'admin@teste.pt', password: 'segredo123' });
  assert.equal(ok.status, 302);
  const cookie = ok.headers.get('set-cookie').split(';')[0];

  for (const u of ['/admin', '/admin/agenda', '/admin/marcacoes', '/admin/marcacoes/nova', '/admin/servicos', '/admin/equipa', '/admin/horario', '/admin/bloqueios', '/admin/mensagens', '/admin/definicoes']) {
    assert.equal((await fetch(base + u, { headers: { cookie } })).status, 200, u);
  }

  const noCsrf = await post('/admin/bloqueios', { date_from: nextWeekday() }, { cookie });
  assert.equal(noCsrf.status, 403);

  // bloquear um dia inteiro remove os horários
  const csrf = db.prepare('SELECT csrf FROM sessions').get().csrf;
  const d = nextWeekday();
  const blk = await post('/admin/bloqueios', { _csrf: csrf, date_from: d, date_to: d, reason: 'Feriado' }, { cookie });
  assert.equal(blk.status, 302);
  const s = await (await fetch(`${base}/api/slots?service=1&date=${d}`)).json();
  assert.equal(s.slots.length, 0);

  // marcação manual com encaixe forçado
  const m = await post('/admin/marcacoes', { _csrf: csrf, serviceId: 1, staffId: 1, date: d, time: '11:00', name: 'Encaixe', force: '1' }, { cookie });
  assert.equal(m.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM bookings WHERE customer_name = 'Encaixe'").get().c, 1);
});
