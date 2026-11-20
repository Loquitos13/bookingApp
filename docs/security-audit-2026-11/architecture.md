# Architecture: bookingApp (run 2, profile quick)

## Product, principals, protected resources
Single-business appointment-booking template: public pt/en site with online booking and a back office at `/admin` (README.md:3). One install = one business, one Node process, one SQLite file.

Principals:
- **Anonymous visitor**: books (`POST /marcar`), joins waitlist, sends contact messages, reads slot APIs (src/routes/public.js).
- **Booking-token holder**: 48-hex `token` (src/security.js `randomToken`, src/availability.js createBooking) gives view, `.ics`, pay, reschedule, cancel inside `cancel_hours` (public.js `/marcacao/:token*`). Also accepted as `?token=` on `/api/days`, `/api/slots` (public.js `ignoreFor`). Never expires.
- **Waitlist-token holder**: `GET /lista-espera/:token/sair` (state change on GET).
- **Staff-calendar-token holder**: `staff.ics_token` reads one professional's bookings incl. customer names/notes (`GET /cal/:token.ics`).
- **Stripe webhook sender**: HMAC-SHA256 with 300 s tolerance (src/payments.js verifySignature), `applyEvent` trusts `metadata.booking_id`.
- **Back-office roles** (src/routes/admin.js top): owner (all); reception (denied `OWNER_ONLY` paths: settings, users, stats, services, staff, hours…); staff (allowlist `STAFF_ALLOWED`, `req.query.staff` forced to own id, `router.param('id')` ownership check only for `/marcacoes/:id`).
- **Operator**: env vars (docker-compose.yml).

Protected resources: customer PII (name, email, phone, notes) across bookings, clients, waitlist, messages; booking state and payment status; staff scoping between professionals; admin accounts and sessions; business settings (brand, deposit rules, URLs used in emails).

## Stack and deployment
Node ≥22.13, Express 4, EJS 7, multer, nodemailer, `node:sqlite` DatabaseSync with WAL and `BEGIN IMMEDIATE` (src/db.js `tx`, now re-entrant). No build. Docker `node:22-alpine`, `USER node`, `/data` volume, `NODE_ENV=production` (Dockerfile). Outbound: Stripe REST, Twilio, Cloudflare Turnstile (fails open on network error, src/security-mw.js), SMTP. Scheduler every 5 min in-process (src/scheduler.js). No CI, no plugin or IPC surface.

Offline tests: `node --test test/*.test.js` (8 files, 49 tests). Each uses `os.tmpdir()` + `DB_PATH`, `app.listen(0)` on loopback, dummy logins (`dono@teste.pt`/`segredo123` etc.), stubs mailer and Stripe fetch. Parent sandbox (scratchpad/sandbox.sh) runs them with loopback-only netns, all mounts read-only except the agent scratch, `env -i`, prlimit and timeout. Prohibited: npm install, `npm run icons`, docker, real provider keys, any push.

No comparable software is named in local docs; integrations follow Stripe Checkout webhook and iCalendar conventions.

## Entry surfaces and key paths
- `server.js`: Stripe webhook (raw body) → payments.applyEvent → booking status/emails; body parsers 100 kb; `/uploads` static (nosniff); `baseUrl` = `BASE_URL` or `req.protocol`+Host header → canonical, sitemap, staff feed URL, Stripe success/cancel URLs; `trust proxy` from `TRUST_PROXY`.
- `src/routes/public.js`: booking POST → createBooking (placeholders, tx) → Stripe checkout or notify emails; token routes via `bookingByToken`; `/cal/:token.ics` → src/ics.js (now UTC stamps, esc of `\ ; ,` and CR/LF); waitlist; contact → `messages` table rendered escaped in admin.
- `src/routes/admin.js`: login (lockout 10/15 min per IP, `next` must match `^/admin(/|?|$)`), role gate, dashboard/agenda (SQL concatenation of numeric `staffId`), bookings list/CSV (formula-escaped), booking actions (`status`, `details`, `move`, `reschedule`, `cancel_series`, `delete`), clients (history, JSON export, GDPR erase, `/api/clientes` autocomplete), packages, services, staff, hours, blocks, messages, users (temp passwords in page + email), settings (keys limited to DEFAULT_SETTINGS), logo upload (multer memory, magic bytes, generated name).
- `src/mailer.js`: plain-text emails/SMS with customer-controlled name/notes in body and in the business notification subject; `to` = customer email validated by `EMAIL_RE` (allows commas).
- Views: EJS escaped output; unescaped only for includes, brand CSS from validated hex, and JSON with `<` escaped. Client JS: picker/book/agenda use innerHTML on generated values and escaped names; service worker caches authenticated admin pages until a logout message.

## Trust boundaries and strongest visible control
1. Anonymous → booking store: rate limits (in-memory, per `req.ip`), honeypot, optional Turnstile, per-email cap, atomic tx with conflict check.
2. Token URL → single booking: 48-hex random token; no expiry or rotation.
3. Staff role → other professionals' data: path allowlist + forced `req.query.staff` + `router.param('id')` + `moveBooking` own-staff check. **Lead:** `action=move` uses `rescheduleBooking` with body `staffId`, not `moveBooking`; booking page `history` spans all staff.
4. Reception → owner functions: lower-cased, slash-stripped path gate.
5. Internet → payment state: HMAC; paid path does not compare `obj.id` with `payment_ref` nor amount with `deposit_cents`.
6. Cross-site browser → admin state: per-session CSRF token on authenticated POSTs; `/login`, `/logout` have none; SameSite=Lax; logo route checks CSRF after multer.
7. Host/proxy headers → links and rate keys: `BASE_URL` optional, `TRUST_PROXY` optional (deployment facts).

## Starting paths
server.js, src/routes/admin.js, src/routes/public.js, src/payments.js, src/auth.js, src/security.js, src/security-mw.js, src/availability.js, src/mailer.js, src/ics.js, src/scheduler.js, views/**, public/js/**.

## Prior coverage
Prior run (pre-597b3de) left 11 unvalidated candidates and 5 covered units, no findings.json. Source changed for all of them (fixes in 597b3de, 89bcdf9, 75e91a7, b488c0a). All are current revalidation work; nothing is carried as confirmed or excluded from hunting.

## Companion selection
- WEB-PROTOCOL-AND-AUTH.md: session cookie, CSRF, Host/forwarded-header trust (boundaries 6-7).
- CLIENT-SIDE.md: DOM sinks in public/js and admin service-worker cache.
- DATA-ISOLATION-AND-LIFECYCLE.md: staff-to-staff isolation, client export, GDPR erase.
- RESOURCE-EXHAUSTION-AND-AVAILABILITY.md: anonymous slot APIs, async error crash path.
- PROTOCOLS-RPC-AND-MESSAGING.md (webhook replay/ordering) selected only for the Stripe unit.
Excluded: AI-AND-LLM, MEMORY-SAFETY, DESKTOP-MOBILE-IPC, SUPPLY-CHAIN (no CI/release surface; 4 pinned deps), CLOUD-AND-DEPLOYMENT (single Dockerfile, no IAM/orchestration in source).
