/* Agenda: arrastar uma marcação para mudar a hora / profissional / dia, com "Desfazer". */
(function () {
  'use strict';
  const ag = document.querySelector('.agenda');
  if (!ag) return;
  const PPM = +ag.dataset.ppm, FROM = +ag.dataset.from, STEP = +ag.dataset.step || 15, CSRF = ag.dataset.csrf;
  const cols = [...ag.querySelectorAll('.ag-col')];
  const toast = document.getElementById('toast');
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  let toastT;

  function say(text, undo) {
    toast.textContent = text;
    if (undo) toast.insertAdjacentHTML('beforeend', ' <button type="button" class="toast-undo">Desfazer</button>');
    toast.hidden = false;
    toast.classList.remove('is-out');
    clearTimeout(toastT);
    toastT = setTimeout(() => { toast.classList.add('is-out'); setTimeout(() => (toast.hidden = true), 250); }, 6000);
    if (undo) toast.querySelector('.toast-undo').onclick = () => { clearTimeout(toastT); toast.hidden = true; undo(); };
  }

  async function save(el, target, force) {
    const r = await fetch('/admin/api/reagendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _csrf: CSRF, id: +el.dataset.id, date: target.date, start: target.start, staffId: target.staffId, force: !!force }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Não foi possível mover.');
    return j;
  }

  function place(el, col, start) {
    if (el.parentElement !== col) col.appendChild(el);
    el.dataset.start = start;
    el.style.top = (start - FROM) * PPM + 'px';
    el.style.left = '3px';
    el.style.width = 'calc(100% - 6px)';
    const t = el.querySelector('.ag-t');
    if (t) t.textContent = hhmm(start);
  }
  const colFor = (date, staffId) => cols.find((c) => c.dataset.date === date && (!c.dataset.staff || +c.dataset.staff === +staffId)) || null;

  ag.querySelectorAll('.ag-bk').forEach((el) => {
    let sx, sy, startTop, dragging = false, armed = false, holdT, target = null, moved = false;
    // é um link: desligar o "arrastar link" nativo do browser, que cancelaria o nosso
    el.setAttribute('draggable', 'false');
    el.addEventListener('dragstart', (e) => e.preventDefault());

    const begin = () => {
      dragging = true;
      el.classList.add('is-dragging');
      ag.classList.add('is-dragging');
      if (navigator.vibrate) navigator.vibrate(10);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; startTop = parseFloat(el.style.top); moved = false; target = null;
      armed = true;
      el.setPointerCapture(e.pointerId);
      // no toque, segurar ~0,35 s antes de arrastar (para não roubar o scroll)
      if (e.pointerType === 'touch') holdT = setTimeout(begin, 350);
    });
    el.addEventListener('pointermove', (e) => {
      if (!armed) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (e.pointerType === 'touch') { if (Math.hypot(dx, dy) > 8) { clearTimeout(holdT); armed = false; } return; }
        if (Math.hypot(dx, dy) < 5) return;
        begin();
      }
      e.preventDefault();
      moved = true;
      const dur = +el.dataset.dur;
      let start = FROM + Math.round((startTop + dy) / PPM / STEP) * STEP;
      start = Math.max(0, Math.min(24 * 60 - dur, start));
      const col = cols.find((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; }) || el.parentElement;
      el.style.top = (start - FROM) * PPM + 'px';
      el.style.transform = col !== el.parentElement ? `translateX(${col.getBoundingClientRect().left - el.parentElement.getBoundingClientRect().left}px)` : '';
      const t = el.querySelector('.ag-t');
      if (t) t.textContent = hhmm(start);
      cols.forEach((c) => c.classList.toggle('is-target', c === col));
      target = { col, date: col.dataset.date, start, staffId: col.dataset.staff || el.dataset.staff };
    });
    const end = async () => {
      clearTimeout(holdT);
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
      ag.classList.remove('is-dragging');
      el.style.transform = '';
      cols.forEach((c) => c.classList.remove('is-target'));
      const before = { col: el.parentElement, start: +el.dataset.start, staffId: el.dataset.staff, date: el.parentElement.dataset.date };
      if (!target || (target.col === before.col && target.start === before.start)) { place(el, before.col, before.start); return; }
      place(el, target.col, target.start);
      el.classList.add('is-saving');
      try {
        const j = await save(el, target);
        el.dataset.staff = j.booking.staffId;
        say(`Movida para ${hhmm(j.booking.start)} · ${j.booking.staffName}.`, async () => {
          try {
            await save(el, { date: j.before.date, start: j.before.start, staffId: j.before.staffId }, true);
            el.dataset.staff = j.before.staffId;
            place(el, colFor(j.before.date, j.before.staffId) || before.col, j.before.start);
            say('Alteração desfeita.');
          } catch (err) { say(err.message); }
        });
      } catch (err) {
        place(el, before.col, before.start);
        say(err.message + ' A marcação voltou ao sítio.');
      } finally {
        el.classList.remove('is-saving');
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { clearTimeout(holdT); armed = false; if (dragging) { dragging = false; el.classList.remove('is-dragging'); ag.classList.remove('is-dragging'); el.style.transform = ''; el.style.top = startTop + 'px'; } });
    // depois de arrastar, não abrir a marcação
    el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; } });
    el.addEventListener('contextmenu', (e) => { if (dragging) e.preventDefault(); });
  });

  // impede o scroll do telemóvel enquanto se arrasta
  document.addEventListener('touchmove', (e) => { if (ag.classList.contains('is-dragging')) e.preventDefault(); }, { passive: false });

  // levar a vista para a hora atual / primeira marcação
  const now = ag.querySelector('.ag-now') || ag.querySelector('.ag-bk');
  if (now) ag.scrollTop = Math.max(0, parseFloat(now.style.top) - 80);
})();
