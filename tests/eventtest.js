// music-event detection on real audio: a synthetic track with one quiet / hit / drop / rise / vocals section each,
// played through the app with the Lucielle Styles pack; every event must fire once inside its window and show its emote.
const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const { execFileSync } = require('child_process'); const path = require('path');
const ZIP = process.env.STYLES || '/workspace/luciel-dist/lucielle-styles-pack.zip', WAV = '/tmp/luc/evmedia/events-test.wav';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  require('fs').mkdirSync(path.dirname(WAV), { recursive: true }); execFileSync('python3', [path.join(__dirname, 'gen_eventtrack.py'), WAV]);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#packZipInput', ZIP);
  await page.waitForFunction(() => !/Reading/.test(document.getElementById('pkMsg').innerText), null, { timeout: 120000 });
  await page.setInputFiles('#fileInput', WAV);
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 1 && window.AeroAmp.tracks[0].meta, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const A = window.AeroAmp, L = A.luciel; A.setScene('lucielle-styles/city-punk', true); const t0 = performance.now(); A.playTrack(A.tracks[0]);
    const shown = new Set();
    while (A.engine.audio.currentTime < 33.5 && performance.now() - t0 < 45000) { await new Promise(r => setTimeout(r, 200)); const l = L.layer; if (l && /emote-/.test(l.name)) shown.add(l.name.split('emote-')[1]); }
    return { ev: L.eventLog.filter(e => e.t >= t0), shown: [...shown] };
  });
  console.log('events:', r.ev.map(e => `${e.evt}@${e.at}`).join(' '), '| emotes shown:', r.shown.join(','));
  const win = { start: [0, 0.5], quiet: [2, 6.5], hit: [9.8, 11], drop: [13.8, 15.5], rise: [20.5, 26], vocals: [24.5, 33] };
  for (const [e, [a, b]] of Object.entries(win)) { const hits = r.ev.filter(x => x.evt === e); ok(hits.length >= 1 && hits.every(x => x.at >= a && x.at <= b), `${e} detected in ${a}–${b}s: ${hits.map(x => x.at).join(',') || 'none'}`); }
  ok(!r.ev.some(x => x.evt === 'quiet' && x.at > 7), 'no false "quiet" during the bass-only groove / drop');
  for (const n of ['happy', 'yawn', 'shocked', 'headbang', 'clap']) ok(r.shown.includes(n), `emote ${n} shown on stage`);
  ok(!errors.length, 'no page errors ' + errors.join('|'));
  await browser.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
