'use strict';
const { db } = require('./db');
const { parseCookies, randomToken, verifyPassword } = require('./security');

const COOKIE = 'bo_session';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

function loadSession(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.user = null;
  if (token) {
    const row = db
      .prepare(
        `SELECT s.token, s.csrf, s.expires_at, u.id, u.name, u.email FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.token = ?`
      )
      .get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, name: row.name, email: row.email };
      req.session = { token: row.token, csrf: row.csrf };
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  res.locals.user = req.user;
  res.locals.csrf = req.session?.csrf || '';
  next();
}

function login(res, email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!u || !verifyPassword(password, u.password_hash)) return false;
  const token = randomToken(32);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run(
    token, u.id, randomToken(16), Date.now() + TTL_MS
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_MS,
    path: '/',
  });
  return true;
}

function logout(req, res) {
  if (req.session) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  // só o upload do logótipo (multipart) verifica o CSRF na própria rota, depois de o ficheiro ser lido
  const upload = req.path === '/definicoes/logo' && req.is('multipart/form-data');
  if (req.method === 'POST' && !upload && req.body?._csrf !== req.session.csrf) {
    return res.status(403).send('Pedido inválido (CSRF). Volte atrás e recarregue a página.');
  }
  next();
}

module.exports = { loadSession, login, logout, requireAuth };
