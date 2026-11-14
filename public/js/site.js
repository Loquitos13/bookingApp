(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DIGITS = '0123456789';
  const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVZ';

  /* --- split-flap: cada célula "bate" até ao seu carácter final --- */
  function strikeCell(cell, final, delay) {
    const pool = /\d/.test(final) ? DIGITS : LETTERS;
    const flips = 3 + Math.floor(Math.random() * 4);
    let n = 0;
    setTimeout(function tick() {
      cell.classList.remove('is-striking');
      void cell.offsetWidth; // reinicia a animação
      cell.classList.add('is-striking');
      cell.textContent = n < flips ? pool[Math.floor(Math.random() * pool.length)] : final;
      if (n++ < flips) setTimeout(tick, 75);
    }, delay);
  }
  window.strikeFlaps = function (root) {
    if (reduce) return;
    root.querySelectorAll('.flap').forEach((flap, row) => {
      flap.querySelectorAll('.flap-cell').forEach((cell, i) => {
        const final = cell.dataset.ch || cell.textContent;
        strikeCell(cell, final, row * 120 + i * 55);
      });
    });
  };
  const board = document.querySelector('.board');
  if (board && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { window.strikeFlaps(board); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(board);
  }
  const newTicket = document.querySelector('.ticket.is-new');
  if (newTicket) setTimeout(() => window.strikeFlaps(newTicket), 450);

  /* --- relógio do painel --- */
  const clock = document.querySelector('[data-clock]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
    const set = () => (clock.textContent = fmt.format(new Date()));
    set();
    setInterval(set, 15000);
  }

  /* --- doca inferior: esconde ao descer, volta ao subir --- */
  const dock = document.querySelector('.dock');
  // na página inicial a doca só aparece depois de o botão Marcar do painel sair do ecrã
  const boardCta = document.querySelector('.board-foot .btn');
  let ctaVisible = !!boardCta;
  if (dock && boardCta && 'IntersectionObserver' in window) {
    dock.classList.add('is-hidden');
    new IntersectionObserver((e) => {
      ctaVisible = e[0].isIntersecting || e[0].boundingClientRect.top > window.innerHeight;
      dock.classList.toggle('is-hidden', ctaVisible);
    }).observe(boardCta);
  } else ctaVisible = false;
  if (dock) {
    let last = window.scrollY, ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const nearBottom = window.innerHeight + y > document.body.scrollHeight - 120;
        dock.classList.toggle('is-hidden', ctaVisible || (y > last && y > 240 && !nearBottom));
        last = y;
        ticking = false;
      });
    }, { passive: true });
  }

  /* --- menu: fecha ao escolher, com Esc ou ao tocar fora --- */
  const menu = document.querySelector('.menu');
  if (menu) {
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.open = false; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
    menu.addEventListener('toggle', () => { document.documentElement.style.overflow = menu.open ? 'hidden' : ''; });
  }

  /* --- folhas (dialog) --- */
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) document.getElementById(opener.dataset.open)?.showModal();
    const closer = e.target.closest('[data-close]');
    if (closer) closer.closest('dialog')?.close();
  });
  document.querySelectorAll('dialog.sheet').forEach((d) =>
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); })
  );

  /* --- partilhar --- */
  document.querySelectorAll('[data-share]').forEach((b) => {
    if (!navigator.share) return;
    b.hidden = false;
    b.addEventListener('click', () => navigator.share({ title: b.dataset.title, text: b.dataset.text, url: location.href.split('?')[0] }).catch(() => {}));
  });

  /* --- campos: só mostra erro depois de o utilizador sair do campo --- */
  document.addEventListener('blur', (e) => {
    if (e.target.matches && e.target.matches('input, textarea')) e.target.classList.add('is-touched');
  }, true);
})();
