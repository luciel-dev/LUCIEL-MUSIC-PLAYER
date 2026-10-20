/* Luciel for Android – part 2 (runs after js/app.js): system integration + "Now playing on Spotify" scene mode. */
(function () {
  'use strict';
  const N = window.LucielAndroid, B = window.LucielAndroidBridge, L = window.LucielLazy;
  if (!N || !B || !window.Luciel || !window.Luciel.app) return;
  const A = window.Luciel.app, audio = A.engine.audio, $ = (id) => document.getElementById(id);
  const body = document.body;
  body.classList.add('android');
  let info = {}; try { info = JSON.parse(N.info()); } catch (e) {}
  let perms = info.perms || {}; const prefs = info.prefs || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => { const t = $('toast'); if (!t) return; t.textContent = m; t.className = 'toast show' + (k ? ' ' + k : ''); clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600); };

  // ------------------------------------------------------------------ insets (edge-to-edge) + system bar colours
  B.insets = (t, r, b, l) => { const s = document.documentElement.style; s.setProperty('--sat', t + 'px'); s.setProperty('--sar', r + 'px'); s.setProperty('--sab', b + 'px'); s.setProperty('--sal', l + 'px'); };
  function syncBars() {
    const c = getComputedStyle(body).getPropertyValue('--bg-2').trim() || '#1b2a3a';
    const probe = document.createElement('i'); probe.style.color = c; document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) || [27, 42, 58]; probe.remove();
    const [r, g, bl] = m.map(Number); const lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
    const hex = '#' + [r, g, bl].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    try { N.systemBars(hex, lum < 0.55); } catch (e) {}
  }
  new MutationObserver(() => requestAnimationFrame(syncBars)).observe(body, { attributes: true, attributeFilter: ['class', 'data-palette', 'data-skin'] });
  syncBars();

  // Classic skin is a fixed 556 px pixel layout: scale it to the phone's width
  const fitClassic = () => document.documentElement.style.setProperty("--cz", String(Math.min(1, (Math.min(innerWidth, screen.width || innerWidth) - 2) / 556).toFixed(4)));
  addEventListener('resize', fitClassic); fitClassic();

  // ------------------------------------------------------------------ local playback -> Android media session
  const covers = new Map();
  function coverData(t, cb) {
    const url = t && t.coverUrl; if (!url) return cb('');
    if (covers.has(url)) return cb(covers.get(url));
    const im = new Image();
    im.onload = () => { try { const c = document.createElement('canvas'), k = Math.min(1, 384 / Math.max(im.naturalWidth, im.naturalHeight)); c.width = Math.max(1, im.naturalWidth * k | 0); c.height = Math.max(1, im.naturalHeight * k | 0); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); const d = c.toDataURL('image/jpeg', 0.85); covers.set(url, d); if (covers.size > 30) covers.delete(covers.keys().next().value); cb(d); } catch (e) { cb(''); } };
    im.onerror = () => cb(''); im.src = url;
  }
  let lastReportKey = '', reportTimer = 0;
  // between two songs (ended -> next track loading) the element is briefly paused: report that as a transition, not a stop,
  // so Android keeps the media notification / foreground service alive while the screen is off
  let transitionUntil = 0, transitionTimer = 0;
  const willAdvance = () => A.settings.repeat !== 'off' || A.tracks.length > 1;
  audio.addEventListener('ended', () => {
    if (!willAdvance()) return;
    transitionUntil = performance.now() + 1500;
    clearTimeout(transitionTimer); transitionTimer = setTimeout(() => { transitionUntil = 0; report(); }, 1600);
  });
  audio.addEventListener('playing', () => { transitionUntil = 0; });
  const inTransition = () => performance.now() < transitionUntil;
  // theme + tempo for the native floater (it draws its own Lucielle, so it needs the palette colours and the beat grid)
  const cssVar = (n) => getComputedStyle(body).getPropertyValue(n).trim();
  const sceneArt = new Map();
  function packSceneArt(sc) {
    if (!sc || !sc.pack) return '';
    if (sceneArt.has(sc.id)) return sceneArt.get(sc.id);
    sceneArt.set(sc.id, '');
    const im = new Image();
    im.onload = () => { try { const c = document.createElement('canvas'), k = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight)); c.width = Math.max(1, im.naturalWidth * k | 0); c.height = Math.max(1, im.naturalHeight * k | 0); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); sceneArt.set(sc.id, c.toDataURL('image/jpeg', 0.8)); report(true); } catch (e) {} };
    im.src = sc.bg || sc.thumb || '';
    return '';
  }
  // the picture is big: send it once per scene (native keeps it while the scene id stays the same)
  let sentArt = '';
  function sceneArtOnce(sc) {
    const a = packSceneArt(sc);
    if (!a) return '';
    if (sentArt === sc.id) return '';
    sentArt = sc.id; return a;
  }
  function themeState() {
    const sc = A.luciel && A.luciel.scene;
    const tr = A.tracker;
    return { bpm: tr && tr.bpm > 0 ? +tr.bpm.toFixed(2) : 0, beatPos: tr && tr.bpm > 0 ? +tr.beatAt(audio.currentTime || 0).toFixed(3) : 0,
      accent: cssVar('--accent'), accent2: cssVar('--accent-2'), bg: cssVar('--bg-2'), bg3: cssVar('--bg-3'), text: cssVar('--text'),
      lcdBg: cssVar('--lcd-bg'), lcdFg: cssVar('--lcd-fg'), frame1: cssVar('--c-frame-1'), frame2: cssVar('--c-frame-2'), frame3: cssVar('--c-frame-3'), frameDark: cssVar('--c-frame-dark'),
      skin: A.settings.skin, palette: A.settings.palette, scene: sc ? sc.id : '', sceneName: sc ? sc.name : '', sceneArt: sceneArtOnce(sc), mascot: A.settings.mascot !== false };
  }
  function report(force) {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const t = A.current, q = A.tracks;
      const playing = !!t && (!audio.paused || inTransition());
      const st = Object.assign({ id: t ? t.id : '', title: t ? (document.getElementById('tTitle') || {}).textContent || t.name : '', artist: t ? (document.getElementById('tArtist') || {}).textContent || '' : '',
        album: t && t.meta ? t.meta.album || '' : '', duration: isFinite(audio.duration) ? audio.duration : 0, position: audio.currentTime || 0,
        playing, buffering: playing && (audio.paused || audio.readyState < 3), hasTrack: !!t, hasPrev: q.length > 1 || audio.currentTime > 3, hasNext: q.length > 1 || A.settings.repeat !== 'off' }, themeState());
      const key = st.id + '|' + (t && t.coverUrl || '');
      if (key !== lastReportKey || force) {
        lastReportKey = key;
        coverData(t, (d) => { st.art = d || (t && t.file && t.file.__nativePath && /^content:\/\/media\//.test(t.file.__nativePath) ? t.file.__nativePath : ''); st.artCleared = !st.art; N.reportState(JSON.stringify(st)); });
      } else N.reportState(JSON.stringify(st));
    }, 60);
  }
  ['play', 'playing', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'seeked', 'emptied', 'waiting'].forEach((ev) => audio.addEventListener(ev, () => report()));
  setInterval(() => { if (!audio.paused) report(); }, 15000);
  // the floater re-syncs its beat clock from these: tempo changes, scene/theme changes
  let lastBpm = 0;
  setInterval(() => { const b = A.tracker && A.tracker.bpm || 0; if (!audio.paused && Math.abs(b - lastBpm) > 0.3) { lastBpm = b; report(); } }, 2000);
  ['luciel:settings', 'luciel:track'].forEach((ev) => window.addEventListener(ev, () => report()));
  new MutationObserver(() => report()).observe(body, { attributes: true, attributeFilter: ['data-palette', 'data-skin', 'class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) report(true); });
  new MutationObserver(() => report(true)).observe($('tTitle') || body, { childList: true, characterData: true, subtree: true });

  // commands from the notification / lock screen / headset / audio focus
  // a play press with nothing loaded (headset button, notification, Bluetooth car kit) starts the queue; it never opens the file picker
  const playFromIdle = () => { if (A.current) { A.togglePlay(); return; } if (A.tracks.length) A.playTrack(A.tracks[0]); };
  B.cmd = (cmd, arg) => {
    if (cmd === 'play') { if (audio.paused) playFromIdle(); }
    else if (cmd === 'pause') { transitionUntil = 0; if (!audio.paused) audio.pause(); }
    else if (cmd === 'toggle') { if (audio.paused) playFromIdle(); else { transitionUntil = 0; audio.pause(); } }
    else if (cmd === 'next') A.next();
    else if (cmd === 'prev') A.prev();
    else if (cmd === 'seek') { try { audio.currentTime = (arg || 0) / 1000; } catch (e) {} }
    else if (cmd === 'duck') { if (A.engine.setDucked) A.engine.setDucked(!!arg); }
    setTimeout(() => report(), 120);
  };

  // ------------------------------------------------------------------ phone library (MediaStore)
  let scanning = false;
  async function scan(interactive) {
    if (scanning) return; scanning = true;
    try {
      if (!perms.audio) {
        if (!interactive) return;
        const ok = await B.call('requestAudioPermission');
        if (!ok) { toast('Music access is off – use “Add files” instead, or allow it in Android settings', 'warn'); return; }
        perms.audio = true;
      }
      if (interactive) toast('Looking for music on your phone…');
      const list = await B.call('scanLibrary');
      const known = new Map(); [...A.lib.values()].forEach((t) => { if (t.nativePath) known.set(t.nativePath, t); });
      const seen = new Set(list.map((e) => e.uri));
      const fresh = list.filter((e) => !known.has(e.uri));
      // songs deleted from the phone disappear from the library too
      const gone = new Set([...A.lib.values()].filter((t) => t.nativePath && /^content:\/\/media\//.test(t.nativePath) && !seen.has(t.nativePath)).map((t) => t.id));
      if (gone.size) A.removeFromLibrary(gone);
      if (fresh.length) {
        const queueEmpty = A.tracks.length === 0;
        await A.addFiles(fresh.map(L.lazyFile), { noPlay: true, noQueue: !queueEmpty });
        toast(`${fresh.length} song${fresh.length > 1 ? 's' : ''} from your phone ${queueEmpty ? 'added' : 'added to the library'}`);
      } else if (interactive) toast(list.length ? `Library is up to date (${list.length} songs on this phone)` : 'No music found on this phone yet');
      localStorage.setItem('luciel.android.scanned', String(Date.now()));
    } catch (e) { console.warn('[scan]', e); if (interactive) toast('Could not read the music library: ' + e.message, 'warn'); }
    finally { scanning = false; renderSheet(); }
  }

  // "Add files" / "Add folder" use Android's pickers (songs are streamed, never copied into the app)
  function hookInput(id, fn) { const el = $(id); if (el) el.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); fn(); }, true); }
  hookInput('fileInput', async () => { try { const l = await B.call('pickAudio'); if (l && l.length) A.addFiles(l.map(L.lazyFile), { playFirst: true }); } catch (e) { toast(e.message, 'warn'); } });
  hookInput('folderInput', async () => { try { const l = await B.call('pickFolder', true); if (l && l.length) { toast(`Adding ${l.length} songs…`); A.addFiles(l.map(L.lazyFile)); } else if (l) toast('No audio files in that folder', 'warn'); } catch (e) { toast(e.message, 'warn'); } });
  hookInput('packDirInput', async () => {
    try {
      const l = await B.call('pickFolder', false); if (!l || !l.length) return;
      toast(`Reading ${l.length} files…`);
      const files = await Promise.all(l.map(async (e) => { const b = await (await fetch(e.url)).blob(); const f = new File([b], e.name, { type: e.mime || b.type }); f.__path = e.rel; try { Object.defineProperty(f, 'webkitRelativePath', { value: e.rel }); } catch (x) {} return f; }));
      A.packs.importFolder(files);
    } catch (e) { toast('Could not read that folder: ' + e.message, 'warn'); }
  });
  // "Open with Luciel" / "Share to Luciel"
  B.openUris = (list) => { if (list && list.length) A.addFiles(list.map(L.lazyFile), { playFirst: true }); };
  B.importPacks = async (list) => { for (const e of list || []) { try { const b = await (await fetch(e.url)).blob(); A.packs.importZip(new File([b], e.name, { type: 'application/zip' })); } catch (x) { toast('Could not open ' + e.name, 'warn'); } } };

  // ------------------------------------------------------------------ system back gesture
  B.back = () => {
    if ($('andOverlay') && !$('andOverlay').hidden) { closeSheet(); return true; }
    const ctx = $('ctxMenu'); if (ctx && !ctx.hidden) { ctx.hidden = true; return true; }
    const ask = $('askOverlay'); if (ask && !ask.hidden) { const c = ask.querySelector('.ask-cancel'); if (c) c.click(); return true; }
    const anyOverlay = [...document.querySelectorAll('.overlay')].some((o) => !o.hidden);
    const edit = $('editOverlay');
    const libOpen = $('winLib') && !$('winLib').hidden;
    if (anyOverlay || (edit && !edit.hidden) || libOpen) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; }
    if (A.mini && A.mini.isOpen) { A.mini.close(); return true; }
    if (EXT.on) { exitExt(true); return true; }
    if (window.LucielMobile && window.LucielMobile.active && window.LucielMobile.back()) return true;
    return false;
  };

  // ------------------------------------------------------------------ permissions
  B.perms = (p) => {
    const had = perms || {}; perms = p || {};
    if (perms.audio && !had.audio) scan(false);
    renderSheet(); renderChip();
  };

  // ================================================================== "Now playing on Spotify" (any outside player)
  // window.LucielExt is read by app.js's frame loop (see tools/sync-web.js patches)
  const BINS = 1024;
  const fake = {
    fftSize: BINS * 2, frequencyBinCount: BINS, context: { sampleRate: 44100 }, smoothingTimeConstant: 0.8,
    mags: new Uint8Array(512), wave: new Uint8Array(512).fill(128), smooth: new Float32Array(BINS),
    getByteFrequencyData(arr) {
      const m = this.mags, n = m.length, ratio = (n / (this.context.sampleRate / 2)) * (this.context.sampleRate / this.fftSize);
      for (let i = 0; i < arr.length; i++) { const v = m[Math.min(n - 1, (i * ratio) | 0)] || 0; this.smooth[i] = Math.max(v, this.smooth[i] * 0.85); arr[i] = this.smooth[i]; }
    },
    getByteTimeDomainData(arr) { const w = this.wave, n = w.length; for (let i = 0; i < arr.length; i++) arr[i] = w[((i / arr.length) * n) | 0]; },
    getFloatTimeDomainData(arr) { const w = this.wave, n = w.length; for (let i = 0; i < arr.length; i++) arr[i] = (w[((i / arr.length) * n) | 0] - 128) / 128; },
  };
  const EXT = window.LucielExt = { on: false, playing: false, analyser: fake, time: () => performance.now() / 1000, state: null, bpm: 0, source: 'tempo' };
  const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  let pollRaf = 0, lastKey = '', savedScene = null, appVisible = true;

  function readFrame() {
    let s; try { s = N.extFrame(); } catch (e) { return; }
    const p = s.split('|');
    const bpm = +p[0], beat = +p[1]; EXT.source = p[2];
    fake.context.sampleRate = +p[8] || 44100;
    const m = b64(p[9]); if (m.length) fake.mags = m;
    const w = b64(p[10]); if (w.length) fake.wave = w;
    if (bpm > 0) {
      const now = EXT.time(), t0 = now - beat * 60 / bpm;
      const tr = A.tracker;
      if (Math.abs(tr.bpm - bpm) > 0.4 || Math.abs(tr.beatAt(now) - beat) > 0.06 || tr.source !== 'tag') tr.setGrid(bpm, t0, 'tag', EXT.source === 'live' ? 0.6 : 0.3);
      EXT.bpm = bpm;
    }
  }
  function poll() {
    pollRaf = 0;
    if (!EXT.on) return;
    readFrame();
    // keep the visualizers bound to the outside-audio analyser (the app binds its own once audio starts)
    if (A.vizBig && A.vizBig.an !== fake) { A.vizBig.setAnalyser(fake, fake, fake); A.vizMini.setAnalyser(fake, fake, fake); }
    updatePanelTime();
    if (appVisible) pollRaf = requestAnimationFrame(poll);
  }

  function applyTint(st) {
    const el = $('extTint'); if (!el) return;
    const t = st && st.tint;
    el.textContent = t ? `body.ext-mode{--accent:${t.accent} !important;--accent-2:${t.accent2} !important;--viz-1:${t.accent} !important;--viz-2:${t.accent2} !important;--cviz-1:${t.accent} !important;--cviz-2:${t.accent2} !important;--accent-glow:${t.accent}88 !important;--ext-bg:${t.bg};}` : '';
  }

  function enterExt(user) {
    const st = EXT.state;
    if (!st || !st.active) { if (user) toast(perms.listener ? 'Play something in Spotify first' : 'Turn on “Spotify & other players” first', 'warn'); if (user && !perms.listener) openSheet(); return; }
    if (EXT.on) return;
    if (user && !audio.paused) audio.pause();
    EXT.on = true; body.classList.add('ext-mode');
    savedScene = A.settings.scene;
    A.engine.ensure && A.engine.ensure();
    try { N.extUse(true); } catch (e) {}
    lastKey = ''; onExt(st, true);
    if (!pollRaf) pollRaf = requestAnimationFrame(poll);
    renderChip();
  }
  function exitExt(user) {
    if (!EXT.on) return;
    EXT.on = false; EXT.playing = false; body.classList.remove('ext-mode');
    try { N.extUse(false); } catch (e) {}
    if (pollRaf) cancelAnimationFrame(pollRaf); pollRaf = 0;
    applyTint(null);
    if (A.engine.analyser) { A.vizBig.setAnalyser(A.engine.analyser, A.engine.anL, A.engine.anR); A.vizMini.setAnalyser(A.engine.analyser, A.engine.anL, A.engine.anR); }
    A.tracker.reset(); if (A.current && A.current.bpmInfo) A.tracker.setGrid(A.current.bpmInfo.bpm, A.current.bpmInfo.t0, A.current.bpmInfo.source, A.current.bpmInfo.confidence);
    A.luciel.setManual(savedScene || A.settings.scene || 'auto');
    if (user) EXT.dismissedKey = EXT.state && EXT.state.key;
    renderChip();
  }

  function onExt(st, force) {
    EXT.state = st;
    if (!EXT.on) {
      // auto-switch: outside player starts while Luciel itself is idle
      if (st && st.active && st.playing && audio.paused && prefs.autoExtMode !== false && appVisible && EXT.dismissedKey !== st.key) enterExt(false);
      renderChip(); return;
    }
    EXT.playing = !!(st && st.active && st.playing);
    if (!st || !st.active) { renderPanel(); return; }
    if (st.key !== lastKey || force) {
      lastKey = st.key;
      // Lucielle reacts to the new song + picks a scene: user's manual scene wins, else the genre word / cover guess
      A.luciel.trackStarted({ genre: st.genre || '' }, st.title);
      if ((savedScene || 'auto') === 'auto') A.luciel.setManual(st.scene || 'auto');
    }
    applyTint(st); renderPanel();
  }
  B.ext = (st) => onExt(st, false);
  B.extMode = (on) => { if (on) { try { onExt(JSON.parse(N.extState()), false); } catch (e) {} enterExt(true); } else exitExt(true); };
  B.visible = (v) => { appVisible = v; if (v && EXT.on && !pollRaf) pollRaf = requestAnimationFrame(poll); if (v) { try { onExt(JSON.parse(N.extState()), false); } catch (e) {} } };
  audio.addEventListener('play', () => { if (EXT.on) exitExt(false); });

  // ---- the panel shown over the scene in Spotify mode
  const svg = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const I = {
    prev: svg('<path d="M6 5h2v14H6zM20 5v14L9 12z"/>'), next: svg('<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>'),
    play: svg('<path d="M7 4v16l13-8z"/>'), pause: svg('<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'),
    back: svg('<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    open: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  };
  const panel = document.createElement('div');
  panel.id = 'extPanel'; panel.className = 'ext-panel';
  panel.innerHTML = `
    <div class="ext-top"><button class="ext-ic" id="extExit" title="Back to my music">${I.back}</button>
      <span class="ext-src" id="extSrc"></span><button class="ext-ic" id="extOpen" title="Open the player app">${I.open}</button></div>
    <div class="ext-card">
      <img class="ext-cover" id="extCover" alt="">
      <div class="ext-meta"><div class="ext-title" id="extTitle"></div><div class="ext-artist" id="extArtist"></div></div>
    </div>
    <div class="ext-seek"><span id="extCur">0:00</span><div class="ext-bar"><i id="extFill"></i></div><span id="extDur">0:00</span></div>
    <div class="ext-ctl"><button class="ext-btn" id="extPrev">${I.prev}</button><button class="ext-btn big" id="extPlay">${I.play}</button><button class="ext-btn" id="extNext">${I.next}</button></div>
    <div class="ext-beat"><button class="ext-chip" id="extTap" title="Tap along to set the tempo">TAP TEMPO</button><span class="ext-bpm" id="extBpm">♪ —</span><button class="ext-chip" id="extScene" title="Pick a scene">SCENE</button></div>`;
  body.appendChild(panel);
  const style = document.createElement('style'); style.id = 'extTint'; document.head.appendChild(style);
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function renderPanel() {
    const st = EXT.state || {};
    $('extTitle').textContent = st.active ? st.title || 'Unknown song' : 'Nothing playing';
    $('extArtist').textContent = st.active ? [st.artist, st.album].filter(Boolean).join(' · ') : 'Start a song in Spotify or another player';
    $('extSrc').textContent = st.active ? (st.playing ? 'Now playing on ' : 'Paused on ') + (st.app || 'another app') : 'Spotify mode';
    const cov = $('extCover'); if (st.art) { if (cov.getAttribute('src') !== st.art) cov.src = st.art; cov.hidden = false; } else { cov.hidden = true; cov.removeAttribute('src'); }
    $('extPlay').innerHTML = st.playing ? I.pause : I.play;
    EXT.posAt = performance.now(); EXT.pos = st.position || 0;
    updatePanelTime();
  }
  function updatePanelTime() {
    const st = EXT.state || {}; const d = st.duration || 0;
    const p = Math.min(d || 1e9, (EXT.pos || 0) + (st.playing ? (performance.now() - (EXT.posAt || 0)) / 1000 : 0));
    $('extCur').textContent = fmt(p); $('extDur').textContent = d ? fmt(d) : '–:––';
    $('extFill').style.width = d ? (p / d * 100).toFixed(2) + '%' : '0';
    const src = { live: 'live beat', tap: 'tapped', tempo: 'steady tempo' }[EXT.source] || '';
    $('extBpm').textContent = EXT.bpm ? `♪ ${Math.round(EXT.bpm)} BPM · ${src}` : '♪ —';
  }
  $('extExit').onclick = () => exitExt(true);
  $('extOpen').onclick = () => N.extCommand('open', 0);
  $('extPlay').onclick = () => N.extCommand('toggle', 0);
  $('extNext').onclick = () => N.extCommand('next', 0);
  $('extPrev').onclick = () => N.extCommand('prev', 0);
  $('extTap').onclick = () => { const b = N.extTap(); try { N.haptic(); } catch (e) {} if (b > 0) $('extBpm').textContent = `♪ ${Math.round(b)} BPM · tapped`; };
  $('extScene').onclick = () => { $('btnTheme').click(); setTimeout(() => { const g = $('sceneGrid'); if (g) g.scrollIntoView({ block: 'center' }); }, 250); };
  panel.querySelector('.ext-bar').addEventListener('click', (e) => { const st = EXT.state; if (!st || !st.duration) return; const r = e.currentTarget.getBoundingClientRect(); N.extCommand('seek', st.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); });
  // a manual pick in the scene grid while in Spotify mode applies to Spotify mode only
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-scene]'); if (b && EXT.on) { savedScene = savedScene || 'auto'; } }, true);

  // ---- the "Spotify is playing" chip in the normal player view
  const chip = document.createElement('button');
  chip.id = 'extChip'; chip.className = 'ext-pill'; chip.hidden = true;
  body.appendChild(chip);
  chip.onclick = () => enterExt(true);
  function renderChip() {
    const st = EXT.state;
    const show = !!(!EXT.on && st && st.active && (st.title || st.playing));
    chip.hidden = !show;
    if (show) chip.innerHTML = `<img src="${esc(st.art || 'icons/favicon-48.png')}" alt=""><span><b>${esc(st.app || 'Spotify')}</b> ${esc(st.title || '')}</span><em>VISUALS ▸</em>`;
  }

  // ================================================================== bundled visual packs (Lucielle Styles)
  let bundled = [];   // [{file, size, id}]
  const packInstalled = (id) => !!(A.packs && (A.packs.installed || []).some((p) => p.id === id));
  async function installBundled(entry, manual) {
    try {
      const r = await fetch('android/packs/' + encodeURIComponent(entry.file)); if (!r.ok) throw new Error(r.status);
      const b = await r.blob();
      return await A.packs.importZip(new File([b], entry.file, { type: 'application/zip' }));
    } catch (e) { if (manual) toast('Could not open the bundled pack', 'warn'); return false; }
  }
  (async () => {
    try { bundled = await (await fetch('android/packs/index.json')).json(); } catch (e) { bundled = []; }
    try { await window.LucielPacksReady; } catch (e) {}
    if (/[?&]safe=1/.test(location.search)) { toast('Luciel restarted after running low on memory: bundled packs will install from the Phone sheet instead', 'warn'); return; }
    for (const e of bundled) {
      const key = 'luciel.android.bundled.' + e.id;
      if (!e.id || localStorage.getItem(key)) continue;          // offered once; removing it in the pack manager is respected
      if (!packInstalled(e.id)) await installBundled(e, false);
      if (packInstalled(e.id)) localStorage.setItem(key, '1');
    }
  })();
  B.installBundled = (id) => { const e = bundled.find((x) => x.id === id) || bundled[0]; return e ? installBundled(e, true) : Promise.resolve(false); };

  // ================================================================== Android settings sheet
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'andOverlay'; ov.hidden = true;
  ov.innerHTML = `<div class="theme-menu and-menu" role="dialog" aria-label="Android"><div class="tm-head"><span>Phone &amp; Spotify</span><button class="tb-btn" data-and-close><svg><use href="#i-close"/></svg></button></div><div id="andBody"></div></div>`;
  body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-and-close]')) closeSheet(); });
  function openSheet() { renderSheet(); ov.hidden = false; requestAnimationFrame(() => ov.classList.add('open')); }
  function closeSheet() { ov.classList.remove('open'); ov.hidden = true; }
  const yes = (b) => b ? '<b class="and-ok">✓ on</b>' : '<b class="and-off">off</b>';
  function renderSheet() {
    const host = $('andBody'); if (!host) return;
    const nPhone = [...A.lib.values()].filter((t) => t.nativePath && /^content:/.test(t.nativePath)).length;
    host.innerHTML = `
      <div class="tm-section"><div class="tm-label">Music on this phone</div>
        <div class="and-row"><span>Music access ${yes(perms.audio)} · ${nPhone} song${nPhone === 1 ? '' : 's'} in the library</span></div>
        <div class="tm-row"><button class="pbtn" data-a="scan">${scanning ? 'SCANNING…' : 'SCAN PHONE MUSIC'}</button><button class="pbtn" data-a="files">ADD FILES</button><button class="pbtn" data-a="folder">ADD FOLDER</button></div></div>
      <div class="tm-section"><div class="tm-label">Spotify &amp; other players</div>
        <div class="and-row"><span>See what's playing (Notification access) ${yes(perms.listener)}</span>${perms.listener ? '' : '<button class="pbtn" data-a="listener">TURN ON</button>'}</div>
        <div class="and-row"><span>Floating Lucielle over other apps ${yes(perms.overlay)}</span>${perms.overlay ? '<button class="pbtn" data-a="overlaySettings">SETTINGS</button>' : '<button class="pbtn" data-a="overlay">TURN ON</button>'}</div>
        <div class="and-row"><span>Beat detection (system visualizer, shown as “Microphone”) ${yes(perms.mic)}</span>${perms.mic ? '' : '<button class="pbtn" data-a="app">ALLOW</button>'}</div>
        <div class="tm-row">
          <label class="chk"><input type="checkbox" data-p="overlay" ${prefs.overlay !== false ? 'checked' : ''}> Show the floating Lucielle</label>
          <label class="chk"><input type="checkbox" data-p="spotifyOnly" ${prefs.spotifyOnly ? 'checked' : ''}> Spotify only</label>
          <label class="chk"><input type="checkbox" data-p="autoExtMode" ${prefs.autoExtMode !== false ? 'checked' : ''}> Switch to Spotify visuals automatically</label>
          <label class="chk"><input type="checkbox" data-p="visualizer" ${prefs.visualizer !== false ? 'checked' : ''}> Use the visualizer when allowed</label>
          <label class="chk">Steady tempo <input type="number" min="60" max="200" step="1" value="${Math.round(prefs.fallbackBpm || 120)}" data-p="fallbackBpm" class="and-num"> BPM</label>
        </div>
        <div class="tm-row"><button class="pbtn primary" data-a="ext">OPEN SPOTIFY VISUALS</button><button class="pbtn" data-a="spotify">OPEN SPOTIFY</button></div></div>
      <div class="tm-section"><div class="tm-label">Visual packs</div>
        ${bundled.map((e) => `<div class="and-row"><span>${e.id === 'lucielle-styles' ? 'Lucielle Styles (Arcade Angel · City Punk · Fall Girl)' : esc(e.id)} ${packInstalled(e.id) ? '<b class="and-ok">✓ installed</b>' : '<b class="and-off">not installed</b>'}</span>${packInstalled(e.id) ? '' : `<button class="pbtn" data-a="bundled" data-id="${esc(e.id)}">INSTALL</button>`}</div>`).join('')}
        <div class="tm-row"><button class="pbtn" data-a="packZip">IMPORT PACK (.ZIP)</button><button class="pbtn" data-a="packs">MANAGE PACKS</button></div></div>
      <div class="tm-section"><div class="tm-label">App</div>
        <div class="tm-row"><label class="chk"><input type="checkbox" data-p="bgPlay" ${prefs.bgPlay !== false ? 'checked' : ''}> Keep playing after the back gesture</label></div>
        <div class="tm-row"><button class="pbtn" data-a="onboarding">PERMISSION GUIDE</button><button class="pbtn" data-a="battery">BATTERY SETTINGS</button></div>
        <div class="and-row and-dim"><span>Luciel ${esc(info.version || '')} · Android ${esc(String(info.sdk || ''))} · ${esc(info.device || '')}</span></div></div>`;
  }
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'scan') scan(true);
    else if (a === 'files') { closeSheet(); $('fileInput').click(); }
    else if (a === 'folder') { closeSheet(); $('folderInput').click(); }
    else if (a === 'ext') { closeSheet(); B.extMode(true); }
    else if (a === 'battery') N.open('app');
    else if (a === 'bundled') { b.disabled = true; b.textContent = 'INSTALLING…'; B.installBundled(b.dataset.id).then(() => renderSheet()); }
    else if (a === 'packs') { closeSheet(); A.packs.openManager(); }
    else if (a === 'packZip') { closeSheet(); const z = document.getElementById('packZipInput') || document.querySelector('input[type=file][accept*="zip"]'); if (z) z.click(); else A.packs.openManager(); }
    else N.open(a);
  });
  ov.addEventListener('change', (e) => {
    const k = e.target.dataset.p; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    prefs[k] = e.target.type === 'checkbox' ? v : +v; N.setPref(k, String(v));
  });

  // title-bar button
  const tb = document.querySelector('#winMain .titlebar');
  if (tb) {
    const btn = document.createElement('button');
    btn.className = 'tb-btn'; btn.id = 'btnAndroid'; btn.title = 'Phone music & Spotify';
    btn.innerHTML = svg('<path d="M12 3a9 9 0 100 18 9 9 0 000-18zm4.1 13a.6.6 0 01-.8.2c-2.3-1.4-5.1-1.7-8.5-.9a.6.6 0 01-.3-1.1c3.7-.9 6.8-.5 9.4 1a.6.6 0 01.2.8zm1.1-2.5a.7.7 0 01-1 .2c-2.6-1.6-6.6-2.1-9.7-1.1a.7.7 0 11-.4-1.4c3.5-1.1 8-.6 10.9 1.3.3.2.4.7.2 1zm.1-2.6C14.2 9.1 9 8.9 6 9.8a.9.9 0 11-.5-1.7c3.4-1 9.1-.8 12.7 1.3a.9.9 0 01-.9 1.5z" fill="currentColor"/>') + '<span class="tb-btn-label">Spotify</span>';
    btn.onclick = openSheet;
    const theme = $('btnTheme'); tb.insertBefore(btn, theme);
  }

  // first run: read the phone's music if allowed; afterwards a quiet rescan each launch picks up new songs
  setTimeout(() => { if (perms.audio) scan(!localStorage.getItem('luciel.android.scanned')); }, 800);
  try { onExt(JSON.parse(N.extState()), false); } catch (e) {}
  report(true);
  window.LucielAndroidUI = { openSheet, closeSheet, enterExt, exitExt, scan, EXT };
})();
