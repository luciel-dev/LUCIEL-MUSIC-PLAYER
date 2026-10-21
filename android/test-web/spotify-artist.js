// 1.1.5 – artist + album pages in Luciel, and tap-to-play landing in Luciel's own Now Playing on THIS phone's Spotify
// (devices -> wake in the background -> transfer -> play), Add to queue on long-press, back navigation (chevron,
// Android back, left-edge swipe). MOCKED Web API (mock-bridge.js); any request leaving 127.0.0.1 is blocked + counted.
const { open } = require('./phone-lib');
const SIZES = (process.env.SIZES == null ? '412x915,360x780' : process.env.SIZES).split(',').filter(Boolean).map((s) => s.split('x').map(Number));
const SHOTS = process.env.SHOTS ? '/workspace/luciel-android/screenshots' : '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);

async function run(W, H) {
  const tag = `${W}x${H}`;
  const { browser, ctx, page, errors } = await open({ port: 8983, width: W, height: H });
  const outside = [];
  await ctx.route((u) => !/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u.toString()), (r) => { outside.push(r.request().url()); r.abort(); });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS && W === 412) { await ev(() => document.querySelectorAll('.toast').forEach((t) => { t.className = 'toast'; })); await page.screenshot({ path: `${SHOTS}/1.1.5-${n}.png` }); } };
  const calls = () => ev(() => window.__calls.slice());
  const api = () => ev(() => window.__spCalls.slice());
  const pg = () => ev(() => document.getElementById('mSpotify').dataset.page);
  const reset = () => ev(() => { window.__calls.length = 0; window.__spCalls.length = 0; window.__spLog = { transfer: [], queue: [], shuffle: [], play: [] }; window.LucielDebug && window.LucielDebug.clear && window.LucielDebug.clear(); });
  const dbg = () => ev(() => { try { return window.LucielDebug.text ? window.LucielDebug.text() : JSON.stringify(window.LucielDebug.entries || window.LucielDebug.list || []); } catch (e) { return ''; } });
  const home = async () => { for (let i = 0; i < 6 && (await pg()) !== 'home'; i++) { await ev(() => window.LucielMobile.back()); await wait(page, 120); } };

  // connected, on the Spotify tab
  await ev(() => { window.LucielSpotify._api.wakeWait = 60; window.__sp.clientId = '0123456789abcdef0123456789abcdef'; window.__sp.connected = true; window.LucielAndroidBridge.event('spotifyAuth', { result: 'ok', status: JSON.parse(window.LucielAndroid.spotifyStatus()) }); });
  await ev(() => document.querySelector('#mTabs [data-tab="spotify"]').click()); await wait(page, 600);

  // ================= artist page from search
  await ev(() => document.querySelector('#mSpotify [data-act="search"]').click()); await wait(page, 200);
  await page.fill('#spQ', 'neon'); await wait(page, 800);
  await reset();
  await ev(() => document.querySelector('#spResults [data-it^="artist:"]').click()); await wait(page, 900);
  const ar = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, name: (document.querySelector('.sp-arhead h2') || {}).textContent, meta: (document.querySelector('.sp-armeta') || {}).textContent || '', pop: document.querySelectorAll('#spPop .sp-row').length, popTxt: (document.querySelector('#spPop .sp-row') || {}).textContent || '', chips: [...document.querySelectorAll('#spDiscTabs [data-disc]')].map((c) => c.textContent.trim()), tiles: document.querySelectorAll('#spDisc .sp-atile').length, img: (document.querySelector('.sp-arimg') || {}).naturalWidth || 0 }));
  ok(ar.page === 'artist' && ar.name === 'Neon Arcade' && ar.img > 0, `[${tag}] tapping an artist in search opens the artist page in Luciel (${ar.name}, image ${ar.img}px)`);
  ok(/synthwave, retrowave/i.test(ar.meta) && !/followers/.test(ar.meta), `[${tag}] header shows genres; followers hidden (removed for dev-mode apps)`);
  ok(ar.pop === 5 && /Hit 1/.test(ar.popTxt), `[${tag}] Popular: 5 songs, built from search because /artists/{id}/top-tracks is gone`);
  const a1 = await api();
  ok(a1.includes('GET /artists/a1') && a1.includes('GET /artists/a1/top-tracks') && a1.some((c) => c === 'GET /search?type=track&limit=10&q=' + encodeURIComponent('artist:"Neon Arcade"')), `[${tag}] uses /artists/{id}, tries top-tracks once, falls back to search artist:"name" (limit 10)`);
  ok(['album', 'single', 'compilation'].every((g) => a1.some((c) => c.startsWith(`GET /artists/a1/albums?include_groups=${g}&limit=20&offset=0`))), `[${tag}] discography via /artists/{id}/albums per include_groups (album, single, compilation)`);
  ok(ar.chips.join('|') === 'Albums 26|Singles & EPs 6' && ar.tiles === 20, `[${tag}] Discography chips (${ar.chips.join(' / ')}) – empty Compilations hidden; cover grid shows 20`);
  await ev(() => document.querySelector('#spArtist [data-act="popMore"]').click()); await wait(page, 100);
  ok(await ev(() => document.querySelectorAll('#spPop .sp-row').length === 10), `[${tag}] Popular "Show more" → 10`);
  await ev(() => document.querySelector('#spDisc [data-act="discMore"]').click()); await wait(page, 400);
  ok(await ev(() => document.querySelectorAll('#spDisc .sp-atile').length === 26 && !document.querySelector('#spDisc [data-act="discMore"]')), `[${tag}] Discography pages (offset) to all 26 albums`);
  await ev(() => document.querySelector('#spDiscTabs [data-disc="single"]').click()); await wait(page, 200);
  const sg = await ev(() => [...document.querySelectorAll('#spDisc .sp-atile span')].map((x) => x.textContent));
  ok(sg.length === 6 && sg.some((x) => /Single/.test(x)) && sg.some((x) => /EP/.test(x)), `[${tag}] Singles & EPs tab (${sg.slice(0, 2).join(', ')}…)`);
  await ev(() => document.querySelector('#spDiscTabs [data-disc="album"]').click()); await wait(page, 300);
  await ev(() => { document.getElementById('mSpotify').scrollTop = 0; }); await wait(page, 300);
  await shot('artist');
  await ev(() => { const d = document.getElementById('spDisc'); document.getElementById('mSpotify').scrollTop = d.offsetTop - 120; }); await wait(page, 400);
  await shot('artist-discography');
  const y0 = await ev(() => document.getElementById('mSpotify').scrollTop);

  // ================= album page
  await reset();
  await ev(() => document.querySelector('#spDisc .sp-atile').click()); await wait(page, 700);
  const al = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, head: (document.querySelector('.sp-alhead') || {}).textContent || '', rows: document.querySelectorAll('#spAlbum .sp-tracklist .sp-row').length, nums: [...document.querySelectorAll('#spAlbum .sp-num')].slice(0, 3).map((n) => n.textContent).join(','), dur: (document.querySelector('#spAlbum .sp-dur') || {}).textContent, feat: [...document.querySelectorAll('#spAlbum .sp-tracklist .sp-row')][4].textContent, solo: [...document.querySelectorAll('#spAlbum .sp-tracklist .sp-row')][0].querySelector('.sp-txt span'), e: !!document.querySelector('#spAlbum .sp-e'), cover: (document.querySelector('.sp-alhead img') || {}).naturalWidth || 0 }));
  ok(al.page === 'album' && /Retrowave Nights/.test(al.head) && /Neon Arcade/.test(al.head) && /Album · 2026 · 20\+ songs/.test(al.head) && al.cover > 0, `[${tag}] album page: cover, title, artist, type · year · songs (${al.head.replace(/\s+/g, ' ').trim().slice(0, 60)}…)`);
  ok(al.rows === 20 && al.nums === '1,2,3' && /^3:00$/.test(al.dur) && al.e, `[${tag}] tracklist with numbers, durations, explicit tag`);
  ok(/Kiyomi/.test(al.feat) && !al.solo, `[${tag}] featured artists shown only where they differ from the album artist`);
  ok((await api()).includes('GET /albums/al-album-0'), `[${tag}] uses /albums/{id}`);
  await ev(() => document.querySelector('#spAlbum [data-act="alMore"]').click()); await wait(page, 400);
  ok(await ev(() => document.querySelectorAll('#spAlbum .sp-tracklist .sp-row').length === 21) && (await api()).some((c) => c === 'GET /albums/al-album-0/tracks?limit=50&offset=20'), `[${tag}] "More songs" pages through /albums/{id}/tracks`);
  await ev(() => { document.getElementById('mSpotify').scrollTop = 0; }); await wait(page, 200);
  await shot('album');

  // ================= tap a song: plays on this phone, lands in Luciel's Now Playing (optimistic), Spotify UI stays shut
  await ev(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); }); await wait(page, 700);
  await reset();
  await ev(() => { window.__spEchoMs = 900; document.querySelectorAll('#spAlbum .sp-tracklist .sp-row')[3].querySelector('b').click(); }); await wait(page, 120);
  const opt = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, t: document.getElementById('spNTitle').textContent, a: document.getElementById('spNArtist').textContent, img: (document.getElementById('spBigCover') || {}).getAttribute && document.getElementById('spBigCover').getAttribute('src'), sub: (document.querySelector('.sp-top-t em') || {}).textContent }));
  ok(opt.page === 'now' && opt.t === 'Overdrive' && /Neon Arcade/.test(opt.a) && /^\/_n\/img\?u=/.test(opt.img || '') && /Starting/.test(opt.sub), `[${tag}] tap → Luciel's Now Playing at once with the song's title + cover (optimistic: “${opt.t}”, ${opt.sub})`);
  await wait(page, 700);
  const pl = await ev(() => window.__spLog.play.slice(-1)[0]);
  ok(pl && pl.device === 'phone1' && pl.body.context_uri === 'spotify:album:al-album-0' && pl.body.offset.uri === 'spotify:track:tXal-album-0-3', `[${tag}] PUT /me/player/play?device_id=<this phone> with the album context + offset`);
  ok(await ev(() => window.__spLog.transfer.length === 1 && window.__spLog.transfer[0].device_ids[0] === 'phone1' && window.__spLog.transfer[0].play === false), `[${tag}] nothing was active → playback transferred to the phone first (PUT /me/player)`);
  const c1 = await calls();
  ok(!c1.some((c) => c.startsWith('link:') || c === 'open:spotify'), `[${tag}] Spotify's own UI is never opened`);
  ok(await ev(() => window.Luciel.app.engine.audio.paused && !!window.Luciel.app.current), `[${tag}] Luciel's own song paused (one source at a time) and stays loaded`);
  await wait(page, 600);
  const real = await ev(() => ({ t: document.getElementById('spNTitle').textContent, cover: document.getElementById('spBigCover').getAttribute('src').slice(0, 15), sub: document.querySelector('.sp-top-t em').textContent }));
  ok(real.t === 'Overdrive' && real.cover === 'data:image/jpeg' && /on Spotify/.test(real.sub), `[${tag}] then Spotify's media session takes over (same song, cached cover, “${real.sub}”)`);
  const log = await dbg();
  ok(/play 1\/4/.test(log) && /play  ?2\/4: devices/.test(log) && /play 3\/4: transfer/.test(log) && /play 4\/4: PUT \/me\/player\/play\?device_id=phone1 → 204/.test(log), `[${tag}] every step is in the Debug log`);
  await shot('now-landing');
  // artist name in Now Playing → artist page
  await ev(() => document.getElementById('spNArtist').click()); await wait(page, 600);
  ok((await pg()) === 'artist', `[${tag}] tapping the artist in Now Playing opens the artist page`);
  await ev(() => window.LucielMobile.back()); await wait(page, 200);

  // ================= back navigation: chevron, Android back, edge swipe (+ scroll kept)
  ok((await pg()) === 'now', `[${tag}] back from the artist returns to Now Playing`);
  await ev(() => document.querySelector('#mSpotify .sp-top [data-act="back"]').click()); await wait(page, 200);
  ok((await pg()) === 'album', `[${tag}] chevron: Now Playing → album`);
  await ev(() => window.LucielAndroidBridge.back()); await wait(page, 250);
  const y1 = await ev(() => document.getElementById('mSpotify').scrollTop);
  ok((await pg()) === 'artist' && Math.abs(y1 - y0) < 4, `[${tag}] Android back: album → artist, scroll position kept (${Math.round(y1)}px)`);
  await page.mouse.move(4, 400); await page.mouse.down(); await page.mouse.move(60, 402, { steps: 3 }); await page.mouse.move(W * 0.6, 405, { steps: 6 }); await page.mouse.up(); await wait(page, 350);
  ok((await pg()) === 'search', `[${tag}] left-edge swipe: artist → search`);

  // ================= a track's artist name opens the artist page
  await ev(() => document.querySelector('#spResults [data-it^="track:"] [data-ar="a2"], #spResults [data-ar]').click()); await wait(page, 700);
  ok((await pg()) === 'artist', `[${tag}] tapping a song's artist name opens that artist`);
  // Play / Shuffle on the artist
  await reset(); await ev(() => document.querySelector('#spArtist [data-act="arShuffle"]').click()); await wait(page, 600);
  const sh = await ev(() => ({ play: window.__spLog.play.slice(-1)[0], shuffle: window.__spLog.shuffle.slice(-1)[0], page: document.getElementById('mSpotify').dataset.page }));
  ok(sh.play && /^spotify:artist:/.test(sh.play.body.context_uri) && sh.shuffle && sh.shuffle.state === 'true' && sh.shuffle.device === 'phone1' && sh.page === 'now', `[${tag}] Shuffle plays the artist on the phone with shuffle on`);
  await home();

  // ================= no device at all: wake Spotify in the background, then play – still no Spotify UI
  await ev(() => { window.__spDevices = []; window.__spWakeAdds = true; }); await reset();
  await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await wait(page, 500);
  await ev(() => document.querySelectorAll('#spList .sp-row')[0].querySelector('b').click()); await wait(page, 1200);
  const nd = await ev(() => ({ calls: window.__calls.slice(), play: window.__spLog.play.slice(-1)[0], tr: window.__spLog.transfer.length, page: document.getElementById('mSpotify').dataset.page }));
  ok(nd.calls.includes('spotifyWake') && nd.play && nd.play.device === 'phone1' && nd.tr === 1 && nd.page === 'now' && !nd.calls.some((c) => c.startsWith('link:')), `[${tag}] phone not in Spotify Connect: woke Spotify in the background, transferred, played – stayed in Luciel`);
  ok(nd.play && nd.play.body.uris && nd.play.body.uris[0] === 'spotify:track:tL0' && nd.play.body.uris.length === 50, `[${tag}] Liked Songs plays as a list of uris from the tapped song`);
  ok(/woke Spotify in the background \(media-button\)/.test(await dbg()), `[${tag}] the wake is in the Debug log`);
  await home();
  // wake doesn't help: last resort opens Spotify, with a toast
  await ev(() => { window.__spDevices = []; window.__spWakeAdds = false; window.__spPlay = () => ({ status: 404, body: { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } } }); }); await reset();
  await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await wait(page, 400);
  await ev(() => document.querySelectorAll('#spList .sp-row')[1].querySelector('b').click()); await wait(page, 1600);
  const lr = await ev(() => ({ calls: window.__calls.slice(), toast: (document.querySelector('.toast') || {}).textContent || '' }));
  ok(lr.calls.filter((c) => c.startsWith('link:spotify:track:tL1')).length === 1 && /Couldn’t wake Spotify/.test(lr.toast), `[${tag}] only when Spotify can't be woken: opens it as a last resort with a toast`);
  await ev(() => { window.__spDevices = [{ id: 'phone1', name: 'Pixel Test', type: 'Smartphone', is_active: true }]; window.__spPlay = null; window.__spWakeAdds = true; });
  await home();

  // ================= long-press → Add to queue
  await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await wait(page, 400);
  await reset();
  const r0 = await page.locator('#spList .sp-row').nth(2).boundingBox();
  await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2); await page.mouse.down(); await wait(page, 700); await page.mouse.up(); await wait(page, 300);
  const menu = await ev(() => [...document.querySelectorAll('#mSheetHost .m-mi span')].map((x) => x.textContent));
  ok(menu.includes('Add to queue') && menu.some((m) => /^Go to /.test(m)) && menu.includes('Go to album') && (await ev(() => document.getElementById('mSpotify').dataset.page)) === 'liked', `[${tag}] long-press a song → menu (${menu.join(' / ')}), nothing played`);
  await ev(() => [...document.querySelectorAll('#mSheetHost .m-mi')].find((b) => /Add to queue/.test(b.textContent)).click()); await wait(page, 300);
  const q = await ev(() => ({ q: window.__spLog.queue.slice(-1)[0], toast: (document.querySelector('.toast') || {}).textContent || '', plays: window.__spLog.play.length }));
  ok(q.q && q.q.uri === 'spotify:track:tL2' && q.q.device === 'phone1' && /Added to queue/.test(q.toast) && q.plays === 0, `[${tag}] Add to queue → POST /me/player/queue?uri=…&device_id=<phone> (“${q.toast}”)`);
  await ev(() => document.querySelectorAll('#spList .sp-row')[3].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); await wait(page, 300);
  ok(await ev(() => !document.getElementById('mSheetHost').hidden), `[${tag}] the menu also opens on contextmenu`);
  await ev(() => window.LucielMobile.closeSheet()); await home();

  // ================= missing playback scope → one-tap reconnect, no fallback to Spotify
  await ev(() => { window.__sp.missing = ['user-modify-playback-state', 'user-read-playback-state']; window.LucielSpotify._api.read(); }); await reset();
  await ev(() => window.LucielSpotify.refresh()); await wait(page, 200);
  ok(await ev(() => /Reconnect Spotify \(one tap\)/.test(document.getElementById('mSpotify').textContent)), `[${tag}] an older sign-in without playback scopes shows "Reconnect Spotify (one tap)"`);
  await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await wait(page, 400);
  await ev(() => document.querySelectorAll('#spList .sp-row')[0].querySelector('b').click()); await wait(page, 300);
  const sc = await ev(() => ({ calls: window.__calls.slice(), plays: window.__spLog.play.length }));
  ok(sc.plays === 0 && !sc.calls.some((c) => c.startsWith('link:')), `[${tag}] no play attempt and no jump to Spotify while scopes are missing`);
  await home(); await ev(() => { window.__calls.length = 0; document.querySelector('#mSpotify [data-act="reconnect"]').click(); });
  ok((await calls()).includes('spotifyConnect'), `[${tag}] Reconnect is one tap (straight to Spotify's consent page)`);
  await ev(() => { window.__sp.missing = []; window.LucielAndroidBridge.event('spotifyAuth', { result: 'ok', status: JSON.parse(window.LucielAndroid.spotifyStatus()) }); }); await wait(page, 300);
  ok(await ev(() => !/Reconnect Spotify/.test(document.getElementById('mSpotify').textContent)), `[${tag}] after reconnecting the card goes away`);

  ok(!outside.length, `[${tag}] no request left the test machine (${outside.length}${outside.length ? ': ' + outside.slice(0, 3).join(', ') : ''})`);
  ok(!errors.length, `[${tag}] no page errors ${errors.join(' | ')}`);
  await browser.close();
}

(async () => {
  for (const [w, h] of SIZES) await run(w, h);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(2); });
