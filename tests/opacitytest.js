// Lucielle must always be drawn fully opaque: no see-through flicker, no transparent dip during pose <-> dance <-> emote
// crossfades, and nothing that reveals the scene (synthwave floor grid) drawn over her. Hooks the stage canvas and, per
// frame, computes her coverage = 1 - prod(1 - alpha) over all character draws, plus whether the grid is stroked after her.
// Aero (#stage) and Classic pixel (#pxStage), core scenes + the Lucielle Styles pack (incl. emote crossfades).
// URL=<app> (default http://localhost:8765/)  STYLES=<zip>  SHOTS=<dir>
const { chromium } = require(process.env.PW || '/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media'), SHOTS = process.env.SHOTS || '/tmp/luc/opacity-shots';
const ZIP = process.env.STYLES || '/workspace/luciel-dist/lucielle-styles-pack.zip';
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (c) passes++; else fails++; };

/** sample `ms` of stage frames on canvas #id; `during` (optional) runs right after the hook is installed.
 *  Every Character.draw / drawPixel call is one frame of Lucielle; all images drawn inside it are hers (also when a scene
 *  style renders her to an offscreen layer first). Each layer is drawn at one alpha, so her coverage for the frame is
 *  1 - prod(1 - a) over the distinct alphas used (two layers at exactly the same alpha count once = stricter).
 *  minSolo = frames with a single layer (must be exactly 1); minCov includes crossfade frames (>= 0.85, ~0.875 by design).
 *  gridOver counts synthwave grid strokes (#ff4fd8) on the stage canvas after she was drawn in that frame. */
