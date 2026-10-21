// Injected before the page loads: a fake window.LucielAndroid that behaves like WebBridge.kt
window.__calls = []; window.__reports = []; window.__writes = []; window.__prefs = {};
window.__perms = { audio: true, notifications: true, mic: true, overlay: true, listener: true };
window.__ext = { active: false };
window.__media = __MEDIA__;
const res = (id, ok, v) => setTimeout(() => window.LucielAndroidBridge._resolve(id, ok, v), 30);
window.LucielAndroid = {
  version: () => '1.0.0',
  info: () => JSON.stringify({ version: '1.0.0', sdk: 37, device: 'Headless Test', perms: window.__perms, prefs: Object.assign({ overlay: true, spotifyOnly: false, visualizer: true, fallbackBpm: 120, autoExtMode: true, bgPlay: true, autoHide: 20, overlayScene: 'auto', autoFloater: false, overlayMode: 'compact', floaterClosed: false, spotifyInstalled: true }, window.__prefs) }),
  reportState: (j) => window.__reports.push(JSON.parse(j)),
  scanLibrary: (id) => { window.__calls.push('scan'); res(id, true, window.__media); },
  pickAudio: (id) => { window.__calls.push('pickAudio'); res(id, true, window.__media.slice(0, 2)); },
  pickFolder: (id, a) => { window.__calls.push('pickFolder:' + a); res(id, true, a ? window.__media.slice(2, 4) : []); },
  requestAudioPermission: (id) => res(id, true, true),
  writeFile: (id, uri, b64) => { window.__writes.push({ uri, len: atob(b64).length }); res(id, true, uri); },
  renameFile: (id, uri, name) => { window.__calls.push('rename:' + name); res(id, true, uri); },
  saveAs: (id, name, mime, b64) => { window.__calls.push('saveAs:' + name); res(id, true, { uri: 'content://x/1', name }); },
  extState: () => JSON.stringify(window.__ext),
  extFrame: () => {
    const now = performance.now() / 1000, bpm = window.__tapBpm || 128, beat = now * bpm / 60;
    const ph = beat - Math.floor(beat), kick = Math.exp(-ph * 6);
    const mags = new Uint8Array(512); for (let i = 0; i < 512; i++) mags[i] = Math.min(255, (i < 12 ? 200 * kick + 40 : 160 * Math.exp(-i / 90)) + Math.random() * 20);
    const wave = new Uint8Array(512); for (let i = 0; i < 512; i++) wave[i] = 128 + 60 * kick * Math.sin(i / 7);
    const b = (u) => btoa(String.fromCharCode(...u));
    return [bpm, beat, window.__tapBpm ? 'tap' : 'live', window.__ext.playing ? 1 : 0, 0.6 * kick, 0.6, 0.3, 0.2, 44100, b(mags), b(wave)].join('|');
  },
  extCommand: (c, a) => { window.__calls.push('ext:' + c + (c === 'seek' ? ':' + Math.round(a) : ''));
    // behave like a media session: toggle/play/pause change the state and Android reports it back
    const e = window.__ext; if (!e.active) return;
    if (c === 'toggle') e.playing = !e.playing; else if (c === 'play') e.playing = true; else if (c === 'pause') e.playing = false; else if (c === 'seek') e.position = a;
    if (['toggle', 'play', 'pause', 'seek'].includes(c)) setTimeout(() => window.LucielAndroidBridge.ext && window.LucielAndroidBridge.ext(JSON.parse(JSON.stringify(e))), 20); },
  openLink: (app, web) => { window.__calls.push('link:' + app + '|' + web); return 'app'; },
  overlayCard: (c) => { window.__calls.push('overlayCard:' + c); if (c !== 'off') window.__prefs.overlay = true; else window.__prefs.overlay = false; },
  extTap: () => (window.__tapBpm = 124), extSetBpm: () => {}, extUse: (on) => window.__calls.push('extUse:' + on), beatSource: () => 'live',
  setPref: (k, v) => { window.__prefs[k] = v === 'true' ? true : v === 'false' ? false : v; }, open: (w) => window.__calls.push('open:' + w),
  systemBars: (bg, light) => { window.__bars = { bg, light }; }, haptic: () => {}, toast: () => {}, exitApp: () => {},
  floater: (c) => window.__calls.push('floater:' + c), immersive: (on) => window.__calls.push('immersive:' + on),
  // Luciel's look for the native floater / Spotify card (WebBridge.visualState / visualHas / visualPut)
  visualState: (j) => window.__visual.push(JSON.parse(j)),
  visualHas: (k, size) => (window.__vfiles[k] && window.__vfiles[k].size === size ? window.__vfiles[k].path : ''),
  visualPut: (k, size, b64) => { const path = '/data/user/0/com.luciel.player/files/visual/' + k.replace(/[^A-Za-z0-9._-]+/g, '_'); window.__vfiles[k] = { size, path, len: b64.length, mime: (b64.match(/^data:([^;]+)/) || [])[1] }; window.__calls.push('visualPut:' + k); return path; },
};
window.__visual = []; window.__vfiles = {};
// ---- optional Spotify connection (WebBridge.spotify*), with a MOCKED Web API: no request ever leaves the test.
// Tests flip window.__sp.connected / clientId and can override window.__spApi(method, path, body) -> {status, body}.
window.__sp = { clientId: '', connected: false }; window.__spCalls = [];
const spStatus = () => JSON.stringify({ clientId: window.__sp.clientId, validId: /^[0-9a-f]{32}$/.test(window.__sp.clientId), connected: window.__sp.connected, redirect: 'luciel://spotify-callback', scope: '' });
const img = (id, w = 300) => [{ url: 'https://i.scdn.co/image/ab67616d0000' + id, width: w, height: w }];
const tr = (n, i) => ({ id: 't' + n + i, uri: 'spotify:track:t' + n + i, name: ['Neon Rain', 'Starlit Avenue', 'Pastel Hearts', 'Overdrive', 'Moonlight Arcade', 'City of Glass', 'Velvet Static', 'Afterglow'][i % 8] + (i >= 8 ? ' ' + i : ''), artists: [{ name: ['Neon Arcade', 'Lumen', 'Kiyomi', 'Night Drive'][i % 4] }], album: { name: 'Album ' + (i % 3 + 1), images: img('a' + (i % 6), 300) }, duration_ms: 200000 + i * 1000, is_local: false, type: 'track' });
window.__spFixtures = {
  playlists: [['p1', 'Late Night Drive', 'pj', 42], ['p2', 'Synthwave Essentials', 'Spotify', 120], ['p3', 'Gym Bangers', 'pj', 31], ['p4', 'Lo-fi Study', 'pj', 64], ['p5', 'Road Trip 2026', 'pj', 18]]
    .map(([id, name, owner, total]) => ({ id, name, uri: 'spotify:playlist:' + id, owner: { id: owner.toLowerCase(), display_name: owner }, images: img(id, 640), items: { total }, external_urls: { spotify: 'https://open.spotify.com/playlist/' + id } })),
  tracks: (n, k) => Array.from({ length: k }, (_, i) => tr(n, i)),
};
window.__spApi = (m, path, body) => {
  if (!window.__sp.connected) return { status: 401, body: { error: { status: 401, message: 'not connected' } } };
  const F = window.__spFixtures, u = new URL('https://api.spotify.com/v1' + path), p = u.pathname.replace('/v1', '');
  if (m === 'GET' && p === '/me/playlists') return { status: 200, body: { items: F.playlists, total: F.playlists.length, next: null } };
  if (m === 'GET' && p === '/me/tracks') { const off = +u.searchParams.get('offset') || 0; const all = F.tracks('L', 60); return { status: 200, body: { items: all.slice(off, off + 50).map((t) => ({ added_at: '2026-10-01T00:00:00Z', track: t })), total: 60, next: off + 50 < 60 ? 'next' : null } }; }
  if (m === 'GET' && p === '/me/player/recently-played') return { status: 200, body: { items: F.tracks('R', 8).map((t, i) => ({ track: t, played_at: new Date(Date.now() - i * 6e5).toISOString() })) } };
  let mm;
  if (m === 'GET' && (mm = /^\/playlists\/([^/]+)\/items$/.exec(p))) {
    if (mm[1] === 'p2') return { status: 403, body: { error: { status: 403, message: 'Forbidden' } } };   // not owned: Feb-2026 rule
    return { status: 200, body: { items: F.tracks(mm[1], 12).map((t) => ({ added_at: '2026-10-01T00:00:00Z', item: t })), total: 12, next: null } };
  }
  if (m === 'GET' && p === '/search') {
    const q = (u.searchParams.get('q') || '').toLowerCase(), lim = +u.searchParams.get('limit');
    if (lim > 10) return { status: 400, body: { error: { status: 400, message: 'Invalid limit' } } };
    const ts = F.tracks('S', 10).map((t) => Object.assign(t, { name: t.name + ' (' + q + ')' }));
    return { status: 200, body: { tracks: { items: ts }, artists: { items: [{ id: 'a1', uri: 'spotify:artist:a1', name: 'Neon Arcade', images: img('ar1', 160) }, null] }, playlists: { items: [null, F.playlists[1]] }, albums: { items: [{ id: 'al1', uri: 'spotify:album:al1', name: 'Retrowave Nights', artists: [{ name: 'Neon Arcade' }], images: img('al1') }] } } };
  }
  if (m === 'PUT' && p === '/me/player/play') return window.__spPlay ? window.__spPlay(body) : { status: 204, body: null };
  if (m === 'GET' && p === '/me/player/devices') return { status: 200, body: { devices: window.__spDevices || [] } };
  return { status: 404, body: { error: { status: 404, message: 'mock: no route ' + m + ' ' + p } } };
};
Object.assign(window.LucielAndroid, {
  spotifyStatus: spStatus,
  spotifySetClientId: (id) => { const t = id.trim().toLowerCase(); if (t && !/^[0-9a-f]{32}$/.test(t)) return JSON.stringify({ error: 'format' }); if (t !== window.__sp.clientId) window.__sp.connected = false; window.__sp.clientId = t; window.__calls.push('spotifySetClientId'); return spStatus(); },
  spotifyConnect: () => { window.__calls.push('spotifyConnect'); return /^[0-9a-f]{32}$/.test(window.__sp.clientId) ? 'opened' : 'no-client-id'; },
  spotifyDisconnect: () => { window.__calls.push('spotifyDisconnect'); window.__sp.connected = false; },
  spotifyApi: (id, m, path, body) => { window.__spCalls.push(m + ' ' + path); let r; try { r = window.__spApi(m, path, body ? JSON.parse(body) : null); } catch (e) { r = { status: 500, body: null }; } res(id, true, Object.assign({ retryAfter: 0 }, r)); },
});
