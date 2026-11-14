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
    'Somos uma clínica pequena, com tempo para si. Avaliamos com cuidado, explicamos o que se passa e criamos um plano de tratamento à sua medida — da lesão desportiva à dor lombar do dia a dia.',
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
};

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

  const email = process.env.ADMIN_EMAIL || 'admin@exemplo.pt';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users(name, email, password_hash) VALUES (?, ?, ?)').run(
    'Administrador',
    email.toLowerCase(),
    hashPassword(pass)
  );
  console.log(`[seed] Utilizador de back office criado: ${email} / ${pass}  (altere a palavra-passe!)`);
}
seed();

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(key, String(value));
}

/** Executa fn numa transação exclusiva (evita marcações duplicadas em simultâneo). */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, getSettings, setSetting, tx, DEFAULT_SETTINGS };
