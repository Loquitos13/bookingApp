/* Comportamentos comuns do back office (sem JavaScript inline, por causa da CSP). */
(function () {
  'use strict';
  // confirmar antes de ações destrutivas: data-confirm em botões ou formulários
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button[data-confirm], a[data-confirm]');
    if (el && !window.confirm(el.dataset.confirm)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) e.preventDefault();
  }, true);
  // submeter ao mudar
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
    const t = e.target.closest('[data-closed-toggle]');
    if (t) t.closest('tr').querySelector(`[name="${t.dataset.closedToggle}"]`).value = t.checked ? '' : '1';
  });
  // horário próprio: ativa/desativa a tabela
  const sh = document.getElementById('sh-form');
  if (sh) sh.addEventListener('change', (e) => { if (e.target.name === 'custom') sh.querySelector('.sh-table').toggleAttribute('data-disabled', e.target.value !== '1'); });
  // pré-visualização da cor da marca
  const bc = document.getElementById('brand-color');
  if (bc) {
    const pv = document.getElementById('brand-preview'), hx = document.getElementById('brand-hex');
    const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const paint = () => {
      const h = bc.value, L = lum(h), ink = 0.0094;
      const onDark = (Math.max(L, ink) + 0.05) / (Math.min(L, ink) + 0.05) >= (1.05) / (L + 0.05);
      pv.style.setProperty('--signal', h); pv.style.setProperty('--on-signal', onDark ? '#12171d' : '#ffffff'); hx.textContent = h;
    };
    bc.addEventListener('input', paint); paint();
  }
  // linhas de tabela clicáveis
  document.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button, input, select, label')) location.href = row.dataset.href;
  });
  // copiar para a área de transferência
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    navigator.clipboard.writeText(b.dataset.copy).then(() => { const o = b.textContent; b.textContent = 'Copiado'; setTimeout(() => (b.textContent = o), 1500); });
  });
  // menu "Mais" fecha ao tocar fora
  document.querySelectorAll('.tab-more').forEach((d) => document.addEventListener('click', (e) => { if (d.open && !d.contains(e.target)) d.open = false; }));
  // app instalável
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin' }).catch(() => {});
  let installEvt = null;
  const btns = () => document.querySelectorAll('.install-app');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; btns().forEach((b) => (b.hidden = false)); });
  btns().forEach((b) => b.addEventListener('click', () => {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.finally(() => { installEvt = null; btns().forEach((x) => (x.hidden = true)); });
  }));
})();
