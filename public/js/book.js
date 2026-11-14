(function () {
  'use strict';
  const data = JSON.parse(document.getElementById('booking-data').textContent);
  const form = document.getElementById('booking');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const steps = $$('.step', form);
  const route = $$('.route li');
  const next = $('#next');
  const barSum = $('#bar-sum');
  const daysEl = $('#days');
  const slotsEl = $('#slots');
  const monthEl = $('#days-month');
  const fDate = $('#f-date');
  const fTime = $('#f-time');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const euros = (c) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(c / 100);
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const shortDate = (s) => { const d = parse(s); return `${WD[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  const longDate = (s) => { const d = parse(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };

  let step = 1, reached = 1, today = null, reqId = 0, firstCache = {};

  const val = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
  const service = () => data.services.find((s) => String(s.id) === val('serviceId'));
  const staff = () => data.staff.find((p) => String(p.id) === val('staffId'));
  const staffFor = (sid) => data.links.filter((l) => l.service_id === +sid).map((l) => l.staff_id);
  const relDay = (s) => (s === today ? 'hoje' : today && s === ymd(new Date(parse(today).getTime() + 864e5)) ? 'amanhã' : shortDate(s));

  /* ---------- navegação entre passos ---------- */
  function go(n, { push = true, back = false } = {}) {
    n = Math.max(1, Math.min(4, n));
    if (n === 2 && service() && staffFor(service().id).length <= 1) n = back ? 1 : 3; // só há um profissional: salta
    step = n;
    reached = Math.max(reached, n);
    steps.forEach((s) => {
      const on = +s.dataset.step === n;
      s.classList.toggle('is-active', on);
      s.classList.toggle('from-back', on && back);
    });
    route.forEach((li) => {
      const k = +li.dataset.route;
      li.classList.toggle('is-current', k === n);
      li.classList.toggle('is-done', k < n || (k <= reached && k !== n && isDone(k)));
      li.querySelector('button').disabled = !(k < n || (k <= reached && isDone(k - 1)));
      if (k === n) li.querySelector('button').setAttribute('aria-current', 'step'); else li.querySelector('button').removeAttribute('aria-current');
    });
    if (push) history.pushState({ step: n }, '', urlFor());
    else history.replaceState({ step: n }, '', urlFor());
    if (n === 2) loadFirst();
    if (n === 3) loadDays();
    update();
    const title = $(`.step[data-step="${n}"] .step-title`);
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    title && title.focus({ preventScroll: true });
  }
  const isDone = (k) => (k === 1 ? !!service() : k === 2 ? !!service() : k === 3 ? !!(fDate.value && fTime.value) : false);

  function urlFor() {
    const p = new URLSearchParams();
    if (val('serviceId')) p.set('servico', val('serviceId'));
    if (val('staffId')) p.set('profissional', val('staffId'));
    if (fDate.value) p.set('dia', fDate.value);
    if (fTime.value) p.set('hora', fTime.value);
    const q = p.toString();
    return location.pathname + (q ? '?' + q : '');
  }
  window.addEventListener('popstate', (e) => { if (e.state && e.state.step) go(e.state.step, { push: false, back: e.state.step < step }); });
  $$('.route-stop').forEach((b) => b.addEventListener('click', () => { const n = +b.dataset.goto; if (n !== step) go(n, { back: n < step }); }));

  /* ---------- resumo (barra, rota, talão) ---------- */
  function update() {
    const svc = service(), p = staff();
    const when = fDate.value && fTime.value ? `${relDay(fDate.value)} · ${fTime.value}` : '';
    const set = (key, text) => $$(`[data-value="${key}"]`).forEach((el) => (el.textContent = text));
    set('service', svc ? svc.name : '—');
    set('staff', svc ? (p ? p.name.split(' ')[0] : 'Qualquer') : '');
    set('staff-long', p ? `Com ${p.name}` : 'Primeiro profissional livre');
    set('when', when);
    set('when-long', fDate.value && fTime.value ? `${longDate(fDate.value)} · ${fTime.value}` : '—');
    set('price', svc ? `${euros(svc.price_cents)} · ${svc.duration_min} min` : '—');

    if (!svc) barSum.textContent = 'Escolha um serviço';
    else barSum.innerHTML = `<b>${escapeHtml(svc.name)}</b> · ${svc.duration_min} min · ${euros(svc.price_cents)}${when ? ` · <b>${when}</b>` : ''}`;

    const ready = step === 1 ? !!svc : step === 2 ? true : step === 3 ? !!(fDate.value && fTime.value) : true;
    next.disabled = !ready;
    next.firstChild.textContent = step === 4 ? 'Confirmar ' : 'Continuar ';
  }
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  next.addEventListener('click', () => {
    if (step < 4) return go(step + 1);
    submit();
  });

  function submit() {
    const invalid = $$('input, textarea', $('.step[data-step="4"]')).filter((el) => !el.checkValidity());
    if (invalid.length) {
      invalid.forEach((el) => el.classList.add('is-touched'));
      invalid[0].focus();
      return;
    }
    next.disabled = true;
    next.firstChild.textContent = 'A confirmar… ';
    form.submit();
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  /* ---------- passo 1: serviço ---------- */
  form.addEventListener('change', (e) => {
    if (e.target.name === 'serviceId') {
      const allowed = staffFor(e.target.value);
      $$('[data-staff]').forEach((el) => { const id = el.dataset.staff; el.hidden = id !== '' && !allowed.includes(+id); });
      if (val('staffId') && !allowed.includes(+val('staffId'))) form.querySelector('input[name="staffId"][value=""]').checked = true;
      fDate.value = ''; fTime.value = ''; firstCache = {};
      update();
      setTimeout(() => go(2), reduce ? 0 : 200);
    } else if (e.target.name === 'staffId') {
      fTime.value = '';
      update();
      setTimeout(() => go(3), reduce ? 0 : 200);
    }
  });

  // tocar numa opção já escolhida também avança
  form.addEventListener('click', (e) => {
    const opt = e.target.closest('.opt');
    if (!opt || e.target.matches('input')) return;
    const input = opt.querySelector('input');
    if (input && input.checked) { e.preventDefault(); go(input.name === 'serviceId' ? 2 : 3); }
  });

  /* ---------- passo 2: primeira vaga de cada profissional ---------- */
  async function loadFirst() {
    const svc = service();
    if (!svc) return;
    const res = firstCache[svc.id] || (firstCache[svc.id] = await fetch(`/api/first?service=${svc.id}`).then((r) => r.json()).catch(() => null));
    if (!res) return;
    today = res.today;
    Object.entries(res.first).forEach(([k, f]) => {
      const el = $(`[data-first="${k}"]`);
      if (!el) return;
      const label = $(`[data-staff="${k === 'any' ? '' : k}"]`);
      if (f) { el.innerHTML = `1.ª vaga <b>${relDay(f.date)} ${f.time}</b>`; label && label.classList.remove('is-full'); }
      else { el.textContent = 'Sem vagas online'; }
    });
  }

  /* ---------- passo 3: dias e horários ---------- */
  async function loadDays() {
    const svc = service();
    if (!svc) return;
    const id = ++reqId;
    daysEl.innerHTML = '';
    slotsEl.innerHTML = skeleton();
    const res = await fetch(`/api/days?service=${svc.id}&staff=${val('staffId')}`).then((r) => r.json());
    if (id !== reqId) return;
    today = res.today;
    const avail = new Set(res.days);
    if (!avail.has(fDate.value)) { fDate.value = res.days[0] || ''; fTime.value = ''; }
    let html = '', month = -1;
    const start = parse(res.today);
    for (let i = 0; i <= res.maxDays; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = ymd(d);
      if (d.getMonth() !== month) {
        if (month !== -1) html += `<span class="day-month" aria-hidden="true">${MONTHS[d.getMonth()].slice(0, 3)}</span>`;
        month = d.getMonth();
      }
      const ok = avail.has(key), on = key === fDate.value;
      html += `<button type="button" class="day" role="radio" data-date="${key}" aria-checked="${on}" ${ok ? '' : 'disabled'} tabindex="${on ? 0 : -1}"
        aria-label="${longDate(key)}${ok ? '' : ', sem vagas'}"><span class="day-wd">${i === 0 ? 'Hoje' : WD[d.getDay()]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot"></span></button>`;
    }
    daysEl.innerHTML = html;
    const sel = $('.day[aria-checked="true"]', daysEl);
    if (sel) daysEl.scrollLeft = sel.offsetLeft - daysEl.clientWidth / 2 + sel.offsetWidth / 2;
    if (fDate.value) loadSlots();
    else {
      monthEl.textContent = '';
      slotsEl.innerHTML = `<div class="slots-empty"><p>Sem vagas online nos próximos ${res.maxDays} dias${val('staffId') ? ' com este profissional' : ''}.</p>
        ${val('staffId') ? '<button type="button" class="btn btn-ink" data-any>Ver com qualquer profissional</button>' : '<p>Ligue-nos: encontramos um horário consigo.</p>'}</div>`;
    }
  }

  function selectDay(btn) {
    if (!btn || btn.disabled) return;
    $$('.day', daysEl).forEach((d) => { const on = d === btn; d.setAttribute('aria-checked', on); d.tabIndex = on ? 0 : -1; });
    fDate.value = btn.dataset.date;
    fTime.value = '';
    loadSlots();
    update();
    history.replaceState({ step }, '', urlFor());
  }
  daysEl.addEventListener('click', (e) => selectDay(e.target.closest('.day')));
  daysEl.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const list = $$('.day:not(:disabled)', daysEl);
    const i = list.indexOf(document.activeElement);
    const t = list[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (t) { selectDay(t); t.focus(); }
  });

  const skeleton = () => `<div class="skel" aria-label="A carregar horários">${'<span></span>'.repeat(8)}</div>`;

  async function loadSlots() {
    const svc = service();
    if (!svc || !fDate.value) return;
    const id = ++reqId;
    monthEl.textContent = longDate(fDate.value);
    slotsEl.innerHTML = skeleton();
    const res = await fetch(`/api/slots?service=${svc.id}&staff=${val('staffId')}&date=${fDate.value}`).then((r) => r.json());
    if (id !== reqId) return;
    if (!res.slots.length) { slotsEl.innerHTML = '<div class="slots-empty"><p>Este dia acabou de ficar cheio. Escolha outro dia.</p></div>'; return; }
    const groups = [['Manhã', (s) => s.start < 780], ['Tarde', (s) => s.start >= 780 && s.start < 1080], ['Fim do dia', (s) => s.start >= 1080]];
    let k = 0;
    slotsEl.innerHTML = `<div role="radiogroup" aria-label="Hora">` + groups.map(([g, f]) => {
      const l = res.slots.filter(f);
      if (!l.length) return '';
      return `<div class="slot-group"><span class="slot-label">${g}</span><div class="slot-list">${l.map((s) => {
        const on = s.time === fTime.value;
        return `<button type="button" class="slot is-in" role="radio" aria-checked="${on}" data-time="${s.time}" style="animation-delay:${Math.min(k++, 14) * 18}ms">${s.time}</button>`;
      }).join('')}</div></div>`;
    }).join('') + '</div>';
  }

  slotsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-any]')) { form.querySelector('input[name="staffId"][value=""]').checked = true; update(); loadDays(); return; }
    const b = e.target.closest('.slot');
    if (!b) return;
    fTime.value = b.dataset.time;
    $$('.slot', slotsEl).forEach((s) => s.setAttribute('aria-checked', s === b));
    update();
    history.replaceState({ step }, '', urlFor());
    if (navigator.vibrate) navigator.vibrate(8);
  });

  /* ---------- passo 4 ---------- */
  const noteBtn = $('#add-note');
  noteBtn && noteBtn.addEventListener('click', () => {
    const n = $('#note');
    n.hidden = false;
    noteBtn.hidden = true;
    n.querySelector('textarea').focus();
  });

  /* ---------- arranque ---------- */
  const errStep = +form.dataset.errorStep || 0;
  const svc = service();
  if (svc) {
    const allowed = staffFor(svc.id);
    $$('[data-staff]').forEach((el) => { const id = el.dataset.staff; el.hidden = id !== '' && !allowed.includes(+id); });
  }
  const params = new URLSearchParams(location.search);
  const start = errStep || (svc && fDate.value && fTime.value ? 4 : svc ? (params.get('profissional') ? 3 : 2) : 1);
  reached = start;
  go(start, { push: false });
})();
