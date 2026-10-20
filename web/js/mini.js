/* Luciel mini player ("floater"). One component, three hosts:
 *   - the Electron floater window (floater.html + js/floater.js, state/commands over IPC),
 *   - an in-page draggable overlay (browser build),
 *   - a Document Picture-in-Picture window (browser build, always on top) when the browser supports it.
 * It is a remote: audio always plays in the main window; the host pushes state with update() and the component sends
 * commands through opts.send(cmd, arg). Follows the current palette + skin (Aero glass / Classic pixel). */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const frac = (x) => x - Math.floor(x);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.6" height="16" rx="1.2"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.2"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="3" height="14" rx="1"/><path d="M20 5.7v12.6a.8.8 0 0 1-1.22.68L8.6 12.68a.8.8 0 0 1 0-1.36l10.18-6.3A.8.8 0 0 1 20 5.7z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><rect x="17" y="5" width="3" height="14" rx="1"/><path d="M4 5.7v12.6a.8.8 0 0 0 1.22.68l10.18-6.3a.8.8 0 0 0 0-1.36L5.22 5.02A.8.8 0 0 0 4 5.7z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9.2h3.3L12 5v14l-4.7-4.2H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.3 5.8a9 9 0 0 1 0 12.4"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9.2h3.3L12 5v14l-4.7-4.2H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m15.5 9.5 5 5m0-5-5 5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M14.5 3.5 20.5 9.5l-2.2.6-3.6 3.6.4 4.3-1.6 1.6-3.5-3.5L5.2 21 3 21l.0-2.2 4.8-4.8-3.5-3.5L5.9 8.9l4.3.4 3.6-3.6z"/></svg>',
    big: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/></svg>',
    small: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M10 5v5H5M14 19v-5h5M10 10 4 4M14 14l6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="2.6" rx="4.2" ry="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    pop: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M13 3h8v8M21 3l-9 9"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="m6 6 12 12M18 6 6 18"/></svg>',
  };

  function mount(host, opts) {
    const doc = host.ownerDocument, win = doc.defaultView;
    const base = opts.base || '';
    const A = (p) => (/^(blob:|data:|https?:|app:|file:)/.test(p || '') ? p : base + p);
    const MD = global.LUCIEL_MASCOT || { dance: {}, pixel: {} };
    const kind = opts.kind || 'overlay';          // 'window' | 'overlay' | 'pip'
    const imgs = new Map();
    const img = (src) => { if (!src) return null; let i = imgs.get(src); if (!i) { i = new Image(); i.decoding = 'async'; i.src = A(src); imgs.set(src, i); } return i; };
    const ready = (i) => i && i.complete && i.naturalWidth > 0;

    const root = doc.createElement('div');
    root.className = 'lm'; root.dataset.kind = kind; root.dataset.palette = 'aero'; root.dataset.skin = 'aero';
    root.innerHTML = `
      <div class="lm-tb">
        <span class="lm-tb-title"><img class="lm-tb-icon" src="${A('icons/favicon-16.png')}" alt=""><span>LUCIEL</span></span>
        <span class="lm-wbtns">
          <button class="lm-wb lm-pin" data-c="pin" title="Keep on top">${kind === 'overlay' ? I.pop : I.pin}</button>
          <button class="lm-wb lm-size" data-c="mode" title="Bigger (show art)">${I.big}</button>
          <button class="lm-wb lm-full" data-c="expand" title="Back to the full player">${I.full}</button>
          <button class="lm-wb lm-x" data-c="close" title="Close mini player">${I.close}</button>
        </span>
      </div>
      <div class="lm-body">
        <div class="lm-art" title="Click: cover art ⇄ Lucielle">
          <div class="lm-scene"></div>
          <img class="lm-cover" alt="" hidden>
          <canvas class="lm-luc"></canvas>
          <span class="lm-shine"></span>
        </div>
        <div class="lm-main">
          <div class="lm-text">
            <div class="lm-title"><span class="lm-title-in">Nothing playing</span></div>
            <div class="lm-artist">Luciel</div>
            <div class="lm-grip lm-grip-text" aria-hidden="true"></div>
          </div>
          <div class="lm-seek">
            <span class="lm-cur">0:00</span>
            <div class="lm-range lm-seekbar"><input type="range" class="lm-seek-in" min="0" max="1000" value="0" step="1" aria-label="Seek"><i class="lm-fill"></i></div>
            <span class="lm-dur">0:00</span>
          </div>
          <div class="lm-ctl">
            <button class="lm-b lm-prev" data-c="prev" title="Previous"><img class="lm-wing l" src="${A('mascot/ui/wingL.webp')}" alt="">${I.prev}</button>
            <button class="lm-b lm-play" data-c="toggle" title="Play / Pause"><span class="lm-halo"></span><span class="ic-play">${I.play}</span><span class="ic-pause">${I.pause}</span></button>
            <button class="lm-b lm-next" data-c="next" title="Next">${I.next}<img class="lm-wing r" src="${A('mascot/ui/wingR.webp')}" alt=""></button>
            <span class="lm-vol">
              <button class="lm-b lm-mute" data-c="mute" title="Mute"><span class="ic-vol">${I.vol}</span><span class="ic-mute">${I.mute}</span></button>
              <span class="lm-range lm-volbar"><input type="range" class="lm-vol-in" min="0" max="100" value="80" aria-label="Volume"><i class="lm-fill"></i></span>
            </span>
          </div>
        </div>
      </div>`;
    host.appendChild(root);
    const q = (s) => root.querySelector(s);
    const els = { title: q('.lm-title'), titleIn: q('.lm-title-in'), artist: q('.lm-artist'), cur: q('.lm-cur'), dur: q('.lm-dur'), seek: q('.lm-seek-in'), vol: q('.lm-vol-in'),
      cover: q('.lm-cover'), cv: q('.lm-luc'), art: q('.lm-art'), scene: q('.lm-scene'), pin: q('.lm-pin'), size: q('.lm-size') };
    if (kind === 'overlay' && !opts.canPop) els.pin.hidden = true;
    if (kind === 'pip') els.pin.hidden = true;
    if (kind === 'overlay') q('.lm-full').title = 'Close the mini player';

    let S = { title: '', artist: '', playing: false, time: 0, duration: 0, volume: 0.8, muted: false, palette: 'aero', skin: 'aero', bpm: 0, beatPos: 0, hasTracks: false };
    let at = performance.now(), seeking = false, artMode = 'auto', large = false, alive = true, pinned = !!opts.pinned;
    const send = (c, a) => { try { opts.send(c, a); } catch (e) {} };

    // ------------------------------------------------------------------ input
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const c = b.dataset.c;
      if (c === 'mode') { setLarge(!large); send('mode', large ? 'large' : 'compact'); return; }
      send(c);
    });
    els.art.addEventListener('click', () => { artMode = showingCover() ? 'luc' : 'cover'; paintArt(); });
    els.seek.addEventListener('input', () => { seeking = true; const p = +els.seek.value / 1000; setFill(els.seek, p); els.cur.textContent = fmt(p * S.duration); });
    els.seek.addEventListener('change', () => { send('seek', +els.seek.value / 1000); S.time = +els.seek.value / 1000 * S.duration; at = performance.now(); seeking = false; });
    els.vol.addEventListener('input', () => { const v = +els.vol.value / 100; setFill(els.vol, v); send('volume', v); });
    root.addEventListener('wheel', (e) => { e.preventDefault(); const v = clamp((S.muted ? 0 : S.volume) + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1); S.volume = v; S.muted = false; paintVol(); send('volume', v); }, { passive: false });
    const onKey = (e) => {
      if (e.target && e.target.tagName === 'INPUT' && /^(text|search)$/.test(e.target.type)) return;
      if (kind === 'overlay' && !root.contains(doc.activeElement)) return;      // in-page: only when the mini has focus
      const k = e.key; let h = true;
      if (k === ' ' || k === 'k') send('toggle'); else if (k === 'ArrowRight') send('seekBy', 5); else if (k === 'ArrowLeft') send('seekBy', -5);
      else if (k === 'ArrowUp') send('volume', clamp(S.volume + 0.05, 0, 1)); else if (k === 'ArrowDown') send('volume', clamp(S.volume - 0.05, 0, 1));
      else if (k === 'b' || k === 'B' || k === 'n') send('next'); else if (k === 'z' || k === 'Z' || k === 'p') send('prev'); else if (k === 'm' || k === 'M') send('mute');
      else h = false;
      if (h) { e.preventDefault(); e.stopPropagation(); }
    };
    doc.addEventListener('keydown', onKey, true);
    root.tabIndex = -1;

    // in-page overlay: drag by the body; resize with the corner grip (CSS resize) -> layout follows the size
    if (opts.dragHost) {
      let d = null;
      root.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button, input, .lm-art')) return;
        const r = opts.dragHost.getBoundingClientRect();
        if (e.clientX > r.right - 16 && e.clientY > r.bottom - 16) return;   // the resize grip
        d = { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId }; root.setPointerCapture(e.pointerId); root.classList.add('dragging');
      });
      root.addEventListener('pointermove', (e) => {
        if (!d || e.pointerId !== d.id) return;
        const W = win.innerWidth, H = win.innerHeight, w = opts.dragHost.offsetWidth, h = opts.dragHost.offsetHeight;
        opts.dragHost.style.left = clamp(e.clientX - d.x, 0, W - w) + 'px'; opts.dragHost.style.top = clamp(e.clientY - d.y, 0, H - h) + 'px';
        opts.dragHost.style.right = 'auto'; opts.dragHost.style.bottom = 'auto';
      });
      const end = (e) => { if (!d) return; d = null; root.classList.remove('dragging'); opts.onMoved && opts.onMoved(); };
      root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
    }
    const ro = new win.ResizeObserver(() => {
      const h = root.clientHeight, w = root.clientWidth;
      const want = h >= 190 && w >= 200;
      if (want !== large) setLarge(want, true);
      root.classList.toggle('narrow', w < 300);
      sizeCanvas(); fitTitle();
    });
    ro.observe(root);
    function setLarge(on, fromSize) {
      large = on; root.classList.toggle('large', on);
      els.size.innerHTML = on ? I.small : I.big; els.size.title = on ? 'Compact' : 'Bigger (show art)';
      if (!fromSize && opts.onMode) opts.onMode(on ? 'large' : 'compact');
      paintArt(); requestAnimationFrame(() => { sizeCanvas(); fitTitle(); });
    }

    // ------------------------------------------------------------------ state
    function setFill(input, p) { input.parentNode.style.setProperty('--p', (clamp(p, 0, 1) * 100).toFixed(2)); }
    function paintVol() { const v = S.muted ? 0 : S.volume; els.vol.value = Math.round(v * 100); setFill(els.vol, v); root.classList.toggle('muted', !!S.muted || S.volume === 0); }
    const showingCover = () => (artMode === 'cover' || (artMode === 'auto' && S.hasCover)) && !!S.cover;
    function paintArt() {
      const cov = showingCover();
      if (S.cover && els.cover.getAttribute('src') !== A(S.cover)) els.cover.src = A(S.cover);
      els.cover.hidden = !cov;
      root.classList.toggle('show-cover', cov);
      const th = S.skin === 'classic' ? (S.scenePx || S.sceneThumb) : S.sceneThumb;
      const bg = th ? `url("${A(th)}")` : '';
      if (els.scene.style.backgroundImage !== bg) els.scene.style.backgroundImage = bg;
    }
    function fitTitle() {
      const over = els.titleIn.scrollWidth - els.title.clientWidth;
      els.title.classList.toggle('scroll', over > 2);
      els.title.style.setProperty('--over', `${-Math.max(0, over) - 12}px`);
      els.title.style.setProperty('--dur', `${Math.max(6, over / 18 + 4)}s`);
    }
    function update(st) {
      const prev = S; S = Object.assign({}, S, st); at = performance.now();
      if (S.palette !== prev.palette || S.skin !== prev.skin || !root.dataset.init) {
        root.dataset.palette = S.palette; root.dataset.skin = S.skin; root.dataset.init = '1';
        if (opts.onTheme) opts.onTheme(S.palette, S.skin);
      }
      if (JSON.stringify(S.colorVars || null) !== JSON.stringify(prev.colorVars || null)) {   // scene colour theme from the main window
        for (const k of Object.keys(prev.colorVars || {})) root.style.removeProperty(k);
        for (const [k, v] of Object.entries(S.colorVars || {})) root.style.setProperty(k, v);
      }
      const title = S.title || (S.hasTracks ? 'Ready' : 'Nothing playing'), artist = S.title ? (S.artist || 'Unknown artist') : (S.hasTracks ? 'Press play' : 'Drop music into Luciel');
      if (els.titleIn.textContent !== title) { els.titleIn.textContent = title; els.title.title = title; requestAnimationFrame(fitTitle); }
      if (els.artist.textContent !== artist) els.artist.textContent = artist;
      root.classList.toggle('playing', !!S.playing); root.classList.toggle('has-cover', !!S.hasCover);
      els.dur.textContent = fmt(S.duration);
      paintVol(); paintArt();
      if (st.pinned !== undefined) setPinned(st.pinned);
      if (st.mode) setLarge(st.mode === 'large', true);
    }
    function setPinned(p) { pinned = !!p; els.pin.classList.toggle('on', pinned); if (kind === 'window') els.pin.title = pinned ? 'Pinned on top (click to unpin)' : 'Keep on top'; }
    setPinned(pinned);
    if (kind === 'overlay') els.pin.title = 'Pop out — always-on-top window (Picture-in-Picture)';

    // ------------------------------------------------------------------ Lucielle (tempo-synced) + clock
    let cw = 0, ch = 0;
    function sizeCanvas() {
      const r = els.cv.getBoundingClientRect(), pix = S.skin === 'classic';
      const dpr = pix ? 1 : Math.min(2, win.devicePixelRatio || 1);
      const W = Math.max(8, Math.round(r.width * dpr)), H = Math.max(8, Math.round(r.height * dpr));
      if (els.cv.width !== W || els.cv.height !== H) { els.cv.width = W; els.cv.height = H; }
      cw = W; ch = H;
    }
    function beatNow(now) { return S.playing && S.bpm ? S.beatPos + (now - at) / 1000 * S.bpm / 60 : now / 1000 * 0.9; }
    function tier() { const b = S.bpm; return !b ? 'mid' : b < 96 ? 'slow' : b <= 126 ? 'mid' : 'fast'; }
    function draw(now) {
      if (!alive) return;
      win.requestAnimationFrame(draw);
      // time (extrapolated between state pushes)
      if (!seeking) {
        const t = S.playing ? Math.min(S.duration || 0, S.time + (now - at) / 1000) : S.time;
        const p = S.duration ? t / S.duration : 0;
        els.seek.value = Math.round(p * 1000); setFill(els.seek, p); els.cur.textContent = fmt(t);
      }
      const g = els.cv.getContext('2d'); if (!cw) sizeCanvas();
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
      const cov = showingCover();
      if (cov && !large) return;                    // compact + cover: the cover fills the art box
      const beat = beatNow(now), ph = frac(beat), pulse = S.playing && S.bpm ? Math.exp(-ph * 7) : 0;
      root.style.setProperty('--pulse', pulse.toFixed(3));
      // in the big layout with a cover, Lucielle dances in the corner in front of it
      const box = cov ? { x: cw * 0.52, y: ch * 0.38, w: cw * 0.5, h: ch * 0.62 } : { x: 0, y: 0, w: cw, h: ch };
      if (S.skin === 'classic') return drawPixel(g, box, beat, now);
      const playing = S.playing && S.hasTracks;
      if (playing) {
        const d = MD.dance && MD.dance[tier()]; const sh = d && img(d.sheet);
        if (d && ready(sh)) {
          const bpm = S.bpm || d.loopBpm; let mult = 1; while (bpm * mult / d.loopBpm < 0.7) mult *= 2; while (bpm * mult / d.loopBpm > 1.45) mult /= 2;
          const beatsPerLoop = d.loopBpm * d.duration / 60, lb = (S.bpm ? beat : now / 1000 * d.loopBpm / 60) * mult;
          const f = Math.floor(frac(lb / beatsPerLoop) * d.frames) % d.frames;
          const s = Math.min(box.w, box.h) * 1.04;
          g.save(); g.translate(box.x + box.w / 2, box.y + box.h + s * 0.03); g.scale(1 + pulse * 0.02, 1 - pulse * 0.035);
          g.drawImage(sh, (f % d.cols) * d.size, Math.floor(f / d.cols) * d.size, d.size, d.size, -s / 2, -s, s, s);
          g.restore(); return;
        }
      }
      const idle = img(S.hasTracks ? 'mascot/poses/idle.webp' : 'mascot/poses/bored.webp');
      if (ready(idle)) {
        const t = now / 1000, s = Math.min(box.w, box.h) * 1.02, bob = -0.02 * (1 - Math.cos(TAU * t * 0.35)) * s;
        g.save(); g.translate(box.x + box.w / 2, box.y + box.h + s * 0.02 + bob); g.rotate(0.015 * Math.sin(TAU * t * 0.17));
        g.drawImage(idle, -s / 2, -s, s, s); g.restore();
      }
    }
    function drawPixel(g, box, beat, now) {
      const pm = MD.pixel || {}, playing = S.playing && S.hasTracks;
      const meta = playing ? pm.dance : pm.idle, sh = meta && img(meta.file);
      if (!meta || !ready(sh)) return;
      const f = (playing && S.bpm ? Math.floor(beat * 2) : Math.floor(now / 1000 * (playing ? 2.2 : 1.6))) % meta.frames;
      const k = Math.max(1, Math.floor(Math.min(box.h / (meta.h * 1.08), box.w / meta.w)));
      const w = meta.w * k, h = meta.h * k, bob = playing && S.bpm && frac(beat) < 0.2 ? -k : 0;
      g.imageSmoothingEnabled = false;
      g.drawImage(sh, f * meta.w, 0, meta.w, meta.h, Math.round(box.x + (box.w - w) / 2), Math.round(box.y + box.h - h + bob), w, h);
    }
    win.requestAnimationFrame(draw);
    if (opts.state) update(opts.state);
    return {
      el: root, update, setPinned, setLarge: (on) => setLarge(on, true), get large() { return large; },
      destroy() { alive = false; ro.disconnect(); doc.removeEventListener('keydown', onKey, true); root.remove(); },
    };
  }
  global.LucielMini = { mount };
})(window);
