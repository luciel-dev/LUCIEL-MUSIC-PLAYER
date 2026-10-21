// Headless smoke test of the Android web layer (Chrome, phone viewport, mocked LucielAndroid bridge).
const { chromium } = require(process.env.PW || '/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const srv = require('./server');
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../screenshots');
const PORT = 8961;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

// Is Lucielle drawn fully opaque, with nothing see-through-making over her? Hooks the stage canvas for ~frames frames:
// min globalAlpha of the character draws, and whether the floor grid is stroked after her.
async function charOpacity(page, ms = 1500) {
  // per frame: coverage = 1 - prod(1 - alpha) over the character draws (a crossfade with a solid layer underneath counts as opaque)
  return page.evaluate((ms) => new Promise((res) => {
    const cv = document.getElementById('stage'); const g = cv.getContext('2d'); const saved = {};
    let minA = 1, n = 0, gridAfter = 0, after = false, frameT = 1, frames = 0; const urls = new Set();
    const isChar = (src) => { const u = String(src && (src.currentSrc || src.src) || ''); urls.add(u.split('/').slice(-2).join('/').slice(0, 40)); return /mascot\/(dance|poses|rig|layers)\/|\/char\/|char%2F|^blob:/.test(u); };
    const endFrame = () => { if (after) { frames++; minA = Math.min(minA, 1 - frameT); } frameT = 1; after = false; };
    saved.drawImage = g.drawImage; saved.clearRect = g.clearRect; saved.stroke = g.stroke;
    g.clearRect = function (...a) { endFrame(); return saved.clearRect.apply(this, a); };
    g.drawImage = function (src, ...a) { if (isChar(src) && a.length >= 4) { n++; after = true; frameT *= 1 - g.globalAlpha; } return saved.drawImage.call(this, src, ...a); };
    g.stroke = function (...a) { if (after && /#ff4fd8/i.test(String(g.strokeStyle))) gridAfter++; return saved.stroke.apply(this, a); };
    setTimeout(() => { delete g.drawImage; delete g.clearRect; delete g.stroke; res({ minA: +minA.toFixed(3), n, frames, gridAfter, urls: [...urls].slice(0, 8) }); }, ms);
  }), ms);
}
(async () => {
  await srv.start(PORT);
  const files = fs.readdirSync(srv.MEDIA).sort();
  const media = files.map((f, i) => ({ uri: 'content://test/' + encodeURIComponent(f), url: `http://127.0.0.1:${PORT}/_n/c?u=` + encodeURIComponent('content://test/' + encodeURIComponent(f)),
    name: f, size: fs.statSync(path.join(srv.MEDIA, f)).size, mime: '', rel: 'Music/' + f, durationMs: 0, title: '', artist: 'MediaStore Artist', album: 'MediaStore Album', genre: '', art: '' }));
  const mock = fs.readFileSync(path.join(__dirname, 'mock-bridge.js'), 'utf8').replace('__MEDIA__', JSON.stringify(media));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', ...(process.env.JSFLAGS ? ['--js-flags=' + process.env.JSFLAGS] : [])] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 LucielAndroid/1.0.0' });
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise((r) => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.LucielAndroidBridge.insets(32, 0, 24, 0));

  ok(await page.evaluate(() => document.body.classList.contains('android') && document.body.classList.contains('m-ui') && window.LucielMobile.active), 'android layer active, phone layout (tabs) active');
  ok(await page.evaluate(() => { const r = document.querySelector('#mShell .m-player').getBoundingClientRect(), t = document.getElementById('mTabs').getBoundingClientRect(); return Math.round(r.top) === 32 && Math.round(innerHeight - t.bottom) === 0 && Math.round(t.height) === 60 + 24; }), 'edge-to-edge insets keep the screens clear of the status bar and the gesture bar');
  ok(await page.evaluate(() => !!window.__bars && /^#[0-9a-f]{6}$/.test(window.__bars.bg)), 'system bar colour reported to Android');

  // 1) phone library scan (auto on first launch since music access is granted)
  await page.waitForFunction(() => window.Luciel.app.lib.size >= 8 && [...window.Luciel.app.lib.values()].every((t) => t.meta), null, { timeout: 30000 });
  const lib = await page.evaluate(() => [...window.Luciel.app.lib.values()].map((t) => ({ name: t.name, lazy: !!t.file.__url, size: t.size, title: t.meta.title, artist: t.meta.artist, sup: t.supported, dur: Math.round(t.duration || 0), np: t.nativePath })));
  console.table(lib);
  ok(lib.every((t) => t.lazy && t.size > 1000 && /^content:/.test(t.np)), 'scanned songs are lazy (streamed) files with content:// paths and real sizes');
  ok(lib.filter((t) => t.title && t.title !== '').length >= 6, 'tags parsed through ranged reads (titles from the files)');
  const st1 = await (await fetch(`http://127.0.0.1:${PORT}/_stats`)).json();
  ok(st1.range > 0, `metadata read with HTTP Range requests (${st1.range} ranges, ${st1.full} full reads)`);
  ok(await page.evaluate(() => window.Luciel.app.engine.audio.paused && window.Luciel.app.tracks.length >= 8), 'scan filled the empty queue without auto-playing');

  // 2) play a lazy file
  await page.evaluate(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); });
  await page.waitForTimeout(2500);
  const play = await page.evaluate(() => { const a = window.Luciel.app.engine.audio; return { src: a.currentSrc, t: a.currentTime, paused: a.paused }; });
  ok(!play.paused && play.t > 0.5 && /\/_n\/c\?u=/.test(play.src), `lazy file plays from the stream URL (t=${play.t.toFixed(2)})`);
  const rep = await page.evaluate(() => window.__reports[window.__reports.length - 1]);
  ok(rep && rep.playing && rep.hasTrack && rep.title && rep.duration > 0, `playback state reported to the Media3 session (${rep && rep.title}, ${rep && rep.duration && rep.duration.toFixed(1)}s)`);
  await page.screenshot({ path: path.join(SHOTS, 'web-player-aero.png') });

  // 3) commands from notification / headset
  await page.evaluate(() => window.LucielAndroidBridge.cmd('pause', 0)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.Luciel.app.engine.audio.paused), 'notification "pause" pauses');
  await page.evaluate(() => window.LucielAndroidBridge.cmd('next', 0)); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.Luciel.app.current === window.Luciel.app.tracks[1] && !window.Luciel.app.engine.audio.paused), 'notification "next" skips and plays');
  await page.evaluate(() => window.LucielAndroidBridge.cmd('seek', 3000)); await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.Luciel.app.engine.audio.currentTime >= 2.9), 'seek from the lock screen');
  const vol0 = await page.evaluate(() => window.Luciel.app.engine.out ? window.Luciel.app.engine.out.gain.value : window.Luciel.app.engine.audio.volume);
  await page.evaluate(() => window.LucielAndroidBridge.cmd('duck', 1)); await page.waitForTimeout(250);
  const vd = await page.evaluate(() => window.Luciel.app.engine.out ? window.Luciel.app.engine.out.gain.value : window.Luciel.app.engine.audio.volume);
  ok(vd < vol0 * 0.5, `audio-focus duck lowers the output (${vol0.toFixed(2)} -> ${vd.toFixed(2)})`);
  await page.evaluate(() => window.LucielAndroidBridge.cmd('duck', 0)); await page.waitForTimeout(250);
  const vu = await page.evaluate(() => window.Luciel.app.engine.out ? window.Luciel.app.engine.out.gain.value : window.Luciel.app.engine.audio.volume);
  ok(Math.abs(vu - vol0) < 0.02, `un-duck restores the user's volume, not 100% (${vu.toFixed(2)})`);
  // BPM analysis for the playing lazy file
  await page.waitForFunction(() => { const c = window.Luciel.app.current; return c && c.bpmInfo; }, null, { timeout: 25000 }).catch(() => {});
  ok(await page.evaluate(() => { const c = window.Luciel.app.current; return !!(c && c.bpmInfo && c.bpmInfo.bpm > 40); }), 'BPM analysis ran for the playing phone song');
  ok(await page.evaluate(() => [...window.Luciel.app.lib.values()].filter((t) => t.bpmInfo).length <= 3), 'BPM analysis is not run on the whole phone library in the background');

  // 4) back gesture
  await page.evaluate(() => document.getElementById('btnTheme').click()); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.LucielAndroidBridge.back() === true), 'back closes an open panel');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => [...document.querySelectorAll('.overlay')].every((o) => o.hidden)), 'panel closed');
  ok(await page.evaluate(() => window.LucielAndroidBridge.back() === false), 'back with nothing open goes to Android (app moves to background)');

  // 5) pickers go through Android (no in-page copies)
  await page.evaluate(() => document.getElementById('folderInput').click()); await page.waitForTimeout(500);
  ok(await page.evaluate(() => window.__calls.includes('pickFolder:true')), '"Add folder" opens the Android folder picker');

  // 6) tag editor output for a phone file -> Android writeFile (+ back to a lazy file)
  const w = await page.evaluate(async () => {
    const A = window.Luciel.app, t = A.tracks[0];
    const blob = new Blob([new Uint8Array(12345)]);
    const r = await window.LucielFS.save(t, blob, 'New Name.mp3');
    return { r, writes: window.__writes, lazy: !!t.file.__url, mode: window.LucielFS.mode(t), calls: window.__calls };
  });
  ok(w.mode === 'native' && w.writes.length === 1 && w.writes[0].len === 12345 && w.calls.includes('rename:New Name.mp3') && w.lazy, 'tag editor saves into the phone file through Android (bytes + rename), track streams again');

  // 6a) Lucielle is opaque on the normal phone stage (synthwave: floor grid must be under her)
  await page.evaluate(() => window.Luciel.app.luciel.setManual('synthwave')); await page.waitForTimeout(1500);
  await page.locator('#stageWrap').scrollIntoViewIfNeeded();
  const op1 = await charOpacity(page); if (op1.minA < 0.999 || !op1.n) console.log(op1);
  ok(op1.n > 5 && op1.minA >= 0.999 && op1.gridAfter === 0, `Lucielle fully opaque on the phone stage, grid under her (min alpha ${op1.minA}, ${op1.n} draws, grid-over ${op1.gridAfter})`);
  await page.evaluate(() => window.Luciel.app.luciel.setManual(null));

  // 6b) bundled Lucielle Styles pack is installed on first launch (same importer as a picked .zip)
  await page.waitForFunction(() => (window.Luciel.app.packs.installed || []).some((p) => p.id === 'lucielle-styles'), null, { timeout: 60000 }).catch(() => {});
  const sp = await page.evaluate(() => { const p = (window.Luciel.app.packs.installed || []).find((x) => x.id === 'lucielle-styles'); return p ? { n: p.scenes.length, en: p.enabled, ids: p.scenes.map((s) => s.id) } : null; });
  console.log('styles pack', sp);
  ok(sp && sp.en && sp.n >= 3, `bundled Lucielle Styles pack auto-installed (${sp ? sp.n : 0} scenes)`);
  ok(await page.evaluate(() => localStorage.getItem('luciel.android.bundled.lucielle-styles') === '1'), 'bundled pack is offered only once (removal is respected)');
  if (sp) {
    const shown = await page.evaluate(async (id) => { window.Luciel.app.luciel.setManual(id); await new Promise((r) => setTimeout(r, 2500)); const L = window.Luciel.app.luciel; return L.scene && L.scene.id; }, sp.ids[0]);
    ok(shown === sp.ids[0], `pack scene shows on the phone stage (${shown})`);
    for (const id of sp.ids.filter((x) => !/pixel/.test(x))) {
      await page.evaluate((id) => window.Luciel.app.luciel.setManual(id), id); await page.waitForTimeout(1800);
      const o = await charOpacity(page, 1200); if (o.minA < 0.999 || !o.n) console.log(o);
      ok(o.n > 3 && o.minA >= 0.999, `Styles pack ${id.split('/')[1]}: Lucielle fully opaque (min alpha ${o.minA}, ${o.n} draws)`);
    }
    await page.evaluate((id) => window.Luciel.app.luciel.setManual(id), sp.ids[0]); await page.waitForTimeout(1500);
    await page.evaluate(() => { scrollTo(0, 0); document.body.scrollTop = 0; document.querySelectorAll('.app,.win-main').forEach((e) => { e.scrollTop = 0; }); }); await page.waitForTimeout(400);
    await page.locator('#stageWrap').scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, 'web-styles-pack-scene.png') });
    await page.evaluate(() => window.Luciel.app.luciel.setManual(null));
  }

  // 7) settings sheet
  await page.evaluate(() => { window.LucielMobile.setTab('settings'); document.querySelector('#mSettings [data-go="__phone"]').click(); }); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.getElementById('andOverlay').hidden), 'Phone & Spotify sheet opens');
  ok(await page.evaluate(() => /Lucielle Styles[^<]*<b class="and-ok">/.test(document.getElementById('andBody').innerHTML)), 'sheet lists the Styles pack as installed');
  await page.screenshot({ path: path.join(SHOTS, 'web-android-sheet.png') });
  await page.evaluate(() => { const c = document.querySelector('[data-p="spotifyOnly"]'); c.click(); });
  ok(await page.evaluate(() => window.__prefs.spotifyOnly === true), 'sheet toggles are saved natively (Spotify only)');
  await page.evaluate(() => window.LucielAndroidBridge.back()); await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.LucielAndroidBridge.back() === true && window.LucielMobile.tab === 'player'), 'back from the Settings tab returns to Now Playing');

  // 8) outside player (Spotify) -> chip, then auto scene mode when Luciel is idle
  await page.evaluate(() => window.Luciel.app.engine.audio.pause());
  await page.evaluate(() => { window.__ext = { active: true, pkg: 'com.spotify.music', app: 'Spotify', spotify: true, title: 'Midnight City Drive', artist: 'Neon Arcade', album: 'Retrowave Nights', genre: 'synthwave', duration: 241, position: 42, playing: true, key: 'k1', art: '/_n/ext-art?v=1', tint: { accent: '#ff3fa4', accent2: '#7a5cff', bg: '#1a0b1f', family: 'red' }, scene: 'synthwave' }; window.LucielAndroidBridge.ext(window.__ext); });
  await page.waitForTimeout(1200);
  // phone layout: Spotify never takes over the Playing tab; it has its own tab
  ok(await page.evaluate(() => !window.LucielExt.on && !document.body.classList.contains('ext-mode') && document.getElementById('mShell').dataset.tab === 'player'), 'Spotify playing while Luciel is idle -> no surprise takeover of the Playing tab (phone layout)');
  await page.evaluate(() => document.querySelector('#mTabs [data-tab="spotify"]').click());
  await page.waitForTimeout(2500);
  const ext = await page.evaluate(() => ({ on: window.LucielExt.on, bpm: window.Luciel.app.tracker.bpm, src: window.Luciel.app.tracker.source, scene: window.Luciel.app.luciel.scene && window.Luciel.app.luciel.scene.id, layer: window.Luciel.app.luciel.layer, title: (document.querySelector('#mSpotify .sp-hero') || {}).textContent || '', use: window.__calls.includes('extUse:true'), viz: window.Luciel.app.vizBig.an === window.LucielExt.analyser }));
  console.log(ext);
  ok(ext.on && ext.use, 'Spotify tab -> Spotify-driven visuals on');
  ok(Math.abs(ext.bpm - 128) < 1 && ext.src === 'tag', 'beat grid follows the Android beat engine (128 BPM)');
  ok(ext.scene === 'synthwave', 'scene picked from the Spotify track (synthwave)');
  ok(ext.layer && (ext.layer.kind === 'dance' || ext.layer.kind === 'pose'), `Lucielle on stage (${ext.layer && ext.layer.kind}:${ext.layer && ext.layer.name})`);
  ok(/Midnight City Drive/.test(ext.title) && ext.viz, 'Spotify tab shows the Spotify song; visualizers bound to outside audio');
  await page.evaluate(() => { localStorage.setItem('luciel.sp.nowView', JSON.stringify('lucielle')); document.querySelector('#mSpotify .sp-hero').click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const v = document.querySelector('#mSpotify [data-view="lucielle"]'); if (v && !v.classList.contains('on')) v.click(); });
  await page.waitForTimeout(2500);   // let the stage move + any dance crossfade settle
  const op2 = await charOpacity(page); if (op2.minA < 0.999) console.log(op2);
  ok(op2.n > 5 && op2.minA >= 0.999 && op2.gridAfter === 0, `Spotify player (Lucielle view): Lucielle fully opaque, grid under her (min alpha ${op2.minA}, ${op2.n} draws, grid-over ${op2.gridAfter})`);
  await page.waitForTimeout(1500);   // let the scene settle before the screenshot
  await page.screenshot({ path: path.join(SHOTS, 'web-spotify-mode.png') });
  await page.evaluate(() => document.querySelector('#mSpotify [data-act="next"]').click());
  ok(await page.evaluate(() => window.__calls.includes('ext:next')), 'next button mirrors to Spotify through the MediaController');
  await page.evaluate(() => { window.__perms.mic = false; window.LucielAndroidBridge.perms(Object.assign({}, window.__perms)); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#mSpotify [data-act="tap"]').click());
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => Math.abs(window.Luciel.app.tracker.bpm - 124) < 1), 'tap tempo (no mic) goes to Android; the dance grid follows the tapped 124 BPM');
  await page.evaluate(() => { window.__perms.mic = true; window.LucielAndroidBridge.perms(Object.assign({}, window.__perms)); });
  ok(await page.evaluate(() => window.LucielAndroidBridge.back() === true && document.getElementById('mSpotify').dataset.page === 'home' && window.LucielAndroidBridge.back() === true && !window.LucielExt.on && document.getElementById('mShell').dataset.tab === 'player'), 'back walks the Spotify pages, then leaves the tab (visuals back to Luciel)');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('extChip')).display === 'none' && getComputedStyle(document.getElementById('extPanel')).display === 'none'), 'old Spotify chip/panel hidden in the phone layout (the tab replaces them)');
  ok(await page.evaluate(() => { window.LucielAndroidBridge.extMode(true); return document.getElementById('mShell').dataset.tab === 'spotify' && window.LucielExt.on; }), '"Spotify mode" (notification / overlay) opens the Spotify tab');
  await page.screenshot({ path: path.join(SHOTS, 'web-spotify-chip.png') });
  await page.evaluate(() => { window.__calls.length = 0; const A = window.Luciel.app; A.playTrack(A.tracks[2]); }); await page.waitForTimeout(800);
  ok(await page.evaluate(() => !window.LucielExt.on && window.__calls.includes('ext:pause')), 'playing a local song pauses Spotify and the stage follows Luciel again');
  await page.evaluate(() => document.querySelector('#mTabs [data-tab="player"]').click());

  // 9) classic skin + other palettes on a phone
  for (const [pal, skin] of [['blue', 'classic'], ['slime', 'aero'], ['red', 'classic']]) {
    await page.evaluate(([p, s]) => window.Luciel.app.applyTheme(p, s), [pal, skin]); await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, `web-player-${skin}-${pal}.png`) });
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(wide <= 413, `no sideways scrolling on a 412px phone (scrollWidth ${wide})`);

  // 10) restore after restart: library comes back as lazy files and still plays
  await page.evaluate(() => window.Luciel.app.applyTheme('aero', 'aero'));
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const rest = await page.evaluate(() => [...window.Luciel.app.lib.values()].map((t) => ({ lazy: !!(t.file && t.file.__url), size: t.size })));
  ok(rest.length >= 8 && rest.every((t) => t.lazy && t.size > 0), `library restored from IndexedDB as streamed files (${rest.length})`);
  await page.evaluate(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); }); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => window.Luciel.app.engine.audio.currentTime > 0.3), 'restored song plays');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
