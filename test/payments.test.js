'use strict';
// Pagamento de sinal: checkout (API da Stripe simulada), webhook assinado, expiração.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-pay-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
process.env.RATE_LIMIT = '0';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const realFetch = global.fetch;
const stripeCalls = [];
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.stripe.com/')) {
    stripeCalls.push({ url: String(url), body: String(opts.body) });
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
  }
  return realFetch(url, opts);
};

const app = require('../server');
const { db, setSetting } = require('../src/db');
const { nowIn, addDays, weekday } = require('../src/time');
const { holidayName } = require('../src/holidays');

let server, base;
before(async () => {
  console.log = () => {};
  setSetting('deposit_mode', 'percent');
  setSetting('deposit_value', '30');
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function day() {
  let d = addDays(nowIn().date, 3);
  while ([0, 6].includes(weekday(d)) || holidayName(d)) d = addDays(d, 1);
  return d;
}
const sign = (raw, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const hook = (event, sig) => {
  const raw = JSON.stringify(event);
  return realFetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig ?? sign(raw) }, body: raw });
};

test('marcação com sinal vai para o checkout e fica pendente', async () => {
  const r = await realFetch(base + '/marcar', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ serviceId: 1, staffId: 1, date: day(), time: '10:00', name: 'Paga Teste', email: 'paga@teste.pt', phone: '912345678', consent: '1' }).toString(),
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_1');
  const b = db.prepare("SELECT * FROM bookings WHERE customer_email = 'paga@teste.pt'").get();
  assert.equal(b.status, 'pending');
  assert.equal(b.payment_status, 'pending');
  assert.equal(b.deposit_cents, Math.round(b.price_cents * 0.3));
  assert.match(stripeCalls[0].body, /unit_amount%5D=1500|unit_amount\]=1500/);
  // o horário fica guardado enquanto o pagamento está pendente
  const s = await (await realFetch(`${base}/api/slots?service=1&staff=1&date=${b.date}`)).json();
  assert.ok(!s.slots.some((x) => x.time === '10:00'));
});

test('webhook com assinatura inválida é recusado', async () => {
  const b = db.prepare("SELECT * FROM bookings WHERE customer_email = 'paga@teste.pt'").get();
  const r = await hook({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { booking_id: b.id } } } }, 't=1,v1=abc');
  assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT payment_status FROM bookings WHERE id = ?').get(b.id).payment_status, 'pending');
});

test('webhook de outra sessão, valor menor ou outra moeda não confirma', async () => {
  const b = db.prepare("SELECT * FROM bookings WHERE customer_email = 'paga@teste.pt'").get();
  for (const obj of [
    { id: 'cs_alheia', amount_total: b.deposit_cents, currency: 'eur', client_reference_id: String(b.id) },
    { id: 'cs_test_1', amount_total: 50, currency: 'eur', metadata: { booking_id: b.id } },
    { id: 'cs_test_1', amount_total: b.deposit_cents, currency: 'usd', metadata: { booking_id: b.id } },
  ]) {
    await hook({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', ...obj } } });
    await hook({ type: 'checkout.session.async_payment_succeeded', data: { object: obj } });
    assert.equal(db.prepare('SELECT payment_status FROM bookings WHERE id = ?').get(b.id).payment_status, 'pending', JSON.stringify(obj));
  }
});

test('webhook pago confirma a marcação', async () => {
  const b = db.prepare("SELECT * FROM bookings WHERE customer_email = 'paga@teste.pt'").get();
  const r = await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', amount_total: b.deposit_cents, currency: 'eur', payment_status: 'paid', metadata: { booking_id: b.id } } } });
  assert.equal(r.status, 200);
  const nb = db.prepare('SELECT status, payment_status FROM bookings WHERE id = ?').get(b.id);
  assert.equal(nb.payment_status, 'paid');
  assert.equal(nb.status, 'confirmed');
});

test('Multibanco: referência gerada não liberta o horário; pagamento falhado cancela', async () => {
  const r = await realFetch(base + '/marcar', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ serviceId: 1, staffId: 1, date: day(), time: '11:30', name: 'MB Teste', email: 'mb@teste.pt', phone: '912345670', consent: '1' }).toString(),
  });
  assert.equal(r.status, 303);
  const b = db.prepare("SELECT * FROM bookings WHERE customer_email = 'mb@teste.pt'").get();
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'unpaid', metadata: { booking_id: b.id } } } });
  assert.equal(db.prepare('SELECT payment_status FROM bookings WHERE id = ?').get(b.id).payment_status, 'processing');
  await hook({ type: 'checkout.session.async_payment_failed', data: { object: { metadata: { booking_id: b.id } } } });
  const nb = db.prepare('SELECT status, payment_status FROM bookings WHERE id = ?').get(b.id);
  assert.equal(nb.status, 'cancelled');
  assert.equal(nb.payment_status, 'expired');
});
