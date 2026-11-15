/* Seletor de dia + hora reutilizável (faixa de dias e horários em células de painel).
   Uso: Picker({ root, base: '/api', params: () => ({ service, staff, token }), selected: { date, time }, onChange }) */
(function () {
  'use strict';
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const longDate = (s) => { const d = parse(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  window.Picker = function ({ root, base = '/api', params, selected = {}, onChange = () => {} }) {
    root.innerHTML = `<div class="days-wrap"><p class="days-month" aria-live="polite"></p><div class="days" role="radiogroup" aria-label="Dia"></div></div><div class="slots" aria-live="polite"></div>`;
    const monthEl = root.querySelector('.days-month'), daysEl = root.querySelector('.days'), slotsEl = root.querySelector('.slots');
    let date = selected.date || '', time = selected.time || '', req = 0;
    const emit = () => onChange({ date, time });
    const skeleton = () => `<div class="skel" aria-label="A carregar horários">${'<span></span>'.repeat(8)}</div>`;

    async function loadDays() {
      const id = ++req;
      daysEl.innerHTML = '';
      slotsEl.innerHTML = skeleton();
      const res = await fetch(`${base}/days?${qs(params())}`).then((r) => r.json());
      if (id !== req) return;
      const avail = new Set(res.days);
      if (!avail.has(date)) { date = res.days[0] || ''; time = ''; }
      let html = '', month = -1;
      const start = parse(res.today);
      for (let i = 0; i <= res.maxDays; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const key = ymd(d);
        if (d.getMonth() !== month) {
          if (month !== -1) html += `<span class="day-month" aria-hidden="true">${MONTHS[d.getMonth()].slice(0, 3)}</span>`;
          month = d.getMonth();
        }
        const ok = avail.has(key), on = key === date;
        html += `<button type="button" class="day" role="radio" data-date="${key}" aria-checked="${on}" ${ok ? '' : 'disabled'} tabindex="${on ? 0 : -1}" aria-label="${longDate(key)}${ok ? '' : ', sem vagas'}"><span class="day-wd">${i === 0 ? 'Hoje' : WD[d.getDay()]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot"></span></button>`;
      }
      daysEl.innerHTML = html;
      const sel = daysEl.querySelector('[aria-checked="true"]');
      if (sel) daysEl.scrollLeft = sel.offsetLeft - daysEl.clientWidth / 2 + sel.offsetWidth / 2;
      if (date) loadSlots();
      else { monthEl.textContent = ''; slotsEl.innerHTML = `<div class="slots-empty"><p>Sem vagas online nos próximos ${res.maxDays} dias.</p></div>`; }
      emit();
    }

    async function loadSlots() {
      const id = ++req;
      monthEl.textContent = longDate(date);
      slotsEl.innerHTML = skeleton();
      const res = await fetch(`${base}/slots?${qs({ ...params(), date })}`).then((r) => r.json());
      if (id !== req) return;
      if (!res.slots.length) { slotsEl.innerHTML = '<div class="slots-empty"><p>Este dia acabou de ficar cheio. Escolha outro.</p></div>'; return; }
      const groups = [['Manhã', (s) => s.start < 780], ['Tarde', (s) => s.start >= 780 && s.start < 1080], ['Fim do dia', (s) => s.start >= 1080]];
      let k = 0;
      slotsEl.innerHTML = '<div role="radiogroup" aria-label="Hora">' + groups.map(([g, f]) => {
        const l = res.slots.filter(f);
        return l.length ? `<div class="slot-group"><span class="slot-label">${g}</span><div class="slot-list">${l.map((s) =>
          `<button type="button" class="slot is-in" role="radio" aria-checked="${s.time === time}" data-time="${s.time}" style="animation-delay:${Math.min(k++, 14) * 18}ms">${s.time}</button>`).join('')}</div></div>` : '';
      }).join('') + '</div>';
    }

    function selectDay(btn) {
      if (!btn || btn.disabled) return;
      daysEl.querySelectorAll('.day').forEach((d) => { const on = d === btn; d.setAttribute('aria-checked', on); d.tabIndex = on ? 0 : -1; });
      date = btn.dataset.date; time = '';
      loadSlots(); emit();
    }
    daysEl.addEventListener('click', (e) => selectDay(e.target.closest('.day')));
    daysEl.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      e.preventDefault();
      const list = [...daysEl.querySelectorAll('.day:not(:disabled)')];
      const t = list[list.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (t) { selectDay(t); t.focus(); }
    });
    slotsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.slot');
      if (!b) return;
      time = b.dataset.time;
      slotsEl.querySelectorAll('.slot').forEach((s) => s.setAttribute('aria-checked', s === b));
      if (navigator.vibrate) navigator.vibrate(8);
      emit();
    });

    loadDays();
    return { reload: loadDays, value: () => ({ date, time }), longDate };
  };
})();
