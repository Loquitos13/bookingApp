'use strict';
/* Pacotes de sessões (ex.: 10 sessões de fisioterapia): consumidos automaticamente ao concluir uma marcação. */
const { db } = require('./db');

function activeFor(email, serviceId, date) {
  return db.prepare(
    `SELECT cp.* FROM client_packages cp JOIN packages p ON p.id = cp.package_id
     WHERE cp.email = ? AND p.service_id = ? AND cp.sessions_used < cp.sessions_total AND (cp.expires_at IS NULL OR cp.expires_at >= ?)
     ORDER BY cp.expires_at, cp.id LIMIT 1`
  ).get(String(email).toLowerCase(), serviceId, date);
}

/** Chamar depois de mudar o estado de uma marcação: consome ou devolve uma sessão do pacote. */
function onStatusChange(b, newStatus) {
  if (newStatus === 'completed' && !b.client_package_id) {
    const cp = activeFor(b.customer_email, b.service_id, b.date);
    if (!cp) return null;
    db.prepare('UPDATE client_packages SET sessions_used = sessions_used + 1 WHERE id = ?').run(cp.id);
    db.prepare('UPDATE bookings SET client_package_id = ? WHERE id = ?').run(cp.id, b.id);
    return cp.id;
  }
  if (newStatus !== 'completed' && b.client_package_id) {
    db.prepare('UPDATE client_packages SET sessions_used = MAX(0, sessions_used - 1) WHERE id = ?').run(b.client_package_id);
    db.prepare('UPDATE bookings SET client_package_id = NULL WHERE id = ?').run(b.id);
  }
  return null;
}

module.exports = { activeFor, onStatusChange };
