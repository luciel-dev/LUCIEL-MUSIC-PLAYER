/* Luciel phone layout (width <= 600 px, or the Android app): bottom tabs (Now Playing · Library · Visuals · Settings),
 * a thumb-friendly player, an iPod-style drill-down library, bottom sheets for the EQ / queue / actions, and a mini
 * "now playing" bar. It drives the existing app (window.AeroAmp) — audio, EQ, library data and settings all stay in one
 * place, so the desktop layout and the phone layout never disagree. Desktop (Electron) and wide windows never see it. */
(function () {
  'use strict';
  const A = window.AeroAmp; if (!A) return;
  const $ = (id) => document.getElementById(id);
  const body = document.body, html = document.documentElement;
  const audio = A.engine.audio, api = A.api, lib = A.library, S = A.settings;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = A.fmt;
  const isAndroid = () => html.classList.contains('android') || body.classList.contains('android');
  const force = /[?&]mobile=([01])/.exec(location.search);
  const mq = matchMedia('(max-width: 600px)');
  const wanted = () => (force ? force[1] === '1' : !body.classList.contains('desktop') && (isAndroid() || mq.matches));
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
  const num = (v) => { const m = /^\s*(\d+)/.exec(String(v || '')); return m ? +m[1] : 0; };
  const vib = () => { try { if (window.LucielAndroid && window.LucielAndroid.haptic) window.LucielAndroid.haptic(); else if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} };

  // ------------------------------------------------------------------ icons
  const svg = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const use = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const IC = {
    back: svg('<path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    chev: svg('<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    more: svg('<circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>'),
    gear: svg('<path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>'),
    spark: svg('<path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/>'),
    popout: svg('<rect x="3" y="7" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 3h10v10M21 3l-9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    grip: svg('<path d="M4 8h16M4 12h16M4 16h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    x: svg('<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    shuffle: use('i-shuffle'), repeat: use('i-repeat'), list: use('i-list'), eq: use('i-eq'), heart: use('i-heart'), play: use('i-play'), pause: use('i-pause'), prev: use('i-prev'), next: use('i-next'),
    note: use('i-note'), libI: use('i-lib'), plus: use('i-plus'), folder: use('i-folder'), search: use('i-search'), trash: use('i-trash'), pack: use('i-pack'),
  };
  const G_ = (c) => `<i class="m-glyph">${c}</i>`;

  // ------------------------------------------------------------------ shell
  let built = false, active = false;
  const moved = [];   // [el, parent, nextSibling] for nodes borrowed from the desktop layout
  function borrow(el, host) { if (!el) return; moved.push([el, el.parentNode, el.nextSibling]); host.appendChild(el); }
  function giveBack() { while (moved.length) { const [el, p, n] = moved.pop(); if (n && n.parentNode === p) p.insertBefore(el, n); else p.appendChild(el); } }

  const shell = document.createElement('div');
  shell.id = 'mShell'; shell.className = 'm-shell';
  shell.innerHTML = `
  <section class="m-screen m-player" data-screen="player" aria-label="Now playing">
    <header class="m-top m-ptop"><span class="m-ptitle"><b>Now Playing</b><em id="mPSub"></em></span>
      <button class="m-ic" id="mPopOut" title="Pop out: floating player over other apps" hidden>${IC.popout}</button>
      <button class="m-ic" id="mPMore" title="More">${IC.more}</button></header>
    <div class="m-stage" id="mStage">
      <div class="m-stage-chips"><button class="m-chip" id="mVizChip" title="Visualizer (swipe the stage)"></button><button class="m-chip m-scene-chip" id="mSceneChip" title="Scene"></button></div>
      <span class="m-stage-hint" id="mStageHint">Tap to exit full screen</span>
    </div>
    <div class="m-np">
      <div class="m-np-info"><img class="m-np-art" id="mArt" alt=""><div class="m-np-text"><div class="m-np-title" id="mTitle">Nothing playing</div><div class="m-np-artist" id="mArtist"></div></div></div>
      <div class="m-seek" id="mSeek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" tabindex="0"><div class="m-seek-track"><i class="m-seek-fill"></i><b class="m-seek-knob"></b></div></div>
      <div class="m-times"><span id="mCur">0:00</span><span id="mDur">0:00</span></div>
      <div class="m-transport"><button class="m-tb" id="mPrev" title="Previous">${IC.prev}</button><button class="m-tb m-play" id="mPlay" title="Play / pause"><span class="m-ic-play">${IC.play}</span><span class="m-ic-pause">${IC.pause}</span></button><button class="m-tb" id="mNext" title="Next">${IC.next}</button></div>
      <div class="m-row2"><button class="m-sb" id="mShuffle" title="Shuffle">${IC.shuffle}</button><button class="m-sb" id="mRepeat" title="Repeat">${IC.repeat}<i>1</i></button><button class="m-sb" id="mQueue" title="Queue">${IC.list}</button><button class="m-sb" id="mEq" title="Equalizer">${IC.eq}</button><button class="m-sb" id="mFav" title="Favorite">${IC.heart}</button><button class="m-sb" id="mMore" title="More">${IC.more}</button></div>
    </div>
  </section>
  <section class="m-screen m-library" data-screen="library" aria-label="Library"><div class="m-stack" id="mStack"></div></section>
  <section class="m-screen m-visuals" data-screen="visuals" aria-label="Visuals"><div class="m-page" id="mVisuals"></div></section>
  <section class="m-screen m-settings" data-screen="settings" aria-label="Settings"><div class="m-page" id="mSettings"></div></section>
  <div class="m-mini" id="mMini" hidden><i class="m-mini-prog" id="mMiniProg"></i><img id="mMiniArt" alt=""><div class="m-mini-text"><b id="mMiniTitle"></b><span id="mMiniArtist"></span></div>
    <button class="m-ic" id="mMiniPlay" title="Play / pause"><span class="m-ic-play">${IC.play}</span><span class="m-ic-pause">${IC.pause}</span></button><button class="m-ic" id="mMiniNext" title="Next">${IC.next}</button></div>
  <nav class="m-tabs" id="mTabs" role="tablist">
    <button data-tab="player" role="tab">${IC.note}<span>Now Playing</span></button>
    <button data-tab="library" role="tab">${IC.libI}<span>Library</span></button>
    <button data-tab="visuals" role="tab">${IC.spark}<span>Visuals</span></button>
    <button data-tab="settings" role="tab">${IC.gear}<span>Settings</span></button>
  </nav>`;
  const sheetHost = document.createElement('div');
  sheetHost.id = 'mSheetHost'; sheetHost.className = 'm-sheet-host'; sheetHost.hidden = true;
  sheetHost.innerHTML = '<div class="m-scrim"></div><div class="m-sheet" role="dialog"><div class="m-grab"><i></i></div><div class="m-sheet-body" id="mSheetBody"></div></div>';

  // ------------------------------------------------------------------ tabs
  let tab = 'player';
  function setTab(t, quiet) {
    if (!['player', 'library', 'visuals', 'settings'].includes(t)) t = 'player';
    const prevTab = tab; tab = t; shell.dataset.tab = t; body.dataset.mtab = t;
    shell.querySelectorAll('#mTabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    if (t === 'library' && !stack.length) push({ type: 'home' }, true);
    if (t === 'library') { const top = stack[stack.length - 1]; if (top && dirtyViews.has(top)) { dirtyViews.delete(top); refreshView(top); } }
    if (t === 'visuals') renderVisuals();
    if (t === 'settings') renderSettings();
    if (t === 'player') syncPlayer(true);
    syncMini();
    if (!quiet && prevTab !== t) try { sessionStorage.setItem('luciel.m.tab', t); } catch (e) {}
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  shell.querySelector('#mTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === tab && tab === 'library' && stack.length > 1) { popTo(0); return; }
    setTab(b.dataset.tab);
  });

  // ------------------------------------------------------------------ player
  const P = {};
  const coverOf = (t) => (t ? api.cover(t, false) : A.fallbackCover(null));
  const thumbOf = (t) => (t ? api.cover(t, true) : 'icons/icon-192.png');
  let lastTrackKey = '';
  function syncPlayer(force) {
    if (!P.title) return;
    const t = A.current;
    const key = t ? t.id + '|' + (t.coverUrl || '') + '|' + A.title(t) + '|' + A.artist(t) : '';
    if (key !== lastTrackKey || force) {
      lastTrackKey = key;
      P.title.textContent = t ? A.title(t) : 'Nothing playing';
      P.artist.textContent = t ? [A.artist(t) || 'Unknown artist', t.meta && t.meta.album].filter(Boolean).join(' · ') : (A.tracks.length ? 'Tap play to start' : 'Add music from the Library tab');
      const src = coverOf(t); if (P.art.getAttribute('src') !== src) P.art.src = src;
    }
    shell.classList.toggle('m-playing', !!t && !audio.paused);
    P.fav.classList.toggle('on', !!(t && api.isFav(t)));
    P.shuffle.classList.toggle('on', !!S.shuffle);
    P.repeat.classList.toggle('on', S.repeat !== 'off'); P.repeat.classList.toggle('one', S.repeat === 'one');
    P.repeat.title = 'Repeat: ' + S.repeat;
    const n = A.tracks.length, i = t ? A.tracks.indexOf(t) : -1;
    $('mPSub').textContent = n ? (i >= 0 ? `${i + 1} of ${n} in the queue` : `${n} in the queue`) : '';
    $('mVizChip').textContent = ({ spectrum: 'Spectrum', scope: 'Scope', both: 'Spectrum + scope', off: 'Visualizer off' })[S.vizMode] || 'Spectrum';
    const sc = A.luciel.scene; $('mSceneChip').textContent = (S.scene === 'auto' ? 'Auto · ' : '') + (sc ? sc.name : 'Scene');
    syncTime();
  }
  let seekDrag = null;
  function syncTime() {
    if (!P.seek) return;
    const d = isFinite(audio.duration) ? audio.duration : (A.current && A.current.duration) || 0;
    const c = seekDrag ? seekDrag.p * d : audio.currentTime || 0;
    const p = d ? Math.max(0, Math.min(1, c / d)) : 0;
    P.seek.style.setProperty('--p', (p * 100).toFixed(2));
    P.seek.setAttribute('aria-valuenow', Math.round(p * 100));
    P.cur.textContent = fmt(c); P.dur.textContent = d ? '-' + fmt(Math.max(0, d - c)) : '0:00';
    P.miniProg.style.width = (p * 100).toFixed(2) + '%';
  }
  function seekFromEvent(e) { const r = P.seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  function bindSeek() {
    const el = P.seek;
    el.addEventListener('pointerdown', (e) => { if (!A.current) return; try { el.setPointerCapture(e.pointerId); } catch (x) {} seekDrag = { p: seekFromEvent(e) }; el.classList.add('drag'); syncTime(); });
    el.addEventListener('pointermove', (e) => { if (!seekDrag) return; seekDrag.p = seekFromEvent(e); syncTime(); });
    const end = (e) => {
      if (!seekDrag) return; const p = seekDrag.p; seekDrag = null; el.classList.remove('drag');
      const d = audio.duration; if (isFinite(d) && d > 0 && e.type !== 'pointercancel') audio.currentTime = p * d;
      syncTime();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => { if (!A.current) return; if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5); });
  }
  function bindPlayer() {
    P.title = $('mTitle'); P.artist = $('mArtist'); P.art = $('mArt'); P.seek = $('mSeek'); P.cur = $('mCur'); P.dur = $('mDur');
    P.fav = $('mFav'); P.shuffle = $('mShuffle'); P.repeat = $('mRepeat'); P.miniProg = $('mMiniProg');
    $('mPlay').onclick = () => { vib(); A.togglePlay(); };
    $('mPrev').onclick = () => { vib(); A.prev(); };
    $('mNext').onclick = () => { vib(); A.next(); };
    P.shuffle.onclick = () => { A.setShuffle(!S.shuffle); A.toast(S.shuffle ? 'Shuffle on' : 'Shuffle off'); syncPlayer(); };
    P.repeat.onclick = () => { A.cycleRepeat(); A.toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[S.repeat]); syncPlayer(); };
    P.fav.onclick = () => { if (A.current) { A.toggleFavorite(); syncPlayer(); } };
    $('mQueue').onclick = openQueue; $('mEq').onclick = openEq;
    $('mMore').onclick = () => { if (A.current) trackSheet([A.current], 'player'); else A.toast('Nothing playing yet'); };
    $('mPMore').onclick = playerMenu;
    $('mVizChip').onclick = (e) => { e.stopPropagation(); A.cycleViz(); syncPlayer(); };
    $('mSceneChip').onclick = (e) => { e.stopPropagation(); scenePicker(); };
    $('mMiniPlay').onclick = (e) => { e.stopPropagation(); A.togglePlay(); };
    $('mMiniNext').onclick = (e) => { e.stopPropagation(); A.next(); };
    $('mMini').onclick = () => setTab('player');
    $('mPopOut').onclick = () => popOut();
    bindSeek(); bindStage();
  }
  function playerMenu() {
    const items = [['queue', IC.list, 'Queue'], ['eq', IC.eq, 'Equalizer'], ['scene', IC.spark, 'Choose a scene'], ['full', IC.expand, 'Full-screen visuals']];
    if (canPopOut()) items.push(['pop', IC.popout, 'Pop out (floating player)']);
    if (isAndroid() && window.LucielAndroidBridge) items.push(['ext', IC.spark, 'Spotify visuals']);
    items.push(['theme', IC.gear, 'Theme & settings']);
    menuSheet('Player', items, (a) => {
      if (a === 'queue') openQueue(); else if (a === 'eq') openEq(); else if (a === 'scene') scenePicker(); else if (a === 'full') setImmersive(true);
      else if (a === 'pop') popOut(); else if (a === 'ext') window.LucielAndroidBridge.extMode(true); else if (a === 'theme') setTab('settings');
    });
  }

  // ---- stage: horizontal swipe = visualizer mode, tap = immersive full screen
  let immersive = false;
  function setImmersive(on) {
    if (immersive === !!on) return;
    immersive = !!on; body.classList.toggle('m-immersive', immersive);
    try { if (window.LucielAndroid && window.LucielAndroid.immersive) window.LucielAndroid.immersive(immersive); } catch (e) {}
    const h = $('mStageHint'); h.classList.remove('show'); if (immersive) { void h.offsetWidth; h.classList.add('show'); }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  function bindStage() {
    const st = $('mStage'); let g = null;
    st.addEventListener('pointerdown', (e) => { if (e.target.closest('.m-chip')) return; g = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    st.addEventListener('pointerup', (e) => {
      if (!g) return; const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = performance.now() - g.t; g = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        const M = ['spectrum', 'scope', 'both', 'off'];
        const i = Math.max(0, M.indexOf(S.vizMode)); A.setVizMode(M[(i + (dx < 0 ? 1 : -1) + M.length) % M.length]); syncPlayer();
        const c = $('mVizChip'); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
        return;
      }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 450) setImmersive(!immersive);
    });
    st.addEventListener('pointercancel', () => { g = null; });
  }

  // ---- mini "now playing" bar (every tab except the player)
  function syncMini() {
    const t = A.current, show = active && tab !== 'player' && !!t;
    const m = $('mMini'); m.hidden = !show; shell.classList.toggle('m-has-mini', show); body.classList.toggle('m-has-mini', show);
    if (!show) return;
    $('mMiniTitle').textContent = A.title(t); $('mMiniArtist').textContent = A.artist(t) || 'Unknown artist';
    const src = thumbOf(t); const im = $('mMiniArt'); if (im.getAttribute('src') !== src) im.src = src;
  }

  // ------------------------------------------------------------------ bottom sheets
  const sheet = { onClose: null, kind: '' };
  function openSheet(htmlStr, { kind = '', onClose = null, tall = false } = {}) {
    closeSheet(true);
    const b = $('mSheetBody'); b.innerHTML = htmlStr; b.onclick = null; b.scrollTop = 0;
    sheetHost.dataset.kind = kind; sheetHost.classList.toggle('tall', !!tall);
    sheet.onClose = onClose; sheet.kind = kind;
    sheetHost.hidden = false; requestAnimationFrame(() => sheetHost.classList.add('open'));
    return b;
  }
  function closeSheet(instant) {
    if (sheetHost.hidden) return false;
    const cb = sheet.onClose; sheet.onClose = null; sheet.kind = '';
    sheetHost.classList.remove('open');
    const fresh = $('mSheetBody').cloneNode(false); $('mSheetBody').replaceWith(fresh);   // drop the listeners of the old content
    if (instant) sheetHost.hidden = true;
    else setTimeout(() => { if (!sheetHost.classList.contains('open')) sheetHost.hidden = true; }, 220);
    if (cb) cb();
    return true;
  }
  sheetHost.querySelector('.m-scrim').addEventListener('click', () => closeSheet());
  (function dragToClose() {
    const grab = sheetHost.querySelector('.m-grab'), sh = sheetHost.querySelector('.m-sheet'); let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grab.setPointerCapture(e.pointerId); } catch (x) {} sh.style.transition = 'none'; });
    grab.addEventListener('pointermove', (e) => { if (y0 == null) return; sh.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    const up = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; sh.style.transition = ''; sh.style.transform = ''; if (dy > 90) closeSheet(); };
    grab.addEventListener('pointerup', up); grab.addEventListener('pointercancel', up);
  })();
  function menuSheet(title, items, cb, head = '') {
    const b = openSheet(`<div class="m-sh-head">${head || `<b>${esc(title)}</b>`}</div><div class="m-menu">${items.map(([a, ic, label, cls]) => `<button class="m-mi${cls ? ' ' + cls : ''}" data-a="${esc(a)}">${ic || ''}<span>${label}</span></button>`).join('')}</div>`, { kind: 'menu' });
    b.onclick = (e) => { const x = e.target.closest('[data-a]'); if (!x) return; closeSheet(true); cb(x.dataset.a); };
  }
  function askText(title, value, okText) {
    return new Promise((res) => {
      const b = openSheet(`<div class="m-sh-head"><b>${esc(title)}</b></div><form class="m-ask"><input type="text" value="${esc(value || '')}" spellcheck="false" autocomplete="off"><div class="m-ask-btns"><button type="button" class="m-btn" data-x>Cancel</button><button class="m-btn primary">${esc(okText || 'OK')}</button></div></form>`, { kind: 'ask', onClose: () => res(null) });
      const inp = b.querySelector('input'); setTimeout(() => { inp.focus(); inp.select(); }, 60);
      b.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); sheet.onClose = null; closeSheet(); res(v || null); };
      b.querySelector('[data-x]').onclick = () => closeSheet();
    });
  }
  function confirmSheet(title, okText) {
    return new Promise((res) => {
      const b = openSheet(`<div class="m-sh-head m-wrap"><b>${esc(title)}</b></div><div class="m-ask-btns"><button class="m-btn" data-x>Cancel</button><button class="m-btn danger" data-ok>${esc(okText || 'OK')}</button></div>`, { kind: 'ask', onClose: () => res(false) });
      b.querySelector('[data-ok]').onclick = () => { sheet.onClose = null; closeSheet(); res(true); };
      b.querySelector('[data-x]').onclick = () => closeSheet();
    });
  }

  // ---- long-press / "⋯" context sheet for songs
  function trackSheet(list, ctx, extra) {
    list = list.filter(Boolean); if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    const G = lib.groups(), inf = one && G.info.get(one);
    const allFav = list.every((t) => api.isFav(t));
    const head = one ? `<div class="m-sh-track"><img src="${esc(thumbOf(one))}" alt=""><div><b>${esc(A.title(one))}</b><span>${esc([A.artist(one), one.meta && one.meta.album].filter(Boolean).join(' · '))}</span></div></div>` : `<b>${list.length} songs</b>`;
    const items = [];
    if (ctx !== 'player') items.push(['playnow', IC.play, 'Play now']);
    items.push(['next', IC.next, 'Play next'], ['queue', IC.list, 'Add to queue'], ['pl', IC.plus, 'Add to playlist…'],
      ['edit', G_('✎'), list.length > 1 ? 'Edit tags (batch)…' : 'Edit tags & cover…'], ['fav', IC.heart, allFav ? 'Remove from favorites' : 'Favorite', allFav ? 'on' : '']);
    if (one && inf) { items.push(['artist', G_('☺'), 'Go to artist']); if (inf.albumKey) items.push(['album', G_('◉'), 'Go to album']); }
    if (ctx === 'playlist' && extra) items.push(['unpl', IC.x, 'Remove from this playlist']);
    if (ctx === 'queue') items.push(['unq', IC.x, 'Remove from queue']);
    items.push(['forget', IC.trash, 'Remove from library…', 'danger']);
    menuSheet('', items, async (a) => {
      switch (a) {
        case 'playnow': api.playList(list, 0); break;
        case 'next': api.enqueue(list, true); break;
        case 'queue': api.enqueue(list, false); break;
        case 'pl': playlistPicker(list); break;
        case 'edit': api.edit(list); break;
        case 'fav': api.setFav(list, !allFav); A.emit('library'); A.toast(allFav ? 'Removed from favorites' : 'Added to favorites ♥'); syncPlayer(); break;
        case 'artist': { const k = norm(inf.albumArtist === 'Various Artists' || !inf.albumArtist ? inf.primary : inf.albumArtist) || 'unknown artist'; goLib([{ type: 'artists' }, { type: 'artist', key: k }]); break; }
        case 'album': goLib([{ type: 'albums' }, { type: 'album', key: inf.albumKey }]); break;
        case 'unpl': { const p = lib.playlists.find((x) => x.id === extra.pid); if (p) { p.ids.splice(extra.index, 1); lib.savePlaylist(p); A.toast('Removed from “' + p.name + '”'); } break; }
        case 'unq': api.queueRemove(new Set(list.map((t) => t.id))); break;
        case 'forget': if (await confirmSheet(`Remove ${one ? '“' + A.title(one) + '”' : list.length + ' songs'} from the library? The files are not deleted.`, 'Remove')) { const ids = new Set(list.map((t) => t.id)); lib.forgetTracks(ids); api.removeFromLibrary(ids); } break;
      }
    }, head);
  }
  /** jump to a library path from anywhere: keeps Home at the bottom of the stack */
  function goLib(path) {
    setTab('library'); popTo(0);
    path.forEach((v, i) => push(v, false, i < path.length - 1));
  }
  function playlistPicker(list) {
    menuSheet('Add to playlist', [['__new', IC.plus, 'New playlist…'], ...lib.playlists.map((p) => [p.id, G_('≡'), `${esc(p.name)} <em>${p.ids.length}</em>`])], async (id) => {
      if (id === '__new') { const n = await askText('New playlist name', 'New playlist', 'Create'); if (n) { const p = lib.createPlaylist(n); lib.addToPlaylist(p.id, list); } }
      else lib.addToPlaylist(id, list);
    });
  }

  // ---- long press helper (touch + mouse): fires cb(el); swallows the click that follows
  function longPress(root, sel, cb) {
    let timer = 0, start = null, fired = false;
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest(sel); if (!el || e.button > 0 || e.target.closest('[data-more],.m-handle')) return;
      fired = false; start = { x: e.clientX, y: e.clientY };
      clearTimeout(timer); timer = setTimeout(() => { fired = true; start = null; vib(); el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 250); cb(el); }, 480);
    });
    root.addEventListener('pointermove', (e) => { if (start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) { clearTimeout(timer); start = null; } }, { passive: true });
    ['pointerup', 'pointercancel'].forEach((ev) => root.addEventListener(ev, () => { clearTimeout(timer); start = null; }, { passive: true }));
    root.addEventListener('scroll', () => { clearTimeout(timer); start = null; }, { passive: true, capture: true });
    root.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
    root.addEventListener('contextmenu', (e) => { const el = e.target.closest(sel); if (!el) return; e.preventDefault(); if (!fired) { clearTimeout(timer); cb(el); } });
  }

  // ------------------------------------------------------------------ library (iPod-style drill-down stack)
  const stack = [];   // [{v, el, q, list}]
  const dirtyViews = new Set();
  const stackHost = () => $('mStack');
  const SMART = () => lib.SMART;
  function titleOf(v) {
    const G = lib.groups();
    switch (v.type) {
      case 'home': return 'Library';
      case 'songs': return 'Songs'; case 'artists': return 'Artists'; case 'albums': return 'Albums'; case 'genres': return 'Genres'; case 'playlists': return 'Playlists'; case 'queue': return 'Queue';
      case 'artist': { const a = G.artists.get(v.key); return a ? a.name : 'Artist'; }
      case 'album': { const a = G.albums.get(v.key); return a ? a.name : 'Album'; }
      case 'genre': { const g = G.genres.get(v.key); return g ? g.name : 'Genre'; }
      case 'playlist': { const p = lib.playlists.find((x) => x.id === v.key); return p ? p.name : 'Playlist'; }
      case 'smart': { const s = SMART().find((x) => x.id === v.key); return s ? s.name : 'Playlist'; }
    }
    return '';
  }
  function push(v, root, instant) {
    const host = stackHost();
    if (root) { stack.length = 0; host.innerHTML = ''; dirtyViews.clear(); }
    const el = document.createElement('div'); el.className = 'm-view'; el.dataset.type = v.type;
    const entry = { v, el, q: '', list: null }; stack.push(entry);
    host.appendChild(el); renderView(entry);
    if (!root && stack.length > 1) {
      const below = stack[stack.length - 2]; below.scroll = below.el.scrollTop;
      if (instant) { below.el.classList.add('under', 'hidden-under'); }
      else {
        el.classList.add('enter'); below.el.classList.add('under');
        void el.offsetWidth; el.classList.remove('enter');
        setTimeout(() => { if (stack[stack.length - 1] !== below) below.el.classList.add('hidden-under'); }, 300);
      }
    }
    return entry;
  }
  function pop(animated = true) {
    if (stack.length <= 1) return false;
    const top = stack.pop(), below = stack[stack.length - 1];
    below.el.classList.remove('hidden-under');
    if (dirtyViews.has(below)) { dirtyViews.delete(below); refreshView(below); }
    below.el.scrollTop = below.scroll || 0;
    void below.el.offsetWidth; below.el.classList.remove('under');
    if (animated) { top.el.classList.add('leave'); setTimeout(() => top.el.remove(), 280); } else top.el.remove();
    dirtyViews.delete(top);
    return true;
  }
  function popTo(n) { while (stack.length > n + 1) pop(stack.length === n + 2); }
  function viewHeader(entry, title) {
    const depth = stack.indexOf(entry);
    return `<header class="m-top m-vtop">${depth > 0 ? `<button class="m-ic m-back" data-act="back" title="Back">${IC.back}</button>` : ''}<h2>${esc(title)}</h2><button class="m-ic" data-act="menu" title="More actions">${IC.more}</button></header>
      <div class="m-search"><span>${IC.search}</span><input type="search" placeholder="Search ${esc(entry.v.type === 'home' ? 'your library' : title)}" value="${esc(entry.q)}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="m-clear" data-act="clear" title="Clear" ${entry.q ? '' : 'hidden'}>${IC.x}</button></div>`;
  }
  const has = (q) => (s) => String(s || '').toLowerCase().includes(q);
  const matchT = (t, q) => !q || [A.title(t), A.artist(t), t.meta && t.meta.album, t.meta && t.meta.genre, t.name].some(has(q));
  const durOf = (list) => { const s = list.reduce((a, t) => a + (isFinite(t.duration) ? t.duration : 0), 0); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`; };
  function trackRows(list, opt = {}) {
    if (!list.length) return `<div class="m-empty">${opt.empty || 'Nothing here yet.'}</div>`;
    const cur = A.current;
    let lastDisc = null; const multi = opt.discs && new Set(list.map((t) => num((t.meta || {}).disc) || 1)).size > 1;
    return `<div class="m-list">` + list.map((t, i) => {
      let pre = '';
      if (multi) { const d = num((t.meta || {}).disc) || 1; if (d !== lastDisc) { lastDisc = d; pre = `<div class="m-sec">Disc ${d}</div>`; } }
      const lead = opt.numbers ? `<span class="m-no">${num((t.meta || {}).track) || i + 1}</span>` : `<img class="m-art" src="${esc(thumbOf(t))}" alt="" loading="lazy">`;
      const sub = opt.sub ? opt.sub(t) : [A.artist(t) || 'Unknown artist', t.meta && t.meta.album].filter(Boolean).join(' · ');
      return pre + `<div class="m-row m-track${t === cur ? ' playing' : ''}${t.supported === false ? ' unsupported' : ''}" data-i="${i}" data-id="${esc(t.id)}">${lead}<div class="m-txt"><b>${api.isFav(t) ? '<i class="m-fv">♥</i>' : ''}${esc(A.title(t))}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div><span class="m-dur">${isFinite(t.duration) ? fmt(t.duration) : ''}</span><button class="m-ic m-rmore" data-more="${i}" title="More">${IC.more}</button></div>`;
    }).join('') + '</div>';
  }
  function navRow(act, ic, label, count, sub = '') { return `<button class="m-row m-nav" data-go="${esc(act)}"><span class="m-nic">${ic}</span><div class="m-txt"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>${count != null ? `<em class="m-count">${count}</em>` : ''}<span class="m-chev">${IC.chev}</span></button>`; }
  function albumCards(list) {
    if (!list.length) return '<div class="m-empty">No albums.</div>';
    return `<div class="m-grid">${list.map((al) => { const t = al.tracks.find((x) => x.coverUrl) || al.tracks[0]; return `<button class="m-card" data-album="${esc(al.key)}"><span class="m-cover"><img src="${esc(api.cover(t, true))}" alt="" loading="lazy"></span><b>${esc(al.name)}</b><span>${esc(al.artist)}${al.year ? ' · ' + esc(al.year) : ''}</span></button>`; }).join('')}</div>`;
  }
  function heroBlock(img, title, sub, round) {
    return `<div class="m-hero"><img class="${round ? 'round' : ''}" src="${esc(img)}" alt=""><div class="m-hero-text"><h3>${esc(title)}</h3><p>${sub}</p></div></div><div class="m-hero-btns"><button class="m-btn primary" data-act="play">${IC.play}<span>Play</span></button><button class="m-btn" data-act="shuffle">${IC.shuffle}<span>Shuffle</span></button></div>`;
  }
  const shuffled = (l) => { l = l.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
  const coverT = (tracks) => tracks.find((x) => x.coverUrl) || tracks[0];
  function renderView(entry) {
    const v = entry.v, q = entry.q.trim().toLowerCase(), G = lib.groups(), all = api.all();
    let h = '', list = null;
    switch (v.type) {
      case 'home': {
        if (q) { const r = searchAll(q, G); h = r.h; list = r.songs; break; }
        const sm = SMART().map((s) => navRow(s.id, G_(s.icon), s.name, s.id === 'smart:bpm' ? null : s.list().length, s.id === 'smart:bpm' ? `${S.smartBpm.min}–${S.smartBpm.max} BPM` : '')).join('');
        h = `<div class="m-group">${navRow('songs', IC.note, 'Songs', all.length)}${navRow('artists', G_('☺'), 'Artists', G.artists.size)}${navRow('albums', G_('◉'), 'Albums', G.albums.size)}${navRow('genres', G_('♯'), 'Genres', G.genres.size)}${navRow('playlists', G_('≡'), 'Playlists', lib.playlists.length)}</div>
          <div class="m-sec">Smart lists</div><div class="m-group">${sm}${navRow('queue', IC.list, 'Up next (queue)', A.tracks.length)}</div>
          ${all.length ? '' : `<div class="m-empty big">Your library is empty.<br><button class="m-btn primary" data-act="add">${IC.plus}<span>Add music</span></button></div>`}`;
        break;
      }
      case 'songs':
        list = all.filter((t) => matchT(t, q)).sort((a, b) => A.title(a).localeCompare(A.title(b), undefined, { numeric: true, sensitivity: 'base' }));
        h = `<div class="m-subhead"><span>${list.length} songs · ${durOf(list)}</span><span class="m-sh-btns"><button class="m-pill" data-act="play">${IC.play}Play</button><button class="m-pill" data-act="shuffle">${IC.shuffle}Shuffle</button></span></div>`
          + trackRows(list, { empty: all.length ? 'No songs match.' : 'Your library is empty — add music from the ⋯ menu.' });
        break;
      case 'artists': {
        const arr = [...G.artists.values()].filter((a) => !q || has(q)(a.name)).sort((a, b) => (a.name === 'Various Artists') - (b.name === 'Various Artists') || norm(a.name).localeCompare(norm(b.name)));
        h = arr.length ? `<div class="m-list">${arr.map((a) => {
          const al = [...a.albums].map((k) => G.albums.get(k)).find(Boolean); const t = al ? coverT(al.tracks) : [...a.tracks][0];
          return `<button class="m-row m-artist" data-artist="${esc(a.key)}"><img class="m-art round" src="${esc(api.cover(t, true))}" alt="" loading="lazy"><div class="m-txt"><b>${esc(a.name)}</b><span>${a.albums.size ? `${a.albums.size} album${a.albums.size === 1 ? '' : 's'} · ` : ''}${a.tracks.size} song${a.tracks.size === 1 ? '' : 's'}</span></div><span class="m-chev">${IC.chev}</span></button>`; }).join('')}</div>` : '<div class="m-empty">No artists.</div>';
        break;
      }
      case 'artist': {
        const a = G.artists.get(v.key); if (!a) { h = '<div class="m-empty">This artist is no longer in the library.</div>'; break; }
        const own = [...a.albums].map((k) => G.albums.get(k)).filter(Boolean).sort((x, y) => String(y.year || '').localeCompare(String(x.year || '')) || norm(x.name).localeCompare(norm(y.name)));
        const app = [...a.appears].filter((k) => !a.albums.has(k)).map((k) => G.albums.get(k)).filter(Boolean);
        list = [...a.tracks].filter((t) => matchT(t, q)).sort((x, y) => norm(x.meta && x.meta.album).localeCompare(norm(y.meta && y.meta.album)) || (num(x.meta && x.meta.disc) - num(y.meta && y.meta.disc)) || (num(x.meta && x.meta.track) - num(y.meta && y.meta.track)) || A.title(x).localeCompare(A.title(y)));
        const t0 = own[0] ? coverT(own[0].tracks) : coverT([...a.tracks]);
        h = (q ? '' : heroBlock(api.cover(t0, false), a.name, `${a.tracks.size} songs${own.length ? ` · ${own.length} album${own.length === 1 ? '' : 's'}` : ''} · ${durOf([...a.tracks])}`, true)
          + (own.length ? `<div class="m-sec">Albums</div><div class="m-hscroll">${albumCards(own)}</div>` : '')
          + (app.length ? `<div class="m-sec">Appears on</div><div class="m-hscroll">${albumCards(app)}</div>` : ''))
          + `<div class="m-sec">Songs</div>` + trackRows(list, { empty: 'No songs match.' });
        break;
      }
      case 'albums': {
        const arr = [...G.albums.values()].filter((al) => !q || has(q)(al.name) || has(q)(al.artist)).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
        h = albumCards(arr); break;
      }
      case 'album': {
        const al = G.albums.get(v.key); if (!al) { h = '<div class="m-empty">This album is no longer in the library.</div>'; break; }
        list = al.tracks.filter((t) => matchT(t, q));
        h = (q ? '' : heroBlock(api.cover(coverT(al.tracks), false), al.name, `<a class="m-link" data-artist="${esc(norm(al.artist) || 'unknown artist')}">${esc(al.artist)}</a>${al.year ? ' · ' + esc(al.year) : ''}${al.genre ? ' · ' + esc(al.genre) : ''}<br>${al.tracks.length} songs · ${durOf(al.tracks)}`))
          + trackRows(list, { numbers: true, discs: true, sub: (t) => (norm(A.artist(t)) !== norm(al.artist) ? A.artist(t) : ''), empty: 'No songs match.' });
        break;
      }
      case 'genres': {
        const arr = [...G.genres.values()].filter((x) => !q || has(q)(x.name)).sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name));
        h = arr.length ? `<div class="m-list">${arr.map((x) => `<button class="m-row m-genre" data-genre="${esc(x.key)}"><img class="m-art" src="${esc(api.genreArt(x.name))}" alt="" loading="lazy"><div class="m-txt"><b>${esc(x.name)}</b><span>${x.tracks.length} song${x.tracks.length === 1 ? '' : 's'}</span></div><span class="m-chev">${IC.chev}</span></button>`).join('')}</div>` : '<div class="m-empty">No genres.</div>';
        break;
      }
      case 'genre': {
        const x = G.genres.get(v.key); if (!x) { h = '<div class="m-empty">No such genre.</div>'; break; }
        list = x.tracks.filter((t) => matchT(t, q));
        h = (q ? '' : heroBlock(api.genreArt(x.name), x.name, `Genre · ${x.tracks.length} songs · ${durOf(x.tracks)}`)) + trackRows(list);
        break;
      }
      case 'playlists': {
        const arr = lib.playlists.filter((p) => !q || has(q)(p.name));
        h = `<div class="m-group">${navRow('__newpl', IC.plus, 'New playlist…', null)}${navRow('__import', G_('⇪'), 'Import M3U…', null)}</div><div class="m-sec">Your playlists</div>`
          + (arr.length ? `<div class="m-list">${arr.map((p) => { const t = coverT(lib.playlistTracks(p)); return `<button class="m-row m-pl" data-pl="${esc(p.id)}"><img class="m-art" src="${esc(t ? api.cover(t, true) : 'icons/icon-192.png')}" alt="" loading="lazy"><div class="m-txt"><b>${esc(p.name)}</b><span>${p.ids.length} song${p.ids.length === 1 ? '' : 's'}</span></div><span class="m-chev">${IC.chev}</span></button>`; }).join('')}</div>`
            : '<div class="m-empty">No playlists yet. Long-press a song and choose “Add to playlist”.</div>');
        break;
      }
      case 'playlist': {
        const p = lib.playlists.find((x) => x.id === v.key); if (!p) { h = '<div class="m-empty">This playlist was deleted.</div>'; break; }
        const full = lib.playlistTracks(p); list = full.filter((t) => matchT(t, q)); entry.full = full;
        const t0 = coverT(full);
        h = (q ? '' : heroBlock(t0 ? api.cover(t0, false) : 'icons/icon-512.png', p.name, `Playlist · ${full.length} songs · ${durOf(full)}`))
          + trackRows(list, { empty: 'Empty playlist — long-press songs anywhere and choose “Add to playlist”.' });
        break;
      }
      case 'smart': {
        const s = SMART().find((x) => x.id === v.key); const full = s ? s.list() : []; list = full.filter((t) => matchT(t, q)); entry.full = full;
        const bpm = s && s.id === 'smart:bpm' ? `<div class="m-bpm"><label>From <input type="number" inputmode="numeric" id="mBpmMin" min="30" max="300" value="${S.smartBpm.min}"></label><label>to <input type="number" inputmode="numeric" id="mBpmMax" min="30" max="300" value="${S.smartBpm.max}"></label><span>BPM</span></div>` : '';
        h = `<div class="m-subhead"><span>Smart list · ${full.length} songs</span><span class="m-sh-btns"><button class="m-pill" data-act="play">${IC.play}Play</button><button class="m-pill" data-act="shuffle">${IC.shuffle}Shuffle</button></span></div>${bpm}`
          + trackRows(list, { empty: s && s.id === 'smart:fav' ? 'No favorites yet — tap ♥ on the player.' : s && s.id === 'smart:bpm' ? 'No songs in this tempo range (BPM is measured as songs play).' : 'Nothing here yet.' });
        break;
      }
      case 'queue':
        list = A.tracks.filter((t) => matchT(t, q));
        h = `<div class="m-subhead"><span>${A.tracks.length} songs · ${durOf(A.tracks)}</span><span class="m-sh-btns"><button class="m-pill" data-act="openq">${IC.grip}Reorder</button></span></div>` + trackRows(list, { empty: 'The queue is empty.' });
        break;
    }
    entry.list = list;
    const y = entry.el.scrollTop;
    entry.el.innerHTML = viewHeader(entry, titleOf(v)) + `<div class="m-vbody">${h}</div>`;
    entry.el.scrollTop = y;
  }
  function searchAll(q, G) {
    const songs = api.all().filter((t) => matchT(t, q)).slice(0, 300);
    const artists = [...G.artists.values()].filter((a) => has(q)(a.name)).slice(0, 12);
    const albums = [...G.albums.values()].filter((a) => has(q)(a.name) || has(q)(a.artist)).slice(0, 20);
    const pls = lib.playlists.filter((p) => has(q)(p.name));
    let h = '';
    if (artists.length) h += `<div class="m-sec">Artists</div><div class="m-list">${artists.map((a) => `<button class="m-row m-artist" data-artist="${esc(a.key)}"><span class="m-nic">${G_('☺')}</span><div class="m-txt"><b>${esc(a.name)}</b><span>${a.tracks.size} songs</span></div><span class="m-chev">${IC.chev}</span></button>`).join('')}</div>`;
    if (albums.length) h += `<div class="m-sec">Albums</div><div class="m-hscroll">${albumCards(albums)}</div>`;
    if (pls.length) h += `<div class="m-sec">Playlists</div><div class="m-list">${pls.map((p) => `<button class="m-row m-pl" data-pl="${esc(p.id)}"><span class="m-nic">${G_('≡')}</span><div class="m-txt"><b>${esc(p.name)}</b><span>${p.ids.length} songs</span></div><span class="m-chev">${IC.chev}</span></button>`).join('')}</div>`;
    h += `<div class="m-sec">Songs</div>` + trackRows(songs, { empty: 'No songs match.' });
    return { h, songs };
  }
  function refreshView(entry) {
    if (!entry || !entry.el) return;
    const ae = document.activeElement, focus = ae && entry.el.contains(ae) && ae.type === 'search';
    const sel = focus ? [ae.selectionStart, ae.selectionEnd] : null;
    renderView(entry);
    if (focus) { const i = entry.el.querySelector('.m-search input'); if (i) { i.focus(); try { i.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  }
  let libTimer = 0;
  function libraryChanged() {
    if (!built) return;
    clearTimeout(libTimer);
    libTimer = setTimeout(() => {
      const top = stack[stack.length - 1];
      stack.forEach((e) => { if (e !== top) dirtyViews.add(e); });
      if (top && active && tab === 'library') { dirtyViews.delete(top); refreshView(top); } else if (top) dirtyViews.add(top);
    }, 250);
  }
  const entryOf = (node) => stack.find((x) => x.el && x.el.contains(node));
  function bindLibrary() {
    const host = stackHost();
    host.addEventListener('input', (e) => {
      if (e.target.type !== 'search') return;
      const entry = entryOf(e.target); if (!entry) return;
      entry.q = e.target.value; clearTimeout(entry.t); entry.t = setTimeout(() => refreshView(entry), 140);
    });
    host.addEventListener('click', async (e) => {
      const entry = entryOf(e.target); if (!entry) return;
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'back') pop();
        else if (a === 'clear') { entry.q = ''; refreshView(entry); }
        else if (a === 'menu') viewMenu(entry);
        else if (a === 'add') addMusicMenu();
        else if (a === 'play' || a === 'shuffle') {
          let l = entry.full && !entry.q ? entry.full : entry.list || [];
          if (!l.length) { A.toast('Nothing to play here', 'warn'); return; }
          if (a === 'shuffle') l = shuffled(l);
          api.playList(l, 0); vib();
        } else if (a === 'openq') openQueue();
        return;
      }
      const more = e.target.closest('[data-more]');
      if (more) { openRowSheet(entry, (entry.list || [])[+more.dataset.more]); return; }
      const go = e.target.closest('[data-go]');
      if (go) {
        const id = go.dataset.go;
        if (id === '__newpl') { const n = await askText('New playlist name', 'New playlist', 'Create'); if (n) { const p = lib.createPlaylist(n); push({ type: 'playlist', key: p.id }); } return; }
        if (id === '__import') { importM3U(); return; }
        if (id.startsWith('smart:')) push({ type: 'smart', key: id }); else push({ type: id });
        return;
      }
      const al = e.target.closest('[data-album]'); if (al) { push({ type: 'album', key: al.dataset.album }); return; }
      const ar = e.target.closest('[data-artist]'); if (ar) { push({ type: 'artist', key: ar.dataset.artist }); return; }
      const ge = e.target.closest('[data-genre]'); if (ge) { push({ type: 'genre', key: ge.dataset.genre }); return; }
      const pl = e.target.closest('[data-pl]'); if (pl) { push({ type: 'playlist', key: pl.dataset.pl }); return; }
      const row = e.target.closest('.m-track[data-i]');
      if (row) {
        const l = entry.list || [], i = +row.dataset.i, t = l[i]; if (!t) return;
        if (entry.v.type === 'queue') A.playTrack(t); else api.playList(l, i);
        vib();
      }
    });
    host.addEventListener('change', (e) => {
      if (e.target.id !== 'mBpmMin' && e.target.id !== 'mBpmMax') return;
      const p = e.target.closest('.m-bpm'); let a = +p.querySelector('#mBpmMin').value || 0, b = +p.querySelector('#mBpmMax').value || 999; if (a > b) [a, b] = [b, a];
      S.smartBpm = { min: a, max: b }; A.save(); refreshView(entryOf(e.target));
    });
    longPress(host, '.m-track[data-i]', (row) => { const entry = entryOf(row); if (entry) openRowSheet(entry, (entry.list || [])[+row.dataset.i]); });
    longPress(host, '.m-pl[data-pl]', (row) => { const p = lib.playlists.find((x) => x.id === row.dataset.pl); if (p) playlistMenu(p); });
    longPress(host, '.m-card[data-album]', (card) => { const al = lib.groups().albums.get(card.dataset.album); if (al) trackSheet(al.tracks.slice(), 'library'); });
    // swipe right from the left edge = back (the Android system back gesture also works, see android.js)
    let sw = null;
    host.addEventListener('pointerdown', (e) => { if (stack.length > 1 && e.clientX < 28) sw = { x: e.clientX, y: e.clientY, el: stack[stack.length - 1].el, under: stack[stack.length - 2].el, id: e.pointerId }; });
    host.addEventListener('pointermove', (e) => {
      if (!sw || e.pointerId !== sw.id) return; const dx = e.clientX - sw.x;
      if (!sw.on && Math.abs(e.clientY - sw.y) > 24) { sw = null; return; }
      if (dx > 12) { if (!sw.on) { sw.on = true; try { host.setPointerCapture(e.pointerId); } catch (x) {} sw.el.style.transition = 'none'; sw.under.classList.remove('hidden-under'); } sw.el.style.transform = `translateX(${dx}px)`; }
    });
    const end = (e) => {
      if (!sw || e.pointerId !== sw.id) return; const s = sw; sw = null; if (!s.on) return;
      const dx = e.clientX - s.x; s.el.style.transition = ''; s.el.style.transform = '';
      if (dx > innerWidth * 0.33 && e.type !== 'pointercancel') pop(); else s.under.classList.add('hidden-under');
    };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
  }
  function openRowSheet(entry, t) {
    if (!t) return;
    if (entry.v.type === 'playlist') { const p = lib.playlists.find((x) => x.id === entry.v.key); const idx = p ? p.ids.indexOf(t.id) : -1; trackSheet([t], 'playlist', p && idx >= 0 ? { pid: p.id, index: idx } : null); }
    else trackSheet([t], entry.v.type === 'queue' ? 'queue' : 'library');
  }
  const addItems = () => {
    const items = [];
    if (isAndroid() && window.LucielAndroidUI && window.LucielAndroidUI.scan) items.push(['scan', G_('⟳'), 'Scan music on this phone']);
    items.push(['files', IC.plus, 'Add files…'], ['folder', IC.folder, 'Add a folder…'], ['newpl', IC.plus, 'New playlist…'], ['m3u', G_('⇪'), 'Import M3U…']);
    return items;
  };
  async function doAdd(a) {
    if (a === 'scan') window.LucielAndroidUI.scan(true);
    else if (a === 'files') api.openFiles(); else if (a === 'folder') api.openFolder();
    else if (a === 'newpl') { const n = await askText('New playlist name', 'New playlist', 'Create'); if (n) { const p = lib.createPlaylist(n); goLib([{ type: 'playlists' }, { type: 'playlist', key: p.id }]); } }
    else if (a === 'm3u') importM3U();
  }
  function addMusicMenu() { menuSheet('Add music', addItems(), doAdd); }
  function importM3U() {
    const before = new Set(lib.playlists.map((p) => p.id));
    const once = () => setTimeout(() => { const p = lib.playlists.find((x) => !before.has(x.id)); if (p) { window.removeEventListener('luciel:library', once); goLib([{ type: 'playlists' }, { type: 'playlist', key: p.id }]); } }, 300);
    window.addEventListener('luciel:library', once);
    setTimeout(() => window.removeEventListener('luciel:library', once), 120000);
    lib.importM3U();
  }
  function playlistMenu(p) {
    menuSheet(p.name, [['play', IC.play, 'Play'], ['shuffle', IC.shuffle, 'Shuffle'], ['queue', IC.list, 'Add to queue'], ['edit', G_('✎'), 'Edit tags of these songs…'], ['rename', G_('✎'), 'Rename…'], ['dup', G_('⧉'), 'Duplicate'], ['export', G_('⇩'), 'Export M3U8'], ['delete', IC.trash, 'Delete playlist…', 'danger']], async (a) => {
      const list = lib.playlistTracks(p);
      if (['play', 'shuffle', 'queue', 'edit'].includes(a) && !list.length) { A.toast('This playlist is empty', 'warn'); return; }
      if (a === 'play') api.playList(list, 0);
      else if (a === 'shuffle') api.playList(shuffled(list), 0);
      else if (a === 'queue') api.enqueue(list, false);
      else if (a === 'edit') api.edit(list);
      else if (a === 'rename') { const n = await askText('Rename playlist', p.name, 'Rename'); if (n) { p.name = n; lib.savePlaylist(p); } }
      else if (a === 'dup') lib.createPlaylist(p.name + ' (copy)', p.ids.slice());
      else if (a === 'export') lib.exportM3U(list, p.name);
      else if (a === 'delete') { if (await confirmSheet(`Delete the playlist “${p.name}”? The songs stay in the library.`, 'Delete')) { lib.deletePlaylist(p); const top = stack[stack.length - 1]; if (top && top.v.type === 'playlist' && top.v.key === p.id) pop(); } }
    });
  }
  function viewMenu(entry) {
    const v = entry.v;
    if (v.type === 'playlist') { const p = lib.playlists.find((x) => x.id === v.key); if (p) return playlistMenu(p); }
    const list = entry.list || [], items = [];
    if (list.length) items.push(['play', IC.play, 'Play all'], ['shuffle', IC.shuffle, 'Shuffle all'], ['queue', IC.list, 'Add all to the queue'], ['edit', G_('✎'), `Edit tags of these ${list.length} songs…`]);
    if (v.type === 'smart' && list.length) items.push(['snap', G_('≡'), 'Save as a playlist']);
    if (v.type === 'queue' && list.length) items.push(['saveq', G_('≡'), 'Save the queue as a playlist…'], ['clearq', IC.trash, 'Clear the queue', 'danger']);
    menuSheet(titleOf(v), items.concat(addItems()), async (a) => {
      if (a === 'play') api.playList(list, 0); else if (a === 'shuffle') api.playList(shuffled(list), 0);
      else if (a === 'queue') api.enqueue(list, false); else if (a === 'edit') api.edit(list);
      else if (a === 'snap') { const s = SMART().find((x) => x.id === v.key); const p = lib.createPlaylist(s.name, list.map((t) => t.id)); goLib([{ type: 'playlists' }, { type: 'playlist', key: p.id }]); }
      else if (a === 'saveq') saveQueue();
      else if (a === 'clearq') { if (await confirmSheet('Clear the queue? The songs stay in the library.', 'Clear')) api.clearQueue(); }
      else doAdd(a);
    });
  }
  async function saveQueue() { const n = await askText('Save the queue as a playlist', 'Queue ' + new Date().toLocaleDateString(), 'Save'); if (n) { lib.createPlaylist(n, A.tracks.map((t) => t.id)); A.toast('Saved “' + n + '”'); } }

  // ------------------------------------------------------------------ queue sheet (tap = play, drag the handle = reorder)
  function queueHTML() {
    const cur = A.current, q = A.tracks;
    return `<div class="m-sh-head"><b>Queue</b><em>${q.length} songs · ${durOf(q)}</em><span class="m-sh-acts"><button class="m-pill" data-q="save">Save</button><button class="m-pill" data-q="clear">Clear</button></span></div>
      <div class="m-qlist" id="mQList">${q.length ? q.map((t, i) => `<div class="m-row m-qrow${t === cur ? ' playing' : ''}" data-i="${i}" data-id="${esc(t.id)}"><img class="m-art" src="${esc(thumbOf(t))}" alt="" loading="lazy"><div class="m-txt"><b>${esc(A.title(t))}</b><span>${esc(A.artist(t) || 'Unknown artist')}</span></div><button class="m-ic m-qdel" data-del="${i}" title="Remove">${IC.x}</button><span class="m-handle" data-h="${i}" title="Drag to reorder">${IC.grip}</span></div>`).join('') : '<div class="m-empty">The queue is empty. Play something from the Library.</div>'}</div>`;
  }
  let drag = null;
  function openQueue() {
    const b = openSheet(queueHTML(), { kind: 'queue', tall: true });
    const cur = b.querySelector('.m-qrow.playing'); if (cur) requestAnimationFrame(() => { const l = b.querySelector('#mQList'); l.scrollTop = cur.offsetTop - l.clientHeight / 2 + cur.offsetHeight / 2; });
    b.onclick = async (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { if (q.dataset.q === 'clear') { if (await confirmSheet('Clear the queue? The songs stay in the library.', 'Clear')) api.clearQueue(); } else saveQueue(); return; }
      const d = e.target.closest('[data-del]'); if (d) { const t = A.tracks[+d.dataset.del]; if (t) api.queueRemove(new Set([t.id])); return; }
      if (e.target.closest('.m-handle')) return;
      const r = e.target.closest('.m-qrow'); if (r) { const t = A.tracks[+r.dataset.i]; if (t) { A.playTrack(t); vib(); } }
    };
    b.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.m-handle'); if (!h) return;
      e.preventDefault();
      const list = b.querySelector('#mQList'), row = h.closest('.m-qrow'), rows = [...list.querySelectorAll('.m-qrow')];
      drag = { from: +row.dataset.i, to: +row.dataset.i, y0: e.clientY, row, rows, rh: row.getBoundingClientRect().height, list, scroll0: list.scrollTop, pid: e.pointerId, y: e.clientY };
      try { h.setPointerCapture(e.pointerId); } catch (x) {}
      row.classList.add('dragging'); vib();
      const tick = () => { if (!drag) return; const lr = drag.list.getBoundingClientRect(); if (drag.y < lr.top + 48) drag.list.scrollTop -= 10; else if (drag.y > lr.bottom - 48) drag.list.scrollTop += 10; moveDrag(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const moveDrag = () => {
      const d = drag, dy = d.y - d.y0 + (d.list.scrollTop - d.scroll0);
      d.row.style.transform = `translateY(${dy}px)`;
      const to = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.rh)));
      if (to !== d.to) { d.to = to; d.rows.forEach((r, i) => { if (r === d.row) return; let s = 0; if (d.from < to && i > d.from && i <= to) s = -d.rh; if (d.from > to && i < d.from && i >= to) s = d.rh; r.style.transform = s ? `translateY(${s}px)` : ''; }); }
    };
    b.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.pid) return; drag.y = e.clientY; moveDrag(); });
    const up = (e) => {
      if (!drag || e.pointerId !== drag.pid) return; const d = drag; drag = null;
      d.rows.forEach((r) => { r.style.transform = ''; }); d.row.classList.remove('dragging');
      if (d.to !== d.from && e.type !== 'pointercancel') { const ids = A.tracks.map((t) => t.id); const [m] = ids.splice(d.from, 1); ids.splice(d.to, 0, m); api.setQueue(ids); }
      rerenderQueue();
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  function rerenderQueue() {
    if (sheet.kind !== 'queue' || drag) return;
    const b = $('mSheetBody'), l = b.querySelector('#mQList'), y = l ? l.scrollTop : 0;
    b.innerHTML = queueHTML(); const l2 = b.querySelector('#mQList'); if (l2) l2.scrollTop = y;
  }

  // ------------------------------------------------------------------ EQ sheet (vertical touch sliders that write through the app's own EQ inputs)
  const EQ_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
  const bandInputs = () => [...document.querySelectorAll('#eqSliders .eq-band input')].filter((i) => i.id !== 'preamp');
  const dbTxt = (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10);
  function eqHTML() {
    const presets = [...$('eqPreset').options].map((o) => o.value).filter((p) => p !== 'Custom');
    const col = (k, label, v) => `<div class="m-band" data-band="${k}"><span class="m-bval">${dbTxt(v)}</span><div class="m-vs" style="--p:${((v + 12) / 24 * 100).toFixed(1)}"><i class="m-vs-mid"></i><i class="m-vs-fill"></i><b class="m-vs-knob"></b></div><span class="m-blbl">${label}</span></div>`;
    return `<div class="m-sh-head"><b>Equalizer</b><span class="m-sh-acts"><button class="m-pill${S.eqOn ? ' on' : ''}" data-eq="on">${S.eqOn ? 'ON' : 'OFF'}</button><button class="m-pill${S.eqAuto ? ' on' : ''}" data-eq="auto" title="Pick a preset from the genre tag">AUTO</button><button class="m-pill" data-eq="reset">Reset</button></span></div>
      <canvas class="m-eqgraph" id="mEqGraph"></canvas>
      <div class="m-presets">${presets.map((p) => `<button class="m-chip${S.preset === p ? ' on' : ''}" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="m-bands${S.eqOn ? '' : ' off'}">${col('pre', 'PRE', S.preamp)}<i class="m-bsep"></i>${S.eq.map((v, i) => col(i, EQ_LABELS[i], v)).join('')}</div>`;
  }
  function drawEqGraph() {
    const c = $('mEqGraph'); if (!c) return; const r = c.getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); c.width = W; c.height = H;
    const g = c.getContext('2d'), cs = getComputedStyle(c);
    const fr = new Float32Array(W); for (let i = 0; i < W; i++) fr[i] = 20 * Math.pow(1000, i / (W - 1));
    const resp = A.engine.response(fr), y = (db) => H / 2 - (Math.max(-18, Math.min(18, db)) / 18) * (H / 2 - 3 * dpr);
    g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = dpr; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = cs.color || '#3af'; g.lineWidth = 2.5 * dpr; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i < W; i++) { const yy = y(S.eqOn ? resp[i] : 0); i ? g.lineTo(i, yy) : g.moveTo(0, yy); }
    g.stroke();
  }
  function openEq() {
    const b = openSheet(eqHTML(), { kind: 'eq' });
    requestAnimationFrame(drawEqGraph);
    const sync = () => { const pr = b.querySelector('.m-presets'), sc = pr ? pr.scrollLeft : 0; b.innerHTML = eqHTML(); b.querySelector('.m-presets').scrollLeft = sc; requestAnimationFrame(drawEqGraph); };
    b.onclick = (e) => {
      const x = e.target.closest('[data-eq]');
      if (x) { const k = x.dataset.eq; if (k === 'on') $('eqOn').click(); else if (k === 'auto') $('eqAuto').click(); else { A.applyPreset('Flat'); const p = $('preamp'); p.value = 0; p.dispatchEvent(new Event('input', { bubbles: true })); } sync(); return; }
      const p = e.target.closest('[data-preset]'); if (p) { A.applyPreset(p.dataset.preset); sync(); }
    };
    let dragB = null;
    const setFrom = (e) => {
      const r = dragB.vs.getBoundingClientRect(); const p = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      const v = Math.round((p * 24 - 12) * 2) / 2;
      const inp = dragB.k === 'pre' ? $('preamp') : bandInputs()[+dragB.k];
      if (inp && +inp.value !== v) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      dragB.vs.style.setProperty('--p', ((v + 12) / 24 * 100).toFixed(1));
      dragB.val.textContent = dbTxt(v);
      drawEqGraph();
      b.querySelectorAll('[data-preset]').forEach((c) => c.classList.toggle('on', c.dataset.preset === S.preset));
    };
    b.addEventListener('pointerdown', (e) => {
      const band = e.target.closest('.m-band'); if (!band) return;
      e.preventDefault(); dragB = { k: band.dataset.band, vs: band.querySelector('.m-vs'), val: band.querySelector('.m-bval'), pid: e.pointerId, band };
      try { band.setPointerCapture(e.pointerId); } catch (x) {}
      band.classList.add('drag'); setFrom(e);
    });
    b.addEventListener('pointermove', (e) => { if (dragB && e.pointerId === dragB.pid) setFrom(e); });
    const up = (e) => { if (!dragB || e.pointerId !== dragB.pid) return; dragB.band.classList.remove('drag'); dragB = null; };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------------ visuals & settings tabs
  const sceneItems = () => [{ id: 'auto', name: 'Auto', thumb: 'icons/icon-192.png' }, ...window.Luciel.Scenes.list];
  const sceneGridHTML = () => `<div class="m-scenes">${sceneItems().map((x) => `<button class="m-scard${S.scene === x.id ? ' on' : ''}" data-scene="${esc(x.id)}"><img src="${esc(x.thumb || x.bg || 'icons/icon-192.png')}" alt="" loading="lazy"><span>${esc(x.name)}</span>${x.pack ? '<i>PACK</i>' : x.kind === 'pixel' ? '<i>PIXEL</i>' : ''}</button>`).join('')}</div>`;
  function scenePicker() {
    const b = openSheet(`<div class="m-sh-head"><b>Scene</b><em>Auto picks by genre, tempo &amp; mood</em></div>${sceneGridHTML()}`, { kind: 'scenes', tall: true });
    b.onclick = (e) => { const c = e.target.closest('[data-scene]'); if (!c) return; A.setScene(c.dataset.scene); closeSheet(); syncPlayer(); };
  }
  const VIZ = [['spectrum', 'Spectrum'], ['scope', 'Scope'], ['both', 'Both'], ['off', 'Off']];
  const tog = (id, label, on, hint) => `<label class="m-toggle"><span><b>${label}</b>${hint ? `<em>${hint}</em>` : ''}</span><input type="checkbox" data-opt="${id}" ${on ? 'checked' : ''}><i></i></label>`;
  const sel = (id, label, cur, opts) => `<label class="m-toggle"><span><b>${label}</b></span><select data-sel="${id}">${opts.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  function renderVisuals() {
    const el = $('mVisuals'); const y = el.scrollTop;
    el.innerHTML = `<header class="m-top"><h2>Visuals</h2></header>
      <div class="m-sec">Visualizer</div><div class="m-chips">${VIZ.map(([k, l]) => `<button class="m-chip${S.vizMode === k ? ' on' : ''}" data-viz="${k}">${l}</button>`).join('')}</div>
      <div class="m-sec">Scene</div>${sceneGridHTML()}
      <div class="m-sec">Lucielle</div><div class="m-group m-pad">
        ${tog('optMascot', 'Show Lucielle', S.mascot)}${sel('optSize', 'Size', S.mascotSize, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}
        ${tog('optDoze', 'Doze when idle', S.doze)}${tog('optStrict', 'Strict genre scenes', S.strict, 'Auto only picks scenes that match the genre')}${tog('optDither', 'Dither FX', !!S.ditherFx, 'Ordered Bayer dither over the scene')}${tog('optSceneColors', 'Scene colours', S.sceneColors !== false, 'Pack scenes recolour the player')}${tog('optBubbles', 'Animated backdrop', S.bubbles)}</div>
      <div class="m-sec">Visual packs</div><div class="m-group">${navRow('__packzip', IC.pack, 'Import a pack (.zip)…', null)}${navRow('__packs', G_('☰'), 'Manage packs', null)}</div>
      ${isAndroid() && window.LucielAndroidBridge ? `<div class="m-sec">Spotify &amp; other players</div><div class="m-group">${navRow('__ext', IC.spark, 'Spotify visuals', null, 'Lucielle dances to what another app plays')}</div>` : ''}
      <div class="m-foot-space"></div>`;
    el.scrollTop = y;
  }
  const androidPrefs = () => { try { return JSON.parse(window.LucielAndroid.info()).prefs || {}; } catch (e) { return {}; } };
  function renderSettings() {
    const el = $('mSettings'); const y = el.scrollTop;
    const cards = ['aero', 'classic'].map((sk) => (A.PALETTES || []).map((p) => `<button class="m-theme${S.palette === p.id && S.skin === sk ? ' on' : ''}" data-theme="${p.id}|${sk}"><span class="m-th-prev" data-palette="${p.id}" data-skin="${sk}"><i></i><i></i><i></i></span><b>${esc(p.name)}</b><em>${sk === 'aero' ? 'Aero' : 'Classic'}</em></button>`).join('')).join('');
    const and = isAndroid() && !!window.LucielAndroid;
    const pr = and ? androidPrefs() : {};
    el.innerHTML = `<header class="m-top"><h2>Settings</h2></header>
      <div class="m-sec">Theme</div><div class="m-themes">${cards}</div>
      <div class="m-sec">Playback</div><div class="m-group m-pad">
        ${tog('__shuffle', 'Shuffle', S.shuffle)}${sel('__repeat', 'Repeat', S.repeat, [['off', 'Off'], ['all', 'All'], ['one', 'This song']])}
        ${tog('optRemember', 'Remember songs between sessions', S.remember)}</div>
      <div class="m-group">${navRow('__eq', IC.eq, 'Equalizer', null, S.eqOn ? (S.preset || 'Custom') : 'Off')}</div>
      ${and ? `<div class="m-sec">Floating player</div><div class="m-group m-pad">${tog('__autoFloater', 'Pop out when leaving the app', pr.autoFloater === true || pr.autoFloater === 'true', 'Shows the floating Luciel player over other apps while music plays')}</div>
        <div class="m-group">${navRow('__pop', IC.popout, 'Pop out now', null)}</div>
        <div class="m-sec">Phone</div><div class="m-group">${navRow('__phone', G_('☏'), 'Phone music, Spotify & permissions', null)}</div>` : ''}
      <div class="m-sec">Help</div><div class="m-group">${navRow('__debug', G_('⚑'), 'Debug log', null, 'why did the music stop?')}</div>
      <div class="m-sec">About</div><div class="m-about">Luciel${pr.version ? ' ' + esc(pr.version) : ''} · ${A.lib.size} songs in the library</div>
      <div class="m-foot-space"></div>`;
    el.scrollTop = y;
  }
  function bindPages() {
    const onClick = (e) => {
      const viz = e.target.closest('[data-viz]'); if (viz) { A.setVizMode(viz.dataset.viz); renderVisuals(); return; }
      const sc = e.target.closest('[data-scene]'); if (sc) { A.setScene(sc.dataset.scene); renderVisuals(); return; }
      const th = e.target.closest('[data-theme]'); if (th) { const [p, sk] = th.dataset.theme.split('|'); A.applyTheme(p, sk, true); renderSettings(); syncPlayer(true); return; }
      const go = e.target.closest('[data-go]'); if (!go) return;
      const id = go.dataset.go;
      if (id === '__packzip') $('packZipInput').click(); else if (id === '__packs') A.packs.openManager();
      else if (id === '__ext') window.LucielAndroidBridge.extMode(true); else if (id === '__eq') openEq();
      else if (id === '__debug') A.openDebugLog();
      else if (id === '__pop') popOut(); else if (id === '__phone') window.LucielAndroidUI.openSheet();
    };
    const onChange = (e) => {
      const o = e.target.dataset.opt, s = e.target.dataset.sel;
      if (o === '__shuffle') { A.setShuffle(e.target.checked); return; }
      if (o === '__autoFloater') { try { window.LucielAndroid.setPref('autoFloater', String(e.target.checked)); } catch (x) {} if (e.target.checked) checkOverlayPerm(); return; }
      if (s === '__repeat') { for (let i = 0; i < 3 && S.repeat !== e.target.value; i++) A.cycleRepeat(); return; }
      const inp = (o || s) && $(o || s); if (!inp) return;
      if (inp.type === 'checkbox') inp.checked = e.target.checked; else inp.value = e.target.value;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    ['mVisuals', 'mSettings'].forEach((id) => { $(id).addEventListener('click', onClick); $(id).addEventListener('change', onChange); });
  }

  // ------------------------------------------------------------------ pop-out floater (Android)
  const canPopOut = () => !!(window.LucielAndroid && window.LucielAndroid.floater);
  function checkOverlayPerm() {
    try { const p = JSON.parse(window.LucielAndroid.info()).perms || {}; if (p.overlay === false) { A.toast('Allow “Display over other apps” for the floating player', 'warn'); window.LucielAndroid.open('overlay'); return false; } } catch (e) {}
    return true;
  }
  function popOut() {
    if (!canPopOut()) { A.toast('The floating player needs the Android app', 'warn'); return; }
    if (!A.current) { A.toast('Play something first', 'warn'); return; }
    if (!checkOverlayPerm()) return;
    try { window.LucielAndroid.floater('show'); } catch (e) {}
  }

  // ------------------------------------------------------------------ back (Android back gesture / Escape)
  function back() {
    if (!active) return false;
    if (closeSheet()) return true;
    if (immersive) { setImmersive(false); return true; }
    if (tab === 'library' && stack.length > 1) { pop(); return true; }
    if (tab !== 'player') { setTab('player'); return true; }
    return false;
  }
  document.addEventListener('keydown', (e) => {
    if (!active || e.key !== 'Escape') return;
    if ([...document.querySelectorAll('.overlay')].some((o) => !o.hidden)) return;   // the app's own dialogs close themselves
    if (back()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // ------------------------------------------------------------------ activation
  function markPlayingRows() {
    const cur = A.current;
    shell.querySelectorAll('.m-track.playing').forEach((r) => r.classList.remove('playing'));
    if (cur) shell.querySelectorAll(`.m-track[data-id="${CSS.escape(cur.id)}"]`).forEach((r) => r.classList.add('playing'));
  }
  function build() {
    if (built) return; built = true;
    body.appendChild(shell); body.appendChild(sheetHost);
    bindPlayer(); bindLibrary(); bindPages();
    $('mPopOut').hidden = !canPopOut();
    ['play', 'pause', 'ended', 'emptied', 'loadedmetadata'].forEach((ev) => audio.addEventListener(ev, () => { if (active) { syncPlayer(); syncMini(); } }));
    audio.addEventListener('timeupdate', () => { if (active && !seekDrag) syncTime(); });
    window.addEventListener('luciel:track', () => { if (!active) return; syncPlayer(); syncMini(); markPlayingRows(); rerenderQueue(); });
    window.addEventListener('luciel:queue', () => { if (!active) return; syncPlayer(); rerenderQueue(); const top = stack[stack.length - 1]; if (top && (top.v.type === 'queue' || top.v.type === 'home')) libraryChanged(); });
    window.addEventListener('luciel:library', () => { if (active) { libraryChanged(); syncPlayer(); } else if (built) libraryChanged(); });
    window.addEventListener('luciel:settings', () => { if (!active) return; syncPlayer(); if (tab === 'visuals') renderVisuals(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && active) { syncPlayer(true); syncMini(); } });
  }
  function activate() {
    build();
    if (active) return; active = true;
    body.classList.add('m-ui');
    const st = $('mStage');
    borrow($('stageWrap'), st); borrow(document.querySelector('.px-stage-frame'), st); borrow($('vizWrap'), st); borrow($('lcd'), st);
    st.appendChild(st.querySelector('.m-stage-chips')); st.appendChild($('mStageHint'));
    let t0 = 'player'; try { t0 = sessionStorage.getItem('luciel.m.tab') || 'player'; } catch (e) {}
    setTab(t0, true); syncPlayer(true); syncMini();
    if (lib.isOpen && lib.isOpen()) lib.close();
    window.dispatchEvent(new Event('resize'));
  }
  function deactivate() {
    if (!active) return; active = false;
    closeSheet(true); setImmersive(false);
    body.classList.remove('m-ui', 'm-immersive', 'm-has-mini'); delete body.dataset.mtab;
    giveBack();
    window.dispatchEvent(new Event('resize'));
  }
  function check() { if (wanted()) activate(); else deactivate(); }
  if (mq.addEventListener) mq.addEventListener('change', check); else mq.addListener(check);
  check();

  window.LucielMobile = {
    get active() { return active; }, back, setTab, get tab() { return tab; }, push, pop, goLib, get depth() { return stack.length; }, get view() { const t = stack[stack.length - 1]; return t ? t.v : null; },
    openQueue, openEq, closeSheet, get sheet() { return sheetHost.hidden ? '' : sheet.kind; }, setImmersive, get immersive() { return immersive; }, scenePicker, trackSheet, popOut, check, syncPlayer,
  };
})();
