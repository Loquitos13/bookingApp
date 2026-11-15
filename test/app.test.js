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
process.env.DEMO = '0';

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
  assert.match(page, /Está marcado/);
  assert.match(page, /class="ticket is-new/);

  // exportação para calendário
  const tok = loc.split('/')[2].split('?')[0];
  const ics = await fetch(`${base}/marcacao/${tok}.ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const icsBody = await ics.text();
  assert.match(icsBody, /BEGIN:VEVENT/);
  assert.match(icsBody, new RegExp(`DTSTART;TZID=Europe/Lisbon:${d.replace(/-/g, '')}T100000`));

  const token = loc.split('/')[2].split('?')[0];
  const c = await post(`/marcacao/${token}/cancelar`, {});
  assert.equal(c.status, 302);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE token = ?').get(token).status, 'cancelled');
});

test('primeira vaga e próximas vagas na página inicial', async () => {
  const f = await (await fetch(`${base}/api/first?service=1`)).json();
  assert.ok(f.first.any && f.first.any.time);
  const home = await (await fetch(base + '/')).text();
  assert.match(home, /Próximas vagas/);
  assert.match(home, /href="\/marcar\?servico=\d+&profissional=\d+&dia=\d{4}-\d{2}-\d{2}&hora=\d{2}:\d{2}"/);
  const pre = await (await fetch(`${base}/marcar?servico=1&dia=2030-01-07&hora=09:00`)).text();
  assert.match(pre, /value="2030-01-07"/);
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

test('cliente reagenda online pelo link pessoal', async () => {
  // o dia de nextWeekday() foi bloqueado num teste anterior: usa o dia útil seguinte
  let d = addDays(nextWeekday(), 1);
  while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
  const r = await post('/marcar', { serviceId: 1, staffId: 1, date: d, time: '15:00', name: 'Rui Teste', email: 'rui@teste.pt', phone: '913333333', consent: '1' });
  const token = r.headers.get('location').split('/')[2].split('?')[0];
  assert.equal((await fetch(`${base}/marcacao/${token}/reagendar`)).status, 200);
  // a própria marcação não bloqueia o seu horário atual
  const s = await (await fetch(`${base}/api/slots?service=1&staff=1&date=${d}&token=${token}`)).json();
  assert.ok(s.slots.some((x) => x.time === '15:00'));
  const m = await post(`/marcacao/${token}/reagendar`, { date: d, time: '16:30', anyStaff: '0' });
  assert.equal(m.status, 302);
  assert.match(m.headers.get('location'), /reagendada=1/);
  const b = db.prepare('SELECT start_min, staff_id FROM bookings WHERE token = ?').get(token);
  assert.equal(b.start_min, 16 * 60 + 30);
  assert.equal(b.staff_id, 1);
  // horário ocupado → recusa
  const other = await post('/marcar', { serviceId: 1, staffId: 1, date: d, time: '17:30', name: 'Ana Teste', email: 'ana@teste.pt', phone: '914444444', consent: '1' });
  assert.equal(other.status, 302);
  const bad = await post(`/marcacao/${token}/reagendar`, { date: d, time: '17:30', anyStaff: '0' });
  assert.match(bad.headers.get('location'), /erro=/);
});

test('back office: clientes, arrastar na agenda, vistas e app', async () => {
  const ok = await post('/admin/login', { email: 'admin@teste.pt', password: 'segredo123' });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY expires_at DESC').get().csrf;
  const get = (u) => fetch(base + u, { headers: { cookie } });

  for (const v of ['dia', 'semana', 'mes']) assert.equal((await get(`/admin/agenda?vista=${v}`)).status, 200, v);
  assert.equal((await get('/admin/clientes')).status, 200);
  const ficha = await get('/admin/clientes/ficha?email=rui%40teste.pt');
  assert.equal(ficha.status, 200);
  assert.match(await ficha.text(), /Rui Teste/);
  const ac = await (await get('/admin/api/clientes?q=Rui')).json();
  assert.equal(ac.clients[0].email, 'rui@teste.pt');
  const notes = await post('/admin/clientes/ficha', { _csrf: csrf, email: 'rui@teste.pt', notes: 'Prefere manhãs' }, { cookie });
  assert.equal(notes.status, 302);
  assert.equal(db.prepare('SELECT notes FROM client_notes WHERE email = ?').get('rui@teste.pt').notes, 'Prefere manhãs');

  // arrastar: mover para um horário livre, depois tentar colidir
  const rui = db.prepare("SELECT * FROM bookings WHERE customer_email = 'rui@teste.pt'").get();
  const move = (body) => fetch(base + '/admin/api/reagendar', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ _csrf: csrf, ...body }) });
  const mv = await move({ id: rui.id, date: rui.date, start: 10 * 60, staffId: 1 });
  assert.equal(mv.status, 200);
  const j = await mv.json();
  assert.equal(j.before.start, rui.start_min);
  const ana = db.prepare("SELECT * FROM bookings WHERE customer_email = 'ana@teste.pt'").get();
  assert.equal((await move({ id: rui.id, date: ana.date, start: ana.start_min, staffId: ana.staff_id })).status, 409);
  const noCsrf = await fetch(base + '/admin/api/reagendar', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: rui.id }) });
  assert.equal(noCsrf.status, 403);

  const man = await (await fetch(base + '/admin/manifest.webmanifest')).json();
  assert.equal(man.start_url, '/admin');
  const sw = await fetch(base + '/admin/sw.js');
  assert.equal(sw.headers.get('service-worker-allowed'), '/admin');
});

test('site em inglês: troca de idioma, datas e textos', async () => {
  const r = await fetch(base + '/?lang=en');
  const html = await r.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Next available/);
  assert.match(html, /Booking takes a minute/);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const book = await (await fetch(base + '/marcar', { headers: { cookie } })).text();
  assert.match(book, /What do you need\?/);
  assert.match(book, /"months":"January,February/);
  const pt = await (await fetch(base + '/?lang=pt')).text();
  assert.match(pt, /Próximas vagas/);
  const seo = await (await fetch(base + '/sitemap.xml')).text();
  assert.match(seo, /hreflang="en"/);
  assert.match(pt, /"@type":"LocalBusiness"/);
});
