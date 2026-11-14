(function () {
  'use strict';
  const data = JSON.parse(document.getElementById('booking-data').textContent);
  const form = document.getElementById('booking');
  const $ = (id) => document.getElementById(id);
  const calEl = $('calendar'), slotsEl = $('slots'), slotsTitle = $('slots-title');
  const fDate = $('f-date'), fTime = $('f-time'), submit = $('submit');

  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const euros = (c) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(c / 100);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const longDate = (s) => { const d = parse(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()}`; };

  let available = new Set(), today = null, maxDate = null, view = null, reqId = 0;

  const val = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
  const service = () => data.services.find((s) => String(s.id) === val('serviceId'));

  function filterStaff() {
    const sid = +val('serviceId');
    const allowed = new Set(data.links.filter((l) => l.service_id === sid).map((l) => l.staff_id));
    form.querySelectorAll('[data-staff]').forEach((el) => {
      const ok = !sid || allowed.has(+el.dataset.staff);
      el.hidden = !ok;
      const input = el.querySelector('input');
      if (!ok && input.checked) form.querySelector('input[name="staffId"][value=""]').checked = true;
    });
  }

  async function loadDays() {
    const svc = service();
    fTime.value = '';
    if (!svc) return;
    const id = ++reqId;
    calEl.innerHTML = '<p class="muted">A procurar dias disponíveis…</p>';
    slotsEl.innerHTML = '';
    slotsTitle.innerHTML = '&nbsp;';
    const res = await fetch(`/api/days?service=${svc.id}&staff=${val('staffId')}`).then((r) => r.json());
    if (id !== reqId) return;
    available = new Set(res.days);
    today = res.today;
    const td = parse(today);
    maxDate = new Date(td.getFullYear(), td.getMonth(), td.getDate() + res.maxDays);
    if (!available.has(fDate.value)) fDate.value = res.days[0] || '';
    const start = fDate.value ? parse(fDate.value) : td;
    view = { y: start.getFullYear(), m: start.getMonth() };
    renderCalendar();
    if (fDate.value) loadSlots();
    else slotsTitle.textContent = 'Sem horários disponíveis nas próximas semanas. Contacte-nos por telefone.';
    update();
  }

  function renderCalendar() {
    const { y, m } = view;
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const td = parse(today);
    const canPrev = new Date(y, m, 1) > new Date(td.getFullYear(), td.getMonth(), 1);
    const canNext = new Date(y, m + 1, 1) <= maxDate;
    let html = `<div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" ${canPrev ? '' : 'disabled'} aria-label="Mês anterior">‹</button>
      <strong>${MONTHS[m]} ${y}</strong>
      <button type="button" class="cal-nav" data-nav="1" ${canNext ? '' : 'disabled'} aria-label="Mês seguinte">›</button></div>
      <div class="cal-grid">${WD.map((w) => `<span class="cal-wd">${w}</span>`).join('')}`;
    for (let i = 0; i < offset; i++) html += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const key = ymd(y, m, d);
      const ok = available.has(key);
      html += `<button type="button" class="cal-day${key === fDate.value ? ' is-selected' : ''}${key === today ? ' is-today' : ''}"
        data-date="${key}" ${ok ? '' : 'disabled'} aria-pressed="${key === fDate.value}">${d}</button>`;
    }
    calEl.innerHTML = html + '</div>';
  }

  async function loadSlots() {
    const svc = service();
    if (!svc || !fDate.value) return;
    const id = ++reqId;
    slotsTitle.textContent = longDate(fDate.value);
    slotsEl.innerHTML = '<p class="muted">A carregar…</p>';
    const res = await fetch(`/api/slots?service=${svc.id}&staff=${val('staffId')}&date=${fDate.value}`).then((r) => r.json());
    if (id !== reqId) return;
    if (!res.slots.length) { slotsEl.innerHTML = '<p class="muted">Sem horários neste dia.</p>'; return; }
    const groups = { Manhã: [], Tarde: [] };
    res.slots.forEach((s) => groups[s.start < 780 ? 'Manhã' : 'Tarde'].push(s));
    slotsEl.innerHTML = Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) =>
      `<div class="slot-group"><span class="slot-label">${g}</span><div class="slot-list">${l.map((s) =>
        `<button type="button" class="slot${s.time === fTime.value ? ' is-selected' : ''}" data-time="${s.time}" role="option" aria-selected="${s.time === fTime.value}">${s.time}</button>`).join('')}</div></div>`
    ).join('');
  }

  function update() {
    const svc = service();
    const staffInput = form.querySelector('input[name="staffId"]:checked');
    const staff = staffInput && data.staff.find((p) => String(p.id) === staffInput.value);
    $('s-service').textContent = svc ? `${svc.name} (${svc.duration_min} min)` : '—';
    $('s-staff').textContent = staff ? staff.name : 'Sem preferência';
    $('s-date').textContent = fDate.value && svc ? longDate(fDate.value) : '—';
    $('s-time').textContent = fTime.value || '—';
    $('s-price').textContent = svc ? euros(svc.price_cents) : '—';
    submit.disabled = !(svc && fDate.value && fTime.value);
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'serviceId') { filterStaff(); loadDays(); }
    else if (e.target.name === 'staffId') loadDays();
    update();
  });

  calEl.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const d = new Date(view.y, view.m + +nav.dataset.nav, 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
      return renderCalendar();
    }
    const day = e.target.closest('[data-date]');
    if (day && !day.disabled) {
      fDate.value = day.dataset.date;
      fTime.value = '';
      renderCalendar();
      loadSlots();
      update();
    }
  });

  slotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-time]');
    if (!b) return;
    fTime.value = b.dataset.time;
    slotsEl.querySelectorAll('.slot').forEach((s) => {
      const on = s === b;
      s.classList.toggle('is-selected', on);
      s.setAttribute('aria-selected', on);
    });
    update();
    if (window.matchMedia('(max-width: 860px)').matches) $('step-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('submit', (e) => {
    if (!form.checkValidity()) {
      e.preventDefault();
      form.reportValidity();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'A confirmar…';
  });

  filterStaff();
  update();
  if (service()) loadDays();
})();
