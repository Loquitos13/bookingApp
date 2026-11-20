'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./security');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  color TEXT DEFAULT '#3d7a6a',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE TABLE IF NOT EXISTS hours (
  weekday INTEGER PRIMARY KEY,          -- 0 = domingo ... 6 = sábado
  closed INTEGER NOT NULL DEFAULT 0,
  open_min INTEGER NOT NULL DEFAULT 540,
  close_min INTEGER NOT NULL DEFAULT 1140,
  break_start INTEGER,
  break_end INTEGER
);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE, -- NULL = todo o espaço
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  start_min INTEGER,                    -- NULL = dia inteiro
  end_min INTEGER,
  reason TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  notes TEXT DEFAULT '',
  internal_notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed', -- pending | confirmed | completed | cancelled | no_show
  source TEXT NOT NULL DEFAULT 'online',    -- online | admin
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, staff_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS client_notes (
  email TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

const DEFAULT_SETTINGS = {
  business_name: 'Equilíbrio',
  business_subtitle: 'Fisioterapia & Osteopatia',
  tagline: 'Recupere o movimento. Volte a fazer o que gosta.',
  intro:
    'Somos uma clínica pequena e temos tempo para cada pessoa. Na primeira consulta percebemos o que se passa e explicamos-lho. Depois fazemos um plano de tratamento, seja para uma lesão desportiva ou para a dor lombar do dia a dia.',
  phone: '+351 210 000 000',
  email: 'geral@equilibrio-clinica.pt',
  address: 'Rua das Flores, 120, 1200-195 Lisboa',
  timezone: 'Europe/Lisbon',
  slot_step: '15',
  min_notice_hours: '2',
  max_days_ahead: '60',
  buffer_min: '0',
  cancel_hours: '24',
  auto_confirm: '1',
  // em produção (imagem Docker) a demo só liga com DEMO=1 explícito: evita um dono admin123 público
  demo_mode: process.env.DEMO === '1' || (process.env.DEMO !== '0' && process.env.NODE_ENV !== 'production') ? '1' : '0',
  // marca
  brand_signal: '#f5c518',
  brand_logo: '',
  // regras e automatismos
  auto_holidays: '1',
  reminder_hours: '24',
  reminder_sms: '0',
  review_url: '',
  review_delay_hours: '3',
  max_online_per_email: '4',
  // sinal / pagamento online
  deposit_mode: 'off', // off | percent | fixed | full
  deposit_value: '0',
  payment_timeout_min: '30',
  // legal
  complaints_url: 'https://www.livroreclamacoes.pt',
  privacy_controller: '',
  // idiomas
  lang_en: '1',
  intro_en: '',
  tagline_en: '',
};

// ---- migrações aditivas (instalações existentes recebem as novas colunas/tabelas) ----
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS staff_hours (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  open_min INTEGER NOT NULL DEFAULT 540,
  close_min INTEGER NOT NULL DEFAULT 1140,
  break_start INTEGER,
  break_end INTEGER,
  PRIMARY KEY (staff_id, weekday)
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  lang TEXT DEFAULT 'pt',
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | notified | booked | removed
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sessions INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 365,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS client_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  package_id INTEGER NOT NULL REFERENCES packages(id),
  sessions_total INTEGER NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  purchased_at TEXT NOT NULL DEFAULT (date('now')),
  expires_at TEXT,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cp_email ON client_packages(email);
`);
addColumn('staff', 'ics_token', 'TEXT');
addColumn('bookings', 'reminder_sent_at', 'TEXT');
addColumn('bookings', 'review_sent_at', 'TEXT');
addColumn('bookings', 'payment_status', "TEXT NOT NULL DEFAULT 'none'"); // none | pending | paid | expired
addColumn('bookings', 'deposit_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bookings', 'payment_ref', 'TEXT');
addColumn('bookings', 'series_id', 'TEXT');
addColumn('bookings', 'client_package_id', 'INTEGER');
addColumn('bookings', 'lang', "TEXT NOT NULL DEFAULT 'pt'");
addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'owner'"); // owner | reception | staff
addColumn('users', 'staff_id', 'INTEGER REFERENCES staff(id) ON DELETE SET NULL');
function ensureStaffTokens() {
  for (const s of db.prepare('SELECT id FROM staff WHERE ics_token IS NULL').all()) {
    db.prepare('UPDATE staff SET ics_token = ? WHERE id = ?').run(require('node:crypto').randomBytes(18).toString('hex'), s.id);
  }
}

function seed() {
  const has = db.prepare('SELECT COUNT(*) c FROM settings').get().c;
  if (has) return;

  const setS = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setS.run(k, v);

  const insSvc = db.prepare(
    'INSERT INTO services(name, description, duration_min, price_cents, sort) VALUES (?, ?, ?, ?, ?)'
  );
  const services = [
    ['Avaliação inicial', 'Primeira consulta: história clínica, testes funcionais e plano de tratamento.', 60, 5000],
    ['Sessão de fisioterapia', 'Tratamento individual com terapia manual e exercício terapêutico.', 45, 4000],
    ['Osteopatia', 'Abordagem global para dores articulares, musculares e posturais.', 50, 5500],
    ['Fisioterapia desportiva', 'Recuperação de lesões e prevenção para quem treina ou compete.', 45, 4500],
    ['Massagem terapêutica', 'Alívio de tensão muscular e recuperação pós-esforço.', 30, 3000],
  ];
  const svcIds = services.map((s, i) => Number(insSvc.run(...s, i).lastInsertRowid));

  const insStaff = db.prepare('INSERT INTO staff(name, role, bio, color, sort) VALUES (?, ?, ?, ?, ?)');
  const staff = [
    ['Ana Ribeiro', 'Fisioterapeuta', 'Especialista em reabilitação músculo-esquelética e dor crónica.', '#3d7a6a'],
    ['Miguel Santos', 'Osteopata', 'Osteopata com formação em terapia manual e coluna.', '#b0653f'],
    ['Inês Costa', 'Fisioterapeuta desportiva', 'Acompanha atletas de corrida, futebol e padel.', '#5a6fa8'],
  ];
  const staffIds = staff.map((s, i) => Number(insStaff.run(...s, i).lastInsertRowid));

  const link = db.prepare('INSERT INTO staff_services(staff_id, service_id) VALUES (?, ?)');
  // Ana: avaliação, fisio, massagem | Miguel: avaliação, osteopatia, massagem | Inês: avaliação, fisio, desportiva
  [[0, [0, 1, 4]], [1, [0, 2, 4]], [2, [0, 1, 3]]].forEach(([s, list]) =>
    list.forEach((v) => link.run(staffIds[s], svcIds[v]))
  );

  const insH = db.prepare(
    'INSERT INTO hours(weekday, closed, open_min, close_min, break_start, break_end) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (let d = 0; d < 7; d++) {
    if (d === 0) insH.run(d, 1, 540, 780, null, null);
    else if (d === 6) insH.run(d, 0, 540, 780, null, null);
    else insH.run(d, 0, 540, 1170, 780, 840);
  }

  // pacote de exemplo: só na primeira instalação (apagá-lo depois é definitivo)
  const sv = db.prepare('SELECT id, price_cents FROM services ORDER BY sort LIMIT 1 OFFSET 1').get();
  if (sv) db.prepare('INSERT INTO packages(name, service_id, sessions, price_cents, validity_days) VALUES (?,?,?,?,?)').run('Pack 10 sessões', sv.id, 10, Math.round(sv.price_cents * 10 * 0.85), 365);

  const email = process.env.ADMIN_EMAIL || 'admin@exemplo.pt';
  // em demonstração a palavra-passe é conhecida; numa instalação real é aleatória (mostrada uma vez no arranque)
  const pass = process.env.ADMIN_PASSWORD || (DEFAULT_SETTINGS.demo_mode === '1' ? 'admin123' : require('node:crypto').randomBytes(9).toString('base64url'));
  db.prepare('INSERT INTO users(name, email, password_hash) VALUES (?, ?, ?)').run(
    'Administrador',
    email.toLowerCase(),
    hashPassword(pass)
  );
  console.log(`[seed] Utilizador de back office criado: ${email}` + (process.env.ADMIN_PASSWORD ? ' (palavra-passe de ADMIN_PASSWORD)' : ` / ${pass}  (altere a palavra-passe!)`));
}
seed();
ensureStaffTokens();

// as definições são lidas em todos os pedidos (e muitas vezes por pedido no cálculo de vagas): cache invalidada ao gravar
let settingsCache = null;
function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS };
    for (const r of db.prepare('SELECT key, value FROM settings').all()) settingsCache[r.key] = r.value;
  }
  return { ...settingsCache };
}

const stmts = new Map();
/** Statement preparado uma única vez (caminhos quentes). */
function stmt(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(key, String(value));
  settingsCache = null;
}

/** Executa fn numa transação exclusiva (evita marcações duplicadas em simultâneo). */
let txDepth = 0;
function tx(fn) {
  if (txDepth) return fn(); // já dentro de uma transação: a de fora faz COMMIT/ROLLBACK
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

module.exports = { db, stmt, getSettings, setSetting, tx, DEFAULT_SETTINGS, ensureStaffTokens };
