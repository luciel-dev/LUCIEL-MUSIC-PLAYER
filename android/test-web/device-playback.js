// REAL playback on an Android device/emulator (debug build): attaches to the app's WebView over CDP and plays the
// phone's own music files through the real native bridge (MediaStore, PlaybackService, audio focus, media session).
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>; PW=... node test-web/device-playback.js
// Fails if a song stops on its own before SECS seconds; prints every pause with its reason and the native debug log.
const { chromium } = require(process.env.PW || '/tmp/pw134/node_modules/playwright-core');
const SECS = +process.env.SECS || 30, PORT = process.env.CDP || 9333;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = browser.contexts()[0].pages().find((p) => /index\.html/.test(p.url())) || browser.contexts()[0].pages()[0];
  console.log('attached', page.url());
  page.on('console', (m) => { if (/luciel:audio/.test(m.text())) console.log('   ', m.text()); });
  await page.waitForFunction(() => window.Luciel && window.Luciel.app && window.Luciel.app.tracks.length > 0, null, { timeout: 120000 });
  const names = await page.evaluate(() => window.Luciel.app.tracks.map((t) => t.name));
  console.log('library:', names.join(', '));
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (let i = 0; i < names.length; i++) {
    if (only && !only.test(names[i])) continue;
    await page.evaluate((i) => { const A = window.Luciel.app; window.__p = []; const a = A.engine.audio;
      if (!a.__hooked) { a.__hooked = 1; a.addEventListener('pause', () => window.__p.push({ t: +a.currentTime.toFixed(2), why: A.engine.lastPauseReason || '?' })); a.addEventListener('error', () => window.__p.push({ err: a.error && a.error.code })); }
      A.playTrack(A.tracks[i]); }, i);
    const secs = only ? SECS : (i === 0 ? SECS : 12);
    const t0 = Date.now(); let r;
    while (Date.now() - t0 < secs * 1000) {
      await sleep(2000);
      r = await page.evaluate(() => { const A = window.Luciel.app, a = A.engine.audio; return { t: +a.currentTime.toFixed(1), paused: a.paused, cur: A.current && A.current.name, dur: a.duration, p: window.__p }; });
      if (r.paused && r.t < (r.dur || 1e9) - 0.5) break;
    }
    const want = Math.min(secs - 3, (r.dur || 1e9) - 1);
    ok(r.t >= want, `${names[i]}: played ${r.t}s of ${secs}s wanted (paused=${r.paused}, now=${r.cur})` + (r.p.length ? ' pauses=' + JSON.stringify(r.p) : ''));
  }
  const log = await page.evaluate(() => window.LucielAndroid && LucielAndroid.debugLog ? LucielAndroid.debugLog() : '(no native log)');
  console.log('--- native debug log (tail)\n' + log.split('\n').slice(-40).join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
