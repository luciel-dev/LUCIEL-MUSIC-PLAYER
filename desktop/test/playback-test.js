// Real playback regression test (desktop): opens real files of every format and checks the music keeps playing.
//   xvfb-run -a -s "-screen 0 1920x1080x24" node test/playback-test.js      (SECS=30 for the long run)
const { _electron } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.LUCIEL_EXE || path.join(ROOT, 'dist/linux-unpacked/luciel');
const MEDIA = process.env.MEDIA || '/workspace/aero-player-test/media';
const SECS = +process.env.SECS || 12;
const UD = '/tmp/luciel-pb/userdata';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync('/tmp/luciel-pb', { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true });
  const files = fs.readdirSync(MEDIA).filter((f) => /\.(mp3|m4a|flac|ogg|wav|opus|webm|aac)$/i.test(f)).map((f) => path.join(MEDIA, f));
  const app = await _electron.launch({ executablePath: EXE, args: ['--no-sandbox', files[0]], env: { ...process.env, LUCIEL_TEST: '1', LUCIEL_USER_DATA: UD } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (/\[luciel:audio\]/.test(t) || m.type() === 'error') console.log('   console:', t.slice(0, 300)); if (m.type() === 'error' && !/GL Driver/.test(t)) errors.push(t); });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('   pageerror:', e.message); });
  await page.waitForFunction(() => window.AeroAmp && window.AeroAmp.engine, null, { timeout: 30000 });
  // record every pause with its stack, so a stray pause() call is found by its caller
  await page.evaluate(() => {
    const a = window.AeroAmp.engine.audio; window.__pauses = [];
    const orig = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () { if (this === window.AeroAmp.engine.audio) window.__pauses.push({ t: this.currentTime, src: (this.src || '').slice(-40), stack: new Error().stack.split('\n').slice(2, 7).join(' | ') }); return orig.call(this); };
    a.addEventListener('pause', () => window.__pauses.push({ ev: 'pause', t: a.currentTime }));
    a.addEventListener('error', () => window.__pauses.push({ ev: 'error', code: a.error && a.error.code }));
  });
  await page.evaluate((fs_) => window.AeroAmp.nativeOpen(fs_), files);
  await page.waitForFunction((n) => window.AeroAmp.tracks.length >= n, files.length, { timeout: 20000 }).catch(() => {});
  const tracks = await page.evaluate(() => window.AeroAmp.tracks.map((t) => t.name));
  console.log('tracks', tracks.join(', '));
  for (let i = 0; i < tracks.length; i++) {
    await page.evaluate((i) => { window.__pauses.length = 0; window.AeroAmp.playTrack(window.AeroAmp.tracks[i]); }, i);
    const t0 = Date.now(); let last = 0, stalls = 0;
    const secs = i === 0 ? Math.max(SECS, 10) : Math.min(SECS, 10);
    while (Date.now() - t0 < secs * 1000) {
      await sleep(1000);
      const s = await page.evaluate(() => { const a = window.AeroAmp.engine.audio; return { t: a.currentTime, paused: a.paused, cur: window.AeroAmp.current && window.AeroAmp.current.name }; });
      if (s.paused) break;
      if (s.t <= last) stalls++; last = s.t;
    }
    const r = await page.evaluate(() => { const a = window.AeroAmp.engine.audio; return { t: +a.currentTime.toFixed(1), paused: a.paused, dur: a.duration, cur: window.AeroAmp.current && window.AeroAmp.current.name, pauses: window.__pauses }; });
    const want = Math.min(secs - 2, (r.dur || 99) - 1);
    ok((!r.paused || r.t >= r.dur - 0.5) && r.t >= want, `${tracks[i]}: keeps playing for ${secs}s (t=${r.t}/${(r.dur || 0).toFixed(1)}, paused=${r.paused}, now=${r.cur})` + (r.pauses.length ? '\n      pauses: ' + JSON.stringify(r.pauses) : ''));
  }
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await app.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
