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
    return true;
  }
  try {
    await transport.sendMail({ from, to, subject, text });
    return true;
  } catch (e) {
    console.error('[email] falhou:', e.message);
    return false;
  }
}

const baseUrl = () => (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

function bookingSummaryEn(b) {
  const { formatDateLong: fl } = require('./time');
  return [`Service: ${b.service_name}`, `With: ${b.staff_name}`, `Date: ${fl(b.date, 'en')}`, `Time: ${minToTime(b.start_min)} – ${minToTime(b.end_min)}`, `Reference: ${b.ref}`].join('\n');
}

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
  if (b.lang === 'en') {
    module.exports.send({
      to: b.customer_email,
      subject: `${st.business_name}: booking ${b.status === 'pending' ? 'received' : 'confirmed'} (${b.ref})`,
      text: `Hello ${b.customer_name},\n\n${b.status === 'pending' ? 'We received your booking request and will confirm it shortly.' : 'Your booking is confirmed.'}\n\n${bookingSummaryEn(b)}\n\nAddress: ${st.address}\n\nTo view, change or cancel: ${manage}\n\nSee you soon,\n${st.business_name}`,
    });
  } else {
    const state = b.status === 'pending' ? 'Recebemos o seu pedido de marcação. Vamos confirmá-lo em breve.' : 'A sua marcação está confirmada.';
    module.exports.send({
      to: b.customer_email,
      subject: `${st.business_name}: marcação ${b.status === 'pending' ? 'recebida' : 'confirmada'} (${b.ref})`,
      text: `Olá ${b.customer_name},\n\n${state}\n\n${bookingSummary(b)}\n\nMorada: ${st.address}\n\nPara ver, mudar ou cancelar: ${manage}\n\nAté breve,\n${st.business_name}`,
    });
  }
  module.exports.send({
    to: process.env.NOTIFY_EMAIL || st.email,
    subject: `Nova marcação ${b.ref} · ${b.customer_name}`,
    text: `${bookingSummary(b)}\n\nCliente: ${b.customer_name}\nEmail: ${b.customer_email}\nTelefone: ${b.customer_phone}\nNotas: ${b.notes || '—'}\n\n${baseUrl()}/admin/marcacoes/${b.id}`,
  });
}

function notifyStatusChange(b) {
  const st = getSettings();
  const en = b.lang === 'en';
  const msgs = en
    ? { confirmed: 'Your booking is confirmed.', cancelled: 'Your booking was cancelled. You can make a new booking on our website at any time.' }
    : { confirmed: 'A sua marcação foi confirmada.', cancelled: 'A sua marcação foi cancelada. Se quiser, pode fazer uma nova marcação no nosso site.' };
  if (!msgs[b.status]) return;
  module.exports.send({
    to: b.customer_email,
    subject: en
      ? `${st.business_name}: booking ${b.status === 'confirmed' ? 'confirmed' : 'cancelled'} (${b.ref})`
      : `${st.business_name}: marcação ${b.status === 'confirmed' ? 'confirmada' : 'cancelada'} (${b.ref})`,
    text: `${en ? 'Hello' : 'Olá'} ${b.customer_name},\n\n${msgs[b.status]}\n\n${en ? bookingSummaryEn(b) : bookingSummary(b)}\n\n${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`,
  });
}
function notifyRescheduled(b, before, { byBusiness = false } = {}) {
  const st = getSettings();
  const en = b.lang === 'en';
  const { formatDateLong: fl } = require('./time');
  const was = en ? `${fl(before.date, 'en')} at ${minToTime(before.start)}` : `${formatDateLong(before.date)} às ${minToTime(before.start)}`;
  module.exports.send({
    to: b.customer_email,
    subject: en ? `${st.business_name}: booking changed (${b.ref})` : `${st.business_name}: marcação alterada (${b.ref})`,
    text: en
      ? `Hello ${b.customer_name},\n\nYour booking was changed (before: ${was}).\n\n${bookingSummaryEn(b)}\n\n${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`
      : `Olá ${b.customer_name},\n\nA sua marcação foi alterada (antes: ${was}).\n\n${bookingSummary(b)}\n\n${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`,
  });
  if (byBusiness) return;
  module.exports.send({
    to: process.env.NOTIFY_EMAIL || st.email,
    subject: `Marcação ${b.ref} reagendada pelo cliente`,
    text: `${b.customer_name} mudou de ${formatDateLong(before.date)} às ${minToTime(before.start)} para ${formatDateLong(b.date)} às ${minToTime(b.start_min)} (${b.staff_name}).\n\n${baseUrl()}/admin/marcacoes/${b.id}`,
  });
}

