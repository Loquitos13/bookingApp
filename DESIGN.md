---
name: Painel de Partidas
description: A rebrandable booking template drawn as a station departures board and a printed ticket.
colors:
  signal: "#f5c518"
  signal-press: "#e0b207"
  on-signal: "#12171d"
  danger: "#c2391f"
  board: "#12171d"
  board-raise: "#1a2129"
  cell-top: "#252e38"
  cell-bot: "#1c232b"
  slat: "rgba(242, 243, 238, 0.09)"
  on-board: "#f2f3ee"
  on-board-2: "#a9b3bc"
  enamel: "#f0efe9"
  enamel-2: "#e4e2da"
  paper: "#fcfbf7"
  office-bg: "#ebe9e3"
  ink: "#12171d"
  ink-2: "#46525d"
  rule: "rgba(18, 23, 29, 0.14)"
typography:
  display:
    fontFamily: "Big Shoulders Display, Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(3rem, 15.5vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.86
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Big Shoulders Display, Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.25rem, 9vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "0.005em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.01em"
  flap:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  button:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  cell: "0.12em"
  xs: "4px"
  slot: "6px"
  md: "8px"
  plate: "12px"
  board: "14px"
  sheet: "16px"
  pill: "999px"
spacing:
  gutter: "16px"
  gutter-wide: "28px"
  row: "14px"
  row-wide: "16px 24px"
  band: "64px"
  band-wide: "96px"
  container: "1180px"
  measure: "680px"
components:
  button-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-signal-hover:
    backgroundColor: "{colors.signal-press}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-board}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  flap-cell:
    backgroundColor: "{colors.cell-top}"
    textColor: "{colors.on-board}"
    typography: "{typography.flap}"
    rounded: "{rounded.cell}"
    width: "0.74em"
    height: "1.22em"
  departure-row:
    backgroundColor: "{colors.board}"
    textColor: "{colors.on-board}"
    padding: "14px 16px"
  departure-row-hover:
    backgroundColor: "{colors.board-raise}"
  slot:
    backgroundColor: "{colors.cell-top}"
    textColor: "{colors.on-board}"
    rounded: "{rounded.slot}"
    height: "52px"
  slot-selected:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
  option-row-selected:
    backgroundColor: "{colors.board}"
    textColor: "{colors.on-board}"
    padding: "16px 14px"
  day-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    width: "62px"
  day-chip-selected:
    backgroundColor: "{colors.board}"
    textColor: "{colors.on-board}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: "52px"
  plate:
    backgroundColor: "{colors.board}"
    textColor: "{colors.on-board}"
    rounded: "{rounded.plate}"
    padding: "22px 22px 20px"
  ticket-main:
    backgroundColor: "{colors.board}"
    textColor: "{colors.on-board}"
    rounded: "{rounded.board}"
    padding: "24px 22px 22px"
  ticket-stub:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.board}"
    padding: "20px 22px"
  last-seat-tag:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "1px 7px"
---

# Design System: Painel de Partidas

## Overview

**Creative North Star: "The Station Departures Board"**

The site is the business's departures board. What leaves next is a real free slot, set in split-flap cells and readable from across the room; booking it travels a four-station line and prints a ticket. The world is station enamel: a deep board ink for the dark regions (plate, board, ticket, footer, back-office sidebar), a warm enamel white for reading regions, and one signal colour that the installer swaps per client. A reserved signal red exists only for "última vaga" and errors.

Density is that of a timetable, not a brochure. Content is grouped by rows, by the board's thin slats and by heavy ink rules, never by white cards. Names, times and labels are painted in condensed sign-writer capitals; prose sits in a plain grotesk underneath. The back office is the same world in a working register: the same inks, flap cells and signal, with paper panels for dense forms.

Motion is mechanical. Values snap rather than tween: flap characters strike through random glyphs to their final value, staggered left to right and row by row; the ticket is issued with a clipped slide. Reduced motion swaps every one of these to instant. The world explicitly refuses the SaaS booking widget (white card, purple calendar, avatar row) and the spa-brochure hero.

**Key Characteristics:**
- Two inks plus one signal; no third hue anywhere on public surfaces.
- Every time of day is drawn in flap cells, never as plain text in a box.
- Grouping by rows, slats and rules; filled containers are dark objects (plate, board, ticket), not white cards.
- Condensed uppercase for anything a sign would carry; sentence-case grotesk for anything a person would read.
- Rebrand by swapping `signal` (and optionally `board`); structure never changes per client.

## Colors

Two inks and one signal: board ink and station enamel carry the whole interface, and a single yellow does the pointing.

