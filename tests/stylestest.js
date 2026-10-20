// Lucielle Styles pack: real import through #packZipInput, validator output, every scene in Aero + Classic, music-event
// emotes (forced + detected from playing audio), scene colour themes on/off, glow light map + beat bursts, no page errors.
// STYLES=<zip> (default /workspace/luciel-dist/lucielle-styles-pack.zip)  SHOTS=<dir>
const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media'), SHOTS = process.env.SHOTS || '/tmp/luc/styles-shots';
const ZIP = process.env.STYLES || '/workspace/luciel-dist/lucielle-styles-pack.zip';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  const core = await page.evaluate(() => window.Luciel.Scenes.list.length);
  // the pack validator on its own (node) — no errors, no warnings
  const P = require('/workspace/aero-player/js/packs.js');
  await page.setInputFiles('#packZipInput', ZIP);
  await page.waitForFunction(() => !/Reading/.test(document.getElementById('pkMsg').innerText), null, { timeout: 120000 }); await page.waitForTimeout(400);
  const msg = await page.evaluate(() => document.getElementById('pkMsg').textContent.replace(/\s+/g, ' '));
  console.log('import:', msg.slice(0, 300));
  ok(/Lucielle Styles/.test(msg) && !/Couldn|warning/i.test(msg), 'pack imports with no errors / warnings');
  const ids = await page.evaluate(() => window.Luciel.Scenes.list.map(s => s.id).filter(i => i.startsWith('lucielle-styles/')));
  ok(ids.length === 6, 'six scenes (3 + 3 pixel): ' + ids.join(' '));
  const info = await page.evaluate(() => window.Luciel.Scenes.list.filter(s => s.pack === 'lucielle-styles').map(s => ({ id: s.id, kind: s.kind, video: !!s.video, glow: !!s.glow, colors: s.colors, ev: s.char && s.char.events, em: s.char && Object.keys(s.char.emotes || {}), burst: s.react && s.react.beatBurst })));
  for (const s of info) ok((s.kind === 'video' || s.kind === 'pixel') && s.video && s.glow && s.colors && s.ev && Object.keys(s.ev).length === 7 && s.burst, `${s.id}: ${s.kind} loop, glow map, colours, 7 events → ${Object.values(s.ev || {}).join('/')}, burst ${s.burst}`);
  // tracks
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 }); await page.waitForTimeout(1000);
  const events = ['start', 'drop', 'hit', 'quiet', 'rise', 'sad', 'vocals'];
  for (const s of info) {
    const skin = s.kind === 'pixel' ? 'classic' : 'aero';
    await page.evaluate(([id, skin]) => { const A = window.AeroAmp; A.applyTheme('aero', skin); if (!A.current) A.playTrack(A.tracks[0]); else A.engine.audio.play(); A.setScene(id, true); }, [s.id, skin]);
    await page.waitForTimeout(2500);
    const col = await page.evaluate(() => ({ pal: document.body.dataset.palette, acc: document.body.style.getPropertyValue('--accent'), cls: document.body.classList.contains('scene-colors') }));
    ok(col.cls && col.pal === s.colors.base && col.acc === s.colors.accent, `${s.id} [${skin}]: scene colours applied (palette ${col.pal}, accent ${col.acc})`);
    const short = s.id.split('/')[1];
    await page.screenshot({ path: `${SHOTS}/${short}-${skin}.png` });
    // forced events -> mapped emote loop on stage
    const seen = [];
    for (const e of events) {
      let r; for (let k = 0; k < 3; k++) { r = await page.evaluate(async ([e]) => { const L = window.AeroAmp.luciel; L.behavior.queue = []; L.behavior.reaction = null; L.musicEvent(e); await new Promise(r => setTimeout(r, 250)); return { layer: L.layer, react: L.behavior.reaction && L.behavior.reaction.name }; }, [e]); if (r.react === s.ev[e] && r.layer && r.layer.name.includes('emote-' + s.ev[e])) break; }
      seen.push(`${e}→${r.react}:${r.layer && r.layer.kind}`);
      ok(r.react === s.ev[e] && r.layer && r.layer.kind === 'pdance' && r.layer.name.includes('emote-' + s.ev[e]), `${short} ${e} → ${s.ev[e]} loop on stage (${r.layer && r.layer.name})`);
      if (e === 'drop' || e === 'rise') await page.screenshot({ path: `${SHOTS}/${short}-${skin}-${e}.png` });
    }
  }
  // detected events while real audio plays (log), and the colours go away on a core scene / when switched off
  const det = await page.evaluate(async () => { const A = window.AeroAmp; A.setScene('lucielle-styles/city-punk', true); const t0 = performance.now(); A.luciel.behavior.reaction = null; A.playTrack(A.tracks[2]); await new Promise(r => setTimeout(r, 14000)); return A.luciel.eventLog.filter(e => e.t >= t0).map(e => e.evt).join(','); });
  console.log('detected while playing:', det);
  ok(/start/.test(det), 'event log records track start + detected events');
  await page.evaluate(() => window.AeroAmp.setScene('lucielle-styles/city-punk', true)); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('optSceneColors').click(); }); await page.waitForTimeout(300);
  let c2 = await page.evaluate(() => ({ pal: document.body.dataset.palette, acc: document.body.style.getPropertyValue('--accent') }));
  ok(c2.pal === 'aero' && !c2.acc, 'Scene colours off restores the user palette: ' + JSON.stringify(c2));
  await page.evaluate(() => { document.getElementById('optSceneColors').click(); }); await page.waitForTimeout(300);
  await page.evaluate(() => window.AeroAmp.setScene(window.Luciel.Scenes.core[0].id, true)); await page.waitForTimeout(300);
  c2 = await page.evaluate(() => ({ pal: document.body.dataset.palette, acc: document.body.style.getPropertyValue('--accent') }));
  ok(c2.pal === 'aero' && !c2.acc, 'core scene: no scene colours ' + JSON.stringify(c2));
  // floater follows the scene colours
  await page.evaluate(() => window.AeroAmp.setScene('lucielle-styles/arcade-angel', true)); await page.waitForTimeout(300);
  const mini = await page.evaluate(async () => { window.AeroAmp.mini.open(); await new Promise(r => setTimeout(r, 800)); const r = document.querySelector('#miniHost .lm'); return r ? { pal: r.dataset.palette, acc: r.style.getPropertyValue('--accent') } : null; });
  ok(!!mini && (mini.pal === 'blue' && mini.acc === '#ff3fd0'), 'floater picks up the scene colours: ' + JSON.stringify(mini));
  if (mini) await page.screenshot({ path: `${SHOTS}/arcade-angel-floater.png` });
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
