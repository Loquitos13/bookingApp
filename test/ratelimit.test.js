'use strict';
// Limite de pedidos: o formulário de contacto aceita 5 mensagens por hora por IP.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-rl-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEMO = '0';
delete process.env.RATE_LIMIT;
const app = require('../server');

let server, base;
before(async () => { console.log = () => {}; await new Promise((r) => (server = app.listen(0, r))); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('6.ª mensagem seguida é recusada com 429 e Retry-After', async () => {
  const send = () => fetch(base + '/contacto', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Spam&email=s@x.pt&message=ola' });
  for (let i = 0; i < 5; i++) assert.equal((await send()).status, 302);
  const r = await send();
  assert.equal(r.status, 429);
  assert.ok(+r.headers.get('retry-after') > 0);
});

test('cabeçalhos de segurança presentes', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'nonce-/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.headers.get('permissions-policy'));
});
