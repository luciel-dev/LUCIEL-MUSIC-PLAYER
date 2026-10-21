// 1.1.3: the native floater + Spotify card mirror Luciel's stage. Checks the page -> native "visual state" publisher
// (scene / palette / skin / outfit / visualizer, pack pictures extracted to files once), background scene following for
// Spotify, and the Spotify tab sync fixes (wall-clock position, seek guard, fresh state on show / resume, stale cover,
// tempo label, latency log). SHOTS=1 saves screenshots.
const { open } = require('./phone-lib');
const SHOTS = process.env.SHOTS ? '/workspace/luciel-android/screenshots' : '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const { browser, page, errors } = await open({ port: 8981, width: 412, height: 915 });
  const ev = (f, a) => page.evaluate(f, a);
  if (process.env.STACK) await ev(() => { window.addEventListener('error', (e) => console.log('PROBE', e.filename, e.lineno, e.colno, e.message)); window.addEventListener('unhandledrejection', (e) => console.log('PROBE rej', e.reason && e.reason.stack)); });
  const last = () => ev(() => window.__visual[window.__visual.length - 1] || null);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/1.1.3-${n}.png` }); };

  // ---- publisher: initial state
  await page.waitForFunction(() => window.__visual.length > 0, null, { timeout: 10000 }).catch(() => {});
  let v = await last();
  ok(v && v.scene && /^asset:www\/art\//.test(v.bg) && v.accent && v.palette && v.skin && v.vizMode, `page publishes its stage at start: ${v && v.scene} bg=${v && v.bg} ${v && v.palette}/${v && v.skin} viz=${v && v.vizMode}`);
  ok(v && v.char && v.char.use === 'lucielle' && v.mascotSize === 'm' && v.mascot === true, 'built-in Lucielle, size and on/off travel with it');
  ok(v && typeof v.bg2 === 'string' && v.bg2.length > 0, 'panel colour travels as bg2 (bg = the scene picture)');

  // ---- manual built-in scene + theme + viz change -> immediate updates
  await ev(() => { window.__visual.length = 0; window.Luciel.app.setScene('hiphop', true); }); await wait(page, 300);
  v = await last();
  ok(v && v.scene === 'hiphop' && v.bg === 'asset:www/art/hiphop.webp' && v.sceneName, `picking a scene updates the floating views at once (${v && v.sceneName})`);
  await ev(() => { window.__visual.length = 0; window.Luciel.app.applyTheme('red', 'aero'); }); await wait(page, 300);
  v = await last();
  const red = await ev(() => getComputedStyle(document.body).getPropertyValue('--accent').trim());
  ok(v && v.palette === 'red' && v.accent === red && !v.pixel, `palette change → floater/card colours (${v && v.accent})`);
  await ev(() => { window.__visual.length = 0; window.Luciel.app.setVizMode('scope'); }); await wait(page, 300);
  v = await last();
  ok(v && v.vizMode === 'scope', 'visualizer style follows (scope)');
  await ev(() => { window.__visual.length = 0; window.Luciel.app.applyTheme('classic', 'classic'); }); await wait(page, 300);
  v = await last();
  ok(v && v.skin === 'classic' && v.pixel === true && /^asset:www\//.test(v.bg) && v.glow === '', `Classic skin → pixel stage with the pixel background (${v && v.bg})`);
  await ev(() => { window.Luciel.app.applyTheme('red', 'aero'); window.Luciel.app.setVizMode('spectrum'); }); await wait(page, 200);
  // dedupe: no change, no message
  const n0 = await ev(() => window.__visual.length); await wait(page, 1700);
  ok((await ev(() => window.__visual.length)) === n0, 'nothing sent when nothing changed (deduped; 1.5 s safety tick is silent)');

  // ---- pack scene: Lucielle Styles (City Punk) -> pictures extracted once, outfit sheets + emotes as files
  await page.waitForFunction(() => (window.Luciel.app.packs.installed || []).some((p) => p.id === 'lucielle-styles'), null, { timeout: 60000 }).catch(() => {});
  const pid = await ev(() => { const p = (window.Luciel.app.packs.installed || []).find((x) => x.id === 'lucielle-styles'); return p ? p.scenes.map((s) => s.id.includes("/") ? s.id : `${p.id}/${s.id}`) : []; });
  const cp = pid.find((x) => /city-punk$/.test(x)) || pid[0];
  ok(!!cp, `bundled Lucielle Styles pack scenes available (${pid.join(', ')})`);
  await ev((id) => { window.__visual.length = 0; window.__calls.length = 0; window.Luciel.app.setScene(id, true); }, cp);
  await page.waitForFunction(() => { const v = window.__visual[window.__visual.length - 1]; return v && v.bg && v.char && [...Object.values(v.char.dance || {}), ...Object.values(v.char.emotes || {})].every((d) => d.file) && Object.values(v.char.stills || {}).every(Boolean) && (!v.char.idle || true); }, null, { timeout: 60000 }).catch(() => {});
  v = await last();
  const first = await ev(() => window.__visual[0]);
  const files = await ev(() => Object.assign({}, window.__vfiles));
  const dk = v ? Object.keys(v.char.dance || {}) : [];
  ok(first && first.scene === cp, `pack scene published at once (${first && first.sceneName}), pictures follow when extracted`);
  ok(v && /\/files\/visual\//.test(v.bg) && v.char.use === 'custom' && v.char.name, `pack background is an extracted file + custom outfit “${v && v.char.name}”`);
  ok(dk.length >= 1 && dk.every((k) => /\/files\/visual\//.test(v.char.dance[k].file) && v.char.dance[k].frames > 1 && v.char.dance[k].cols > 1 && v.char.dance[k].loopBpm > 0), `outfit dance sheets as files with frames/cols/loopBpm (${dk.join(', ')})`);
  const em = v ? Object.keys(v.char.emotes || {}).length + Object.keys(v.char.stills || {}).length : 0;
  ok(em > 0, `pack emotes travel too (${em})`);
  const sheetK = Object.keys(files).find((k) => /dance-/.test(k));
  ok(sheetK && files[sheetK].mime === 'image/webp' && Object.keys(files).some((k) => /\/bg-/.test(k) && files[k].mime === 'image/jpeg'), 'sheets keep transparency (webp), backgrounds are jpeg');
  // a second visit doesn't extract again
  await page.waitForFunction(() => { const v = window.__visual[window.__visual.length - 1]; return v && v.char && v.char.idle !== '' && v.glow !== undefined; }, null, { timeout: 30000 }).catch(() => {});
  await wait(page, 800);
  await ev(() => { window.__calls.length = 0; window.Luciel.app.setScene('hiphop', true); });
  await wait(page, 300);
  await ev((id) => window.Luciel.app.setScene(id, true), cp); await wait(page, 1500);
  ok(!(await ev(() => window.__calls.some((c) => /^visualPut:/.test(c)))), 'already extracted pictures are reused (no second extraction)');
  // a fresh page load (= app restart) finds them on disk via visualHas
  await shot('visual-pack-stage');
  await ev(() => window.Luciel.app.setScene('auto', true)); await wait(page, 200);

  // ---- Spotify playing while Luciel is idle and the Spotify tab is closed: the stage (and so the card) follows the song
  const SONG = { active: true, playing: true, pkg: 'com.spotify.music', app: 'Spotify', title: 'Nights Like This', artist: 'Drake', album: 'X', duration: 200, position: 10, key: 'd1', genre: 'hip hop', scene: 'hiphop', evAt: Date.now() - 40, posWall: Date.now(), speed: 1, bpm: 121, bpmSource: 'live', tempo: '♩ 121 BPM · live' };
  await ev(() => document.querySelector('#mTabs [data-tab="library"]').click()); await wait(page, 300);
  await ev((s) => { window.__visual.length = 0; window.__ext = Object.assign({}, s); window.LucielAndroidBridge.ext(Object.assign({}, s)); }, SONG); await wait(page, 400);
  v = await last();
  ok(v && v.scene === 'hiphop', `Spotify song in the background → stage + card switch to its scene (${v && v.scene})`);
  // local play gives the stage back to the user's choice
  // ---- Spotify tab: tempo label, latency log, fresh state on show
  await ev(() => { window.__fresh = 0; const o = window.LucielAndroid.extState; window.LucielAndroid.extState = () => { window.__fresh++; return o(); }; });
  await ev(() => document.querySelector('#mTabs [data-tab="spotify"]').click()); await wait(page, 500);
  ok((await ev(() => window.__fresh)) >= 1, 'opening the Spotify tab pulls a fresh state immediately');
  await ev(() => document.querySelector('#mSpotify .sp-hero, #mSpotify [data-act="now"]') && document.querySelector('#mSpotify [data-act="now"]').click()); await wait(page, 500);
  const tp = await ev(() => { const e = document.getElementById('spTempo'); return e ? { t: e.textContent, vis: !e.hidden && e.getBoundingClientRect().height > 0 } : null; });
  ok(tp && tp.vis && /♩ \d+ BPM · (live|tapped|steady)/.test(tp.t), `clear tempo label on the now page: “${tp && tp.t}”`);
  await shot('spotify-now-tempo');
  const log = await ev(() => (window.LucielDebug && window.LucielDebug.text ? window.LucielDebug.text() : (window.Luciel.app.debugText ? window.Luciel.app.debugText() : '')));
  ok(/tab: “Nights Like This” playing .*shown \d+ ms after the session event/.test(log), 'debug log has the session-event → tab latency');
  // resume pulls too
  await ev(() => { window.__fresh = 0; window.LucielAndroidBridge.visible(false); window.LucielAndroidBridge.visible(true); }); await wait(page, 200);
  ok((await ev(() => window.__fresh)) >= 1, 'coming back to the app re-reads the Spotify state at once');

  // ---- position: wall-clock extrapolation, late delivery, seek guard
  const S = await ev(() => {
    const Y = window.LucielSpotify._sync, t = 1_000_000, out = {};
    Y.base = { pos: 0, wall: 0, speed: 1, playing: false, key: '' }; Y.hold = null;
    // a state built 400 ms before it arrived: the bar must already be 0.4 s further
    Y.take({ position: 30, posWall: t - 400, playing: true, speed: 1, key: 'a' }, t); out.late = Y.at(Y.base, t);
    // 2x speed (podcasts)
    Y.take({ position: 30, posWall: t, playing: true, speed: 2, key: 'b' }, t); out.fast = Y.at(Y.base, t + 1000);
    // seek to 100 s, then a stale report from before the seek arrives: held
    Y.take({ position: 50, posWall: t, playing: true, speed: 1, key: 'c' }, t);
    Y.seek(100, t + 100); out.stale = Y.take({ position: 50.2, posWall: t + 200, playing: true, speed: 1, key: 'c' }, t + 300); out.afterStale = Y.at(Y.base, t + 300);
    out.confirm = Y.take({ position: 100.3, posWall: t + 400, playing: true, speed: 1, key: 'c' }, t + 450);
    // tiny backward jitter while playing is ignored, a real jump is not
    out.jitter = Y.take({ position: Y.at(Y.base, t + 1000) - 0.2, posWall: t + 1000, playing: true, speed: 1, key: 'c' }, t + 1000);
    out.jump = Y.take({ position: 10, posWall: t + 1100, playing: true, speed: 1, key: 'c' }, t + 1100);
    // paused: no running on
    Y.take({ position: 40, posWall: t, playing: false, speed: 1, key: 'c' }, t); out.paused = Y.at(Y.base, t + 5000);
    return out;
  });
  ok(Math.abs(S.late - 30.4) < 0.01, `late state: position runs on from when Android measured it (${S.late.toFixed(2)} s)`);
  ok(Math.abs(S.fast - 32) < 0.01, `playback speed respected (${S.fast.toFixed(2)} s after 1 s at 2×)`);
  ok(S.stale === 'held' && S.afterStale > 99.9 && S.confirm === 'moved', `seek bar doesn't jump back to a stale position (${S.stale}, ${S.afterStale.toFixed(1)} s), then follows Spotify (${S.confirm})`);
  ok(S.jitter === 'kept' && S.jump === 'moved', 'small backward jitter ignored, real jumps followed');
  ok(Math.abs(S.paused - 40) < 0.001, 'paused: the bar stands still');
  // the live bar moves smoothly (rAF while playing)
  await ev((s) => { const x = Object.assign({}, s, { position: 20, posWall: Date.now(), key: 'd2', title: 'Rich Flex' }); window.__ext = x; window.LucielAndroidBridge.ext(x); }, SONG);
  const w1 = await ev(() => document.getElementById('spFill').style.width); await wait(page, 300);
  const w2 = await ev(() => document.getElementById('spFill').style.width);
  ok(w1 !== w2, `seek bar keeps moving between session events (${w1} → ${w2})`);
  // stale cover: a new song without art shows the placeholder, not the previous song's cover
  await ev((s) => { const x = Object.assign({}, s, { key: 'd3', title: 'Jimmy Cooks', art: 'http://127.0.0.1:8981/_n/ext-art?v=7' }); window.LucielAndroidBridge.ext(x); }, SONG); await wait(page, 100);
  await ev((s) => { const x = Object.assign({}, s, { key: 'd4', title: 'Passionfruit', art: null }); window.LucielAndroidBridge.ext(x); }, SONG); await wait(page, 100);
  const cov = await ev(() => ({ src: document.getElementById('spBigCover') && document.getElementById('spBigCover').getAttribute('src'), t: document.getElementById('spNTitle').textContent }));
  ok(cov.t === 'Passionfruit' && !/ext-art\?v=7/.test(cov.src || ''), 'next song without its cover yet: placeholder, never the previous cover');

  // local play returns the stage to the user's scene choice
  await ev(() => { window.__visual.length = 0; window.Luciel.app.setScene('jazz', true); }); await wait(page, 300);
  v = await last();
  ok(v && v.scene === 'jazz', 'manual scene pick still wins and is mirrored');
  ok(!errors.length, `no page errors ${errors.join(' | ')}`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(2); });