### Primary
- **Flap Yellow** (`signal`): the brand colour and the only accent. The primary "Marcar" action, the selected slot, the current station on the route, the ticket stub, today's row in the hours table, the plate subtitle, the selection highlight and the focus halo on fields. On dark regions it may be text; on enamel it is only ever a fill under ink text.
- **Pressed Yellow** (`signal-press`): hover and pressed state of signal fills only.
- **Ink on Signal** (`on-signal`): text and icons placed on a signal fill. It equals the board ink by default and must be re-chosen for contrast whenever the signal is swapped.

### Tertiary
- **Signal Red** (`danger`): reserved. The "Última vaga / Últimas vagas" tag on the board, invalid field borders and error text, destructive buttons, the no-show badge. Error notices use a pale red tint with deep red text derived from it.

### Neutral
- **Board Ink** (`board`): the dark ink. Plate, departures board, dark bands, footer, ticket body, selected option rows and day chips, back-office sidebar, mobile tab bar and agenda header.
- **Raised Board** (`board-raise`): hover and "next up" state of rows on the board.
- **Flap Cell Top / Bottom** (`cell-top`, `cell-bot`): the two halves of every flap cell and every time slot; the hard split between them is the hinge.
- **Board Slat** (`slat`): hairline dividers between rows on dark regions.
- **Board White** (`on-board`) and **Board Grey** (`on-board-2`): primary and secondary text on board ink.
- **Station Enamel** (`enamel`): the public page ground and the sticky top bar, docks and sheets.
- **Worn Enamel** (`enamel-2`): tinted bands, row hover on enamel, cancelled ticket stub.
- **Ticket Paper** (`paper`): field and day-chip fills, pending ticket stub, back-office panels.
- **Office Ground** (`office-bg`): the back-office page ground, one step darker than enamel so paper panels separate.
- **Enamel Ink** (`ink`) and **Faded Ink** (`ink-2`): text on enamel. `ink` is also the heavy 2px rule and focus outline colour.
- **Enamel Rule** (`rule`): light dividers, ghost-button borders, field borders at rest.

### Named Rules
**The Two Inks One Signal Rule.** Every public surface is built from board ink, station enamel and the signal. No third hue, no gradients of colour, no tinted accents. Signal red is a reserved state, not a palette colour. The only extra colour in the system is the per-staff identity dot in the back office, which is user data.

**The Swap Rule.** A client rebrand changes `signal` (with `signal-press` and `on-signal` following it) and, if the client needs it, `board` (with `board-raise`, `cell-top`, `cell-bot` and `ink` re-derived from it). Nothing else changes per client: no layout, type or component edits. Every use of the signal must therefore read the token, never a literal yellow, and `on-signal` must be re-checked for at least 4.5:1 against the new signal.

**The Signal Points Rule.** The signal marks the one thing to do or the one thing chosen: the next action, the selected value, today, the current step. If two unrelated things on a screen are yellow, one of them is wrong.

## Typography

**Display Font:** Big Shoulders Display (with Barlow Condensed, Arial Narrow)
**Body Font:** Barlow (with system-ui, Segoe UI)
**Label/Flap Font:** Barlow Condensed (with Arial Narrow)

**Character:** A tall sign-painter condensed for the business name and section titles, a workmanlike condensed grotesk for everything a board or ticket would print, and a plain grotesk of the same family for reading. All three are self-hosted woff2 files under the SIL OFL.

### Hierarchy
- **Display** (800, clamp(3rem, 15.5vw, 6rem), 0.86): the business name on the enamel plate only. Uppercase, wraps anywhere rather than overflowing.
- **Headline** (800, clamp(2.25rem, 9vw, 3.75rem), 0.9): band titles. The same face at clamp(2.5rem, 11vw, 4rem) heads the booking page, clamp(2rem, 8.5vw, 2.75rem) each booking step, clamp(2.75rem, 13vw, 4.5rem) the ticket page.
- **Title** (Barlow Condensed 700, 1.5rem, 1.05): service names in the timetable, staff names, station names. Uppercase. Steps down to 1.25–1.3125rem inside board rows and option rows.
- **Flap** (Barlow Condensed 700, 1.75rem, tabular figures): every time, initials and reference; 2rem on desktop boards, 2.5–3.5rem on the ticket, 1.25rem as the small variant.
- **Body** (Barlow 400, 1.0625rem, 1.55): intros, descriptions, bios, answers. Measure 54–64ch.
- **Button** (Barlow Condensed 700, 1.0625rem, 0.04em, uppercase): every button and action label.
- **Label** (Barlow Condensed 700, 0.8125rem, 0.12em, uppercase): board column heads, ticket and stub field names, day-of-week on chips. Field labels use 600 at 0.9375rem, 0.07em.

### Named Rules
**The Sign and Prose Rule.** If a station sign, board or ticket would print it (names, times, states, labels, buttons), it is condensed uppercase. If a person reads it as a sentence, it is Barlow in sentence case. Never set prose in caps; never set a time in the body face.

