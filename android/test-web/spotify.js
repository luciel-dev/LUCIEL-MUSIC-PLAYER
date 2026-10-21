// Spotify tab tests (phone layout, Android): home/empty/setup states, deep-link search + recent searches, recently played
// capture/filter, quick picks, Spotify-style now playing (seek/transport), one-source-at-a-time switching, mini source badge,
// overlay toggle/mode/pop-out, back navigation, tab fit. Runs at 360x780 and 412x915. SHOTS=1 saves screenshots.
const fs = require('fs');
const { open } = require('./phone-lib');
const SIZES = (process.env.SIZES == null ? '360x780,412x915' : process.env.SIZES).split(',').filter(Boolean).map((s) => s.split('x').map(Number));
const SHOTS = process.env.SHOTS ? '/workspace/luciel-android/screenshots' : '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);
const SONG = { active: true, playing: true, pkg: 'com.spotify.music', app: 'Spotify', title: 'Midnight City Drive', artist: 'Neon Arcade', album: 'Retrowave Nights', duration: 241, position: 42, key: 'k1' };

async function run(W, Hh) {
  const tag = `${W}x${Hh}`;
  const { browser, page, errors } = await open({ port: 8979, width: W, height: Hh });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/1.1.2-${n}-${W}.png` }); };
  const calls = () => ev(() => window.__calls.slice());
  const clear = () => ev(() => { window.__calls.length = 0; });
  const vis = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

  // ---- tabs
  const tabs = await ev(() => [...document.querySelectorAll('#mTabs button')].map((b) => ({ t: b.dataset.tab, l: b.textContent.trim(), clip: b.querySelector('span').scrollWidth > b.querySelector('span').clientWidth + 1, w: b.getBoundingClientRect().width })));
  ok(tabs.length === 5 && tabs.map((t) => t.t).join() === 'player,library,spotify,visuals,settings', `[${tag}] five tabs on Android: ${tabs.map((t) => t.l).join(' / ')}`);
  ok(tabs.every((t) => !t.clip && t.w >= 44), `[${tag}] every tab label fits (no clipping) and every tab is ≥44px wide`);

  // ---- empty state, nothing playing
  await ev(() => document.querySelector('#mTabs [data-tab="spotify"]').click()); await wait(page, 600);
  const e0 = await ev(() => ({ empty: !!document.querySelector('#mSpotify .sp-empty'), txt: (document.querySelector('#mSpotify .sp-empty') || {}).textContent || '', quick: document.querySelectorAll('#mSpotify .sp-hs [data-quick]').length, hint: !!document.querySelector('#mSpotify .sp-hint'), extUse: window.__calls.includes('extUse:true'), attr: /trademark of Spotify AB/.test(document.getElementById('mSpotify').textContent) }));
  ok(e0.empty && /Nothing playing/.test(e0.txt) && e0.hint, `[${tag}] friendly empty state when nothing plays + recently played hint`);
  ok(e0.quick === 4, `[${tag}] Quick picks shelf (Liked Songs, Daily Mix, Discover Weekly, Release Radar)`);
  ok(e0.extUse && e0.attr, `[${tag}] opening the tab turns on Spotify-driven visuals; attribution text shown`);
  await shot('spotify-empty');
  await clear(); await ev(() => document.querySelector('#mSpotify .sp-empty [data-act="openSpotify"]').click());
  ok((await calls()).includes('open:spotify'), `[${tag}] empty state "Open Spotify" opens the app`);
  // nothing playing: play opens Spotify rather than doing nothing
  await clear(); await ev(() => window.LucielSpotify.cmd('toggle'));
  ok((await calls()).includes('open:spotify'), `[${tag}] play with no Spotify session opens Spotify`);

  // ---- setup card when notification access is missing
  await ev(() => { window.__perms.listener = false; window.LucielAndroidBridge.perms(Object.assign({}, window.__perms)); }); await wait(page, 200);
  const su = await ev(() => ({ card: !!document.querySelector('#mSpotify .sp-setup [data-act="listener"]'), empty: !!document.querySelector('#mSpotify .sp-empty') }));
  ok(su.card && !su.empty, `[${tag}] inline setup card when notification access is off`);
  await shot('spotify-setup');
  await clear(); await ev(() => document.querySelector('#mSpotify [data-act="listener"]').click());
  ok((await calls()).includes('open:listener'), `[${tag}] setup card opens the notification-access screen`);
  await ev(() => { window.__perms.listener = true; window.__perms.overlay = false; window.LucielAndroidBridge.perms(Object.assign({}, window.__perms)); }); await wait(page, 200);
  ok(await ev(() => !document.querySelector('#mSpotify .sp-setup') && !!document.querySelector('#mSpotify [data-act="overlayPerm"]')), `[${tag}] setup card goes away once allowed; overlay permission note shows when "Display over other apps" is off`);
  await ev(() => { window.__perms.overlay = true; window.LucielAndroidBridge.perms(Object.assign({}, window.__perms)); });

  // ---- a Spotify song starts playing
  await ev((s) => { window.__ext = Object.assign({}, s); window.LucielAndroidBridge.ext(Object.assign({}, s)); }, SONG); await wait(page, 700);
  const h1 = await ev(() => ({ hero: (document.querySelector('#mSpotify .sp-hero') || {}).textContent || '', grid: document.querySelectorAll('#mSpotify .sp-gtile').length, cards: document.querySelectorAll('#mSpotify .sp-card').length, hist: JSON.parse(localStorage.getItem('luciel.sp.history') || '[]') }));
  ok(/Midnight City Drive/.test(h1.hero) && /Neon Arcade/.test(h1.hero) && /Now playing on Spotify/i.test(h1.hero), `[${tag}] now-playing hero shows the media-session song`);
  ok(h1.grid === 1 && h1.cards === 1 && h1.hist.length === 1 && h1.hist[0].title === 'Midnight City Drive' && h1.hist[0].at > 0, `[${tag}] song captured into Recently played (grid + shelf + stored with time)`);
  // more songs: history keeps order, dedupes, counts plays
  await ev(async () => {
    const songs = [['Ocean Lights', 'Pastel Waves'], ['Starfall', 'Neon Arcade'], ['Paper Planes', 'Kite Club'], ['Ocean Lights', 'Pastel Waves']];
    for (const [i, [t, a]] of songs.entries()) { window.__ext = { active: true, playing: true, pkg: 'com.spotify.music', app: 'Spotify', title: t, artist: a, duration: 200, position: 0, key: 'k' + (i + 2) }; window.LucielAndroidBridge.ext(Object.assign({}, window.__ext)); await new Promise((r) => setTimeout(r, 120)); }
  }); await wait(page, 500);
  const h2 = await ev(() => JSON.parse(localStorage.getItem('luciel.sp.history') || '[]').map((t) => t.title + ':' + (t.plays || 1)));
  ok(h2.length === 4 && h2[0] === 'Ocean Lights:2', `[${tag}] recently played dedupes and counts plays, newest first (${h2.join(', ')})`);
  ok(await ev(() => document.querySelectorAll('#mSpotify .sp-gtile').length === 4 && document.querySelectorAll('#mSpotify .sp-card').length === 4), `[${tag}] home grid + shelf refresh as songs change`);
  await shot('spotify-home');
  await ev(() => document.getElementById('mSpotify').scrollTo(0, 99999)); await wait(page, 200); await shot('spotify-home-overlay');
  await ev(() => document.getElementById('mSpotify').scrollTo(0, 0));

  // ---- quick picks deep links
  await clear(); await ev(() => document.querySelector('#mSpotify [data-quick="liked"]').click()); await ev(() => document.querySelector('#mSpotify [data-quick="discover"]').click());
  const ql = await calls();
  ok(ql.includes('link:spotify:collection:tracks|https://open.spotify.com/collection/tracks') && ql.includes('link:spotify:search:Discover%20Weekly|https://open.spotify.com/search/Discover%20Weekly'), `[${tag}] quick picks open Spotify deep links (with web fallback)`);
  // tapping a recently played song finds it in Spotify
  await clear(); await ev(() => document.querySelector('#mSpotify .sp-card').click());
  ok((await calls()).some((c) => c === 'link:spotify:search:Ocean%20Lights%20Pastel%20Waves|https://open.spotify.com/search/Ocean%20Lights%20Pastel%20Waves'), `[${tag}] tapping a recent song searches Spotify for title + artist`);

  // ---- search page
  await ev(() => document.querySelector('#mSpotify [data-act="search"]').click()); await wait(page, 300);
  ok(await ev(() => document.getElementById('mSpotify').dataset.page === 'search' && !!document.getElementById('spQ') && document.querySelectorAll('#mSpotify .sp-qgrid [data-quick]').length === 4), `[${tag}] search page opens with Browse tiles`);
  await page.fill('#spQ', 'neon'); await wait(page, 200);
  const sr = await ev(() => ({ go: (document.querySelector('#mSpotify [data-act="searchGo"]') || {}).textContent || '', rows: [...document.querySelectorAll('#spResults .sp-row[data-track]')].map((r) => r.querySelector('b').textContent) }));
  ok(/Search Spotify for “neon”/.test(sr.go) && sr.rows.length === 2 && sr.rows.includes('Starfall') && sr.rows.includes('Midnight City Drive'), `[${tag}] typing shows "Search Spotify for…" + matching recently played rows (${sr.rows.join(', ')})`);
  await ev(() => document.querySelector('#mSpotify [data-filter="artists"]').click()); await wait(page, 150);
  ok(await ev(() => document.querySelectorAll('#spResults [data-artist]').length === 1 && /2 songs/.test(document.querySelector('#spResults [data-artist]').textContent)), `[${tag}] Artists filter groups by artist`);
  await shot('spotify-search');
  await clear(); await page.focus('#spQ'); await page.keyboard.press('Enter'); await wait(page, 200);
  const sq = await calls();
  ok(sq.includes('link:spotify:search:neon|https://open.spotify.com/search/neon'), `[${tag}] Enter opens spotify:search:<query> (web fallback open.spotify.com/search)`);
  await page.fill('#spQ', 'lofi beats'); await ev(() => document.querySelector('#mSpotify [data-act="searchGo"]').click()); await wait(page, 100);
  await page.fill('#spQ', ''); await wait(page, 150);
  const rs = await ev(() => [...document.querySelectorAll('#spResults .sp-recent b')].map((b) => b.textContent));
  ok(rs.join('|') === 'lofi beats|neon', `[${tag}] recent searches remembered, newest first (${rs.join(', ')})`);
  await shot('spotify-search-recent');
  await ev(() => document.querySelector('#spResults [data-rmq="neon"]').click()); await wait(page, 100);
  ok(await ev(() => [...document.querySelectorAll('#spResults .sp-recent b')].map((b) => b.textContent).join() === 'lofi beats'), `[${tag}] a recent search can be removed`);
  await ev(() => document.querySelector('#spResults .sp-recent').click()); await wait(page, 150);
  ok(await ev(() => document.getElementById('spQ').value === 'lofi beats'), `[${tag}] tapping a recent search fills the box`);
  ok(await ev(() => window.LucielMobile.back() !== false) && await ev(() => document.getElementById('mSpotify').dataset.page === 'home'), `[${tag}] back returns from search to the Spotify home`);
  ok(await ev(() => document.querySelectorAll('#mSpotify .sp-chips [data-q]').length >= 1), `[${tag}] "Your searches" shelf on the home page`);

  // ---- history page
  await ev(() => document.querySelector('#mSpotify [data-act="history"]').click()); await wait(page, 250);
  const hp = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, rows: document.querySelectorAll('#spHList .sp-row').length, time: /\d{1,2}:\d{2}/.test(document.getElementById('spHList').textContent) }));
  ok(hp.page === 'history' && hp.rows === 4 && hp.time, `[${tag}] Recently played page lists songs with time`);
  await page.fill('#spHQ', 'pastel'); await wait(page, 120);
  ok(await ev(() => document.querySelectorAll('#spHList .sp-row').length === 1), `[${tag}] Recently played can be filtered by text`);
  await page.fill('#spHQ', ''); await ev(() => { const h = JSON.parse(localStorage.getItem('luciel.sp.history')); h[3].at -= 10 * 864e5; localStorage.setItem('luciel.sp.history', JSON.stringify(h)); document.querySelector('#mSpotify [data-hfilter="week"]').click(); }); await wait(page, 120);
  ok(await ev(() => document.querySelectorAll('#spHList .sp-row').length === 3), `[${tag}] "This week" filter drops older songs`);
  await shot('spotify-history');
  await ev(() => window.LucielMobile.back());

  // ---- now playing (Spotify style)
  await ev((s) => { window.__ext = Object.assign({}, s); window.LucielAndroidBridge.ext(Object.assign({}, s)); }, SONG); await wait(page, 300);
  await ev(() => document.querySelector('#mSpotify .sp-hero').click()); await wait(page, 300);
  const np = await ev(() => ({ page: document.getElementById('mSpotify').dataset.page, t: document.getElementById('spNTitle').textContent, a: document.getElementById('spNArtist').textContent, cover: !!document.getElementById('spBigCover').src, seek: !document.getElementById('spSeek').hidden, dur: document.getElementById('spDur').textContent }));
  ok(np.page === 'now' && np.t === 'Midnight City Drive' && /Neon Arcade/.test(np.a) && np.cover && np.seek && /^-3:/.test(np.dur), `[${tag}] Spotify-style now playing: big cover, title, artist, seek bar (${np.dur})`);
  await shot('spotify-now-cover');
  await clear();
  await ev(() => document.querySelector('#mSpotify [data-act="next"]').click()); await ev(() => document.querySelector('#mSpotify [data-act="prev"]').click());
  await ev(() => document.getElementById('spBigPlay').click()); await wait(page, 150);
  const tc = await calls();
  ok(tc.includes('ext:next') && tc.includes('ext:prev') && tc.includes('ext:toggle'), `[${tag}] transport buttons go to Spotify's media session`);
  ok(await ev(() => !window.LucielExt.state.playing && /M6 4|play/i.test(document.getElementById('spBigPlay').innerHTML) !== null), `[${tag}] play/pause reflects the paused state`);
  const box = await page.locator('#spSeek .sp-bar').boundingBox();
  await clear(); await page.mouse.move(box.x + box.width * 0.5, box.y + 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.75, box.y + 2, { steps: 4 }); await page.mouse.up(); await wait(page, 100);
  const sk = (await calls()).find((c) => c.startsWith('ext:seek:'));
  ok(sk && Math.abs(+sk.split(':')[2] - 181) <= 3, `[${tag}] dragging the seek bar seeks Spotify (${sk})`);
  // Lucielle view borrows the stage, and gives it back
  await ev(() => document.querySelector('#mSpotify [data-view="lucielle"]').click()); await wait(page, 500);
  const lv = await ev(() => ({ inside: !!document.querySelector('#spStage #stageWrap, #spStage .px-stage-frame'), h: document.getElementById('spNowArt').getBoundingClientRect().height }));
  ok(lv.inside && lv.h > 150, `[${tag}] "Lucielle" view shows the dancing stage inside the Spotify player (${Math.round(lv.h)}px)`);
  await ev((s) => { window.__ext = Object.assign({}, s); window.LucielAndroidBridge.ext(Object.assign({}, s)); }, SONG); await wait(page, 600);
  await shot('spotify-now-lucielle');
  await ev(() => window.LucielMobile.back()); await wait(page, 200);
  ok(await ev(() => !document.querySelector('#spStage') && !!document.querySelector('#mShell .m-player #stageWrap, #mShell .m-player .px-stage-frame')), `[${tag}] leaving the player puts the stage back on the Playing tab`);
  await ev(() => { document.querySelector('#mSpotify .sp-hero').click(); }); await wait(page, 200);
  ok(await ev(() => !!document.getElementById('spStage')), `[${tag}] the Cover/Lucielle choice is remembered`);
  await ev(() => document.querySelector('#mSpotify [data-view="cover"]').click()); await ev(() => window.LucielMobile.back()); await wait(page, 100);

  // ---- overlay controls
  await clear();
  await ev(() => { const c = document.querySelector('#mSpotify [data-act="overlay"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await ev(() => document.querySelector('#mSpotify [data-mode="bubble"]').click());
  await ev(() => document.querySelector('#mSpotify .sp-group [data-act="popout"]').click());
  const oc = await calls();
  ok(oc.includes('overlayCard:off') && oc.includes('overlayCard:show') && (await ev(() => window.__prefs.overlayMode)) === 'bubble', `[${tag}] overlay toggle, mode picker (Bubble) and Pop out reach Android`);
  ok(await ev(() => document.querySelector('#mSpotify [data-mode="bubble"]').classList.contains('on')), `[${tag}] chosen overlay style highlighted`);

  // ---- one source at a time
  // Spotify playing, then the user plays a local song: Spotify gets paused through its session
  await ev((s) => { window.__ext = Object.assign({}, s); window.LucielAndroidBridge.ext(Object.assign({}, s)); }, SONG); await wait(page, 200);
  await clear();
  await ev(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); }); await wait(page, 1500);
  const s1 = await ev(() => ({ calls: window.__calls.slice(), playing: !window.Luciel.app.engine.audio.paused, src: window.LucielSpotify.activeSource(), stored: localStorage.getItem('luciel.source') }));
  if (process.env.DBGT) console.log(JSON.stringify(s1));
  ok(s1.playing && s1.calls.includes('ext:pause') && s1.src === 'local' && JSON.parse(s1.stored) === 'local', `[${tag}] playing a local song pauses Spotify (ext:pause) and makes Luciel the source`);
  const m1 = await ev(() => ({ badge: document.getElementById('mMiniSrc').textContent, sp: document.getElementById('mMini').classList.contains('src-sp'), vis: getComputedStyle(document.getElementById('mMini')).display !== 'none' }));
  ok(m1.vis && /Luciel/i.test(m1.badge) && !m1.sp, `[${tag}] mini bar shows the "Luciel" source badge on the Spotify tab`);
  await shot('spotify-mini-local');
  // now press play on the Spotify tab: local pauses, Spotify plays
  await clear(); await ev(() => document.querySelector('#mSpotify .sp-hero [data-act="toggle"]').click()); await wait(page, 300);
  const s2 = await ev(() => ({ calls: window.__calls.slice(), paused: window.Luciel.app.engine.audio.paused, src: window.LucielSpotify.activeSource(), stored: localStorage.getItem('luciel.source') }));
  if (process.env.DBGT) console.log(JSON.stringify(s2));
  ok(s2.paused && s2.calls.includes('ext:toggle') && s2.src === 'spotify' && JSON.parse(s2.stored) === 'spotify', `[${tag}] play on the Spotify tab pauses Luciel's own music; never both at once`);
  await ev(() => document.querySelector('#mTabs [data-tab="library"]').click()); await wait(page, 400);
  const m2 = await ev(() => ({ badge: document.getElementById('mMiniSrc').textContent, sp: document.getElementById('mMini').classList.contains('src-sp'), title: document.getElementById('mMiniTitle').textContent, extOff: window.__calls.includes('extUse:false') }));
  ok(m2.sp && /Spotify/i.test(m2.badge) && m2.title === 'Midnight City Drive', `[${tag}] mini bar follows Spotify with a "Spotify" badge (${m2.title})`);
  await shot('spotify-mini-spotify');
  await clear(); await ev(() => document.querySelector('#mMini [data-act="play"], #mMini .m-mini-play, #mMini button').click()); await wait(page, 150);
  ok((await calls()).some((c) => /^ext:(toggle|pause)/.test(c)) && await ev(() => window.Luciel.app.engine.audio.paused), `[${tag}] mini play/pause controls Spotify while it is the source`);
  ok(m2.extOff, `[${tag}] leaving the Spotify tab turns Spotify-driven visuals off again`);
  // persistence: reload starts on the Spotify tab
  await ev(() => sessionStorage.clear()); await page.reload({ waitUntil: 'networkidle' }); await wait(page, 800);   // a fresh app start (the tab is only kept per session)
  ok(await ev(() => document.getElementById('mShell').dataset.tab === 'spotify' && JSON.parse(localStorage.getItem('luciel.sp.history')).length === 4), `[${tag}] last source (Spotify) and recently played survive a restart`);
  // back from a sub-page with the Android back button
  await ev(() => document.querySelector('#mSpotify [data-act="search"]').click()); await wait(page, 200);
  await ev(() => window.LucielAndroidBridge.back && window.LucielAndroidBridge.back()); await wait(page, 200);
  ok(await ev(() => document.getElementById('mSpotify').dataset.page === 'home'), `[${tag}] Android back closes the search page first`);

  // ---- touch targets on the Spotify pages
  const small = await ev(() => [...document.querySelectorAll('#mSpotify button, #mSpotify .sp-row, #mSpotify .sp-toggle')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.top < innerHeight && (r.height < 36 || r.width < 36) && !e.classList.contains('sp-link'); }).map((e) => e.className + ':' + e.textContent.trim().slice(0, 14)));
  ok(!small.length, `[${tag}] Spotify tab touch targets are finger-sized ${small.join(', ')}`);
  const over = await ev(() => document.getElementById('mSpotify').scrollWidth <= document.getElementById('mSpotify').clientWidth + 1);
  ok(over, `[${tag}] no sideways overflow on the Spotify home`);
  // classic theme renders
  await ev(() => { window.Luciel.app.applyTheme ? window.Luciel.app.applyTheme('red', 'classic') : document.querySelector('#mTabs [data-tab="settings"]').click(); });
  ok(!errors.length, `[${tag}] no page errors ${errors.join(' | ')}`);
  await browser.close();
}

(async () => {
  for (const [w, h] of SIZES) await run(w, h);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(2); });
