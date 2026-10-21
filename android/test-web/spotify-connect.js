// 1.1.4 – the Spotify tab and Luciel's player kept apart, covers cached per song, and the optional "Connect Spotify"
// (user's own Client ID, PKCE natively) with a MOCKED Web API (mock-bridge.js). Every request outside 127.0.0.1 is
// blocked and counted: the suite fails if anything tries to reach Spotify. SHOTS=1 saves screenshots.
const { open, srv } = require('./phone-lib');
const SIZES = (process.env.SIZES == null ? '412x915,360x780' : process.env.SIZES).split(',').filter(Boolean).map((s) => s.split('x').map(Number));
const SHOTS = process.env.SHOTS ? '/workspace/luciel-android/screenshots' : '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);
const SONG = { active: true, playing: true, pkg: 'com.spotify.music', app: 'Spotify', title: 'asphyxia', artist: 'Cö shu Nie', album: 'PURE', duration: 245, position: 30, key: 'spotify|asphyxia|Cö shu Nie', art: null };

async function run(W, H) {
  const tag = `${W}x${H}`;
  const { browser, ctx, page, errors } = await open({ port: 8981, width: W, height: H });
  const outside = [];
  await ctx.route((u) => !/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u.toString()), (r) => { outside.push(r.request().url()); r.abort(); });
  const ev = (f, a) => page.evaluate(f, a);
  await page.evaluate(() => { window.LucielSpotify._api.wakeWait = 60; });
  const shot = async (n) => { if (SHOTS && W === 412) await page.screenshot({ path: `${SHOTS}/1.1.4-${n}.png` }); };
  const calls = () => ev(() => window.__calls.slice());
  const api = () => ev(() => window.__spCalls.slice());
  const ext = (s) => ev((x) => { window.__ext = Object.assign({}, x); window.LucielAndroidBridge.ext(Object.assign({}, x)); }, s);
  const tab = (t) => ev((x) => document.querySelector(`#mTabs [data-tab="${x}"]`).click(), t);
  const imgOk = (sel) => ev((s) => [...document.querySelectorAll(s)].map((i) => ({ src: i.getAttribute('src') || '', w: i.naturalWidth, done: i.complete })), sel);

  // ================= 1. kept apart: pj's exact case – a local song loaded, Spotify playing, Spotify now page open
  await ev(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); }); await wait(page, 900);
  await ev(() => window.Luciel.app.engine.audio.pause()); await wait(page, 200);
  await tab('library'); await wait(page, 300);
  ok(await ev(() => !document.getElementById('mMini').hidden && document.getElementById('mMiniTitle').textContent === window.Luciel.app.title(window.Luciel.app.current)), `[${tag}] Library tab: the mini bar shows Luciel's own (paused) song`);
  await tab('spotify'); await wait(page, 500);
  await ext(Object.assign({}, SONG, { art: '/_n/ext-art?v=1' })); await wait(page, 600);
  const k1 = await ev(() => { const m = document.getElementById('mMini'); return { hidden: m.hidden || m.getBoundingClientRect().height === 0, cls: document.body.classList.contains('m-has-mini'), localStill: !!window.Luciel.app.current }; });
  ok(k1.hidden && !k1.cls && k1.localStill, `[${tag}] Spotify tab: no Luciel mini bar on top of it (local song still loaded underneath, untouched)`);
  await ev(() => document.querySelector('#mSpotify .sp-hero').click()); await wait(page, 300);
  await ev(() => document.querySelector('#mSpotify [data-view="lucielle"]').click()); await wait(page, 700);
  const k2 = await ev(() => { const sp = document.getElementById('mSpotify').getBoundingClientRect(), tabs = document.getElementById('mTabs').getBoundingClientRect(), m = document.getElementById('mMini'); return { gap: Math.round(tabs.top - sp.bottom), miniH: Math.round(m.getBoundingClientRect().height), page: document.getElementById('mSpotify').dataset.page }; });
  ok(k2.page === 'now' && k2.miniH === 0 && Math.abs(k2.gap) <= 2, `[${tag}] Spotify now page (Lucielle view) runs right down to the tab bar – the mini bar's space is given back (gap ${k2.gap}px)`);
  await shot('spotify-now-no-mini');
  // Spotify actions never touch Luciel's queue/song (only the existing pause rule)
  const before = await ev(() => ({ id: window.Luciel.app.current && window.Luciel.app.current.id, n: window.Luciel.app.tracks.length, t: window.Luciel.app.engine.audio.currentTime }));
  await ev(() => { document.querySelector('#mSpotify [data-act="next"]').click(); document.querySelector('#mSpotify [data-act="prev"]').click(); }); await wait(page, 200);
  const after = await ev(() => ({ id: window.Luciel.app.current && window.Luciel.app.current.id, n: window.Luciel.app.tracks.length, t: window.Luciel.app.engine.audio.currentTime, paused: window.Luciel.app.engine.audio.paused }));
  ok(before.id === after.id && before.n === after.n && Math.abs(before.t - after.t) < 0.05 && after.paused, `[${tag}] Spotify next/prev leave Luciel's song, queue and position exactly as they were`);
  await ev(() => document.querySelector('#mSpotify [data-view="cover"]').click()); await wait(page, 200);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  // and the other way: playing Luciel's song while on the Spotify tab -> still no mini bar there; on other tabs it is Luciel's
  await ev(() => window.Luciel.app.engine.audio.play()); await wait(page, 500);
  ok(await ev(() => document.getElementById('mMini').hidden), `[${tag}] Luciel playing while the Spotify tab is open: still no mini bar over the Spotify tab`);
  await ev(() => window.Luciel.app.engine.audio.pause()); await wait(page, 100);

  // ================= 2. covers: the 1.1.3 hero bug (picture replaced before it loaded) – slow cover + many updates
  await ev(() => { localStorage.removeItem('luciel.sp.covers'); window.LucielSpotify._covers.mem.clear(); window.LucielSpotify._covers.disk = {}; });
  const S2 = Object.assign({}, SONG, { title: 'Juicy', artist: 'Kiyomi', key: 'spotify|Juicy|Kiyomi', art: '/_n/ext-art?v=7&delay=500' });
  for (let i = 0; i < 10; i++) { await ext(Object.assign({}, S2, { position: 30 + i * 0.25 })); await wait(page, 60); }   // playback ticks during the load
  await wait(page, 900);
  const hero = await imgOk('#mSpotify .sp-hero img');
  ok(hero.length === 1 && /^data:image\/jpeg/.test(hero[0].src) && hero[0].w > 0, `[${tag}] hero cover shows (cached ${hero[0] && hero[0].src.slice(0, 22)}…, ${hero[0] && hero[0].w}px) although the state was re-sent 10× while it loaded`);
  const extArtLoads = await ev(() => fetch('/_stats').then((r) => r.json()).then((s) => s.extArt));
  const grid = await ev(() => { const im = document.querySelector('#mSpotify .sp-gtile img[data-ck="com.spotify.music|Juicy|Kiyomi"]'); return im ? { src: im.getAttribute('src').slice(0, 15), w: im.naturalWidth } : null; });
  ok(grid && grid.src === 'data:image/jpeg' && grid.w > 0, `[${tag}] the recent grid tile shows the same cached cover`);
  const shelf = await ev(() => { const im = document.querySelector('#mSpotify .sp-card img[data-ck="com.spotify.music|Juicy|Kiyomi"]'); return im ? im.getAttribute('src').slice(0, 15) : ''; });
  ok(shelf === 'data:image/jpeg', `[${tag}] the Recently played shelf shows it too`);
  const hist = await ev(() => JSON.parse(localStorage.getItem('luciel.sp.history')).find((t) => t.title === 'Juicy'));
  ok(hist && /^data:image\/jpeg/.test(hist.art), `[${tag}] the history entry got the cover once it arrived`);
  await shot('spotify-hero-cover');
  await ev(() => document.querySelector('#mSpotify .sp-hero').click()); await wait(page, 300);
  const big = await imgOk('#spBigCover');
  ok(big.length && big[0].src === hero[0].src && big[0].w > 0, `[${tag}] now-playing Cover view shows the same picture`);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  await ev(() => window.LucielMobile.back && window.LucielSpotify._go('history')); await wait(page, 200);
  ok(await ev(() => { const im = document.querySelector('#spHList img[data-ck="com.spotify.music|Juicy|Kiyomi"]'); return !!im && /^data:image\/jpeg/.test(im.getAttribute('src')); }), `[${tag}] Recently played page shows it`);
  await ev(() => window.LucielMobile.back()); await wait(page, 150);
  // back to a song we've seen: cover at once, from the cache, no new load
  const n0 = (await ev(() => fetch('/_stats').then((r) => r.json()))).extArt;
  await ext(Object.assign({}, SONG, { title: 'This Time', artist: 'Lumen', key: 'spotify|This Time|Lumen', art: null })); await wait(page, 300);
  const ph = await imgOk('#mSpotify .sp-hero img');
  ok(ph.length && ph[0].src && !/ext-art/.test(ph[0].src) && ph[0].w > 0, `[${tag}] a song with no picture at all gets the themed Lucielle placeholder, never an empty box`);
  await ext(Object.assign({}, S2, { art: '/_n/ext-art?v=8' })); await wait(page, 120);
  const back = await imgOk('#mSpotify .sp-hero img');
  ok(back.length && back[0].src === hero[0].src, `[${tag}] coming back to a song shows its cached cover immediately`);
  ok(await ev(() => Object.keys(JSON.parse(localStorage.getItem('luciel.sp.covers') || '{}')).includes('com.spotify.music|Juicy|Kiyomi')), `[${tag}] covers are cached per song across restarts (luciel.sp.covers)`);
  if (process.env.DBGT) console.log('ext-art loads', extArtLoads, n0);

  // ================= 3. not connected: everything as before + a tasteful connect card
  const c0 = await ev(() => ({ card: (document.querySelector('#mSpotify .sp-connect') || {}).textContent || '', ext: [...document.querySelectorAll('#mSpotify .sp-quick.is-ext')].map((q) => q.dataset.quick), extTxt: (document.querySelector('#mSpotify .sp-quick.is-ext .sp-ext') || {}).textContent || '', pls: !!document.getElementById('spPls') }));
  ok(/Connect Spotify to load your playlists here/.test(c0.card) && !c0.pls, `[${tag}] not connected: "Connect Spotify to load your playlists here" card, no playlists shelf`);
  ok(c0.ext.join() === 'daily,discover,radar' && /Opens in Spotify/.test(c0.extTxt), `[${tag}] Daily Mix / Discover Weekly / Release Radar are labelled "Opens in Spotify"`);
  await ev(() => { window.__calls.length = 0; document.querySelector('#mSpotify [data-quick="liked"]').click(); });
  ok((await calls()).some((c) => c.startsWith('link:spotify:collection:tracks')), `[${tag}] not connected: Liked Songs still opens in Spotify (as before)`);

  // ================= 4. Settings › Spotify › Client ID
  await tab('settings'); await wait(page, 300);
  const row = await ev(() => { const b = document.querySelector('#mSettings [data-go="__spAccount"]'); return b ? b.textContent : ''; });
  ok(/Spotify account/.test(row) && /Optional/.test(row), `[${tag}] Settings has a Spotify section with "Spotify account · Client ID"`);
  await ev(() => document.querySelector('#mSettings [data-go="__spAccount"]').click()); await wait(page, 400);
  const acc = await ev(() => ({ tab: document.getElementById('mShell').dataset.tab, page: document.getElementById('mSpotify').dataset.page, txt: document.getElementById('mSpotify').textContent, field: !!document.getElementById('spCid') }));
  ok(acc.tab === 'spotify' && acc.page === 'account' && acc.field && /luciel:\/\/spotify-callback/.test(acc.txt) && /developer\.spotify\.com\/dashboard/.test(acc.txt) && /Web API/.test(acc.txt), `[${tag}] the Spotify account page: Client ID field + the step-by-step guide with the redirect URI`);
  ok(!/[0-9a-f]{32}/.test(acc.txt), `[${tag}] no Client ID is built in`);
  await shot('spotify-account');
  await ev(() => { window.__calls.length = 0; document.querySelector('#mSpotify [data-act="connect"]').click(); });
  ok(!(await calls()).includes('spotifyConnect'), `[${tag}] Connect without a Client ID asks for one first`);
  await page.fill('#spCid', 'not-a-client-id'); await ev(() => document.getElementById('spCid').dispatchEvent(new Event('change', { bubbles: true })));
  ok(/doesn’t look like a Client ID/.test(await ev(() => document.getElementById('spCidNote').textContent)) && (await ev(() => window.__sp.clientId)) === '', `[${tag}] a wrong Client ID is refused with a friendly note`);
  await page.fill('#spCid', '  0123456789ABCDEF0123456789abcdef '); await ev(() => { window.__calls.length = 0; document.querySelector('#mSpotify [data-act="connect"]').click(); }); await wait(page, 100);
  ok((await ev(() => window.__sp.clientId)) === '0123456789abcdef0123456789abcdef' && (await calls()).includes('spotifyConnect'), `[${tag}] a pasted Client ID is saved (trimmed) and Connect opens Spotify's sign-in`);
  // Spotify's page -> luciel://spotify-callback -> Android exchanges the code -> event
  await ev(() => { window.__sp.connected = true; window.LucielAndroidBridge.event('spotifyAuth', { result: 'ok', status: JSON.parse(window.LucielAndroid.spotifyStatus()) }); }); await wait(page, 800);

  // ================= 5. connected home
  const h = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, card: !!document.querySelector('#mSpotify .sp-connect'), pls: [...document.querySelectorAll('#spPls .sp-card')].map((c) => c.textContent), recent: document.querySelectorAll('#spRecent .sp-card').length }));
  ok(h.page === 'home' && !h.card && h.pls.length === 5 && /Late Night Drive/.test(h.pls[0]) && /pj/.test(h.pls[0]), `[${tag}] connected: back home with "Your playlists" (${h.pls.length}) and no connect card`);
  ok(h.recent === 8, `[${tag}] connected: Recently played comes from Spotify (${h.recent})`);
  await ev(() => document.getElementById('spPls').scrollIntoView({ block: 'center' })); await wait(page, 700);
  const covers = await ev(() => [...document.querySelectorAll('#spPls .sp-card img')].map((i) => { const r = i.getBoundingClientRect(); return { src: i.getAttribute('src') || '', w: i.naturalWidth, seen: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight }; }));
  // (off-screen cards are lazy: they load as the shelf scrolls)
  ok(covers.length === 5 && covers.every((c) => /^\/_n\/img\?u=https%3A%2F%2Fi\.scdn\.co/.test(c.src)) && covers.filter((c) => c.seen).length >= 2 && covers.filter((c) => c.seen).every((c) => c.w > 0), `[${tag}] playlist covers load (through /_n/img, Spotify CDN only; ${covers.filter((c) => c.seen && c.w > 0).length} on screen loaded)`);
  ok((await api()).some((c) => c.startsWith('GET /me/playlists')) && (await api()).some((c) => c.startsWith('GET /me/player/recently-played')), `[${tag}] home asked the (mocked) Web API for /me/playlists and /me/player/recently-played`);
  await ev(() => { const y = document.getElementById('spPls'); document.getElementById('mSpotify').scrollTop = y.offsetTop - 260; }); await wait(page, 200);
  if (SHOTS) await ev(() => document.querySelectorAll('.toast').forEach((t) => { t.className = 'toast'; }));
  await shot('spotify-connected-home');
  await ev(() => { document.getElementById('mSpotify').scrollTop = 0; });

  // ================= 6. a playlist page + play through the Web API
  await ev(() => document.querySelector('#spPls .sp-card').click()); await wait(page, 500);
  const pl = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, rows: document.querySelectorAll('#spList .sp-row').length, head: (document.querySelector('.sp-plhead') || {}).textContent || '' }));
  ok(pl.page === 'playlist' && pl.rows === 12 && /Late Night Drive/.test(pl.head) && /12 songs/.test(pl.head), `[${tag}] playlist page lists its songs in Luciel (${pl.rows})`);
  ok((await api()).some((c) => /^GET \/playlists\/p1\/items\?limit=50/.test(c)), `[${tag}] uses the 2026 endpoint /playlists/{id}/items`);
  await wait(page, 300);
  await shot('spotify-playlist');
  // local song playing -> tapping a song: Luciel pauses (one source), Spotify plays the song in the playlist's context
  await ev(() => window.Luciel.app.engine.audio.play()); await wait(page, 400);
  let played = null; await ev(() => { window.__spPlay = (b) => { window.__played = b; return { status: 204, body: null }; }; window.__calls.length = 0; document.querySelectorAll('#spList .sp-row')[2].click(); }); await wait(page, 300);
  played = await ev(() => window.__played);
  ok(played && played.context_uri === 'spotify:playlist:p1' && played.offset && played.offset.uri === 'spotify:track:tp12', `[${tag}] tapping a song plays it in the playlist (PUT /me/player/play context_uri + offset)`);
  ok(await ev(() => document.getElementById('mSpotify').dataset.page === 'now'), `[${tag}] …and lands on Luciel's own Now Playing`);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  ok(await ev(() => window.Luciel.app.engine.audio.paused && !!window.Luciel.app.current), `[${tag}] …and pauses Luciel's own music, which stays loaded`);
  ok(!(await calls()).some((c) => c.startsWith('link:')), `[${tag}] Premium: no jump to the Spotify app`);
  await ev(() => { window.__played = null; document.querySelector('#mSpotify [data-act="playCtx"]').click(); }); await wait(page, 200);
  ok((await ev(() => window.__played && window.__played.context_uri)) === 'spotify:playlist:p1', `[${tag}] Play on the playlist header plays the whole playlist`);
  await ev(() => { if (document.getElementById('mSpotify').dataset.page === 'now') window.LucielMobile.back(); }); await wait(page, 200);
  // Free account: 403 PREMIUM_REQUIRED -> deep link with a friendly note
  await ev(() => { window.__spPlay = () => ({ status: 403, body: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } } }); window.__calls.length = 0; document.querySelectorAll('#spList .sp-row')[0].click(); }); await wait(page, 300);
  ok((await calls()).some((c) => c.startsWith('link:spotify:track:tp10|https://open.spotify.com/track/tp10')), `[${tag}] Free account: falls back to opening the song in Spotify`);
  await ev(() => { if (document.getElementById('mSpotify').dataset.page === 'now') window.LucielMobile.back(); }); await wait(page, 200);
  // nothing active: 404 NO_ACTIVE_DEVICE -> wake the phone's device and retry
  await ev(() => { let n = 0; window.__spDevices = [{ id: 'dev-phone', is_active: false, type: 'Smartphone', name: 'Pixel' }]; window.__spPlay = (b) => (n++ ? (window.__played = b, { status: 204, body: null }) : { status: 404, body: { error: { status: 404, message: 'No active device', reason: 'NO_ACTIVE_DEVICE' } } }); window.__spCalls.length = 0; window.__calls.length = 0; document.querySelectorAll('#spList .sp-row')[1].click(); }); await wait(page, 400);
  const dv = await api();
  ok(dv.includes('GET /me/player/devices') && dv.some((c) => c === 'PUT /me/player/play?device_id=dev-phone') && !(await calls()).some((c) => c.startsWith('link:')), `[${tag}] no active device: picks the phone and retries`);
  await ev(() => { window.__spPlay = null; window.__spDevices = [{ id: 'phone1', name: 'Pixel Test', type: 'Smartphone', is_active: false }]; });
  await ev(() => { if (document.getElementById('mSpotify').dataset.page === 'now') window.LucielMobile.back(); }); await wait(page, 200);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  // a playlist you don't own (Feb-2026 rule): header + play + friendly note
  await ev(() => document.querySelectorAll('#spPls .sp-card')[1].click()); await wait(page, 500);
  const pr = await ev(() => (document.getElementById('spList') || {}).textContent || '');
  ok(/keeps this playlist’s songs to itself/.test(pr) && /Open in Spotify/.test(pr), `[${tag}] someone else's playlist (403): friendly note, Play + Open in Spotify still there`);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);

  // ================= 7. Liked Songs in-app + load more
  await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await wait(page, 500);
  const lk = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, rows: document.querySelectorAll('#spList .sp-row').length, more: !!document.querySelector('#spList [data-act="more"]') }));
  ok(lk.page === 'liked' && lk.rows === 50 && lk.more, `[${tag}] connected: Liked Songs load in Luciel (${lk.rows} + Load more)`);
  await ev(() => document.querySelector('#spList [data-act="more"]').click()); await wait(page, 400);
  ok(await ev(() => document.querySelectorAll('#spList .sp-row').length === 60 && !document.querySelector('#spList [data-act="more"]')), `[${tag}] Load more pages through the rest`);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  await ev(() => { window.__calls.length = 0; document.querySelector('#mSpotify [data-quick="discover"]').click(); });
  ok((await calls()).some((c) => c.startsWith('link:spotify:search:Discover')), `[${tag}] connected: Discover Weekly still opens in Spotify`);

  // ================= 8. in-app search
  await ev(() => document.querySelector('#mSpotify [data-act="search"]').click()); await wait(page, 200);
  await ev(() => { window.__calls.length = 0; }); await page.fill('#spQ', 'neon'); await wait(page, 800);
  const sr = await ev(() => ({ secs: [...document.querySelectorAll('#spResults .sp-sec')].map((s) => s.textContent), rows: document.querySelectorAll('#spResults [data-it]').length, links: window.__calls.filter((c) => c.startsWith('link:')).length, filt: [...document.querySelectorAll('#mSpotify [data-filter]')].map((b) => b.dataset.filter).join() }));
  ok(sr.secs.join() === 'Songs,Artists,Playlists,Albums' && sr.rows === 5 + 1 + 1 + 1 && sr.links === 0, `[${tag}] search shows results in Luciel (${sr.secs.join(' / ')}, ${sr.rows} rows, null items skipped, ${sr.links} opened in Spotify)`);
  ok((await api()).some((c) => /^GET \/search\?type=track,artist,playlist,album&limit=10&q=neon$/.test(c)), `[${tag}] search uses limit=10 (the 2026 maximum)`);
  ok(sr.filt === 'all,songs,artists,playlists', `[${tag}] search filters: All / Songs / Artists / Playlists`);
  await wait(page, 300);
  await shot('spotify-search');
  await ev(() => document.querySelector('#mSpotify [data-filter="songs"]').click()); await wait(page, 200);
  ok(await ev(() => document.querySelectorAll('#spResults [data-it^="track:"]').length === 10), `[${tag}] Songs filter shows all 10 songs`);
  await ev(() => { window.__played = null; window.__spPlay = (b) => { window.__played = b; return { status: 204, body: null }; }; document.querySelector('#spResults [data-it^="track:"] .sp-txt b').click(); }); await wait(page, 300);
  ok((await ev(() => window.__played && window.__played.uris && window.__played.uris[0])) === 'spotify:track:tS0', `[${tag}] tapping a search result plays it`);
  await ev(() => { window.__spPlay = null; window.LucielMobile.back(); }); await wait(page, 200);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);

  // ================= 9. sign-in ends / disconnect
  await ev(() => window.LucielSpotify.openAccount()); await wait(page, 200);
  ok(/Connected/.test(await ev(() => document.querySelector('.sp-acct-st').textContent)), `[${tag}] account page says Connected`);
  await ev(() => { window.confirm = () => true; document.querySelector('#mSpotify [data-act="disconnect"]').click(); }); await wait(page, 200);
  await ev(() => window.LucielMobile.back()); await wait(page, 300);
  ok(await ev(() => !!document.querySelector('#mSpotify .sp-connect') && !document.getElementById('spPls')), `[${tag}] after Disconnect the home is back to the not-connected layout`);
  await ev(() => window.LucielAndroidBridge.event('spotifyAuth', { result: 'denied', status: JSON.parse(window.LucielAndroid.spotifyStatus()) })); await wait(page, 100);

  ok(!outside.length, `[${tag}] no request left the test machine (${outside.length}${outside.length ? ': ' + outside.slice(0, 3).join(', ') : ''})`);
  ok(!errors.length, `[${tag}] no page errors ${errors.join(' | ')}`);
  await browser.close();
}

(async () => {
  for (const [w, h] of SIZES) await run(w, h);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(2); });
