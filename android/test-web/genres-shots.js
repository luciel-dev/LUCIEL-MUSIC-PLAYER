// 1.2.0 showcase screenshots at phone size (Android build, mocked bridge): Alt Rock instrument loops, a rare outfit
// (first-time sparkle), weather overlays, and frames for a 3-scene GIF. OUT=<dir> (default /workspace/lucielle/pack3/shots)
const fs = require('fs');
const { open } = require('./phone-lib');
const ZIP = process.env.GENRES || '/workspace/luciel-dist/lucielle-genres-pack.zip';
const OUT = process.env.OUT || '/workspace/lucielle/pack3/shots';
(async () => {
  fs.mkdirSync(OUT + '/gif', { recursive: true });
  const { browser, ctx, page, errors } = await open({ port: 8988, width: 412, height: 915 });
  await ctx.route((u) => !/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u.toString()), (r) => r.abort());
  await ctx.route(/\/_dl\/g\.zip/, (r) => r.fulfill({ contentType: 'application/zip', body: fs.readFileSync(ZIP) }));
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => window.LucielAndroidBridge.importPacks([{ url: '/_dl/g.zip', name: 'lucielle-genres-pack.zip' }]));
  await page.waitForFunction(() => window.Luciel.Scenes.list.filter((s) => s.pack === 'lucielle-genres').length === 5, null, { timeout: 180000 });
  const clean = () => ev(() => document.querySelectorAll('.toast').forEach((t) => { t.className = 'toast'; }));
  const shot = async (n) => { await clean(); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
  await ev(() => { const a = window.Luciel.app; a.luciel.setRng(() => 0.99); a.luciel.setDayMode('night'); a.setScene('lucielle-genres/alt-rock', true); a.playTrack(a.tracks[0]); });
  await page.waitForTimeout(3000);
  for (const k of ['guitar', 'bass', 'drums', 'vocals']) {
    await ev((k) => { const L = window.Luciel.app.luciel; L.behavior.queue = []; L.behavior.reaction = null; L.forceInstrument(k); }, k);
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(400); await ev(() => { const L = window.Luciel.app.luciel; L.behavior.queue = []; L.behavior.reaction = null; }); }
    await page.waitForTimeout(500); await shot('phone-alt-rock-' + k);
  }
  await ev(() => window.Luciel.app.luciel.forceInstrument(null));
  // rare outfit: forced 1-in-20 hit on Hip-Hop → Puffer Jacket, first-time sparkle (keep the toast in this one)
  await ev(() => { const a = window.Luciel.app; a.setScene('lucielle-genres/hip-hop', true); a.luciel.setRng(() => 0.01); a.playTrack(a.tracks[1]); });
  await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/phone-rare-puffer-sparkle.png` }); console.log('shot rare');
  await ev(() => window.Luciel.app.luciel.setRng(() => 0.99));
  // weather overlays (the layer itself; the Open-Meteo pipeline is covered by the tests)
  for (const [sc, w, dn] of [['rnb', 'rain', 'night'], ['acoustic', 'snow', 'night'], ['indie-rock', 'storm', 'day'], ['hip-hop', 'fog', 'night']]) {
    await ev(([sc, w, dn]) => { const a = window.Luciel.app; a.luciel.setDayMode(dn); a.setScene('lucielle-genres/' + sc, true); a.luciel.setWeather(w); }, [sc, w, dn]);
    await page.waitForTimeout(1600); await shot(`phone-weather-${w}-${sc}`);
  }
  await ev(() => window.Luciel.app.luciel.setWeather(null));
  // GIF frames: stage area only, 3 scenes x 2.4 s
  const box = await ev(() => { const c = document.querySelector('#mPlayer canvas, .m-stage canvas, canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  let n = 0;
  for (const [sc, dn] of [['hip-hop', 'night'], ['alt-rock', 'night'], ['acoustic', 'night']]) {
    await ev(([sc, dn]) => { const a = window.Luciel.app; a.luciel.setDayMode(dn); a.setScene('lucielle-genres/' + sc, true); }, [sc, dn]);
    await page.waitForTimeout(1200);
    for (let i = 0; i < 24; i++) { await page.screenshot({ path: `${OUT}/gif/f${String(n++).padStart(3, '0')}.png`, clip: box }); await page.waitForTimeout(60); }
  }
  console.log('gif frames', n, JSON.stringify(box), 'errors', errors.length ? errors.slice(0, 3).join(' | ') : 0);
  await browser.close();
})();
