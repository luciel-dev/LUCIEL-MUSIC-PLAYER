/* Luciel desktop shell layer (only active inside the Electron app, where window.lucielNative exists). */
(function () {
  'use strict';
  const N = window.lucielNative; if (!N || !N.isDesktop) return;
  const b = document.body;
  b.classList.add('desktop', 'desktop-' + N.platform);
  const svg = (d) => `<svg viewBox="0 0 10 10" aria-hidden="true">${d}</svg>`;
  const bar = document.createElement('header');
  bar.className = 'dtb'; bar.id = 'desktopTitlebar';
  bar.innerHTML = `<div class="dtb-drag" title=""><img class="dtb-icon" src="icons/favicon-32.png" alt=""><span class="dtb-title"><span><b>Luci</b>el</span></span><span class="dtb-now" id="dtbNow"></span></div>
    <div class="dtb-btns">
      <button class="dtb-btn min" id="dtbMin" title="Minimize">${svg('<path d="M0 5.5h10"/>')}</button>
      <button class="dtb-btn max" id="dtbMax" title="Maximize">${svg('<rect class="i-max" x=".5" y=".5" width="9" height="9"/><g class="i-restore"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></g>')}</button>
      <button class="dtb-btn close" id="dtbClose" title="Close">${svg('<path d="M.5.5l9 9M9.5.5l-9 9"/>')}</button>
    </div>`;
  b.prepend(bar);
  const classicTitle = () => { bar.querySelector('.dtb-title').innerHTML = b.classList.contains('skin-classic') ? '<span>Luciel</span>' : '<span><b>Luci</b>el</span>'; };
  document.getElementById('dtbMin').onclick = () => N.minimize();
  document.getElementById('dtbMax').onclick = () => N.toggleMaximize();
  document.getElementById('dtbClose').onclick = () => N.close();
  // double-click the bar = maximize / restore (Windows does this natively for drag regions)
  if (N.platform !== 'win32') bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) N.toggleMaximize(); });
  const setMax = (s) => { b.classList.toggle('win-max', !!s.maximized); b.classList.toggle('win-blur', s.focused === false); document.getElementById('dtbMax').title = s.maximized ? 'Restore' : 'Maximize'; };
  N.onWinState(setMax); N.winState().then(setMax);
  // tell the shell which skin is active (the page is zoomed to fit the window per skin)
  let skin = '';
  const sync = () => {
    const s = b.classList.contains('skin-classic') ? 'classic' : 'aero';
    if (s !== skin) { skin = s; N.setSkin(s); classicTitle(); }
    const now = document.title.replace(/\s*·\s*Luciel$/, ''); document.getElementById('dtbNow').textContent = now === 'Luciel' ? '' : now;
  };
  new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.querySelector('title') || document.head, { childList: true, subtree: true, characterData: true });
  sync();
})();
