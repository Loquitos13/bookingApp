# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated ("o que for melhor para os clientes e que seja escalável"). Chosen: keep the existing Node.js + Express + server-rendered EJS + vanilla CSS/JS with SQLite (`node:sqlite`). Reason: the end customers of each installed business mostly book from phones on mobile data, and server-rendered HTML with no client framework gives the fastest first paint, works without JS, and is indexable for local SEO. One install serves one business, so SQLite is enough; the data layer (`src/`) is isolated so it can move to Postgres or sit behind an API later without touching the views.

## Users

- **Business owner / front-desk staff** of a small appointment-based business (clinic, salon, studio, tutor, etc.). Uses the back office during the working day, often from a phone between appointments, to see today's schedule, confirm requests, add bookings taken by phone, and mark attendance. Occasionally from a desktop to configure services, staff, hours and time off.
- **End customer** of that business. Arrives on the public site, usually on a phone, wants to understand what is offered and book a free slot in under a minute without creating an account; later returns via an emailed link to view, cancel or (planned) reschedule.
- **Installer (the template owner)**: sets up a copy of the template for each client business, swapping brand, texts, services and staff.

## Product Purpose

A reusable, multi-niche template that gives any small appointment-based business an informative website with real-time online booking and a back office to manage the agenda. Success: a customer books in under a minute on a phone; the owner runs the day from the phone; the installer rebrands a new client without touching code.

## Positioning

Niche-neutral by design: no sector-specific vocabulary or imagery is baked into the structure; the demo uses one fictional example business, and everything sector-specific is content, editable in the back office. It shows only genuinely available slots (per staff member, service duration, hours, breaks, buffers, time off) and books atomically.

## Operating Context

- Installed per client by the template owner; each install is one business with its own domain, brand and data.
- Customers book without an account; identity is name, email and phone; a private tokenised link manages the booking.
- Owners take bookings by phone/walk-in too and enter them in the back office, sometimes forcing a slot outside availability.
- Language: European Portuguese (pt-PT); currency EUR; timezone Europe/Lisbon by default (configurable).
- Email notifications via SMTP when configured; otherwise logged.

## Capabilities and Constraints

- Public: home/info page, services, team, hours, contact form, 4-step booking flow, booking page with cancel.
- Back office: dashboard, day agenda per staff, bookings list/filter/CSV, booking detail (status, reschedule, notes, customer history), manual booking, services, staff, weekly hours with break, time-off blocks, messages, settings, password.
- Constraints: must work without client-side JS for core forms; mobile-first; no customer accounts.
- Planned (from docs/UI-PLAN.md, not yet built): online reschedule, .ics export, demo seed with relative dates, demo mode, clients list, week/month agenda, brand config file.
- Undecided: payments, SMS reminders, multi-user roles, multi-location.

## Brand Commitments

None binding. The template must be rebrandable: business name, colours, logo and copy are per-install content. The current demo business "Equilíbrio — Fisioterapia & Osteopatia" is fictional.

## Evidence on Hand

- No real testimonials, ratings, client logos, customer counts or photos exist. All demo content must be clearly fictional placeholder data (fictional names, `+351 210 000 000`, `@exemplo.pt` emails) and must never be presented as real proof.
- Planning doc: `docs/UI-PLAN.md`.

## Product Principles

1. Booking is the product: every public surface leads to a free slot in as few taps as possible.
2. Never show a dead end: only bookable options are offered, and empty states say what to do next.
3. The owner's day fits in one thumb: the most frequent back-office actions are reachable on a phone in one or two taps.
4. Content is swappable, structure is not: nothing sector-specific is hard-coded into layout or components.
5. Fast and resilient on any device: server-rendered first, JavaScript enhances.

## Accessibility & Inclusion

WCAG 2.2 AA as the target: keyboard and screen-reader operable booking flow, visible focus, 44px touch targets, reduced-motion respected, no colour-only status.
