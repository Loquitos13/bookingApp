---
version: 1
slug: "views-public-home-ejs"
primary_target: "views/public/home.ejs"
related_targets: ["views/public/book.ejs","views/public/booking.ejs"]
---

# Surface brief: public site + booking flow (+ back office reach)

Scope: public home (Persuade), booking flow and booking ticket page (Operate inside the same world), back office inherits the world in Operate register.
Audience/job: end customer on a phone learns what the business is, then books a free slot in under a minute. Owner runs the day from the board.
User answers: presentation of the business first, booking one thumb below it; avoid generic-SaaS look, avoid sector-specific look, avoid any slowness/confusion. Bold is acceptable.
Content: all demo data fictional (Equilíbrio is a placeholder business); no ratings, counts or testimonials presented as real.

## Direction contract

THESIS: The site is the business's departures board: what leaves next is a real free slot, readable from across the room, and booking it prints your ticket. Refuses the SaaS booking widget (white card, purple calendar, avatar row) and the spa-brochure hero.

OWN-WORLD: Station enamel and split-flap board. Two inks plus one signal, no third colour: enamel ground (deep board ink #12171d on dark regions; warm enamel white on reading regions), flap yellow as the signal/brand accent (swappable per client), signal red reserved for "última vaga"/errors. Condensed sign-painter caps for names and times, a plain grotesk for prose. No card boxes: grouping by rows, rules of the board's slats, and alignment. Flap cells for every time.

STORY: Visitor reads the enamel plate (who), the one-line promise and short intro (what), sees the board with next real departures (proof it works now), taps a row or Marcar, travels a four-station line (serviço, profissional, dia e hora, dados), receives a perforated ticket with reference, adds it to calendar.

FIRST VIEWPORT: Phone 390: enamel plate with business name in big condensed caps and subtitle, two-line intro, then the dark board starting above the fold: header "Próximas vagas", three flap rows (time cells, service, professional/day), full-width yellow "Marcar" bar fixed at the board foot. Desktop: plate and intro left column, board as a tall right panel at the same scale.

FORM: Departures board + printed ticket, candidate 6 of 7 on the ordered list (1 appointment card, 2 receptionist day book, 3 azulejo tiles, 4 take-a-number ticket, 5 shopfront fascia and door hours decal, 6 departures board and ticket, 7 calçada mosaic). seed:7b75b71f34fefcce. Raises: from the noir one-sheet, two inks plus one signal with no third colour anywhere; from the provenance ribbon, one continuous line ties the four booking steps as stations; from the cathode stack, values snap and never tween, the old flap decays as the new one strikes. Signature interaction: split-flap characters strike in sequence when slots load or change. Motion grammar: mechanical snaps, staggered left to right; the ticket slides out and tears along the perforation on confirm; reduced motion swaps to instant.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
