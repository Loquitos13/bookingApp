# Por validar

## Stripe webhook marks a booking paid for any paid checkout session naming its id, regardless of session or amount

Fingerprint: `src/payments.js:applyEvent:paid-path-unbound-session-and-amount` (pista prioritária, sem gravidade)

**Fronteira:** um evento Stripe assinado, vindo de outra fonte de checkout na mesma conta, chega às marcações deste negócio.

applyEvent takes the booking id from metadata.booking_id or client_reference_id and, on checkout.session.completed with payment_status=paid or on async_payment_succeeded, sets payment_status=paid and confirms the booking (server.js then sends the confirmation). The paid path never checks obj.id against the booking payment_ref (the stale check guards only expired/failed) and never compares amount_total or currency with deposit_cents/eur. HMAC only proves Stripe sent the event for this account, so any other checkout producer whose events reach this endpoint (a Payment Link with ?client_reference_id=<id>, another integration, or a second install sharing the Stripe account with colliding sequential ids) can confirm an unpaid booking for a smaller amount or another currency. Independently reproduced locally (agents/v-stripe/artifacts/check-1.txt): foreign session cs_FOREIGN_1, 50 usd, client_reference_id=1 and async_payment_succeeded cs_FOREIGN_2 with metadata.booking_id=2 each moved a 5000-cent booking to paid/confirmed; a foreign expired event was ignored.

**Causa alegada:** src/payments.js applyEvent's paid() branch trusts payload identity fields (metadata.booking_id / client_reference_id) as authoritative and does not bind the event to the checkout session the app created (payment_ref) or to the expected amount and currency.

### Caminho no código
1. entrypoint: server.js:26 (POST /webhooks/stripe): Raw body; verifySignature proves only that Stripe sent the event for this account
2. propagation: src/payments.js:84 (applyEvent): Booking id from obj.metadata.booking_id or obj.client_reference_id
3. propagation: src/payments.js:90 (applyEvent): stale check (obj.id !== payment_ref) used only for expired/failed events
4. propagation: src/payments.js:99 (applyEvent checkout.session.completed): payment_status==='paid' calls paid() with no session id, amount or currency check
5. sink: src/payments.js:93 (applyEvent paid()): UPDATE bookings SET payment_status='paid', status=confirmStatus; server.js then sends confirmation email

### Evidência verificada
- src/payments.js:66: createCheckout stores the app's own session id in bookings.payment_ref: the binding value exists
- src/payments.js:48: App sessions set client_reference_id=String(b.id); applyEvent accepts the same field from any session
- src/payments.js:104: async_payment_succeeded also calls paid() without stale or amount check
- src/routes/public.js:181: deposit_cents is the expected amount, never compared with the event
- src/payments.js:60: App sessions charge unit_amount=deposit_cents in eur; neither is compared on the event
- server.js:37: A non-late paid() result triggers notifyNewBooking confirmation emails

### O que bloqueia
- Whether the Stripe account has another producer of checkout.session events that can carry a victim booking id (Payment Links or pricing tables accepting client_reference_id from the URL, another integration, or a second install of this template sharing the account with colliding sequential ids) is a Stripe account fact not visible in the repository
- Whether /webhooks/stripe is subscribed account-wide to checkout.session.completed / async_payment_succeeded from those sources is a Stripe Dashboard setting not visible in the repository

### Como resolver
- **Local:** Already observed (agents/h-platform/artifacts/check-1.txt): dummy booking with payment_ref cs_REAL, deposit_cents 5000; a webhook signed with the dummy secret for session cs_OTHER_SOURCE, amount_total 50, client_reference_id=<id> moved it to paid/confirmed. Regression: require obj.id === b.payment_ref and obj.amount_total >= b.deposit_cents with currency eur before paid(); assert booking stays pending.
- **Dono (Stripe Dashboard, modo de teste, só leitura):** Owner checks in the Stripe Dashboard (test mode) whether the account has Payment Links, pricing tables or other Checkout integrations, and whether the /webhooks/stripe endpoint subscribes to checkout.session.* account-wide; optionally open a test Payment Link with ?client_reference_id=<a test booking id> on a test install and confirm the booking flips to paid.
