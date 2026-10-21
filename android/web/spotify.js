// Luciel for Android – the Spotify tab: a small "Spotify inside Luciel" in Luciel's own themes.
// Home (greeting, recent grid, shelves), search (deep links), recently played (local history), a now-playing view
// (big cover or the dancing Lucielle stage), the floating-overlay controls and one-source-at-a-time switching.
// Everything works without a Spotify login: media-session controls + spotify: deep links. Spotify is a trademark of
// Spotify AB; Luciel only shows the word "Spotify" as a label, never its logo.
(() => {
  const N = window.LucielAndroid, B = window.LucielAndroidBridge;
  if (!N || !B || !window.Luciel || !window.Luciel.app) return;
  const A = window.Luciel.app, audio = A.engine.audio, $ = (id) => document.getElementById(id);
  const DBG = window.LucielDebug || { add() {} };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => (A.toast ? A.toast(m, k) : null);
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const vib = () => { try { N.haptic(); } catch (e) {} };
  const svg = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const I = {
    tab: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="13" width="5" height="8" rx="2" fill="currentColor"/><rect x="16" y="13" width="5" height="8" rx="2" fill="currentColor"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    back: svg('<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>'), pause: svg('<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/>'),
    prev: svg('<path d="M6 5h2.2v14H6zM20 5v14L9.5 12z" fill="currentColor"/>'), next: svg('<path d="M15.8 5H18v14h-2.2zM4 5v14l10.5-7z" fill="currentColor"/>'),
    open: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    x: svg('<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    heart: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" fill="currentColor"/>'),
    spark: svg('<path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" fill="currentColor"/>'),
    radio: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    chev: svg('<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  // ------------------------------------------------------------------ storage (local, per phone)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const K_HIST = 'luciel.sp.history', K_SEARCH = 'luciel.sp.searches', K_SRC = 'luciel.source', K_VIEW = 'luciel.sp.nowView';

  // ------------------------------------------------------------------ data providers
  // Today: what Luciel itself has seen in the media session + deep links. A later optional "Connect Spotify account"
  // (PKCE OAuth + Web API) can register another provider here with in-app search results and the user's playlists;
  // the pages below only talk to `Library`, so nothing else has to change.
  const LocalProvider = {
    id: 'local',
    history() { return store.get(K_HIST, []); },
    remember(t) {
      const h = this.history();
      const i = h.findIndex((x) => x.key === t.key);
      if (i >= 0) { const old = h.splice(i, 1)[0]; t.art = t.art || old.art; t.plays = (old.plays || 1) + 1; } else t.plays = 1;
      h.unshift(t); if (h.length > 150) h.length = 150; store.set(K_HIST, h);
    },
    forget(key) { store.set(K_HIST, this.history().filter((x) => x.key !== key)); },
    clear() { store.set(K_HIST, []); },
    searches() { return store.get(K_SEARCH, []); },
    addSearch(q) { const s = this.searches().filter((x) => x.toLowerCase() !== q.toLowerCase()); s.unshift(q); if (s.length > 20) s.length = 20; store.set(K_SEARCH, s); },
    removeSearch(q) { store.set(K_SEARCH, this.searches().filter((x) => x !== q)); },
    clearSearches() { store.set(K_SEARCH, []); },
    /** results-style rows from what Luciel has seen; filter: all | songs | artists */
    search(q, filter = 'all') {
      const n = q.trim().toLowerCase(); if (!n) return [];
      const h = this.history();
      if (filter === 'artists') {
        const seen = new Map();
        for (const t of h) if (t.artist && t.artist.toLowerCase().includes(n) && !seen.has(t.artist.toLowerCase())) seen.set(t.artist.toLowerCase(), { kind: 'artist', artist: t.artist, art: t.art, count: h.filter((x) => x.artist === t.artist).length });
        return [...seen.values()];
      }
      return h.filter((t) => (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(n) && (filter !== 'songs' || t.title)).map((t) => ({ kind: 'song', ...t }));
    },
  };
  const Library = { providers: [LocalProvider], get main() { return this.providers[0]; } };
  const QUICK = [
    { id: 'liked', name: 'Liked Songs', sub: 'Your saved songs', uri: 'spotify:collection:tracks', web: 'https://open.spotify.com/collection/tracks', icon: I.heart, hue: 0 },
    { id: 'daily', name: 'Daily Mix', sub: 'Made for you', q: 'Daily Mix', icon: I.radio, hue: 1 },
    { id: 'discover', name: 'Discover Weekly', sub: 'New picks every Monday', q: 'Discover Weekly', icon: I.spark, hue: 2 },
    { id: 'radar', name: 'Release Radar', sub: 'New from artists you follow', q: 'Release Radar', icon: I.radio, hue: 3 },
  ];

  // ------------------------------------------------------------------ deep links (the only jumps into the Spotify app)
  const Links = {
    search(q) { const u = encodeURIComponent(q.trim()); return { app: 'spotify:search:' + u, web: 'https://open.spotify.com/search/' + u }; },
    open(l, why) {
      let how = 'web';
      try { how = N.openLink(l.app || '', l.web); } catch (e) { try { window.open(l.web, '_blank'); } catch (x) {} }
      DBG.add('spotify', `${why}: ${l.app || l.web} (${how})`);
      return how;
    },
  };
  function searchSpotify(q, save = true) {
    q = String(q || '').trim(); if (!q) return;
    if (save) Library.main.addSearch(q);
    Links.open(Links.search(q), 'search');
  }
  function openQuick(id) { const p = QUICK.find((x) => x.id === id); if (!p) return; Links.open(p.uri ? { app: p.uri, web: p.web } : Links.search(p.q), p.name); }
  function openTrack(t) { searchSpotify([t.title, t.artist].filter(Boolean).join(' '), false); }

  // ------------------------------------------------------------------ state
  const EXT = () => window.LucielExt || {};
  const st = () => (EXT().state || { active: false });
  let info = {}; const readInfo = () => { try { info = JSON.parse(N.info()); } catch (e) { info = info || {}; } return info; };
  const perms = () => info.perms || {}, prefs = () => info.prefs || {};
  readInfo();
  let source = store.get(K_SRC, 'local');
  function setSource(s, why) { if (s === source) return; source = s; store.set(K_SRC, s); DBG.add('source', `${s === 'spotify' ? 'Spotify' : 'Luciel'} is the active source (${why})`); syncMini(); }
  /** which source the mini bar / buttons follow right now */
  function activeSource() { if (!audio.paused) return 'local'; if (st().active && st().playing) return 'spotify'; return source; }
  let pos = 0, posAt = 0;
  const posNow = () => { const s = st(); const d = s.duration || 0; const p = pos + (s.playing ? (performance.now() - posAt) / 1000 : 0); return d ? Math.min(d, p) : p; };

  /** one source at a time: playing on the Spotify tab pauses Luciel's own music (and Luciel's play pauses Spotify, see android.js) */
  function cmd(c, arg = 0) {
    vib();
    const s = st();
    if (!s.active) {
      if (c === 'toggle' || c === 'play') { toast(info.prefs && info.prefs.spotifyInstalled === false ? 'Spotify isn’t installed' : 'Opening Spotify – press play there and Luciel follows along'); N.open('spotify'); }
      return;
    }
    const starts = c === 'play' || (c === 'toggle' && !s.playing) || c === 'next' || c === 'prev';
    if (starts && !audio.paused) { A.engine.pauseFor('Spotify tab: play pressed (one source at a time)'); }
    if (starts) setSource('spotify', 'play on the Spotify tab');
    if (starts && open) { try { window.LucielAndroidUI.extView(true); } catch (e) {} }   // the stage follows Spotify again
    try { N.extCommand(c, arg); } catch (e) {}
    if (c === 'toggle') { s.playing = !s.playing; if (!s.playing) { pos = posNow(); posAt = performance.now(); } else posAt = performance.now(); paintNow(); syncMini(); }
  }

  // history capture: every media-session song Luciel sees playing (cover kept as a small JPEG)
  let lastSeenKey = '';
  function capture(s) {
    if (!s || !s.active || !s.playing || !s.title) return;
    const key = (s.pkg || '') + '|' + s.title + '|' + (s.artist || '');
    if (key === lastSeenKey) return; lastSeenKey = key;
    const t = { key, title: s.title, artist: s.artist || '', album: s.album || '', app: s.app || 'Spotify', pkg: s.pkg || '', at: Date.now(), art: '' };
    const done = () => { Library.main.remember(t); if (open) refresh(); };
    if (!s.art) return done();
    const im = new Image();
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 120; c.getContext('2d').drawImage(im, 0, 0, 120, 120); t.art = c.toDataURL('image/jpeg', 0.8); } catch (e) {} done(); };
    im.onerror = done; im.src = s.art;
  }
  const coverOf = (t) => t.art || window.Luciel.Scenes.coverFor({ title: t.title, artist: t.artist, album: t.album }, A.settings.palette);

  // ------------------------------------------------------------------ pages
  let root = null, open = false; const stack = [{ p: 'home' }];
  const top = () => stack[stack.length - 1];
  function go(p, extra = {}) { stack.push({ p, ...extra }); render(); if (root) root.scrollTop = 0; }
  function back() { if (stack.length <= 1) return false; const was = top().p; stack.pop(); if (was === 'now') stageHome(); render(); return true; }
  function greeting() { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  const head = (title, sub = '') => `<header class="sp-top"><button class="sp-ic" data-act="back" title="Back">${I.back}</button><div class="sp-top-t"><b>${esc(title)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div></header>`;
  const tile = (t, i) => `<button class="sp-gtile" data-track="${i}"><img src="${esc(coverOf(t))}" alt=""><span>${esc(t.title)}</span></button>`;
  const card = (t, i) => `<button class="sp-card" data-track="${i}"><img src="${esc(coverOf(t))}" alt="" loading="lazy"><b>${esc(t.title)}</b><span>${esc(t.artist || t.app)}</span></button>`;
  const quickTile = (q) => `<button class="sp-quick q${q.hue}" data-quick="${q.id}"><i>${q.icon}</i><b>${esc(q.name)}</b><span>${esc(q.sub)}</span></button>`;
  const when = (at) => { const d = new Date(at), now = new Date(); const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5); return days === 0 ? t : days === 1 ? 'Yesterday ' + t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const row = (t, i, extra = '') => `<div class="sp-row" data-track="${i}"><img src="${esc(coverOf(t))}" alt="" loading="lazy"><div class="sp-txt"><b>${esc(t.title)}</b><span>${esc([t.artist, t.app !== 'Spotify' ? t.app : ''].filter(Boolean).join(' · '))}${extra}</span></div><button class="sp-ic sp-go" data-track="${i}" title="Find in Spotify">${I.open}</button></div>`;

  function setupCards() {
    const p = perms(); let h = '';
    if (!p.listener) h += `<div class="sp-setup"><b>See what Spotify is playing</b><p>Turn on notification access so Luciel can show the song, cover and controls, and keep your recently played list. Nothing leaves your phone.</p><button class="sp-btn primary" data-act="listener">Turn on notification access</button></div>`;
    return h;
  }
  function nowHero() {
    const s = st();
    if (!s.active) {
      if (!perms().listener) return '';
      if (prefs().spotifyInstalled === false) return `<div class="sp-empty"><b>Spotify isn’t installed</b><p>Install it, or play music in any other player – Luciel follows any app with a media notification.</p><button class="sp-btn primary" data-act="openSpotify">Get Spotify</button></div>`;
      return `<div class="sp-empty"><b>Nothing playing on Spotify</b><p>Open Spotify and play a song – Lucielle starts dancing to it right here.</p><button class="sp-btn primary" data-act="openSpotify">Open Spotify</button></div>`;
    }
    return `<div class="sp-hero" data-act="now"><img src="${esc(s.art || coverOf(s))}" alt=""><div class="sp-txt"><em>${s.playing ? 'Now playing' : 'Paused'} on ${esc(s.app || 'Spotify')}</em><b>${esc(s.title || 'Unknown song')}</b><span>${esc(s.artist || '')}</span></div><button class="sp-play" data-act="toggle" title="Play / pause">${s.playing ? I.pause : I.play}</button></div>`;
  }
  function overlaySection() {
    const p = perms(), pr = prefs(); const on = !!pr.overlay; const mode = pr.overlayMode || 'compact';
    return `<div class="sp-sec">Floating overlay</div><div class="sp-group">
      <label class="sp-toggle"><span><b>Spotify overlay</b><em>Lucielle and the controls float over Spotify and other apps</em></span><input type="checkbox" data-act="overlay" ${on ? 'checked' : ''}><i></i></label>
      <div class="sp-seg" role="radiogroup" aria-label="Overlay style">${['compact', 'large', 'bubble'].map((m) => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}" role="radio" aria-checked="${m === mode}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      ${p.overlay ? '' : `<div class="sp-note">Needs “Display over other apps”. <button class="sp-link" data-act="overlayPerm">Allow</button></div>`}
      <div class="sp-row2"><button class="sp-btn" data-act="popout">Pop out now</button></div>
      <div class="sp-note">Close it with ✕, a long-press on the bubble, or by dragging it onto the ✕ at the bottom of the screen. It stays closed until you turn it on here. Closing never stops the music.</div></div>
      ${p.mic ? '' : `<div class="sp-note sp-warn">Beat sync is off, so Lucielle dances to a steady ${Math.round(pr.fallbackBpm || 120)} BPM. <button class="sp-link" data-act="mic">Allow beat sync</button></div>`}`;
  }
  function renderHome() {
    readInfo();
    const h = Library.main.history(), q = Library.main.searches();
    return `<header class="sp-head"><div><h1>${greeting()}</h1><span class="sp-brand">Luciel × <b>Spotify</b></span></div></header>
      <button class="sp-searchbar" data-act="search">${I.search}<span>What do you want to listen to?</span></button>
      ${setupCards()}${nowHero()}
      ${h.length ? `<div class="sp-grid">${h.slice(0, 6).map(tile).join('')}</div>` : ''}
      <div class="sp-shelf"><div class="sp-sh"><b>Quick picks</b></div><div class="sp-hs">${QUICK.map(quickTile).join('')}</div></div>
      <div class="sp-shelf"><div class="sp-sh"><b>Recently played</b>${h.length ? '<button class="sp-link" data-act="history">See all</button>' : ''}</div>
        ${h.length ? `<div class="sp-hs">${h.slice(0, 12).map(card).join('')}</div>` : '<div class="sp-hint">Songs you play in Spotify show up here.</div>'}</div>
      ${q.length ? `<div class="sp-shelf"><div class="sp-sh"><b>Your searches</b></div><div class="sp-hs sp-chips">${q.slice(0, 12).map((s) => `<button class="sp-chip" data-q="${esc(s)}">${I.search}${esc(s)}</button>`).join('')}</div></div>` : ''}
      ${overlaySection()}
      <div class="sp-attr">Spotify is a trademark of Spotify AB. Luciel isn’t made by or affiliated with Spotify; it follows what your Spotify app is playing.</div>`;
  }
  // search page
  function renderSearch() {
    const e = top();
    return `<header class="sp-top sp-stop"><button class="sp-ic" data-act="back" title="Back">${I.back}</button>
        <div class="sp-sbox">${I.search}<input type="search" id="spQ" placeholder="Songs, artists, playlists" value="${esc(e.q || '')}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="sp-ic" data-act="clearq" ${e.q ? '' : 'hidden'} title="Clear">${I.x}</button></div></header>
      <div class="sp-filters">${['all', 'songs', 'artists'].map((f) => `<button class="sp-chip ${(e.f || 'all') === f ? 'on' : ''}" data-filter="${f}">${f === 'all' ? 'All' : f === 'songs' ? 'Songs' : 'Artists'}</button>`).join('')}</div>
      <div id="spResults">${searchResults()}</div>`;
  }
  function searchResults() {
    const e = top(), q = (e.q || '').trim();
    if (!q) {
      const s = Library.main.searches();
      return (s.length ? `<div class="sp-sec">Recent searches</div><div class="sp-list">${s.map((x) => `<div class="sp-row sp-recent" data-q="${esc(x)}"><i class="sp-ri">${I.clock}</i><div class="sp-txt"><b>${esc(x)}</b></div><button class="sp-ic" data-rmq="${esc(x)}" title="Remove">${I.x}</button></div>`).join('')}</div><button class="sp-link sp-clear" data-act="clearSearches">Clear recent searches</button>` : '<div class="sp-hint">Search Spotify for any song, artist or playlist. Your searches are kept here.</div>') +
        `<div class="sp-sec">Browse</div><div class="sp-qgrid">${QUICK.map(quickTile).join('')}</div>`;
    }
    const res = Library.main.search(q, e.f || 'all');
    const hist = Library.main.history();
    return `<div class="sp-row sp-searchrow" data-act="searchGo"><i class="sp-ri sp-acc">${I.search}</i><div class="sp-txt"><b>Search Spotify for “${esc(q)}”</b><span>Opens the results in Spotify</span></div>${I.chev}</div>
      ${res.length ? `<div class="sp-sec">From your recently played</div><div class="sp-list">${res.map((r) => r.kind === 'artist'
        ? `<div class="sp-row" data-artist="${esc(r.artist)}"><img class="sp-round" src="${esc(r.art || coverOf({ title: r.artist }))}" alt=""><div class="sp-txt"><b>${esc(r.artist)}</b><span>Artist · ${r.count} song${r.count === 1 ? '' : 's'} played</span></div>${I.chev}</div>`
        : row(r, hist.findIndex((x) => x.key === r.key))).join('')}</div>` : `<div class="sp-hint">Nothing in your recently played matches “${esc(q)}”.</div>`}`;
  }
  // full recently played list, searchable + filterable
  function renderHistory() {
    const e = top();
    return `${head('Recently played', 'Songs Luciel has seen in Spotify and other players')}
      <div class="sp-sbox sp-inline">${I.search}<input type="search" id="spHQ" placeholder="Filter by song or artist" value="${esc(e.q || '')}" autocomplete="off" spellcheck="false"></div>
      <div class="sp-filters">${[['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['spotify', 'Spotify only']].map(([f, n]) => `<button class="sp-chip ${(e.f || 'all') === f ? 'on' : ''}" data-hfilter="${f}">${n}</button>`).join('')}</div>
      <div id="spHList">${historyList()}</div>`;
  }
  function historyList() {
    const e = top(), q = (e.q || '').trim().toLowerCase(), f = e.f || 'all';
    const h = Library.main.history(), now = Date.now(), day0 = new Date(new Date().toDateString()).getTime();
    const rows = h.map((t, i) => [t, i]).filter(([t]) => (!q || (t.title + ' ' + t.artist).toLowerCase().includes(q)) &&
      (f === 'all' || (f === 'today' && t.at >= day0) || (f === 'week' && now - t.at < 7 * 864e5) || (f === 'spotify' && (t.pkg === 'com.spotify.music' || t.app === 'Spotify'))));
    if (!h.length) return '<div class="sp-empty"><b>No songs yet</b><p>Play something in Spotify – each song shows up here with its cover and time.</p></div>';
    if (!rows.length) return '<div class="sp-hint">No songs match.</div>';
    return `<div class="sp-list">${rows.map(([t, i]) => row(t, i, ` · ${esc(when(t.at))}`)).join('')}</div><button class="sp-link sp-clear" data-act="clearHistory">Clear recently played</button>`;
  }
  // now playing (Spotify style): big cover or the Lucielle stage, title/artist, seek, transport
  let nowView = store.get(K_VIEW, 'cover');
  function renderNow() {
    const s = st();
    return `${head('Now playing', s.active ? 'on ' + (s.app || 'Spotify') : '')}
      <div class="sp-seg sp-viewseg">${[['cover', 'Cover'], ['lucielle', 'Lucielle']].map(([v, n]) => `<button data-view="${v}" class="${nowView === v ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="sp-nowart ${nowView === 'lucielle' ? 'is-stage' : ''}" id="spNowArt">${nowView === 'cover' ? `<img id="spBigCover" alt="">` : '<div class="sp-stage" id="spStage"></div>'}</div>
      <div class="sp-nowmeta"><div class="sp-txt"><b id="spNTitle"></b><span id="spNArtist"></span></div><button class="sp-ic" data-act="openSpotify" title="Open Spotify">${I.open}</button></div>
      <div class="sp-seek" id="spSeek"><div class="sp-bar"><i id="spFill"></i><b id="spKnob"></b></div><div class="sp-times"><span id="spCur">0:00</span><span id="spDur">0:00</span></div></div>
      <div class="sp-transport"><button class="sp-tb" data-act="prev" title="Previous">${I.prev}</button><button class="sp-tb big" data-act="toggle" id="spBigPlay" title="Play / pause"></button><button class="sp-tb" data-act="next" title="Next">${I.next}</button></div>
      <div class="sp-row2"><button class="sp-btn" data-act="openSpotify">Open Spotify</button>${perms().mic ? '' : '<button class="sp-btn" data-act="tap">Tap tempo</button>'}<button class="sp-btn" data-act="popout">Pop out</button></div>`;
  }
  function paintNow() {
    if (!open || top().p !== 'now' || !root) return;
    const s = st();
    const t = $('spNTitle'); if (!t) return;
    t.textContent = s.active ? s.title || 'Unknown song' : 'Nothing playing'; $('spNArtist').textContent = s.active ? [s.artist, s.album].filter(Boolean).join(' · ') : 'Play a song in Spotify';
    const c = $('spBigCover'); if (c) { const src = s.art || coverOf(s.active ? s : { title: 'Luciel' }); if (c.getAttribute('src') !== src) c.src = src; }
    $('spBigPlay').innerHTML = s.playing ? I.pause : I.play;
    paintTime();
  }
  function paintTime() {
    const s = st(), d = s.duration || 0, el = $('spSeek'); if (!el) return;
    el.hidden = !(s.active && d > 0);
    const p = seekDrag != null ? seekDrag * d : posNow(), f = d ? Math.max(0, Math.min(1, p / d)) : 0;
    $('spFill').style.width = (f * 100).toFixed(2) + '%'; $('spKnob').style.left = (f * 100).toFixed(2) + '%';
    $('spCur').textContent = fmt(p); $('spDur').textContent = d ? '-' + fmt(d - p) : '0:00';
  }
  let seekDrag = null;
  function bindSeek() {
    const el = $('spSeek'); if (!el) return; const bar = el.querySelector('.sp-bar');
    const frac = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    el.addEventListener('pointerdown', (e) => { if (!(st().duration > 0)) return; try { el.setPointerCapture(e.pointerId); } catch (x) {} seekDrag = frac(e); paintTime(); });
    el.addEventListener('pointermove', (e) => { if (seekDrag == null) return; seekDrag = frac(e); paintTime(); });
    const end = (e) => { if (seekDrag == null) return; const f = seekDrag; seekDrag = null; if (e.type !== 'pointercancel') { const sec = f * (st().duration || 0); N.extCommand('seek', sec); pos = sec; posAt = performance.now(); } paintTime(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  // the Lucielle stage lives in the Now Playing tab; the "Lucielle" view borrows it
  function stageHome() { if (stageBorrowed) { window.LucielMobile.stageTo(null); stageBorrowed = false; } }
  let stageBorrowed = false;

  function render() {
    if (!root) return;
    const p = top().p;
    stageHome();   // always give the stage back before the page is rebuilt, or it would be destroyed with it
    root.dataset.page = p;
    root.innerHTML = p === 'search' ? renderSearch() : p === 'history' ? renderHistory() : p === 'now' ? renderNow() : renderHome();
    if (p === 'search') { const i = $('spQ'); if (i && !top().q) setTimeout(() => i.focus(), 60); }
    if (p === 'now') { if (nowView === 'lucielle') { window.LucielMobile.stageTo($('spStage')); stageBorrowed = true; } paintNow(); bindSeek(); }
  }
  function refresh() {
    if (!open || !root) return;
    const p = top().p;
    if (p === 'home') { const y = root.scrollTop; render(); root.scrollTop = y; }
    else if (p === 'now') paintNow();
    else if (p === 'history') { const l = $('spHList'); if (l) l.innerHTML = historyList(); }
    else if (p === 'search') { const r = $('spResults'); if (r) r.innerHTML = searchResults(); }
  }

  // ------------------------------------------------------------------ events (one delegated handler per root)
  function bind(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-track],[data-quick],[data-q],[data-rmq],[data-filter],[data-hfilter],[data-mode],[data-view],[data-artist]');
      if (!b || !el.contains(b)) return;
      const d = b.dataset;
      if (d.rmq != null) { e.stopPropagation(); Library.main.removeSearch(d.rmq); refresh(); return; }
      if (d.track != null) { const t = Library.main.history()[+d.track]; if (t) { vib(); openTrack(t); } return; }
      if (d.quick) { vib(); openQuick(d.quick); return; }
      if (d.q != null) { if (top().p === 'search') { top().q = d.q; render(); } else go('search', { q: d.q }); return; }
      if (d.filter) { top().f = d.filter; render(); return; }
      if (d.hfilter) { top().f = d.hfilter; el.querySelectorAll('[data-hfilter]').forEach((x) => x.classList.toggle('on', x === b)); $('spHList').innerHTML = historyList(); return; }
      if (d.artist) { searchSpotify(d.artist); return; }
      if (d.mode) { vib(); N.setPref('overlayMode', d.mode); readInfo(); el.querySelectorAll('[data-mode]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); toast(`Overlay style: ${b.textContent}`); return; }
      if (d.view) { nowView = d.view; store.set(K_VIEW, nowView); render(); return; }
      const a = d.act;
      if (a === 'back') back();
      else if (a === 'search') go('search');
      else if (a === 'history') go('history');
      else if (a === 'now') { if (!e.target.closest('[data-act="toggle"]')) go('now'); }
      else if (a === 'toggle' || a === 'next' || a === 'prev') { e.stopPropagation(); cmd(a); }
      else if (a === 'openSpotify') { vib(); N.open('spotify'); }
      else if (a === 'listener') N.open('listener');
      else if (a === 'overlayPerm') N.open('overlay');
      else if (a === 'mic') N.open('app');
      else if (a === 'popout') { vib(); N.overlayCard('show'); }
      else if (a === 'tap') { const bpm = N.extTap(); if (bpm > 0) toast(`♪ ${Math.round(bpm)} BPM`); }
      else if (a === 'clearq') { top().q = ''; render(); }
      else if (a === 'searchGo') searchSpotify(top().q);
      else if (a === 'clearSearches') { Library.main.clearSearches(); refresh(); }
      else if (a === 'clearHistory') { if (confirm('Clear your recently played list?')) { Library.main.clear(); refresh(); } }
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.act === 'overlay') { vib(); N.overlayCard(e.target.checked ? 'on' : 'off'); readInfo(); toast(e.target.checked ? 'Spotify overlay on – it shows when you leave Luciel while music plays' : 'Spotify overlay off'); }
    });
    el.addEventListener('input', (e) => {
      if (e.target.id === 'spQ') { top().q = e.target.value; const c = el.querySelector('[data-act="clearq"]'); if (c) c.hidden = !e.target.value; $('spResults').innerHTML = searchResults(); }
      if (e.target.id === 'spHQ') { top().q = e.target.value; $('spHList').innerHTML = historyList(); }
    });
    el.addEventListener('keydown', (e) => { if (e.target.id === 'spQ' && e.key === 'Enter') { e.preventDefault(); searchSpotify(e.target.value); e.target.blur(); refresh(); } });
  }

  // ------------------------------------------------------------------ live updates from android.js
  let ticker = 0, heroKey = null;
  function onState(s) {
    s = s || st();
    pos = s.position || 0; posAt = performance.now();
    capture(s);
    if (s.active && s.playing && audio.paused) setSource('spotify', 'Spotify started playing');
    const k = s.active ? (s.key || s.title || "") : ""; const changed = k !== heroKey; heroKey = k;
    if (open) { if (top().p === 'home' && !changed) refreshHero(); else refresh(); }
    syncMini();
  }
  function refreshHero() {
    // repaint only the parts that change, so the home page doesn't flicker or lose its scroll
    const old = root && root.querySelector('.sp-hero, .sp-empty:not(.keep)'); const html = nowHero();
    if (!root) return;
    if (old && html) { const t = document.createElement('div'); t.innerHTML = html; old.replaceWith(t.firstElementChild); }
    else refresh();
  }
  function syncMini() { try { if (window.LucielMobile && window.LucielMobile.syncMini) window.LucielMobile.syncMini(); } catch (e) {} }
  audio.addEventListener('play', () => setSource('local', 'Luciel started playing'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && open) { readInfo(); refresh(); } });

  window.LucielSpotify = {
    icon: I.tab,
    get source() { return source; },
    activeSource, cmd, back, onState, refresh,
    onPerms() { readInfo(); if (open) { if (top().p === 'now') render(); else refresh(); } },
    show(host) {
      if (!root) { root = host; bind(root); }
      open = true; readInfo();
      try { window.LucielAndroidUI && window.LucielAndroidUI.extView(true); } catch (e) {}
      render();
      clearInterval(ticker); ticker = setInterval(() => { if (open && top().p === 'now') paintTime(); }, 500);
    },
    hide() {
      open = false; clearInterval(ticker); stageHome();
      try { window.LucielAndroidUI && window.LucielAndroidUI.extView(false); } catch (e) {}
    },
    /** what the mini bar above the tabs should show for Spotify (null = show Luciel's own music) */
    miniInfo(tab) {
      const s = st();
      if (!s.active || activeSource() !== 'spotify' || tab === 'spotify') return null;
      const d = s.duration || 0;
      return { title: s.title || 'Spotify', artist: s.artist || s.app || '', art: s.art || '', playing: !!s.playing, progress: d ? Math.min(1, posNow() / d) : 0 };
    },
    // for tests
    _lib: Library, _links: Links, _quick: QUICK, get _page() { return top().p; },
  };
})();
