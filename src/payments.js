'use strict';
/* Sinal / pagamento online com Stripe Checkout (cartão, MB WAY e Multibanco — os métodos ativos na conta Stripe).
   Sem SDK: chamadas REST + verificação da assinatura do webhook. Ativo só com STRIPE_SECRET_KEY e um modo de sinal. */
const crypto = require('node:crypto');
const { db, getSettings } = require('./db');
const { formatDateLong, minToTime } = require('./time');

const enabled = () => !!process.env.STRIPE_SECRET_KEY && getSettings().deposit_mode !== 'off';

function depositFor(priceCents) {
  const st = getSettings();
  const v = Math.max(0, +st.deposit_value || 0);
  let c = 0;
  if (st.deposit_mode === 'percent') c = Math.round((priceCents * Math.min(v, 100)) / 100);
  else if (st.deposit_mode === 'fixed') c = Math.min(priceCents || Infinity, Math.round(v * 100));
  else if (st.deposit_mode === 'full') c = priceCents;
  return c >= 50 ? c : 0; // a Stripe exige pelo menos 0,50 €
}

function flatten(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}

async function stripe(pathname, params) {
  const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: flatten(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Stripe ${r.status}`);
  return j;
}

async function createCheckout(b, baseUrl) {
  const st = getSettings();
  // "pagar outra vez": fecha a sessão anterior para não ser possível pagar duas vezes
  if (b.payment_ref) await stripe(`checkout/sessions/${encodeURIComponent(b.payment_ref)}/expire`, {}).catch(() => {});
  const timeout = Math.max(30, +st.payment_timeout_min || 30); // a Stripe exige pelo menos 30 min
  const session = await stripe('checkout/sessions', {
    mode: 'payment',
    customer_email: b.customer_email,
    client_reference_id: String(b.id),
    locale: b.lang === 'en' ? 'en' : 'pt',
    success_url: `${baseUrl}/marcacao/${b.token}?pago=1`,
    cancel_url: `${baseUrl}/marcacao/${b.token}?pago=0`,
    expires_at: Math.floor(Date.now() / 1000) + timeout * 60,
    metadata: { booking_id: b.id, ref: b.ref },
    payment_intent_data: { metadata: { booking_id: b.id, ref: b.ref }, description: `${st.business_name} · ${b.ref}` },
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: b.deposit_cents,
          product_data: { name: `${b.deposit_cents < b.price_cents ? 'Sinal · ' : ''}${b.service_name}`, description: `${formatDateLong(b.date)} às ${minToTime(b.start_min)} · ${b.staff_name}` },
        },
      },
    },
  });
  db.prepare('UPDATE bookings SET payment_ref = ? WHERE id = ?').run(session.id, b.id);
  return session.url;
}

/** Verifica o cabeçalho Stripe-Signature (HMAC-SHA256 de "t.corpo"), com tolerância de 5 min. */
function verifySignature(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = +parts.t;
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Aplica um evento da Stripe à marcação. Devolve a marcação quando passou a paga (para enviar a confirmação). */
function applyEvent(event) {
  const obj = event.data?.object || {};
  const id = +(obj.metadata?.booking_id || obj.client_reference_id);
  if (!id) return null;
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return null;
  const confirmStatus = getSettings().auto_confirm === '1' ? 'confirmed' : 'pending';
  // eventos de uma sessão antiga (substituída por um novo "pagar") não mexem na marcação
  const stale = obj.id && b.payment_ref && obj.id !== b.payment_ref;
  const paid = () => {
    if (b.payment_status === 'paid') return null;
    if (!b.payment_ref || obj.id !== b.payment_ref || !(+obj.amount_total >= (b.deposit_cents || 0)) || String(obj.currency || '').toLowerCase() !== 'eur') {
      console.error(`[pagamentos] evento ${event.type} ignorado para a marcação ${id}: sessão, valor ou moeda não correspondem`);
      return null;
    }
    db.prepare(`UPDATE bookings SET payment_status = 'paid', status = CASE WHEN status = 'cancelled' THEN status ELSE ? END, updated_at = datetime('now') WHERE id = ?`).run(confirmStatus, id);
    // pago depois de cancelada (horário já libertado): não confirmar ao cliente, avisar o negócio
    return { id, late: b.status === 'cancelled' };
  };
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.payment_status === 'paid') return paid();
      if (stale || !b.payment_ref) return null;
      // Multibanco: a referência foi gerada, o pagamento chega mais tarde — não libertar o horário entretanto
      db.prepare("UPDATE bookings SET payment_status = 'processing' WHERE id = ? AND payment_status = 'pending'").run(id);
      return null;
    case 'checkout.session.async_payment_succeeded':
      return paid();
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      if (stale) return null;
      db.prepare(`UPDATE bookings SET payment_status = 'expired', status = 'cancelled', updated_at = datetime('now'),
        internal_notes = trim(internal_notes || ' [Cancelada: pagamento não concluído]') WHERE id = ? AND payment_status != 'paid'`).run(id);
      return null;
    default:
      return null;
  }
}

module.exports = { enabled, depositFor, createCheckout, verifySignature, applyEvent };
