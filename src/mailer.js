'use strict';
const nodemailer = require('nodemailer');
const { getSettings } = require('./db');
const { formatDateLong, minToTime } = require('./time');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function send({ to, subject, text }) {
  const st = getSettings();
  const from = process.env.MAIL_FROM || `${st.business_name} <${st.email}>`;
  if (!transport) {
    console.log(`\n[email:simulado] Para: ${to}\nAssunto: ${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from, to, subject, text });
  } catch (e) {
    console.error('[email] falhou:', e.message);
  }
}

const baseUrl = () => (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

function bookingSummary(b) {
  return [
    `Serviço: ${b.service_name}`,
    `Profissional: ${b.staff_name}`,
    `Data: ${formatDateLong(b.date)}`,
    `Hora: ${minToTime(b.start_min)} – ${minToTime(b.end_min)}`,
    `Referência: ${b.ref}`,
  ].join('\n');
}

function notifyNewBooking(b) {
  const st = getSettings();
  const manage = `${baseUrl()}/marcacao/${b.token}`;
  const state = b.status === 'pending' ? 'Recebemos o seu pedido de marcação — vamos confirmá-lo em breve.' : 'A sua marcação está confirmada.';
  send({
    to: b.customer_email,
    subject: `${st.business_name}: marcação ${b.status === 'pending' ? 'recebida' : 'confirmada'} (${b.ref})`,
    text: `Olá ${b.customer_name},\n\n${state}\n\n${bookingSummary(b)}\n\nMorada: ${st.address}\n\nPara ver ou cancelar: ${manage}\n\nAté breve,\n${st.business_name}`,
  });
  send({
    to: process.env.NOTIFY_EMAIL || st.email,
    subject: `Nova marcação ${b.ref} — ${b.customer_name}`,
    text: `${bookingSummary(b)}\n\nCliente: ${b.customer_name}\nEmail: ${b.customer_email}\nTelefone: ${b.customer_phone}\nNotas: ${b.notes || '—'}\n\n${baseUrl()}/admin/marcacoes/${b.id}`,
  });
}

function notifyStatusChange(b) {
  const st = getSettings();
  const msgs = {
    confirmed: 'A sua marcação foi confirmada.',
    cancelled: 'A sua marcação foi cancelada. Se quiser, pode fazer uma nova marcação no nosso site.',
  };
  if (!msgs[b.status]) return;
  send({
    to: b.customer_email,
    subject: `${st.business_name}: marcação ${b.status === 'confirmed' ? 'confirmada' : 'cancelada'} (${b.ref})`,
    text: `Olá ${b.customer_name},\n\n${msgs[b.status]}\n\n${bookingSummary(b)}\n\n${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`,
  });
}

function notifyRescheduled(b, before, { byBusiness = false } = {}) {
  const st = getSettings();
  const was = `${formatDateLong(before.date)} às ${minToTime(before.start)}`;
  send({
    to: b.customer_email,
    subject: `${st.business_name}: marcação alterada (${b.ref})`,
    text: `Olá ${b.customer_name},\n\nA sua marcação foi alterada (antes: ${was}).\n\n${bookingSummary(b)}\n\n${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`,
  });
  if (byBusiness) return;
  send({
    to: process.env.NOTIFY_EMAIL || st.email,
    subject: `Marcação ${b.ref} reagendada pelo cliente`,
    text: `${b.customer_name} mudou de ${was} para ${formatDateLong(b.date)} às ${minToTime(b.start_min)} (${b.staff_name}).\n\n${baseUrl()}/admin/marcacoes/${b.id}`,
  });
}

module.exports = { send, notifyNewBooking, notifyStatusChange, notifyRescheduled };