**The Tabular Time Rule.** Every number that can change (times, durations, prices, counts) uses tabular figures so values strike in place without shifting the row.

## Layout

Mobile-first, a single column at 390px with a 16px gutter that widens to 28px from 600px. Content sits in a centred container of 1180px; reading pages narrow to 680px. The departures board bleeds edge to edge on phones (negative gutter margins) and becomes a rounded panel from 900px.

The home opening is plate and intro, then the board starting above the fold on a phone; from 900px it is a two-column grid (1.05fr / 0.95fr, 56px gap) with the board as a tall right panel. Bands stack at 64px vertical padding (96px from 900px); a band head becomes two columns at 900px with the title left and its note bottom-aligned right. Services lay out as a timetable whose rows become four columns on desktop (name, description, duration and price, "Marcar"). Consecutive enamel bands are separated by a 2px ink rule rather than space alone.

The booking flow is one column with a fixed action bar; from 1024px a 320px sticky ticket stub sits beside a 720px main column. A fixed bottom dock (call + "Marcar") appears on phones once the board's own button has scrolled away, and is hidden from 900px. The back office is a 240px sticky board-ink sidebar plus fluid main (max 1320px); under 1000px it becomes a five-item bottom tab bar with a floating signal "+" button, and under 760px tables reflow into stacked rows.

Touch targets are at least 44px everywhere; primary buttons are 48px, large ones 56px, fields and slots 52px.

## Elevation & Depth

The system is flat. Depth comes from the two inks (dark objects on enamel ground), from slats and rules, and from the physical cues of the board itself: the flap cell's split gradient with a 1px dark hinge line. Shadows exist only where a real object would cast one.

### Shadow Vocabulary
- **Flap hinge** (`box-shadow: 0 1px 0 rgba(0, 0, 0, .5), inset 0 1px 0 rgba(255, 255, 255, .05)`): every flap cell; a lighter `0 1px 0 rgba(0, 0, 0, .35)` on slots.
- **Issued ticket** (`filter: drop-shadow(0 18px 24px rgba(18, 23, 29, .18)) drop-shadow(0 2px 3px rgba(18, 23, 29, .2))`): the printed ticket only, so the notched silhouette casts correctly.
- **Field halo** (`box-shadow: 0 0 0 4px` signal at 55% opacity): focused inputs, with the border turning ink.
- **Floating control** (`box-shadow: 0 8px 20px rgba(18, 23, 29, .3), 0 2px 4px rgba(18, 23, 29, .2)`): back-office floating "+" button and the "more" sheet on phones.

### Named Rules
**The Real Object Rule.** Only things that exist as objects in the world (a flap cell, a ticket, a floating button) carry a shadow. Panels, rows, bands and cards never lift.

## Shapes

Corners are gently rounded and consistent: 8px on buttons, fields, day chips and notices; 6px on time slots; 0.12em on flap cells; 12px on the enamel plate and back-office panels; 14px on the desktop board and the ticket; 16px on sheets (top corners only when docked to the bottom of a phone). Pills (999px) are reserved for back-office badges, counts and tally chips; circles for route stops, option ticks and status dots.

Borders are the main structural device: 1px slats on board ink, 1px rules on enamel, 2px ink rules between timetable rows, FAQ items and enamel bands, and 2px borders on fields and ghost buttons. The plate carries an inset 2px enamel-white keyline 7–9px inside its edge, like a painted station sign. The ticket is a single mask-cut silhouette: two semicircular notches (14px radius) where the body meets the stub, with a 2px dashed perforation between them; on desktop the stub moves to the right and the perforation turns vertical. The route is a 4px ink line threading 28px circular stops with 4px borders.

## Components

### Buttons
Heavy, squared-off and printed: condensed uppercase on a solid fill.
- **Shape:** gently rounded (8px), 2px border, 48px tall (40px small, 56px large), 20px side padding.
- **Signal:** flap yellow with ink text; the one primary action per view ("Marcar", "Confirmar"). Hover deepens to pressed yellow.
- **Ink:** board ink with board-white text, for secondary confirmations on enamel.
- **Ghost / Ghost on board:** transparent with a rule border that turns solid ink (or board white) on hover.
- **Danger:** signal red with white text, only for cancel-booking confirmations.
- **States:** press scales to 0.97 over 100ms; trailing arrow icons nudge 3px right on hover; disabled drops to 40% opacity; focus is a 3px ink outline offset 3px (signal on dark regions).

### Split-flap cells
The signature component. Each character of a time, initials or reference sits in its own cell (0.74em × 1.22em) with a top half in `cell-top`, a bottom half in `cell-bot` and a 1px black hinge across the middle; colons and spaces become narrower separator cells in board grey. When a board scrolls into view, loads, or a ticket is issued, every cell strikes through 3–6 random glyphs at 75ms intervals before landing, staggered 55ms per cell and 120ms per row; each strike is a 90ms vertical squash with a brightness flash. Reduced motion shows the final value immediately. The whole group carries the value as its accessible name; the cells are hidden from assistive tech.

