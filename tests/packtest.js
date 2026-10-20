// Visual packs + mini player (browser build): import/validation/enable/disable/delete/persistence, scene picker + auto selection,
// mini overlay state sync, remote commands, theme sync. Screenshots -> $SHOTS (default /workspace/aero-player/screenshots)
const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const MEDIA = path.resolve(__dirname, 'media'), FIX = '/tmp/luc/packs', SHOTS = process.env.SHOTS || '/workspace/aero-player/screenshots';
const EXAMPLE = process.env.EXAMPLE || '/workspace/luciel-dist/example-pack.zip';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  execFileSync('python3', [path.join(__dirname, 'gen_badpacks.py'), FIX]);
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  const P = () => page.evaluate(() => window.AeroAmp.packs.installed.map(p => p.id + (p.enabled ? '' : '(off)')).sort().join(','));
  const sceneIds = () => page.evaluate(() => window.Luciel.Scenes.list.map(s => s.id));
  const msg = () => page.evaluate(() => document.getElementById('pkMsg').textContent.replace(/\s+/g, ' '));
  const imp = async (file) => { await page.setInputFiles('#packZipInput', file); await page.waitForFunction(() => !/Reading/.test(document.getElementById('pkMsg').innerText), null, { timeout: 30000 }); await page.waitForTimeout(200); return msg(); };

  const core = (await sceneIds()).length;
  ok(core === 20 && (await P()) === '', `core pack only: ${core} scenes`);
  // ---- import the example pack
  let m = await imp(EXAMPLE);
  ok(/Cyber Night/.test(m) && (await P()) === 'cyber-night', 'example pack imported: ' + m.slice(0, 90));
  let ids = await sceneIds();
  ok(ids.length === core + 3 && ids.includes('cyber-night/cyber-night') && ids.includes('cyber-night/rooftop-pixel'), 'pack scenes join the scene list');
  ok(await page.evaluate(() => document.querySelectorAll('#sceneGrid [data-scene^="cyber-night/"]').length >= 2 && !!document.querySelector('#sceneGrid [data-scene="cyber-night/neon-glitch"] i.pk')), 'pack scenes in the scene picker with PACK badge');
  // ---- invalid packs
  const bad = { 'script': /payload\.js/, 'badjson': /not valid JSON/, 'missing': /nothere\.png/, 'traversal': /illegal path/, 'fakemagic': /not really a \.png/, 'reserved': /reserved/, 'nomanifest': /No pack\.json/, 'notzip': /not a zip/, 'oversize': /at most 20 MB/ };
  for (const [f, re] of Object.entries(bad)) { m = await imp(path.join(FIX, f + '.zip')); ok(re.test(m) && /Couldn/.test(m) && (await P()) === 'cyber-night', `rejects ${f}: ${m.slice(0, 110)}`); }
  // ---- wrapped zip + folder import
  m = await imp(path.join(FIX, 'good-wrapped.zip'));
  ok((await P()) === 'cyber-night,tiny-test', 'zip with a wrapping folder imports (README/__MACOSX skipped): ' + m.slice(0, 120));
  await page.setInputFiles('#packDirInput', path.join(FIX, 'folder', 'tiny-folder'));
  await page.waitForFunction(() => window.AeroAmp.packs.installed.some(p => p.id === 'tiny-folder'), null, { timeout: 20000 }).catch(() => {});
  m = await msg();
  ok((await P()) === 'cyber-night,tiny-folder,tiny-test' && /unused\.png/.test(m), 'folder import works, warns about unused files: ' + m.slice(0, 120));
  // ---- auto selection by genre
  const auto = await page.evaluate(() => { const S = window.Luciel.Scenes; return ['zzpinkcore', 'phonk', 'cyberpunk', 'vaporwave', 'jazz'].map(g => g + '→' + ((S.matchGenre(g, '', ['layered', 'full', 'video']) || {}).id)).join(' '); });
  console.log('auto:', auto);
  ok(/zzpinkcore→tiny-(test|folder)\/pink/.test(auto) && /jazz→jazz/.test(auto), 'imported scenes take part in auto genre selection');
  const px = await page.evaluate(() => { const S = window.Luciel.Scenes; window.AeroAmp.applyTheme('blue', 'classic'); const r = (S.matchGenre('cyberpunk', '', ['pixel']) || {}).id; window.AeroAmp.applyTheme('aero', 'aero'); return r; });
  console.log('pixel cyberpunk →', px);
  // ---- disable / enable / delete / persistence
  await page.evaluate(() => window.AeroAmp.packs.setEnabled('tiny-folder', false));
  ids = await sceneIds();
  ok(!ids.some(i => i.startsWith('tiny-folder/')) && (await P()).includes('tiny-folder(off)'), 'disable removes scenes');
  await page.evaluate(() => window.AeroAmp.packs.remove('tiny-test'));
  ok(!(await sceneIds()).some(i => i.startsWith('tiny-test/')) && !(await P()).includes('tiny-test'), 'delete removes pack');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await P()) === 'cyber-night,tiny-folder(off)' && (await sceneIds()).length === core + 3, 'state persists after reload (IndexedDB): ' + (await P()));
  // ---- play with the pack scenes
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 }); await page.waitForTimeout(1500);
  for (const [id, pal, skin] of [['cyber-night/cyber-night', 'blue', 'aero'], ['cyber-night/neon-glitch', 'red', 'aero'], ['cyber-night/rooftop-pixel', 'blue', 'classic']]) {
    await page.evaluate(([id, pal, skin]) => { const A = window.AeroAmp; A.applyTheme(pal, skin); if (!A.current) A.playTrack(A.tracks[2]); A.engine.audio.currentTime = 8; A.setScene(id, true); }, [id, pal, skin]);
    await page.waitForTimeout(3000);
    const f = `${SHOTS}/pack-${id.split('/')[1]}-${skin}-${pal}.png`; await page.screenshot({ path: f });
    const st = await page.evaluate(() => { const L = window.AeroAmp.luciel; return { scene: L.scene.id, kind: L.scene.kind, char: L.scene.char ? L.scene.char.use : null }; });
    ok(st.scene === id, `renders ${id} (${JSON.stringify(st)}) -> ${f}`);
  }
  // ---- packs manager screenshot (with an error message on top)
  await page.evaluate(() => { window.AeroAmp.applyTheme('aero', 'aero'); window.AeroAmp.packs.openManager(); });
  await imp(path.join(FIX, 'script.zip'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/packs-manager-aero.png` });
  await page.evaluate(() => { window.AeroAmp.applyTheme('slime', 'classic'); }); await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/packs-manager-classic-slime.png` });
  ok(await page.evaluate(() => document.querySelectorAll('#pkList .pk-card, #pkList > *').length >= 3), 'manager lists core + installed packs');
  await page.keyboard.press('Escape'); await page.evaluate(() => { const o = document.getElementById('packsOverlay'); if (o) o.hidden = true; }); await page.waitForTimeout(300);

  // ---- mini player overlay
  await page.evaluate(() => { const A = window.AeroAmp; A.applyTheme('aero', 'aero'); A.setScene('auto', true); if (A.engine.audio.paused) A.engine.audio.play(); });
  await page.keyboard.press('o'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.AeroAmp.mini.isOpen && !!window.AeroAmp.mini.overlay), "'o' opens the mini overlay");
  const ui = () => page.evaluate(() => { const h = document.getElementById('miniHost'); const q = (s) => h.querySelector(s); return { title: q('.lm-title-in') && q('.lm-title-in').textContent, artist: q('.lm-artist') && q('.lm-artist').textContent, playing: h.querySelector('[data-c="toggle"]').getAttribute('aria-label') || h.querySelector('[data-c="toggle"]').title, skin: h.dataset.skin, large: h.querySelector('.lm-main') ? null : null, cls: h.firstElementChild && h.firstElementChild.className, seek: q('.lm-seek-in').value, vol: q('.lm-vol-in').value }; });
  const cur = () => page.evaluate(() => { const A = window.AeroAmp; return { title: A.mini.state().title, playing: A.mini.state().playing, vol: A.settings.volume, t: A.engine.audio.currentTime }; });
  let u = await ui(), c = await cur();
  ok(u.title === c.title && c.title.length > 0, `title synced: "${u.title}"`);
  await page.click('#miniHost [data-c="toggle"]'); await page.waitForTimeout(400);
  ok((await cur()).playing === false, 'mini play/pause button pauses the main player');
  await page.click('#miniHost [data-c="toggle"]'); await page.waitForTimeout(400);
  ok((await cur()).playing === true, 'mini play/pause resumes');
  const t0 = c.title; await page.click('#miniHost [data-c="next"]'); await page.waitForTimeout(800);
  u = await ui(); c = await cur();
  ok(c.title !== t0 && u.title === c.title, `next -> "${c.title}", mini follows`);
  await page.evaluate(() => { const i = document.querySelector('#miniHost .lm-vol-in'); i.value = i.max * 0.3; i.dispatchEvent(new Event('input', { bubbles: true })); }); await page.waitForTimeout(200);
  ok(Math.abs((await cur()).vol - 0.3) < 0.05, 'mini volume slider drives the main volume: ' + (await cur()).vol);
  await page.evaluate(() => window.AeroAmp.mini.cmd('seek', 0.5)); await page.waitForTimeout(400);
  c = await cur(); const dur = await page.evaluate(() => window.AeroAmp.engine.audio.duration);
  ok(Math.abs(c.t - dur * 0.5) < 2, `seek command -> ${c.t.toFixed(1)}s of ${dur.toFixed(1)}s`);
  // theme sync + screenshots
  const shot = async (name) => { const b = await page.evaluate(() => { const r = document.getElementById('miniHost').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); const pad = 14; await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } }); };
  for (const [pal, skin] of [['aero', 'aero'], ['blue', 'aero'], ['red', 'classic'], ['slime', 'classic']]) {
    await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]); await page.waitForTimeout(700);
    u = await ui(); ok(u.skin === skin, `theme sync ${pal}/${skin} (host skin=${u.skin})`);
    await shot(`mini-overlay-${skin}-${pal}`);
  }
  // large mode
  await page.evaluate(() => { const h = document.getElementById('miniHost'); h.style.width = '340px'; h.style.height = '360px'; }); await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.querySelector('#miniHost .is-large, #miniHost.large, #miniHost [data-large="1"]') !== null || window.AeroAmp.mini.overlay.large), 'resizing taller switches to large art mode');
  for (const [pal, skin] of [['slime', 'aero'], ['blue', 'classic']]) { await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]); await page.waitForTimeout(900); await shot(`mini-overlay-large-${skin}-${pal}`); }
  await page.click('#miniHost [data-c="close"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !window.AeroAmp.mini.isOpen && document.getElementById('miniHost').hidden !== false || !window.AeroAmp.mini.isOpen), 'close button closes the overlay');
  await page.click('#btnMini'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.AeroAmp.mini.isOpen), 'titlebar mini button opens it again');
  ok(errors.length === 0, 'no console errors ' + JSON.stringify(errors.slice(0, 5)));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