async function coverage(page, id, ms, during) {
  return page.evaluate(([id, ms, during]) => new Promise((res) => {
    const CP = CanvasRenderingContext2D.prototype, Ch = window.Luciel.Character.prototype;
    const stage = document.getElementById(id).getContext('2d');
    let minCov = 1, minSolo = 1, frames = 0, gridOver = 0, maxLayers = 0, inChar = false, alphas = null, after = false;
    const di = CP.drawImage, st = CP.stroke, cr = CP.clearRect, d0 = Ch.draw, p0 = Ch.drawPixel;
    const wrap = (orig) => function (g, ...a) {
      inChar = true; alphas = new Set();
      try { return orig.call(this, g, ...a); } finally {
        inChar = false;
        if (alphas.size) { frames++; let t = 1; alphas.forEach((x) => { t *= 1 - x; }); minCov = Math.min(minCov, 1 - t); if (alphas.size === 1) minSolo = Math.min(minSolo, 1 - t); maxLayers = Math.max(maxLayers, alphas.size); after = true; }
      }
    };
    Ch.draw = wrap(d0); Ch.drawPixel = wrap(p0);
    CP.drawImage = function (...a) { if (inChar && a.length >= 5) alphas.add(+this.globalAlpha.toFixed(3)); return di.apply(this, a); };
    CP.clearRect = function (...a) { if (this === stage && a[0] === 0 && a[1] === 0) after = false; return cr.apply(this, a); };
    CP.stroke = function (...a) { if (this === stage && after && /#ff4fd8/i.test(String(this.strokeStyle))) gridOver++; return st.apply(this, a); };
    if (during) (0, eval)(during);
    setTimeout(() => { CP.drawImage = di; CP.stroke = st; CP.clearRect = cr; Ch.draw = d0; Ch.drawPixel = p0;
      res({ minCov: +minCov.toFixed(3), minSolo: +minSolo.toFixed(3), frames, gridOver, maxLayers }); }, ms);
  }), [id, ms, during || '']);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  if (process.env.LUCIEL_JS) await page.route('**/js/luciel.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.LUCIEL_JS, 'utf8') })); // regression check against another build
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length >= 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 });
  const set = (skin, scene, play) => page.evaluate(([skin, scene, play]) => { const A = window.AeroAmp; A.applyTheme('aero', skin); A.setScene(scene, true); if (play) { if (!A.current) A.playTrack(A.tracks[0]); else A.engine.audio.play(); } else A.engine.audio.pause(); }, [skin, scene, play]);

  // 1) core scenes in Aero, paused (rig pose) and playing (dance loop); synthwave has the floor grid
  for (const scene of ['synthwave', 'jazz', 'mood-hype']) {
    for (const play of [false, true]) {
      await set('aero', scene, play); await page.waitForTimeout(2200);
      const c = await coverage(page, 'stage', 1500);
      ok(c.frames > 5 && c.minSolo >= 0.999 && c.minCov >= 0.85 && c.gridOver === 0, `aero ${scene} ${play ? 'playing' : 'paused'}: Lucielle opaque (solo frames ${c.minSolo}, incl. crossfades ${c.minCov}, ${c.frames} frames, grid over her ${c.gridOver})`);
    }
  }
  await page.screenshot({ path: `${SHOTS}/aero-mood-hype.png` });
  // 2) pose <-> dance crossfade (pause/play flips the layer) must not dip
  await set('aero', 'synthwave', true); await page.waitForTimeout(2200);
  let c = await coverage(page, 'stage', 1600, `setTimeout(() => window.AeroAmp.engine.audio.pause(), 100); setTimeout(() => window.AeroAmp.engine.audio.play(), 800);`);
  ok(c.frames > 5 && c.minCov >= 0.85 && c.maxLayers >= 2, `aero dance -> pose -> dance crossfades keep her solid (min coverage ${c.minCov} over ${c.frames} frames, up to ${c.maxLayers} layers/frame)`);
  await page.waitForTimeout(800);
  await page.locator('#stage').screenshot({ path: `${SHOTS}/aero-synthwave-stage.png` });
  // 3) Classic pixel stage
  await set('classic', 'synthwave', true); await page.waitForTimeout(2200);
  c = await coverage(page, 'pxStage', 1500);
  ok(c.frames > 5 && c.minSolo >= 0.999 && c.minCov >= 0.85 && c.gridOver === 0, `classic pixel synthwave playing: Lucielle opaque (solo frames ${c.minSolo}, incl. crossfades ${c.minCov}, ${c.frames} frames, grid over her ${c.gridOver})`);
  // 4) Lucielle Styles pack: each scene settled, then an emote crossfade (drop) while it plays
  await page.setInputFiles('#packZipInput', ZIP);
  await page.waitForFunction(() => window.Luciel.Scenes.list.some(s => s.id.startsWith('lucielle-styles/')), null, { timeout: 120000 });
  const ids = await page.evaluate(() => window.Luciel.Scenes.list.filter(s => s.pack === 'lucielle-styles').map(s => [s.id, s.kind]));
  for (const [id, kind] of ids) {
    const skin = kind === 'pixel' ? 'classic' : 'aero', cv = kind === 'pixel' ? 'pxStage' : 'stage', short = id.split('/')[1];
    await set(skin, id, true); await page.waitForTimeout(2500);
    c = await coverage(page, cv, 1200);
    ok(c.frames > 3 && c.minSolo >= 0.999 && c.minCov >= 0.85, `${short} [${skin}] settled: Lucielle opaque (solo frames ${c.minSolo}, incl. crossfades ${c.minCov}, ${c.frames} frames)`);
    c = await coverage(page, cv, 1500, `const L = window.AeroAmp.luciel; L.behavior.queue = []; L.behavior.reaction = null; L.musicEvent('drop');`);
    ok(c.frames > 3 && c.minCov >= 0.85 && c.minSolo >= 0.999 && (skin === 'classic' || c.maxLayers >= 2), `${short} [${skin}] drop emote crossfade: no see-through dip (min coverage ${c.minCov}, ${c.frames} frames, up to ${c.maxLayers} layers/frame)`);
    if (skin === 'aero') await page.locator('#stage').screenshot({ path: `${SHOTS}/${short}-stage.png` });
  }
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})();