### Departures board
Board-ink panel headed "Próximas vagas" in tracked board-grey label caps with a live clock. Each departure is a full-width link row: flap time, then service name in title caps and a meta line (day in signal, staff, duration) in board grey, then an arrow that slides 4px and turns signal on hover. Rows divide with slats and raise to `board-raise` on hover. A red "Última vaga" tag rides after the service name when one or two seats remain. The foot holds the full-width large signal "Marcar" button and a quiet "see all" link. Empty state says to call and gives the number.

### Lists: timetable, crew, option rows
No cards. Services are timetable rows between 2px ink rules; staff are crew rows between 1px rules, led by flap initials; booking choices (service, professional) are option rows with a 28px circular tick. A checked option row inverts to board ink, its meta turns board grey with the value in signal, and its tick fills signal. Hover on enamel rows is the worn-enamel tint.

### Inputs / Fields
- **Style:** paper fill, 2px rule border, 8px radius, 52px tall, Barlow 1.0625rem. Labels sit above in condensed uppercase faded ink.
- **Focus:** border turns ink and a 4px signal halo appears.
- **Error:** after first interaction an invalid field takes a signal-red border and its error line appears below in red.

### Day chips and time slots
Days scroll horizontally with snap: 62px paper chips with weekday label caps, a large display numeral and an availability dot; unavailable days fade to 30% ink with no border. The selected day inverts to board ink with a signal dot. Time slots are flap-gradient tiles (52px, 6px radius) in an auto-fill grid of 84px minimum; the selected slot fills signal. Slots enter with an 18ms stagger capped at 14 items; loading shows shimmering enamel placeholders of the same size.

### Route (booking stations)
Four stations (serviço, profissional, dia e hora, dados) on a 4px line. Done stations are filled ink and clickable to go back; the current station fills signal and scales to 1.12; future stations are rule-grey rings. Each station shows a label and the chosen value truncated beneath. The same line, horizontal from 900px, explains the flow on the home page, with the final stop in signal.

### Ticket
The confirmation is a printed ticket: board-ink body with the business name, the time in large flap cells, the date and a two-column fact list; a signal stub carries the state and the reference in display figures. Pending stubs are paper, cancelled stubs worn enamel with a faded body. A new ticket is issued with a 0.8s clip-path slide (down on phones, sideways on desktop), then its flaps strike. Actions below are full-width rows between rules.

### Navigation
A sticky enamel top bar (60px) with the mark (a 32px board-ink tile carrying the initial in signal) and the business name in display caps. From 900px a row of condensed uppercase links plus a signal "Marcar"; below it a 44px menu toggle opens a full-screen enamel sheet of large condensed links between rules. In the back office the sidebar is board ink with condensed links; the active link inverts to board white with ink text, and counts are signal pills.

### Back-office panels and badges
Paper panels (12px, 1px rule border) group dense forms and lists in the working register; a "hot" panel takes a 2px ink border. Status badges use only ink, signal and outline: confirmed is solid ink, pending is signal, completed is an outline, cancelled is an outline with strike-through, no-show is a red outline. The day board on the dashboard repeats the departures board, with the next booking raised and ringed in signal.

## Do's and Don'ts

### Do:
- **Do** draw every time of day, set of initials and booking reference in split-flap cells with tabular figures.
- **Do** rebrand a client by changing `signal` (and optionally `board`) and re-checking `on-signal` contrast; leave everything else alone.
- **Do** group by rows, slats and 2px ink rules; reserve filled containers for dark objects (plate, board, ticket, stub).
- **Do** keep the signal for the one primary action or the one selected value on a screen.
- **Do** set names, times, states, labels and buttons in condensed uppercase, and sentences in Barlow sentence case.
- **Do** make flap values strike mechanically (75ms flips, 55ms per cell, 120ms per row) and swap all motion to instant under reduced motion.
- **Do** keep touch targets at 44px or more, and give every status a word as well as a colour.

### Don't:
- **Don't** build the SaaS booking widget: no white booking card, no purple or blue calendar grid, no avatar row.
- **Don't** build a spa-brochure hero: the opening is the enamel plate and the live board, not a mood image with a tagline.
- **Don't** introduce a third hue, a gradient of colour, or a tinted accent on public surfaces.
- **Don't** use signal red for anything but "última vaga", errors and destructive actions.
- **Don't** put white cards with shadows on enamel; panels, rows and bands never lift.
- **Don't** tween a changing value (count-ups, cross-fades of times); values snap.
- **Don't** hard-code a literal yellow anywhere; read `signal` so the swap reaches it.
