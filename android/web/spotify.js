// Luciel for Android – the Spotify tab: a small "Spotify inside Luciel" in Luciel's own themes.
// Home (greeting, recent grid, shelves), search (deep links), recently played (local history), a now-playing view
// (big cover or the dancing Lucielle stage), the floating-overlay controls and one-source-at-a-time switching.
// Everything works without a Spotify login: media-session controls + spotify: deep links. 1.1.4 adds an optional
// "Connect Spotify" (the user's own Client ID, PKCE sign-in done natively, tokens never reach this page) that loads
// playlists, Liked Songs, recently played and search results in-app through the Web API. Spotify is a trademark of
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
    list: svg('<path d="M4 6h12M4 12h12M4 18h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M18 14v6l4-3z" fill="currentColor"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  };

  // ------------------------------------------------------------------ storage (local, per phone)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const K_HIST = 'luciel.sp.history', K_SEARCH = 'luciel.sp.searches', K_SRC = 'luciel.source', K_VIEW = 'luciel.sp.nowView';
  const K_COVERS = 'luciel.sp.covers', K_LATER = 'luciel.sp.connectLater';

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
    /** a cover that arrived after the song was first seen */
    setArt(key, art) { const h = this.history(); let n = 0; for (const t of h) if (t.key === key && t.art !== art) { t.art = art; n++; } if (n) store.set(K_HIST, h); return n; },
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
    // Spotify's own made-for-you mixes can't be read by other apps (Web API, since Nov 2024): always a deep link, labelled so
    { id: 'daily', name: 'Daily Mix', sub: 'Made for you', q: 'Daily Mix', icon: I.radio, hue: 1, ext: true },
    { id: 'discover', name: 'Discover Weekly', sub: 'New picks every Monday', q: 'Discover Weekly', icon: I.spark, hue: 2, ext: true },
    { id: 'radar', name: 'Release Radar', sub: 'New from artists you follow', q: 'Release Radar', icon: I.radio, hue: 3, ext: true },
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
  // ------------------------------------------------------------------ optional: Connect Spotify (Web API)
  // The native side owns the sign-in and the tokens (WebBridge.spotify*): this page only asks for API results.
  const REDIRECT = 'luciel://spotify-callback', DASH = 'https://developer.spotify.com/dashboard';
  const Api = {
    st: {}, cache: new Map(), wakeWait: 750, noTopTracks: false,
    get has() { return typeof N.spotifyApi === 'function' && typeof N.spotifyStatus === 'function'; },
    read() { try { this.st = (this.has && JSON.parse(N.spotifyStatus())) || {}; } catch (e) { this.st = {}; } return this.st; },
    get on() { return this.has && !!this.st.connected; },
    async call(method, path, body) {
      let r;
      try { r = await B.call('spotifyApi', method, path, body == null ? '' : JSON.stringify(body)); } catch (e) { r = { status: 0, body: null }; }
      r = r || { status: 0, body: null };
      if (r.status === 401) { const was = this.on; this.read(); if (was && !this.on) { this.cache.clear(); toast('Spotify sign-in ended – connect again in Settings › Spotify', 'warn'); } }
      return r;
    },
    /** GET with a short cache; throws {status, message} */
    async get(path, maxAge = 120000) {
      const c = this.cache.get(path); if (c && Date.now() - c.at < maxAge) return c.body;
      const r = await this.call('GET', path);
      if (r.status === 200 && r.body) { this.cache.set(path, { at: Date.now(), body: r.body }); return r.body; }
      const e = new Error(apiMsg(r)); e.status = r.status; e.reason = r.body && r.body.error && r.body.error.reason; throw e;
    },
  };
  const apiMsg = (r) => r.status === 0 ? 'Couldn’t reach Spotify – check your internet connection.'
    : r.status === 401 ? 'Spotify isn’t connected.' : r.status === 403 ? 'Spotify doesn’t let apps read this one.'
    : r.status === 404 ? 'Spotify couldn’t find it.' : r.status === 429 ? 'Spotify is busy – try again in a moment.'
    : `Spotify answered ${r.status}${r.body && r.body.error && r.body.error.message ? ' (' + r.body.error.message + ')' : ''}.`;
  /** Web API pictures go through Android (/_n/img: Spotify's CDN only, cached on the phone) */
  const imgOf = (images, want = 300) => {
    const l = (images || []).filter((x) => x && x.url); if (!l.length) return '';
    const best = l.slice().sort((a, b) => Math.abs((a.width || want) - want) - Math.abs((b.width || want) - want))[0];
    return '/_n/img?u=' + encodeURIComponent(best.url);
  };
  const sid = (uri) => String(uri || '').split(':').pop();
  // Web API objects -> what the pages draw. Handles both the 2026 names (playlist "items", entry "item") and the older
  // ones ("tracks", "track").
  const Norm = {
    playlist: (p) => (p && p.id ? { kind: 'playlist', id: p.id, uri: p.uri || 'spotify:playlist:' + p.id, name: p.name || 'Playlist', owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', ownerId: (p.owner && p.owner.id) || '', total: ((p.items || p.tracks) || {}).total, img: imgOf(p.images), web: (p.external_urls && p.external_urls.spotify) || 'https://open.spotify.com/playlist/' + p.id } : null),
    // al: the album when the track comes from /albums/{id}/tracks (those tracks carry no album of their own)
    track: (t, al) => { if (!t || !(t.uri || t.id)) return null; const A_ = t.album || al || null; const ims = (A_ && A_.images) || t.images;
      return { kind: 'track', id: t.id || '', uri: t.uri || (t.id ? 'spotify:track:' + t.id : ''), name: t.name || 'Unknown song',
        artists: (t.artists || []).filter((a) => a && a.name).map((a) => ({ id: a.id || '', name: a.name })),
        artist: (t.artists || []).map((a) => a && a.name).filter(Boolean).join(', ') || (t.show && t.show.name) || '',
        album: (A_ && A_.name) || '', albumId: (A_ && A_.id) || '', albumUri: (A_ && (A_.uri || (A_.id && 'spotify:album:' + A_.id))) || '',
        img: imgOf(ims, 64), big: imgOf(ims, 640), dur: (t.duration_ms || 0) / 1000, no: t.track_number || 0, disc: t.disc_number || 1, pop: t.popularity,
        explicit: !!t.explicit, local: !!t.is_local, web: (t.external_urls && t.external_urls.spotify) || (t.id ? 'https://open.spotify.com/track/' + t.id : '') }; },
    entry: (e) => (e ? Norm.track(e.item || e.track) : null),
    // (followers / popularity were removed for Development Mode apps in Feb 2026: shown only if Spotify still sends them)
    artist: (a) => (a && a.id ? { kind: 'artist', id: a.id, uri: a.uri || 'spotify:artist:' + a.id, name: a.name || '', img: imgOf(a.images, 160), big: imgOf(a.images, 640), genres: a.genres || [], followers: a.followers && a.followers.total, web: (a.external_urls && a.external_urls.spotify) || 'https://open.spotify.com/artist/' + a.id } : null),
    album: (a) => (a && a.id ? { kind: 'album', id: a.id, uri: a.uri || 'spotify:album:' + a.id, name: a.name || '', type: a.album_type || '', year: String(a.release_date || '').slice(0, 4), date: a.release_date || '', total: a.total_tracks,
      artists: (a.artists || []).filter((x) => x && x.name).map((x) => ({ id: x.id || '', name: x.name })), artist: (a.artists || []).map((x) => x && x.name).filter(Boolean).join(', '), img: imgOf(a.images, 300), big: imgOf(a.images, 640), web: (a.external_urls && a.external_urls.spotify) || 'https://open.spotify.com/album/' + a.id } : null),
    list: (arr, f) => (arr || []).map(f).filter((x) => x && (x.kind !== 'track' || (x.uri && !x.local))),
  };
  // every Web API item on screen, by "kind:id" (rows carry data-it)
  const Items = new Map();
  const reg = (x) => { const k = x.kind + ':' + (x.id || x.uri); Items.set(k, x); return k; };
  const linkOf = (x) => ({ app: x.uri || '', web: x.web || 'https://open.spotify.com/' });

  // ---- 1.1.5: tap a song -> it plays on THIS phone's Spotify, and Luciel's own Now Playing view shows it (Spotify's UI
  // stays closed). Steps (each in the Debug log): find the phone in Spotify Connect (/me/player/devices); if it isn't
  // there, wake Spotify in the background (media session / media button) and look again; if nothing is active, transfer
  // playback to it (PUT /me/player); start the song (PUT /me/player/play?device_id=…). Spotify's UI only as a last resort.
  const PLAY_SCOPES = ['user-modify-playback-state', 'user-read-playback-state'];
  const PHONE = (() => { try { return JSON.parse(N.spotifyDeviceNames ? N.spotifyDeviceNames() : '[]').map((x) => String(x || '').trim().toLowerCase()).filter(Boolean); } catch (e) { return []; } })();
  function pickPhone(list) {
    const ok = list.filter((d) => d && d.id && !d.is_restricted);
    return ok.find((d) => PHONE.includes(String(d.name || '').trim().toLowerCase())) || ok.find((d) => /smartphone/i.test(d.type || '')) || null;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const why = (r) => { const e = r && r.body && r.body.error; return e ? ` ${e.reason || ''} ${e.message || ''}`.replace(/\s+/g, ' ').trimEnd() : ''; };
  async function devices(step) {
    const r = await Api.call('GET', '/me/player/devices'); const l = (r.body && r.body.devices) || [];
    DBG.add('spotify', `play ${step}: devices → ${r.status}: ${l.map((d) => `${d.name} (${d.type}${d.is_active ? ', active' : ''}${d.is_restricted ? ', restricted' : ''})`).join(', ') || 'none'}`);
    return l;
  }
  const missingScopes = () => (Api.st && Api.st.missing) || [];
  const needsReconnect = () => missingScopes().some((x) => PLAY_SCOPES.includes(x));
  function askReconnect(why_) {
    DBG.add('spotify', `play: needs a reconnect (${why_})`);
    toast('Reconnect Spotify once so Luciel may start songs – tap Reconnect', 'warn');
    if (open) { if (top().p === 'now') paintNow(); else refresh(); }
  }
  /** wake / find the phone's Spotify device (null = none) */
  async function phoneDevice(tag) {
    const T = tag ? tag + ' ' : '';
    let list = await devices(T + '2/4'), dev = pickPhone(list);
    if (!dev) {
      const how = N.spotifyWake ? N.spotifyWake() : 'none';
      DBG.add('spotify', `play ${T}2/4: this phone isn't in Spotify Connect yet – woke Spotify in the background (${how})`);
      if (how !== 'not-installed') for (let i = 0; i < 8 && !dev; i++) { await sleep(Api.wakeWait); list = await devices(`${T}2/4 look again ${i + 1}`); dev = pickPhone(list); }
      if (!dev) dev = list.find((d) => d && d.id && d.is_active && !d.is_restricted) || null;   // something else already playing (a speaker…)
    }
    return { dev, anyActive: list.some((d) => d && d.is_active) };
  }
  let pending = null, playSeq = 0;
  /** what Now Playing shows until Spotify's own session reports the new song */
  function pendingNow(s) {
    const p = pending; if (!p) return null;
    if (Date.now() - p.at > 15000) { pending = null; return null; }
    if (s && s.active) {
      const same = String(s.title || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase();
      if ((p.ctx ? songKey(s) !== p.prevKey && s.playing : same)) { pending = null; return null; }
    }
    return p;
  }
  async function playApi(body, fallback, label, opt = {}) {
    vib(); const seq = ++playSeq, t0 = Date.now();
    if (!audio.paused) A.engine.pauseFor('Spotify: play from Luciel (one source at a time)');
    setSource('spotify', 'play from the Spotify tab');
    if (!Api.on) { Links.open(fallback, label); return 'link'; }
    if (needsReconnect()) { askReconnect('missing ' + missingScopes().join(', ')); return 'reconnect'; }
    if (opt.show) { pending = Object.assign({ at: Date.now(), prevKey: songKey(st()) }, opt.show); if (top().p !== 'now') go('now'); else paintNow(); }
    DBG.add('spotify', `play 1/4: “${label}” – ${body.context_uri ? body.context_uri + (body.offset ? ' from ' + body.offset.uri : '') : (body.uris || []).length + ' song(s)'}`);
    const { dev, anyActive } = await phoneDevice('');
    if (seq !== playSeq) return 'superseded';
    if (dev && !dev.is_active && !anyActive) {
      const t = await Api.call('PUT', '/me/player', { device_ids: [dev.id], play: false });
      DBG.add('spotify', `play 3/4: transfer playback to ${dev.name} → ${t.status}${why(t)}`);
    }
    const path = '/me/player/play' + (dev ? '?device_id=' + encodeURIComponent(dev.id) : '');
    let r = await Api.call('PUT', path, body);
    if (dev && (r.status === 404 || r.status === 502)) { await sleep(700); r = await Api.call('PUT', path, body); }
    DBG.add('spotify', `play 4/4: PUT ${path} → ${r.status}${why(r)} (${Date.now() - t0} ms)`);
    if (seq !== playSeq) return 'superseded';
    if (r.status >= 200 && r.status < 300) {
      if (opt.after) { try { await opt.after(dev); } catch (e) {} }
      setTimeout(() => pull('played via Web API'), 700); setTimeout(() => pull('played via Web API'), 2200);
      return 'api';
    }
    pending = null; if (open && top().p === 'now') paintNow();
    const e = (r.body && r.body.error) || {}, reason = e.reason || '';
    if ((r.status === 401 || r.status === 403) && /scope/i.test(e.message || '')) { Api.st.missing = PLAY_SCOPES.slice(); askReconnect(e.message); return 'reconnect'; }
    const note = reason === 'PREMIUM_REQUIRED' || (r.status === 403 && !reason) ? 'Starting songs from Luciel needs Spotify Premium – opening it in Spotify instead'
      : r.status === 0 ? 'No connection – opening it in Spotify'
      : !dev ? 'Couldn’t wake Spotify in the background – opening it so it can play' : 'Spotify didn’t start it – opening it in Spotify';
    DBG.add('spotify', `play: last resort – open Spotify (${r.status} ${reason})`);
    toast(note); Links.open(fallback, label);
    return 'link';
  }
  const showOf = (x, sub) => ({ name: x.name, artist: sub || x.artist || x.owner || '', artists: x.artists || [], img: x.big || x.img || '', uri: x.uri, albumId: x.albumId || (x.kind === 'album' ? x.id : ''), ctx: x.kind !== 'track' });
  function playItem(x, ctx, opt = {}) {
    if (x.kind === 'playlist' || x.kind === 'album' || x.kind === 'artist') return playApi({ context_uri: x.uri }, linkOf(x), x.name, Object.assign({ show: showOf(x, (x.kind === 'artist' ? 'Artist' : x.kind === 'album' ? x.artist : 'Playlist') + ' · starting…') }, opt));
    const show = showOf(x);
    if (ctx && ctx.uri) return playApi({ context_uri: ctx.uri, offset: { uri: x.uri } }, linkOf(x), x.name, { show });
    if (ctx && ctx.uris) { const i = Math.max(0, ctx.uris.indexOf(x.uri)); return playApi({ uris: ctx.uris.slice(i, i + 50) }, linkOf(x), x.name, { show }); }
    return playApi({ uris: [x.uri] }, linkOf(x), x.name, { show });
  }
  function shuffleItem(x) {
    return playItem(x, null, { after: async (dev) => { const r = await Api.call('PUT', '/me/player/shuffle?state=true' + (dev ? '&device_id=' + encodeURIComponent(dev.id) : '')); DBG.add('spotify', `shuffle on → ${r.status}`); } });
  }
  /** long-press: Add to queue */
  async function queueAdd(x) {
    vib();
    if (!Api.on) { toast('Connect Spotify to queue songs from Luciel'); return 'off'; }
    if (needsReconnect()) { askReconnect('queue'); return 'reconnect'; }
    const list = await devices('queue'); const dev = pickPhone(list) || list.find((d) => d.is_active);
    const r = await Api.call('POST', '/me/player/queue?uri=' + encodeURIComponent(x.uri) + (dev ? '&device_id=' + encodeURIComponent(dev.id) : ''));
    DBG.add('spotify', `queue “${x.name}” → ${r.status}${why(r)}`);
    if (r.status >= 200 && r.status < 300) { toast(`Added to queue: ${x.name}`); return 'ok'; }
    toast(r.status === 404 ? 'Start something on Spotify first – then songs can be queued' : (r.body && r.body.error && r.body.error.reason) === 'PREMIUM_REQUIRED' ? 'Queueing needs Spotify Premium' : 'Couldn’t add it to the queue', 'warn');
    return 'fail';
  }
  function itemMenu(x) {
    const M = window.LucielMobile; if (!M || !M.menuSheet) return;
    const items = [];
    if (x.kind === 'track') items.push(['queue', I.list, 'Add to queue']);
    if (x.kind === 'track' || x.kind === 'album') (x.artists || []).filter((a) => a.id).slice(0, 3).forEach((a) => items.push(['ar:' + a.id, I.radio, 'Go to ' + esc(a.name)]));
    if (x.kind === 'track' && x.albumId) items.push(['al', I.spark, 'Go to album']);
    if (x.kind !== 'track') items.push(['play', I.play, 'Play']);
    items.push(['open', I.open, 'Open in Spotify']);
    M.menuSheet(x.name, items, (a) => {
      if (a === 'queue') queueAdd(x);
      else if (a.startsWith('ar:')) { const ar = (x.artists || []).find((y) => y.id === a.slice(3)); if (ar) go('artist', { ar: { id: ar.id, name: ar.name } }); }
      else if (a === 'al') go('album', { al: { id: x.albumId, name: x.album, uri: x.albumUri, img: x.big || x.img } });
      else if (a === 'play') playItem(x);
      else if (a === 'open') Links.open(linkOf(x), x.name);
    });
  }
  // sign-in result from Android (SpotifyCallbackActivity -> WebBridge.pushEvent)
  const prevEvent = B.event;
  B.event = (name, d) => {
    if (name !== 'spotifyAuth') return prevEvent ? prevEvent(name, d) : undefined;
    Api.st = (d && d.status) || Api.read(); Api.cache.clear(); homeData = null;
    const r = (d && d.result) || '';
    if (r === 'ok') { toast('Spotify connected – your playlists load right here now'); if (top().p === 'account') stack.length = 1; }
    else if (r === 'denied') toast('Spotify sign-in cancelled', 'warn');
    else if (r === 'state') toast('That sign-in expired – tap Connect again', 'warn');
    else toast('Spotify sign-in didn’t finish: ' + r.replace(/^exchange: /, '') + '. Check the Client ID and that the Redirect URI is exactly ' + REDIRECT, 'warn');
    DBG.add('spotify', 'connect: ' + r);
    if (open) render();
    try { window.LucielMobile && window.LucielMobile.tab === 'settings' && window.dispatchEvent(new Event('luciel:settings')); } catch (e) {}
  };
  function searchSpotify(q, save = true) {
    q = String(q || '').trim(); if (!q) return;
    if (save) Library.main.addSearch(q);
    Links.open(Links.search(q), 'search');
  }
  function openQuick(id) {
    const p = QUICK.find((x) => x.id === id); if (!p) return;
    if (id === 'liked' && Api.on) { go('liked'); return; }          // connected: Liked Songs load right here
    Links.open(p.uri ? { app: p.uri, web: p.web } : Links.search(p.q), p.name);
  }
  function openTrack(t) { searchSpotify([t.title, t.artist].filter(Boolean).join(' '), false); }

  // ------------------------------------------------------------------ state
  const EXT = () => window.LucielExt || {};
  const st = () => (EXT().state || { active: false });
  let info = {}; const readInfo = () => { try { info = JSON.parse(N.info()); } catch (e) { info = info || {}; } return info; };
  const perms = () => info.perms || {}, prefs = () => info.prefs || {};
  readInfo(); Api.read();
  let source = store.get(K_SRC, 'local');
  function setSource(s, why) { if (s === source) return; source = s; store.set(K_SRC, s); DBG.add('source', `${s === 'spotify' ? 'Spotify' : 'Luciel'} is the active source (${why})`); syncMini(); }
  /** which source the mini bar / buttons follow right now */
  function activeSource() { if (!audio.paused) return 'local'; if (st().active && st().playing) return 'spotify'; return source; }
  // ---- position sync: Android sends the position measured at `posWall` (wall clock ms) and the playback speed, so the
  // bar runs on from there however late the update arrives; a seek holds its target until Spotify confirms it.
  const Sync = {
    base: { pos: 0, wall: 0, speed: 1, playing: false, key: '' }, hold: null,
    at(b, now) { return b.pos + (b.playing ? Math.max(0, now - b.wall) / 1000 * (b.speed || 1) : 0); },
    now(now = Date.now()) { const d = st().duration || 0, p = Sync.at(Sync.base, now); return d ? Math.max(0, Math.min(d, p)) : Math.max(0, p); },
    /** a fresh state from Android; returns what was done (for the tests / debug log) */
    take(s, now = Date.now()) {
      const nb = { pos: s.position || 0, wall: s.posWall || now, speed: s.speed > 0 ? s.speed : 1, playing: !!s.playing, key: s.key || s.title || '' };
      const h = Sync.hold;
      if (h && (now - h.at > 2500 || h.key !== nb.key)) Sync.hold = null;
      if (Sync.hold) {
        // waiting for Spotify to report the seek: ignore stale positions from before it
        if (Math.abs(Sync.at(nb, now) - Sync.at(Sync.hold.base, now)) > 1.2) { Sync.base = Object.assign({}, Sync.hold.base, { playing: nb.playing, wall: Sync.hold.base.wall }); return 'held'; }
        Sync.hold = null;
      }
      const cur = Sync.at(Sync.base, now), inc = Sync.at(nb, now);
      // same song, still playing, the report is a hair behind what is on screen: don't jerk the bar back
      if (Sync.base.key === nb.key && nb.playing && Sync.base.playing && inc < cur && cur - inc < 0.35) return 'kept';
      Sync.base = nb; return 'moved';
    },
    seek(sec, now = Date.now()) { Sync.base = Object.assign({}, Sync.base, { pos: sec, wall: now }); Sync.hold = { at: now, key: Sync.base.key, base: Object.assign({}, Sync.base) }; },
    pause(now = Date.now()) { Sync.base = Object.assign({}, Sync.base, { pos: Sync.at(Sync.base, now), wall: now, playing: false }); },
    resume(now = Date.now()) { Sync.base = Object.assign({}, Sync.base, { wall: now, playing: true }); },
  };
  const posNow = () => Sync.now();

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
    if (c === 'toggle') { s.playing = !s.playing; if (!s.playing) Sync.pause(); else Sync.resume(); paintNow(); syncMini(); kick(); }
  }

  // ------------------------------------------------------------------ covers, cached per song
  // The media-session cover arrives as /_n/ext-art?v=N (one fixed picture per N). It is loaded ONCE per song into a data
  // URL and kept here (300 px in memory, 160 px across restarts, and in the history entry), so every spot – hero, grid,
  // shelves, history, now playing – shows the same picture at once and nothing waits on a URL that may be gone by the
  // time it loads. Truly no picture -> the themed Lucielle placeholder (Scenes.coverFor).
  const songKey = (s) => (s.pkg || '') + '|' + (s.title || '') + '|' + (s.artist || '');
  const Covers = {
    mem: new Map(), src: new Map(), busy: new Map(), disk: store.get(K_COVERS, {}),
    get(k) { return (k && (this.mem.get(k) || (this.disk[k] && this.disk[k].d))) || ''; },
    put(k, big, small, url) {
      this.mem.set(k, big); this.src.set(k, url || '');
      this.disk[k] = { d: small, at: Date.now() };
      const ks = Object.keys(this.disk); if (ks.length > 40) ks.sort((a, b) => this.disk[a].at - this.disk[b].at).slice(0, ks.length - 40).forEach((x) => delete this.disk[x]);
      store.set(K_COVERS, this.disk);
      LocalProvider.setArt(k, small);
    },
    /** cache song k's cover from url (once); done(k) when it is. Returns true while a load is under way. */
    want(k, url, done) {
      if (!k || !url) return false;
      if (this.src.get(k) === url && this.mem.has(k)) return false;
      if (this.busy.get(k) === url) return true;
      this.busy.set(k, url);
      const t0 = Date.now();
      const load = (tries) => {
        const im = new Image();
        im.onload = () => {
          if (this.busy.get(k) !== url) return; this.busy.delete(k);
          const draw = (n, q) => { const c = document.createElement('canvas'); c.width = c.height = n; const w = im.naturalWidth || n, h = im.naturalHeight || n, m = Math.min(w, h); c.getContext('2d').drawImage(im, (w - m) / 2, (h - m) / 2, m, m, 0, 0, n, n); return c.toDataURL('image/jpeg', q); };
          let big = url, small = '';
          try { big = draw(300, 0.86); small = draw(160, 0.8); } catch (e) {}
          this.put(k, big, small || big, url);
          DBG.add('sync', `cover cached (${Date.now() - t0} ms) for “${k.split('|')[1] || ''}”`);
          if (done) done(k);
        };
        im.onerror = () => { if (this.busy.get(k) !== url) return; if (tries > 0) setTimeout(() => load(tries - 1), 600); else { this.busy.delete(k); DBG.add('sync', 'cover did not load: ' + url); } };
        im.src = url;
      };
      load(2); return true;
    },
  };
  const placeholder = (t) => window.Luciel.Scenes.coverFor({ title: t.title, artist: t.artist, album: t.album }, A.settings.palette);
  const coverOf = (t) => Covers.get(t.key) || t.art || placeholder(t);
  /** the cover for the media-session state right now */
  const coverNow = (s) => (s && s.active ? Covers.get(songKey(s)) || placeholder(s) : placeholder({ title: 'Luciel' }));
  /** a cover just got cached: swap it in wherever that song is on screen (no page rebuild) */
  function paintCovers(k) {
    if (!root) return;
    const src = Covers.get(k); if (!src) return;
    root.querySelectorAll('img[data-ck]').forEach((im) => { if (im.dataset.ck === k && im.getAttribute('src') !== src) im.src = src; });
    if (open && top().p === 'now') paintNow();
  }

  // history capture: every media-session song Luciel sees playing (its cover joins once it's cached)
  let lastSeenKey = '';
  function capture(s) {
    if (!s || !s.active || !s.playing || !s.title) return;
    const key = songKey(s);
    if (key === lastSeenKey) return; lastSeenKey = key;
    const c = Covers.disk[key];
    Library.main.remember({ key, title: s.title, artist: s.artist || '', album: s.album || '', app: s.app || 'Spotify', pkg: s.pkg || '', at: Date.now(), art: (c && c.d) || '' });
    if (open && top().p !== 'home') refresh();
  }

  // ------------------------------------------------------------------ pages
  let root = null, open = false; const stack = [{ p: 'home' }];
  const top = () => stack[stack.length - 1];
  function go(p, extra = {}) { if (root) top().y = root.scrollTop; stack.push({ p, ...extra }); render(); if (root) root.scrollTop = 0; }
  function back() { if (stack.length <= 1) return false; const was = top().p; stack.pop(); if (was === 'now') stageHome(); render(); if (root) root.scrollTop = top().y || 0; return true; }
  function greeting() { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  const head = (title, sub = '') => `<header class="sp-top"><button class="sp-ic" data-act="back" title="Back">${I.back}</button><div class="sp-top-t"><b>${esc(title)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div></header>`;
  const tile = (t, i) => `<button class="sp-gtile" data-track="${i}"><img src="${esc(coverOf(t))}" data-ck="${esc(t.key)}" alt=""><span>${esc(t.title)}</span></button>`;
  const card = (t, i) => `<button class="sp-card" data-track="${i}"><img src="${esc(coverOf(t))}" data-ck="${esc(t.key)}" alt="" loading="lazy"><b>${esc(t.title)}</b><span>${esc(t.artist || t.app)}</span></button>`;
  const quickTile = (q) => `<button class="sp-quick q${q.hue}${q.ext ? ' is-ext' : ''}" data-quick="${q.id}"><i>${q.icon}</i>${q.ext ? `<em class="sp-ext" title="Spotify doesn’t share this mix with other apps">Opens in Spotify ${I.open}</em>` : ''}<b>${esc(q.name)}</b><span>${esc(q.id === 'liked' && Api.on ? 'Your saved songs, here' : q.sub)}</span></button>`;
  const when = (at) => { const d = new Date(at), now = new Date(); const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5); return days === 0 ? t : days === 1 ? 'Yesterday ' + t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const row = (t, i, extra = '') => `<div class="sp-row" data-track="${i}"><img src="${esc(coverOf(t))}" data-ck="${esc(t.key)}" alt="" loading="lazy"><div class="sp-txt"><b>${esc(t.title)}</b><span>${esc([t.artist, t.app !== 'Spotify' ? t.app : ''].filter(Boolean).join(' · '))}${extra}</span></div><button class="sp-ic sp-go" data-track="${i}" title="Find in Spotify">${I.open}</button></div>`;

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
    return `<div class="sp-hero" data-act="now"><img src="${esc(coverNow(s))}" data-ck="${esc(songKey(s))}" alt=""><div class="sp-txt"><em>${s.playing ? 'Now playing' : 'Paused'} on ${esc(s.app || 'Spotify')}</em><b>${esc(s.title || 'Unknown song')}</b><span>${esc(s.artist || '')}</span></div><button class="sp-play" data-act="toggle" title="Play / pause">${s.playing ? I.pause : I.play}</button></div>`;
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
    readInfo(); Api.read(); loadHome();
    const h = Library.main.history(), q = Library.main.searches();
    return `<header class="sp-head"><div><h1>${greeting()}</h1><span class="sp-brand">Luciel × <b>Spotify</b></span></div></header>
      <button class="sp-searchbar" data-act="search">${I.search}<span>What do you want to listen to?</span></button>
      ${setupCards()}${nowHero()}${connectCard()}
      ${h.length ? `<div class="sp-grid">${h.slice(0, 6).map(tile).join('')}</div>` : ''}
      <div class="sp-shelf"><div class="sp-sh"><b>Quick picks</b></div><div class="sp-hs">${QUICK.map(quickTile).join('')}</div></div>
      ${playlistShelf()}
      ${recentShelf(h)}
      ${q.length ? `<div class="sp-shelf"><div class="sp-sh"><b>Your searches</b></div><div class="sp-hs sp-chips">${q.slice(0, 12).map((s) => `<button class="sp-chip" data-q="${esc(s)}">${I.search}${esc(s)}</button>`).join('')}</div></div>` : ''}
      ${overlaySection()}
      ${Api.has ? `<div class="sp-sec">Spotify account</div><div class="sp-group sp-acctrow"><button class="sp-row" data-act="account"><i class="sp-ri sp-acc">${I.link}</i><div class="sp-txt"><b>${Api.on ? 'Connected to Spotify' : 'Connect Spotify'}</b><span>${Api.on ? 'Playlists and search load in Luciel' : 'Optional · your own Client ID'}</span></div>${I.chev}</button></div>` : ''}
      <div class="sp-attr">Spotify is a trademark of Spotify AB. Luciel isn’t made by or affiliated with Spotify; it follows what your Spotify app is playing.</div>`;
  }
  // search page
  function renderSearch() {
    const e = top();
    return `<header class="sp-top sp-stop"><button class="sp-ic" data-act="back" title="Back">${I.back}</button>
        <div class="sp-sbox">${I.search}<input type="search" id="spQ" placeholder="Songs, artists, playlists" value="${esc(e.q || '')}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="sp-ic" data-act="clearq" ${e.q ? '' : 'hidden'} title="Clear">${I.x}</button></div></header>
      <div class="sp-filters">${(Api.on ? ['all', 'songs', 'artists', 'playlists'] : ['all', 'songs', 'artists']).map((f) => `<button class="sp-chip ${(e.f || 'all') === f ? 'on' : ''}" data-filter="${f}">${{ all: 'All', songs: 'Songs', artists: 'Artists', playlists: 'Playlists' }[f]}</button>`).join('')}</div>
      <div id="spResults">${searchResults()}</div>`;
  }
  function searchResults() {
    const e = top(), q = (e.q || '').trim();
    if (!q) {
      const s = Library.main.searches();
      return (s.length ? `<div class="sp-sec">Recent searches</div><div class="sp-list">${s.map((x) => `<div class="sp-row sp-recent" data-q="${esc(x)}"><i class="sp-ri">${I.clock}</i><div class="sp-txt"><b>${esc(x)}</b></div><button class="sp-ic" data-rmq="${esc(x)}" title="Remove">${I.x}</button></div>`).join('')}</div><button class="sp-link sp-clear" data-act="clearSearches">Clear recent searches</button>` : '<div class="sp-hint">Search Spotify for any song, artist or playlist. Your searches are kept here.</div>') +
        `<div class="sp-sec">Browse</div><div class="sp-qgrid">${QUICK.map(quickTile).join('')}</div>`;
    }
    if (Api.on) return apiResults(e, q) + `<div class="sp-row sp-searchrow" data-act="searchGo"><i class="sp-ri">${I.open}</i><div class="sp-txt"><b>See “${esc(q)}” in Spotify</b><span>Opens in Spotify</span></div>${I.chev}</div>`;
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
  // ------------------------------------------------------------------ connected pages (Web API)
  const dedupe = (l) => { const seen = new Set(); return l.filter((x) => (seen.has(x.uri) ? false : seen.add(x.uri))); };
  const subOf = (x) => x.kind === 'playlist' ? ['Playlist', x.owner].filter(Boolean).join(' · ') : x.kind === 'artist' ? 'Artist' : x.kind === 'album' ? ['Album', x.artist].filter(Boolean).join(' · ') : [x.artist, x.album].filter(Boolean).join(' · ');
  const pic = (x, cls = '') => `<img${cls ? ` class="${cls}"` : ''} src="${esc(x.img || placeholder({ title: x.name, artist: x.artist || x.owner }))}" data-fb="${esc(x.name || '')}" alt="" loading="lazy">`;
  const apiCard = (x) => `<button class="sp-card" data-it="${esc(reg(x))}">${pic(x)}<b>${esc(x.name)}</b><span>${esc(subOf(x))}</span></button>`;
  /** "Drake, 21 Savage · Her Loss" with each artist name tappable (-> artist page) */
  const arLinks = (arts) => (arts || []).map((a) => (a.id ? `<span class="sp-arl" data-ar="${esc(a.id)}" data-arn="${esc(a.name)}">${esc(a.name)}</span>` : esc(a.name))).join(', ');
  const trackSub = (x, noAlbum) => [arLinks(x.artists) || esc(x.artist), noAlbum ? '' : esc(x.album)].filter(Boolean).join(' · ');
  const fmtDur = (d) => (d ? fmt(d) : '');
  const apiRow = (x, o = {}) => `<div class="sp-row${o.num ? ' sp-numrow' : ''}" data-it="${esc(reg(x))}">${o.num ? `<i class="sp-num">${o.num}</i>` : pic(x, x.kind === 'artist' ? 'sp-round' : '')}<div class="sp-txt"><b>${esc(x.name)}${x.explicit ? ' <i class="sp-e" title="Explicit">E</i>' : ''}</b>${o.noSub ? '' : `<span>${x.kind === 'track' ? trackSub(x, o.noAlbum) : esc(subOf(x))}</span>`}</div>${x.kind === 'track' ? (o.dur ? `<em class="sp-dur">${fmtDur(x.dur)}</em>` : `<i class="sp-ri sp-acc sp-mini-play">${I.play}</i>`) : I.chev}</div>`;
  const skeleton = (n = 5) => `<div class="sp-list sp-skel" aria-label="Loading">${'<div class="sp-row"><i class="sp-sk-img"></i><div class="sp-txt"><b class="sp-sk"></b><span class="sp-sk short"></span></div></div>'.repeat(n)}</div>`;
  const skelShelf = () => `<div class="sp-hs sp-skel">${'<div class="sp-card"><i class="sp-sk-img big"></i><b class="sp-sk"></b></div>'.repeat(4)}</div>`;

  const reconCard = () => `<div class="sp-connect sp-recon"><div class="sp-connect-ic">${I.link}</div><div class="sp-txt"><b>Reconnect Spotify (one tap)</b><span>Luciel now needs permission to start songs on your phone. Your Client ID stays as it is.</span></div><div class="sp-row2"><button class="sp-btn primary" data-act="reconnect">Reconnect</button></div></div>`;
  function connectCard() {
    if (Api.on && needsReconnect()) return reconCard();
    if (!Api.has || Api.on || store.get(K_LATER, false)) return '';
    return `<div class="sp-connect"><div class="sp-connect-ic">${I.link}</div><div class="sp-txt"><b>Connect Spotify to load your playlists here</b><span>Your playlists, Liked Songs and search results right inside Luciel. Optional – everything else works without it.</span></div>
      <div class="sp-row2"><button class="sp-btn primary" data-act="account">Set up</button><button class="sp-btn" data-act="connectLater">Not now</button></div></div>`;
  }
  let homeData = null;   // { pls, recent, at, plsErr, recentErr }
  function loadHome(force) {
    if (!Api.on) return;
    if (homeData && !force && (homeData.busy || Date.now() - homeData.at < 120000)) return;
    homeData = Object.assign(homeData || {}, { busy: true });
    Promise.allSettled([Api.get('/me/playlists?limit=20'), Api.get('/me/player/recently-played?limit=20')]).then(([a, b]) => {
      homeData = { at: Date.now(), busy: false,
        pls: a.status === 'fulfilled' ? Norm.list(a.value.items, Norm.playlist) : null, plsErr: a.status === 'rejected' ? a.reason : null,
        recent: b.status === 'fulfilled' ? dedupe(Norm.list(b.value.items, Norm.entry)) : null, recentErr: b.status === 'rejected' ? b.reason : null };
      DBG.add('spotify', `home: ${homeData.pls ? homeData.pls.length + ' playlists' : 'playlists failed'}, ${homeData.recent ? homeData.recent.length + ' recent' : 'recent failed'}`);
      if (open && top().p === 'home' && root) { const y = root.scrollTop; render(); root.scrollTop = y; }
    });
  }
  function playlistShelf() {
    if (!Api.on) return '';
    const d = homeData || {};
    const body = d.pls ? (d.pls.length ? `<div class="sp-hs">${d.pls.slice(0, 12).map(apiCard).join('')}</div>` : '<div class="sp-hint">No playlists in your library yet.</div>')
      : d.plsErr ? `<div class="sp-hint">${esc(d.plsErr.message)} <button class="sp-link" data-act="retryHome">Try again</button></div>` : skelShelf();
    return `<div class="sp-shelf" id="spPls"><div class="sp-sh"><b>Your playlists</b>${d.pls && d.pls.length ? '<button class="sp-link" data-act="playlists">See all</button>' : ''}</div>${body}</div>`;
  }
  function recentShelf(h) {
    const d = homeData || {};
    if (Api.on && (d.recent || d.busy || !homeData)) {
      const body = d.recent ? (d.recent.length ? `<div class="sp-hs">${d.recent.slice(0, 12).map(apiCard).join('')}</div>` : '<div class="sp-hint">Nothing played on Spotify lately.</div>') : skelShelf();
      return `<div class="sp-shelf" id="spRecent"><div class="sp-sh"><b>Recently played</b><button class="sp-link" data-act="recent">See all</button></div>${body}</div>`;
    }
    return `<div class="sp-shelf"><div class="sp-sh"><b>Recently played</b>${h.length ? '<button class="sp-link" data-act="history">See all</button>' : ''}</div>
        ${h.length ? `<div class="sp-hs">${h.slice(0, 12).map(card).join('')}</div>` : '<div class="sp-hint">Songs you play in Spotify show up here.</div>'}</div>`;
  }

  // list pages: your playlists, Liked Songs, recently played (Spotify), one playlist
  const PAGES = {
    playlists: { title: 'Your playlists', sub: 'From your Spotify library', path: (o) => `/me/playlists?limit=50&offset=${o}`, map: (b) => Norm.list(b.items, Norm.playlist) },
    liked: { title: 'Liked Songs', sub: 'Your saved songs', path: (o) => `/me/tracks?limit=50&offset=${o}`, map: (b) => Norm.list(b.items, Norm.entry) },
    recent: { title: 'Recently played', sub: 'On Spotify, any device', path: () => '/me/player/recently-played?limit=50', map: (b) => dedupe(Norm.list(b.items, Norm.entry)), once: true },
    playlist: { path: (o, e) => `/playlists/${encodeURIComponent(e.pl.id)}/${e.oldApi ? 'tracks' : 'items'}?limit=50&offset=${o}`, map: (b) => Norm.list(b.items, Norm.entry) },
  };
  function loadList(e, more) {
    const P = PAGES[e.p]; if (!P || e.busy || !Api.on) return;
    if (!more && (e.list || e.err)) return;
    e.busy = true; const off = more ? (e.list || []).length : 0;
    Api.get(P.path(off, e), 60000).then((b) => { const l = P.map(b); e.list = more ? (e.list || []).concat(l) : l; e.next = !P.once && !!b.next; if (b.total != null) e.total = b.total; e.err = null; e.busy = false; })
      .catch((er) => {
        e.busy = false;
        if (e.p === 'playlist' && er.status === 404 && !e.oldApi) { e.oldApi = true; return loadList(e, more); }   // pre-2026 API name
        e.err = er;
      })
      .then(() => { if (open && top() === e) paintList(e); });
  }
  function ctxOf(e) {
    if (e.p === 'playlist') return { uri: e.pl.uri };
    if (e.p === 'album') return { uri: (e.info && e.info.uri) || e.al.uri || 'spotify:album:' + e.al.id };
    if (e.p === 'artist' && e.pop) return { uris: e.pop.map((t) => t.uri) };          // no offset into an artist context
    if ((e.p === 'liked' || e.p === 'recent') && e.list) return { uris: e.list.map((t) => t.uri) };
    return null;
  }
  function renderListPage() {
    const e = top(), P = PAGES[e.p];
    let h;
    if (e.p === 'playlist') {
      const x = e.pl, n = e.total != null ? e.total : x.total;
      h = `${head(x.name, 'Playlist')}<div class="sp-plhead">${pic(x)}<div class="sp-txt"><b>${esc(x.name)}</b><span>${esc([x.owner && 'by ' + x.owner, n != null && n + ' song' + (n === 1 ? '' : 's')].filter(Boolean).join(' · '))}</span></div></div>
        <div class="sp-row2"><button class="sp-btn primary" data-act="playCtx">${I.play}<span>Play</span></button><button class="sp-btn" data-act="openCtx">Open in Spotify</button></div>`;
    } else {
      h = head(P.title, P.sub) + (e.p === 'liked' ? `<div class="sp-row2"><button class="sp-btn primary" data-act="playCtx">${I.play}<span>Play</span></button></div>` : '');
    }
    h += `<div id="spList">${listBody(e)}</div>`;
    if (e.p === 'recent') h += '<button class="sp-link sp-clear" data-act="history">Songs Luciel saw on this phone</button>';
    return h;
  }
  function listBody(e) {
    if (!Api.on) return `<div class="sp-empty keep"><b>Spotify isn’t connected</b><p>Connect it to load this here.</p><button class="sp-btn primary" data-act="account">Connect Spotify</button></div>`;
    if (e.err && !e.list) {
      if (e.p === 'playlist' && e.err.status === 403) return `<div class="sp-empty keep"><b>Spotify keeps this playlist’s songs to itself</b><p>Other apps can only list the songs of playlists you made or collaborate on. You can still play it from here, or open it in Spotify.</p><div class="sp-row2"><button class="sp-btn primary" data-act="playCtx">Play</button><button class="sp-btn" data-act="openCtx">Open in Spotify</button></div></div>`;
      return `<div class="sp-empty keep"><b>Couldn’t load this</b><p>${esc(e.err.message)}</p><button class="sp-btn" data-act="retry">Try again</button></div>`;
    }
    if (!e.list) return skeleton();
    if (!e.list.length) return '<div class="sp-hint">Nothing here yet.</div>';
    return `<div class="sp-list">${e.list.map(apiRow).join('')}</div>${e.next ? `<button class="sp-btn sp-more" data-act="more" ${e.busy ? 'disabled' : ''}>${e.busy ? 'Loading…' : 'Load more'}</button>` : ''}`;
  }
  function paintList(e) { const l = $('spList'); if (l) l.innerHTML = listBody(e); const sub = root && root.querySelector('.sp-plhead .sp-txt span'); if (sub && e.p === 'playlist' && e.total != null) { const x = e.pl; sub.textContent = [x.owner && 'by ' + x.owner, e.total + ' song' + (e.total === 1 ? '' : 's')].filter(Boolean).join(' · '); } }

  // ---- artist page (iPod / Spotify style): header, Play / Shuffle, Popular, Discography (Albums · Singles & EPs · Compilations)
  // Feb-2026 Development Mode: /artists/{id}/top-tracks is removed, so "Popular" comes from search (artist:"name", tracks
  // by this artist, in Spotify's relevance order – track popularity is gone too); followers are removed (hidden).
  const GROUPS = [['album', 'Albums'], ['single', 'Singles & EPs'], ['compilation', 'Compilations']];
  function loadArtist(e) {
    if (e.started || !Api.on) return; e.started = true;
    const id = encodeURIComponent(e.ar.id), redraw = () => { if (open && top() === e) paintArtist(e); };
    Api.get('/artists/' + id, 600000).then((b) => { e.info = Norm.artist(b); }).catch((er) => { e.infoErr = er; }).then(redraw);
    loadPopular(e).then(redraw);
    e.disc = {}; GROUPS.forEach(([g]) => { e.disc[g] = { list: null }; loadDisc(e, g).then(redraw); });
  }
  async function loadPopular(e) {
    const id = e.ar.id;
    if (!Api.noTopTracks) {
      try { const b = await Api.get(`/artists/${encodeURIComponent(id)}/top-tracks`, 600000); e.pop = Norm.list(b.tracks, Norm.track).slice(0, 10); DBG.add('spotify', `artist: top-tracks → ${e.pop.length}`); return; }
      catch (er) { Api.noTopTracks = true; DBG.add('spotify', `artist: top-tracks unavailable (${er.status}) – Popular comes from search`); }
    }
    const name = (e.info && e.info.name) || e.ar.name || '';
    try {
      const b = await Api.get('/search?type=track&limit=10&q=' + encodeURIComponent(`artist:"${name}"`), 600000);
      let l = Norm.list(b.tracks && b.tracks.items, Norm.track).filter((t) => t.artists.some((a) => a.id === id));
      if (l.some((t) => t.pop != null)) l = l.map((t, i) => [t, i]).sort((a, b2) => (b2[0].pop || 0) - (a[0].pop || 0) || a[1] - b2[1]).map((x) => x[0]);
      e.pop = dedupe(l);
    } catch (er) { e.pop = []; e.popErr = er; }
  }
  async function loadDisc(e, g, more) {
    const d = e.disc[g]; if (d.busy) return; d.busy = true;
    const off = more ? (d.list || []).length : 0, lim = Api.albumLimit || 20;
    const path = (l) => `/artists/${encodeURIComponent(e.ar.id)}/albums?include_groups=${g}&limit=${l}&offset=${off}`;
    try {
      let b;
      try { b = await Api.get(path(lim), 600000); }
      catch (er) { if (er.status !== 400 || lim <= 10) throw er; Api.albumLimit = 10; DBG.add('spotify', 'artist albums: limit 20 refused – using 10'); b = await Api.get(path(10), 600000); }
      const l = Norm.list(b.items, Norm.album);
      d.list = more ? (d.list || []).concat(l) : l; d.next = !!b.next; d.total = b.total; d.err = null;
    } catch (er) { d.err = er; if (!d.list) d.list = []; }
    d.busy = false;
  }
  const albumTile = (x) => `<button class="sp-atile" data-it="${esc(reg(x))}">${pic(x)}<b>${esc(x.name)}</b><span>${esc([x.year, x.type === 'single' && x.total > 1 ? 'EP' : x.type === 'single' ? 'Single' : x.type === 'compilation' ? 'Compilation' : 'Album'].filter(Boolean).join(' · '))}</span></button>`;
  function renderArtist() {
    const e = top(); loadArtist(e);
    const a = e.info || e.ar;
    return `${head(a.name || 'Artist', 'Artist')}<div id="spArtist">${artistBody(e)}</div>`;
  }
  function artistBody(e) {
    if (!Api.on) return `<div class="sp-empty keep"><b>Spotify isn’t connected</b><p>Connect it to see artists here.</p><button class="sp-btn primary" data-act="account">Connect Spotify</button></div>`;
    const a = e.info || e.ar;
    const meta = [a.followers != null ? Number(a.followers).toLocaleString() + ' followers' : '', (a.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    const popN = e.popAll ? 10 : 5;
    const pop = e.pop == null ? skeleton(3) : e.pop.length ? `<div class="sp-list">${e.pop.slice(0, popN).map((t, i) => apiRow(t, { num: i + 1, noAlbum: false })).join('')}</div>${e.pop.length > 5 && !e.popAll ? '<button class="sp-link sp-clear" data-act="popMore">Show more</button>' : ''}` : '<div class="sp-hint">No popular songs to show.</div>';
    const disc = e.disc || {}, have = GROUPS.filter(([g]) => disc[g] && disc[g].list && disc[g].list.length);
    if (!e.tab || (disc[e.tab] && disc[e.tab].list && !disc[e.tab].list.length && have.length)) e.tab = (have[0] || GROUPS[0])[0];
    const cur = disc[e.tab] || {};
    const allDone = GROUPS.every(([g]) => disc[g] && disc[g].list);
    const grid = !cur.list ? `<div class="sp-agrid sp-skel">${'<div class="sp-atile"><i class="sp-sk-img big"></i><b class="sp-sk"></b></div>'.repeat(4)}</div>`
      : cur.list.length ? `<div class="sp-agrid">${cur.list.map(albumTile).join('')}</div>${cur.next ? `<button class="sp-btn sp-more" data-act="discMore" ${cur.busy ? 'disabled' : ''}>${cur.busy ? 'Loading…' : 'Show more'}</button>` : ''}`
      : allDone && !have.length ? `<div class="sp-hint">${cur.err ? esc(cur.err.message) : 'No releases found.'}</div>` : '';
    return `<div class="sp-arhead">${a.big || a.img ? `<img class="sp-arimg" src="${esc(a.big || a.img)}" data-fb="${esc(a.name || '')}" alt="">` : `<img class="sp-arimg" src="${esc(placeholder({ title: a.name || '' }))}" alt="">`}
        <h2>${esc(a.name || '')}</h2>${meta ? `<span class="sp-armeta">${esc(meta)}</span>` : ''}</div>
      <div class="sp-row2 sp-center"><button class="sp-btn primary" data-act="arPlay">${I.play}<span>Play</span></button><button class="sp-btn" data-act="arShuffle">${I.spark}<span>Shuffle</span></button><button class="sp-btn" data-act="openCtx">Open in Spotify</button></div>
      <div class="sp-sec">Popular</div><div id="spPop">${pop}</div>
      <div class="sp-sec">Discography</div>
      <div class="sp-filters" id="spDiscTabs">${(have.length ? have : allDone ? [] : GROUPS.slice(0, 1)).map(([g, n]) => `<button class="sp-chip ${e.tab === g ? 'on' : ''}" data-disc="${g}">${n}${disc[g] && disc[g].total ? ` <em>${disc[g].total}</em>` : ''}</button>`).join('')}</div>
      <div id="spDisc">${grid}</div>`;
  }
  function paintArtist(e) { const el = $('spArtist'); if (!el) return; el.innerHTML = artistBody(e); const t = root.querySelector('.sp-top-t b'); if (t && e.info) t.textContent = e.info.name; }

  // ---- album page: cover, title, artist(s), year, tracklist, Play album
  function loadAlbum(e) {
    if (e.started || !Api.on) return; e.started = true;
    const redraw = () => { if (open && top() === e) paintAlbum(e); };
    Api.get('/albums/' + encodeURIComponent(e.al.id), 600000).then((b) => {
      e.info = Norm.album(b); e.tracks = Norm.list((b.tracks || {}).items, (t) => Norm.track(t, b)); e.next = !!(b.tracks && b.tracks.next); e.raw = { id: b.id, name: b.name, images: b.images, uri: b.uri };
      e.copy = ((b.copyrights || [])[0] || {}).text || '';
    }).catch((er) => { e.err = er; }).then(redraw);
  }
  async function albumMore(e) {
    if (e.busy) return; e.busy = true; paintAlbum(e);
    try { const b = await Api.get(`/albums/${encodeURIComponent(e.al.id)}/tracks?limit=50&offset=${e.tracks.length}`, 600000); e.tracks = e.tracks.concat(Norm.list(b.items, (t) => Norm.track(t, e.raw))); e.next = !!b.next; }
    catch (er) { toast(er.message, 'warn'); }
    e.busy = false; paintAlbum(e);
  }
  function renderAlbum() { const e = top(); loadAlbum(e); return `${head((e.info || e.al).name || 'Album', 'Album')}<div id="spAlbum">${albumBody(e)}</div>`; }
  function albumBody(e) {
    if (!Api.on) return `<div class="sp-empty keep"><b>Spotify isn’t connected</b><p>Connect it to see albums here.</p><button class="sp-btn primary" data-act="account">Connect Spotify</button></div>`;
    const a = e.info || e.al;
    if (e.err) return `<div class="sp-empty keep"><b>Couldn’t load this album</b><p>${esc(e.err.message)}</p><button class="sp-btn" data-act="retry">Try again</button></div>`;
    const tr = e.tracks, mins = tr ? Math.round(tr.reduce((n, t) => n + (t.dur || 0), 0) / 60) : 0;
    const type = a.type === 'single' && (a.total || 0) > 1 ? 'EP' : a.type ? a.type[0].toUpperCase() + a.type.slice(1) : 'Album';
    let disc = 0; const multi = tr && tr.some((t) => t.disc > 1);
    const albumArtists = new Set((a.artists || []).map((x) => x.id));
    const rows = tr ? tr.map((t) => { let h = ''; if (multi && t.disc !== disc) { disc = t.disc; h = `<div class="sp-sec">Disc ${disc}</div>`; } const solo = t.artists.length === albumArtists.size && t.artists.every((x) => albumArtists.has(x.id)); return h + apiRow(t, { num: t.no || '•', noAlbum: true, dur: true, noSub: solo }); }).join('') : '';
    return `<div class="sp-alhead">${pic({ img: a.big || a.img, name: a.name })}<div class="sp-txt"><b>${esc(a.name || '')}</b><span>${arLinks(a.artists) || esc(a.artist || '')}</span><em>${esc([type, a.year, tr ? tr.length + (e.next ? '+' : '') + ' songs' : '', mins ? mins + ' min' : ''].filter(Boolean).join(' · '))}</em></div></div>
      <div class="sp-row2"><button class="sp-btn primary" data-act="alPlay">${I.play}<span>Play album</span></button><button class="sp-btn" data-act="alShuffle">${I.spark}<span>Shuffle</span></button><button class="sp-btn" data-act="openCtx">Open in Spotify</button></div>
      ${tr ? `<div class="sp-list sp-tracklist">${rows}</div>${e.next ? `<button class="sp-btn sp-more" data-act="alMore" ${e.busy ? 'disabled' : ''}>${e.busy ? 'Loading…' : 'More songs'}</button>` : ''}` : skeleton(6)}
      ${a.date ? `<div class="sp-attr sp-left">${esc(a.date)}${e.copy ? '<br>' + esc(e.copy) : ''}</div>` : ''}`;
  }
  function paintAlbum(e) { const el = $('spAlbum'); if (!el) return; el.innerHTML = albumBody(e); const t = root.querySelector('.sp-top-t b'); if (t && e.info) t.textContent = e.info.name; }
  /** an artist by name (Now Playing from the media session has no ids) */
  async function openArtistByName(name) {
    name = String(name || '').split(/,|&| feat\.? | ft\.? /i)[0].trim(); if (!name) return;
    if (!Api.on) { searchSpotify(name, false); return; }
    try {
      const b = await Api.get('/search?type=artist&limit=5&q=' + encodeURIComponent(name), 600000);
      const l = Norm.list(b.artists && b.artists.items, Norm.artist);
      const a = l.find((x) => x.name.toLowerCase() === name.toLowerCase()) || l[0];
      if (a) go('artist', { ar: a }); else toast(`Couldn’t find ${name} on Spotify`);
    } catch (er) { toast(er.message, 'warn'); }
  }

  // in-app search (connected)
  let searchT = 0;
  function runSearch(e, now) {
    clearTimeout(searchT);
    const q = (e.q || '').trim(); if (!q || !Api.on) return;
    if (e.res && e.res.q === q) return;
    e.pending = q;
    searchT = setTimeout(() => {
      Api.get('/search?type=track,artist,playlist,album&limit=10&q=' + encodeURIComponent(q), 300000)
        .then((b) => { e.res = { q, tracks: Norm.list(b.tracks && b.tracks.items, Norm.track), artists: Norm.list(b.artists && b.artists.items, Norm.artist), playlists: Norm.list(b.playlists && b.playlists.items, Norm.playlist), albums: Norm.list(b.albums && b.albums.items, Norm.album) }; })
        .catch((er) => { e.res = { q, err: er }; })
        .then(() => { if (e.pending === q) e.pending = ''; if (top() === e && (e.q || '').trim() === q) { const r = $('spResults'); if (r) r.innerHTML = searchResults(); } });
    }, now ? 0 : 320);
  }
  function apiResults(e, q) {
    const r = e.res && e.res.q === q ? e.res : null;
    if (!r) { if (e.pending !== q) runSearch(e); return skeleton(4); }
    if (r.err) return `<div class="sp-hint">${esc(r.err.message)}</div>`;
    const f = e.f || 'all';
    const sec = (title, l) => (l.length ? `<div class="sp-sec">${title}</div><div class="sp-list">${l.map(apiRow).join('')}</div>` : '');
    const html = f === 'songs' ? sec('Songs', r.tracks) : f === 'artists' ? sec('Artists', r.artists) : f === 'playlists' ? sec('Playlists', r.playlists)
      : sec('Songs', r.tracks.slice(0, 5)) + sec('Artists', r.artists.slice(0, 3)) + sec('Playlists', r.playlists.slice(0, 5)) + sec('Albums', r.albums.slice(0, 3));
    return html || `<div class="sp-hint">Nothing on Spotify matches “${esc(q)}”.</div>`;
  }

  // the Spotify account page (Settings › Spotify): Client ID + connect + a short guide
  function renderAccount() {
    const a = Api.read(), on = Api.on, cid = a.clientId || '';
    return `${head('Spotify account', 'Optional · load your playlists in Luciel')}
      <div class="sp-acct ${on ? 'on' : ''}"><div class="sp-acct-st"><i>${on ? '✓' : I.link}</i><div class="sp-txt"><b>${on ? 'Connected' : 'Not connected'}</b><span>${on ? 'Playlists, Liked Songs, recently played and search load right here.' : 'Luciel works fine without this.'}</span></div></div>
        <label class="sp-field"><span>Client ID</span><input id="spCid" value="${esc(cid)}" placeholder="Paste your app’s Client ID" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" inputmode="text"></label>
        <div class="sp-note" id="spCidNote">${cid ? (a.validId ? 'Saved on this phone.' : 'That doesn’t look like a Client ID (32 letters and numbers).') : 'Your own, from a free Spotify developer app – see the steps below.'}</div>
        <div class="sp-row2"><button class="sp-btn primary" data-act="connect">${on ? 'Reconnect' : 'Connect Spotify'}</button>${on ? '<button class="sp-btn" data-act="disconnect">Disconnect</button>' : ''}</div></div>
      <div class="sp-sec">Get a Client ID (free, about 2 minutes)</div>
      <ol class="sp-guide">
        <li>Open <b>developer.spotify.com/dashboard</b> and log in with your Spotify account. <button class="sp-link" data-act="dash">Open it</button></li>
        <li>Tap <b>Create app</b>. Any name and description (for example “Luciel”).</li>
        <li>In <b>Redirect URIs</b> enter exactly <code>${REDIRECT}</code> <button class="sp-link" data-act="copyRedirect">Copy</button> and tap <b>Add</b>.</li>
        <li>Tick <b>Web API</b>, accept the terms and tap <b>Save</b>.</li>
        <li>Open the app’s <b>Settings</b>, copy the <b>Client ID</b>, paste it above and tap <b>Connect Spotify</b>.</li>
      </ol>
      <div class="sp-note">Spotify asks the owner of a developer app to have Premium, and starting songs from Luciel needs Premium too (without it, taps open Spotify). One app works for up to 5 Spotify accounts – add others under <b>User Management</b>. Luciel never sees your password and keeps no client secret; sign-in happens on Spotify’s own page and you can remove access any time at spotify.com/account/apps.</div>
      <div class="sp-note">Daily Mix, Discover Weekly and Release Radar always open in Spotify: Spotify doesn’t share its made-for-you mixes with other apps.</div>`;
  }
  function saveCid(v) {
    v = String(v == null ? (($('spCid') || {}).value || '') : v).trim();
    let r; try { r = JSON.parse(N.spotifySetClientId(v)); } catch (e) { r = { error: 'bridge' }; }
    const note = $('spCidNote');
    if (r.error) { if (note) note.textContent = 'That doesn’t look like a Client ID – it’s 32 letters and numbers from your app’s Settings.'; return false; }
    Api.st = r; Api.cache.clear(); homeData = null;
    if (note) note.textContent = v ? 'Saved on this phone.' : 'Cleared.';
    return true;
  }
  // now playing (Spotify style): big cover or the Lucielle stage, title/artist, seek, transport
  let nowView = store.get(K_VIEW, 'cover');
  function renderNow() {
    const s = st();
    return `${head('Now playing', s.active ? 'on ' + (s.app || 'Spotify') : ' ')}
      <div class="sp-seg sp-viewseg">${[['cover', 'Cover'], ['lucielle', 'Lucielle']].map(([v, n]) => `<button data-view="${v}" class="${nowView === v ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="sp-nowart ${nowView === 'lucielle' ? 'is-stage' : ''}" id="spNowArt">${nowView === 'cover' ? `<img id="spBigCover" alt="">` : '<div class="sp-stage" id="spStage"></div>'}</div>
      <div id="spRecon"></div>
      <div class="sp-nowmeta"><div class="sp-txt"><b id="spNTitle"></b><span id="spNArtist" class="sp-arl" data-act="nowArtist"></span></div><button class="sp-ic" data-act="openSpotify" title="Open Spotify">${I.open}</button></div>
      <div class="sp-seek" id="spSeek"><div class="sp-bar"><i id="spFill"></i><b id="spKnob"></b></div><div class="sp-times"><span id="spCur">0:00</span><span id="spDur">0:00</span></div></div>
      <div class="sp-tempo-row"><span class="sp-tempo" id="spTempo" title="Lucielle's tempo: live = measured from the music, tapped = your taps, steady = a fixed beat (tap the tempo to correct it)"></span></div>
      <div class="sp-transport"><button class="sp-tb" data-act="prev" title="Previous">${I.prev}</button><button class="sp-tb big" data-act="toggle" id="spBigPlay" title="Play / pause"></button><button class="sp-tb" data-act="next" title="Next">${I.next}</button></div>
      <div class="sp-row2"><button class="sp-btn" data-act="openSpotify">Open Spotify</button>${perms().mic ? '' : '<button class="sp-btn" data-act="tap">Tap tempo</button>'}<button class="sp-btn" data-act="popout">Pop out</button></div>`;
  }
  function paintNow() {
    if (!open || top().p !== 'now' || !root) return;
    const s = st();
    const t = $('spNTitle'); if (!t) return;
    const pn = pendingNow(s);
    if (pn) { t.textContent = pn.name; $('spNArtist').textContent = pn.artist || 'Starting on Spotify…'; }
    else { t.textContent = s.active ? s.title || 'Unknown song' : 'Nothing playing'; $('spNArtist').textContent = s.active ? [s.artist, s.album].filter(Boolean).join(' · ') : 'Play a song in Spotify'; }
    const em = root.querySelector('.sp-top-t em'); if (em) em.textContent = pn ? 'Starting on Spotify…' : s.active ? 'on ' + (s.app || 'Spotify') : '';
    const c = $('spBigCover'); if (c) { const src = pn && pn.img ? pn.img : coverNow(s); if (c.getAttribute('src') !== src) c.src = src; }
    $('spBigPlay').innerHTML = (pn || s.playing) ? I.pause : I.play;
    const rc = $('spRecon'); if (rc) rc.innerHTML = Api.on && needsReconnect() ? reconCard() : '';
    const tp = $('spTempo'); if (tp) { tp.hidden = !s.active; tp.textContent = tempoLabel(s); tp.dataset.src = s.bpmSource || ''; }
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
    const end = (e) => { if (seekDrag == null) return; const f = seekDrag; seekDrag = null; if (e.type !== 'pointercancel') { const sec = f * (st().duration || 0); N.extCommand('seek', sec); Sync.seek(sec); } paintTime(); };
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
    root.innerHTML = p === 'search' ? renderSearch() : p === 'history' ? renderHistory() : p === 'now' ? renderNow() : p === 'account' ? renderAccount() : p === 'artist' ? renderArtist() : p === 'album' ? renderAlbum() : PAGES[p] ? renderListPage() : renderHome();
    if (PAGES[p]) loadList(top());
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
    else if (PAGES[p]) paintList(top());
    else if (p === 'artist') paintArtist(top());
    else if (p === 'album') paintAlbum(top());
  }

  // ------------------------------------------------------------------ events (one delegated handler per root)
  let longAt = 0;   // when a long-press / context menu / edge swipe last consumed a gesture
  function bind(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-track],[data-quick],[data-q],[data-rmq],[data-filter],[data-hfilter],[data-mode],[data-view],[data-artist],[data-it],[data-ar],[data-disc]');
      if (!b || !el.contains(b)) return;
      const d = b.dataset;
      if (d.rmq != null) { e.stopPropagation(); Library.main.removeSearch(d.rmq); refresh(); return; }
      if (Date.now() - longAt < 300) { longAt = 0; return; }   // the long-press menu already handled it
      if (d.ar) { vib(); go('artist', { ar: { id: d.ar, name: d.arn || '' } }); return; }
      if (d.disc) { const t = top(); t.tab = d.disc; paintArtist(t); return; }
      if (d.it) { const x = Items.get(d.it); if (!x) return; vib();
        if (x.kind === 'playlist') go('playlist', { pl: x }); else if (x.kind === 'artist') go('artist', { ar: x }); else if (x.kind === 'album') go('album', { al: x });
        else playItem(x, ctxOf(top())); return; }
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
      else if (a === 'account') go('account');
      else if (a === 'connectLater') { store.set(K_LATER, true); refresh(); toast('You can connect Spotify any time in Settings › Spotify'); }
      else if (a === 'playlists' || a === 'liked' || a === 'recent') go(a);
      else if (a === 'retryHome') { Api.cache.clear(); homeData = null; refresh(); }
      else if (a === 'retry') { const t = top(); Api.cache.clear(); t.err = null; t.list = null; t.oldApi = false; t.started = false; render(); }
      else if (a === 'more') { loadList(top(), true); paintList(top()); }
      else if (a === 'playCtx') { const t = top(); if (t.p === 'playlist') playItem(t.pl); else if (t.list && t.list.length) playItem(t.list[0], ctxOf(t)); }
      else if (a === 'openCtx') { const t = top(), x = t.pl || (t.p === 'artist' && (t.info || t.ar)) || (t.p === 'album' && (t.info || t.al)); if (x) Links.open(linkOf(Object.assign({ uri: '', web: '' }, x, { uri: x.uri || (t.p === 'artist' ? 'spotify:artist:' + x.id : t.p === 'album' ? 'spotify:album:' + x.id : x.uri), web: x.web || '' })), x.name); }
      else if (a === 'arPlay' || a === 'arShuffle') { const t = top(), x = Object.assign({ kind: 'artist', uri: 'spotify:artist:' + t.ar.id }, t.ar, t.info || {}); if (a === 'arPlay') playItem(x); else shuffleItem(x); }
      else if (a === 'alPlay' || a === 'alShuffle') { const t = top(), x = Object.assign({ kind: 'album', uri: 'spotify:album:' + t.al.id }, t.al, t.info || {}); if (a === 'alPlay') playItem(x); else shuffleItem(x); }
      else if (a === 'popMore') { top().popAll = true; paintArtist(top()); }
      else if (a === 'discMore') { const t = top(); loadDisc(t, t.tab, true).then(() => { if (top() === t) paintArtist(t); }); paintArtist(t); }
      else if (a === 'alMore') albumMore(top());
      else if (a === 'nowArtist') { const p = pendingNow(st()); const ar = p && (p.artists || []).find((x) => x.id); if (ar) go('artist', { ar }); else openArtistByName(st().artist); }
      else if (a === 'reconnect') { const r = N.spotifyConnect(); DBG.add('spotify', 'reconnect: ' + r); if (r === 'opened') toast('Tap Agree on Spotify’s page – Luciel comes straight back'); else go('account'); }
      else if (a === 'connect') {
        vib(); const inp = $('spCid');
        if (inp && inp.value.trim() !== (Api.st.clientId || '') && !saveCid(inp.value)) return;
        if (!Api.read().validId) { toast('Paste your Client ID first – the steps are just below', 'warn'); if (inp) inp.focus(); return; }
        const r = N.spotifyConnect(); DBG.add('spotify', 'connect: ' + r);
        if (r === 'opened') toast('Log in on Spotify’s page and tap Agree – Luciel comes straight back'); else toast('Paste your Client ID first', 'warn');
      }
      else if (a === 'disconnect') { if (confirm('Disconnect Spotify? Luciel goes back to following what Spotify plays.')) { N.spotifyDisconnect(); Api.read(); Api.cache.clear(); homeData = null; render(); toast('Spotify disconnected'); } }
      else if (a === 'dash') Links.open({ app: '', web: DASH }, 'developer dashboard');
      else if (a === 'copyRedirect') { const done = () => toast('Copied ' + REDIRECT); try { navigator.clipboard.writeText(REDIRECT).then(done, () => toast(REDIRECT)); } catch (x) { toast(REDIRECT); } }
      else if (a === 'clearHistory') { if (confirm('Clear your recently played list?')) { Library.main.clear(); refresh(); } }
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'spCid') { saveCid(e.target.value); return; }
      if (e.target.dataset.act === 'overlay') { vib(); N.overlayCard(e.target.checked ? 'on' : 'off'); readInfo(); toast(e.target.checked ? 'Spotify overlay on – it shows when you leave Luciel while music plays' : 'Spotify overlay off'); }
    });
    el.addEventListener('input', (e) => {
      if (e.target.id === 'spQ') { top().q = e.target.value; const c = el.querySelector('[data-act="clearq"]'); if (c) c.hidden = !e.target.value; $('spResults').innerHTML = searchResults(); }
      if (e.target.id === 'spHQ') { top().q = e.target.value; $('spHList').innerHTML = historyList(); }
    });
    el.addEventListener('keydown', (e) => {
      if (e.target.id === 'spQ' && e.key === 'Enter') {
        e.preventDefault();
        if (Api.on) { const q = e.target.value.trim(); if (q) Library.main.addSearch(q); runSearch(top(), true); e.target.blur(); return; }   // results stay in Luciel
        searchSpotify(e.target.value); e.target.blur(); refresh();
      }
      if (e.target.id === 'spCid' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    // long-press a song / album / artist -> menu (Add to queue, Go to artist / album, Open in Spotify)
    let lp = null;
    const lpItem = (t) => { const r = t && t.closest && t.closest('[data-it]'); return r && el.contains(r) ? Items.get(r.dataset.it) : null; };
    const menuOpen = () => !!(window.LucielMobile && window.LucielMobile.sheet === 'menu');
    el.addEventListener('pointerdown', (e) => { longAt = 0; const x = lpItem(e.target); if (!x) return; clearTimeout(lp && lp.t); lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => { longAt = Date.now() + 60000; lp = null; if (!menuOpen()) itemMenu(x); }, 520) }; });
    const lpEnd = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
    el.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) lpEnd(); });
    el.addEventListener('pointerup', lpEnd); el.addEventListener('pointercancel', lpEnd);
    el.addEventListener('contextmenu', (e) => { const x = lpItem(e.target); if (!x) return; e.preventDefault(); lpEnd(); longAt = Date.now(); if (!menuOpen()) itemMenu(x); });
    // edge swipe from the left = back (like the library pages)
    let sw = null;
    el.addEventListener('pointerdown', (e) => { if (stack.length > 1 && e.clientX < 24 && top().p !== 'now') sw = { x: e.clientX, y: e.clientY, on: false }; });
    el.addEventListener('pointermove', (e) => {
      if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (!sw.on && Math.abs(dy) > 24 && Math.abs(dy) > dx) { sw = null; return; }
      if (dx > 12) { if (!sw.on) { sw.on = true; lpEnd(); try { el.setPointerCapture(e.pointerId); } catch (x) {} el.style.transition = 'none'; } el.style.transform = `translateX(${Math.max(0, dx)}px)`; el.style.opacity = String(1 - Math.min(0.4, dx / innerWidth)); }
    });
    const swEnd = (e) => {
      if (!sw) return; const on = sw.on, dx = e.clientX - sw.x; sw = null; if (!on) return;
      el.style.transition = 'transform .18s ease, opacity .18s ease'; el.style.transform = ''; el.style.opacity = '';
      if (dx > innerWidth * 0.3 && e.type !== 'pointercancel') { longAt = Date.now(); back(); }
      setTimeout(() => { el.style.transition = ''; }, 200);
    };
    el.addEventListener('pointerup', swEnd); el.addEventListener('pointercancel', swEnd);
    // a Web API picture that doesn't load -> the themed placeholder
    el.addEventListener('error', (e) => { const im = e.target; if (im && im.tagName === 'IMG' && im.dataset.fb != null && !im.dataset.failed) { im.dataset.failed = '1'; im.src = placeholder({ title: im.dataset.fb }); } }, true);
  }

  // ------------------------------------------------------------------ live updates from android.js
  let ticker = 0, raf = 0, heroKey = null, lastPlay = null, lastArt = null;
  function onState(s) {
    s = s || st();
    const how = Sync.take(s);
    capture(s);
    if (s.active && s.art) Covers.want(songKey(s), s.art, paintCovers);
    if (s.active && s.playing && audio.paused) setSource('spotify', 'Spotify started playing');
    const k = s.active ? (s.key || s.title || "") : ""; const changed = k !== heroKey; heroKey = k;
    const playChanged = !!s.playing !== lastPlay, artChanged = (s.art || '') !== lastArt; lastPlay = !!s.playing; lastArt = s.art || '';
    if (open) { if (top().p === 'home' && !changed) refreshHero(); else refresh(); }
    syncMini(); kick();
    // sync debugging: session event -> on screen (song / play state / cover changes only, not every position report)
    if (s.active && s.evAt && (changed || playChanged || artChanged)) DBG.add('sync', `tab: “${String(s.title || '').slice(0, 40)}” ${s.playing ? 'playing' : 'paused'}${changed ? ' (new song)' : artChanged ? ' (cover)' : ''} shown ${Math.max(0, Date.now() - s.evAt)} ms after the session event · bar ${how}`);
  }
  // smooth bar while playing (every frame), a slow tick otherwise; nothing at all while the tab is closed
  function kick() {
    if (raf || !open || !st().playing) return;
    const loop = () => { raf = 0; if (!open || !st().playing) return; if (top().p === 'now') paintTime(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  /** pull a fresh snapshot from Android (tab shown, app resumed) instead of waiting for the next session event */
  function pull(why) {
    try { const s = JSON.parse(N.extState()); if (window.LucielAndroidBridge && window.LucielAndroidBridge.ext) window.LucielAndroidBridge.ext(s); else onState(s); DBG.add('sync', `tab: fresh state (${why})`); } catch (e) {}
  }
  /** the stage's own beat reading (updated every frame while the tab drives the stage) beats the last session snapshot */
  const liveTempo = () => { const E = EXT(); return E.on && E.bpm > 0 ? { bpm: E.bpm, bpmSource: E.source, tempo: '' } : {}; };
  function tempoLabel(s) {
    const b = Math.round(s.bpm > 0 ? s.bpm : 120);
    return s.tempo || (s.bpmSource === 'live' ? `♩ ${b} BPM · live` : s.bpmSource === 'tap' ? `♩ ${b} BPM · tapped` : `♩ ${b} BPM · steady · tap`);
  }
  function refreshHero() {
    // repaint only the parts that change, so the home page doesn't flicker or lose its scroll
    const old = root && root.querySelector('.sp-hero, .sp-empty:not(.keep)'); const html = nowHero();
    if (!root) return;
    if (old && html) {
      const t = document.createElement('div'); t.innerHTML = html; const nu = t.firstElementChild;
      // keep the very same <img> when the picture is unchanged (no reload, no grey flash)
      const oi = old.querySelector('img'), ni = nu.querySelector('img');
      if (oi && ni && oi.getAttribute('src') === ni.getAttribute('src') && oi.dataset.ck === ni.dataset.ck) ni.replaceWith(oi);
      if (old.outerHTML !== nu.outerHTML) old.replaceWith(nu);
    }
    else refresh();
  }
  function syncMini() { try { if (window.LucielMobile && window.LucielMobile.syncMini) window.LucielMobile.syncMini(); } catch (e) {} }
  audio.addEventListener('play', () => setSource('local', 'Luciel started playing'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && open) { readInfo(); pull('app resumed'); } });

  window.LucielSpotify = {
    icon: I.tab,
    get source() { return source; },
    activeSource, cmd, back, onState, refresh,
    onPerms() { readInfo(); if (open) { if (top().p === 'now') render(); else refresh(); } },
    show(host) {
      if (!root) { root = host; bind(root); }
      open = true; readInfo();
      try { window.LucielAndroidUI && window.LucielAndroidUI.extView(true); } catch (e) {}
      pull('tab shown');
      render();
      clearInterval(ticker); ticker = setInterval(() => { if (open && top().p === 'now') { paintTime(); const tp = $('spTempo'); const s = st(); if (tp && s.active) tp.textContent = tempoLabel(Object.assign({}, s, liveTempo())); } kick(); }, 250);
    },
    hide() {
      open = false; clearInterval(ticker); if (raf) cancelAnimationFrame(raf); raf = 0; stageHome();
      try { window.LucielAndroidUI && window.LucielAndroidUI.extView(false); } catch (e) {}
    },
    /** 1.1.4: the two players are kept apart. The Spotify tab has its own player, so Luciel's mini bar is hidden there
     *  (hideMini), and on Luciel's own tabs the mini bar only shows Luciel's own music (miniInfo never hands it Spotify). */
    miniInfo() { return null; },
    hideMini(tab) { return tab === 'spotify'; },
    openAccount() { try { window.LucielMobile.setTab('spotify'); } catch (e) {} if (top().p !== 'account') go('account'); },
    accountRow() { Api.read(); return Api.on ? 'Connected · playlists load in Luciel' : Api.st.validId ? 'Client ID saved · not connected' : 'Optional · load your playlists in Luciel'; },
    // for tests
    _lib: Library, _links: Links, _quick: QUICK, get _page() { return top().p; }, _sync: Sync, _tempo: tempoLabel, _covers: Covers, _api: Api, _norm: Norm, _go: go,
  };
})();
