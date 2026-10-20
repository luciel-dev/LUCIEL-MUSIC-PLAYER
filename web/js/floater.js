/* Host page for the desktop floater window (Electron). The mini player here is a remote control: state arrives from the
 * main window over IPC (window.lucielMiniHost, see luciel-desktop/preload-mini.js) and button presses go back the same way. */
(function () {
  'use strict';
  const H = window.lucielMiniHost;
  const body = document.body;
  const mini = window.LucielMini.mount(body, {
    kind: 'window',
    send: (c, a) => H && H.send(c, a),
    onTheme: (palette, skin) => { body.dataset.palette = palette; body.dataset.skin = skin; document.documentElement.style.background = getComputedStyle(body).getPropertyValue(skin === 'classic' ? '--c-frame-3' : '--bg-2'); },
  });
  window.__mini = mini;
  if (!H) { mini.update({ title: 'Open Luciel to use the mini player', artist: '' }); return; }
  H.onState((s) => mini.update(s));
  H.onWin((w) => { if ('pinned' in w) mini.setPinned(w.pinned); if (w.mode) mini.setLarge(w.mode === 'large'); });
  H.ready();
})();