/* ---------- SMS / WhatsApp (Twilio, opcional) ---------- */
const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
function normalizePhone(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.length === 9) return '+351' + d; // número português sem indicativo
  return null;
}
async function sendSms(phone, body) {
  const to = normalizePhone(phone);
  if (!to) return false;
  if (!smsReady()) { console.log(`\n[sms:simulado] Para: ${to}\n${body}\n`); return false; }
  const from = process.env.TWILIO_FROM; // ex.: +351910000000 ou whatsapp:+14155238886
  const wa = from.startsWith('whatsapp:');
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') },
      body: new URLSearchParams({ To: wa ? `whatsapp:${to}` : to, From: from, Body: body }),
    });
    if (!r.ok) console.error('[sms] falhou:', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('[sms] falhou:', e.message); return false; }
}

function sendReminder(b) {
  const st = getSettings();
  const en = b.lang === 'en';
  const when = `${formatDateLong(b.date)} às ${minToTime(b.start_min)}`;
  const sent = module.exports.send({
    to: b.customer_email,
    subject: en ? `Reminder: ${b.service_name} at ${st.business_name}` : `Lembrete: ${b.service_name} · ${st.business_name}`,
    text: en
      ? `Hello ${b.customer_name},\n\nA reminder of your appointment:\n\n${bookingSummaryEn(b)}\n\nAddress: ${st.address}\n\nNeed to change or cancel? ${baseUrl()}/marcacao/${b.token}\n\n${st.business_name}`
      : `Olá ${b.customer_name},\n\nLembramos a sua marcação:\n\n${bookingSummary(b)}\n\nMorada: ${st.address}\n\nPrecisa de mudar ou cancelar? ${baseUrl()}/marcacao/${b.token}\n\nAté breve,\n${st.business_name}`,
  });
  if (st.reminder_sms === '1') {
    sendSms(b.customer_phone, en
      ? `${st.business_name}: reminder ${b.service_name}, ${b.date} ${minToTime(b.start_min)}. Change/cancel: ${baseUrl()}/marcacao/${b.token}`
      : `${st.business_name}: lembrete ${b.service_name}, ${when}. Mudar/cancelar: ${baseUrl()}/marcacao/${b.token}`);
  }
  return sent;
}

function sendReviewRequest(b) {
  const st = getSettings();
  const en = b.lang === 'en';
  return module.exports.send({
    to: b.customer_email,
    subject: en ? `How was your visit to ${st.business_name}?` : `Como correu a sua visita à ${st.business_name}?`,
    text: en
      ? `Hello ${b.customer_name},\n\nThank you for coming. If you have a minute, a short review helps others find us:\n\n${st.review_url}\n\n${st.business_name}`
      : `Olá ${b.customer_name},\n\nObrigado pela visita. Se tiver um minuto, uma avaliação curta ajuda outras pessoas a encontrar-nos:\n\n${st.review_url}\n\n${st.business_name}`,
  });
}

function sendWaitlistOpening(w, serviceName) {
  const st = getSettings();
  const en = w.lang === 'en';
  const link = `${baseUrl()}/marcar?servico=${w.service_id}${w.staff_id ? '&profissional=' + w.staff_id : ''}&dia=${w.date}`;
  const sent = module.exports.send({
    to: w.email,
    subject: en ? `A slot opened up on ${w.date} · ${st.business_name}` : `Vagou um horário a ${formatDateLong(w.date)} · ${st.business_name}`,
    text: en
      ? `Hello ${w.name},\n\nGood news: a slot for ${serviceName} on ${w.date} is now available. It's first come, first served:\n\n${link}\n\nTo leave the waiting list: ${baseUrl()}/lista-espera/${w.token}/sair\n\n${st.business_name}`
      : `Olá ${w.name},\n\nBoas notícias: vagou um horário para ${serviceName} a ${formatDateLong(w.date)}. É por ordem de chegada:\n\n${link}\n\nPara sair da lista de espera: ${baseUrl()}/lista-espera/${w.token}/sair\n\n${st.business_name}`,
  });
  if (st.reminder_sms === '1') sendSms(w.phone, `${st.business_name}: ${en ? 'a slot opened up on' : 'vagou um horário a'} ${w.date}. ${link}`);
  return sent;
}

module.exports = { send, sendSms, normalizePhone, notifyNewBooking, notifyStatusChange, notifyRescheduled, sendReminder, sendReviewRequest, sendWaitlistOpening };
