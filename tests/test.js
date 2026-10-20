const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media');
const SHOTS = '/workspace/aero-player/screenshots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const reqfail = []; page.on('requestfailed', (r) => reqfail.push(r.url().slice(0, 30) + ' ' + (r.failure() && r.failure().errorText)));
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/empty.png' });
  const files = fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta && (!t.supported || isFinite(t.duration))), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => window.AeroAmp.tracks.map(t => ({ name: t.name, supported: t.supported, title: t.meta.title, artist: t.meta.artist, album: t.meta.album, dur: Math.round(t.duration*10)/10, cover: !!t.coverUrl, fmt: t.meta.format })));
  console.table(info);
  const st = await page.evaluate(() => ({ cur: window.AeroAmp.current && window.AeroAmp.current.name, t: window.AeroAmp.engine.audio.currentTime, paused: window.AeroAmp.engine.audio.paused, ctx: window.AeroAmp.engine.ctx && window.AeroAmp.engine.ctx.state, title: document.getElementById('tTitle').textContent, artist: document.getElementById('tArtist').textContent }));
  console.log('state after add:', st);
  // Play each supported track briefly and confirm time advances
  const results = [];
  for (let i = 0; i < info.length; i++) {
    const r = await page.evaluate(async (i) => {
      const A = window.AeroAmp, t = A.tracks[i];
      if (!t.supported) return { name: t.name, skipped: 'unsupported (flagged)' };
      A.playTrack(t);
      const a = A.engine.audio;
      await new Promise(r => setTimeout(r, 1800));
      return { name: t.name, time: Math.round(a.currentTime * 100) / 100, paused: a.paused, err: a.error && a.error.code, shown: document.getElementById('tTitle').textContent, cover: !document.getElementById('cover').hidden };
    }, i);
    results.push(r);
  }
  console.table(results);
  // test analyser receiving signal
  const sig = await page.evaluate(async () => { const an = window.AeroAmp.engine.analyser; const d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d); return d.reduce((a, b) => a + b, 0); });
  console.log('analyser energy sum:', sig);
  // wait for tempo analysis of all supported tracks
  await page.waitForFunction(() => window.AeroAmp.tracks.filter(t => t.supported).every(t => t.bpmInfo), null, { timeout: 60000 });
  console.log('BPM (songs):', await page.evaluate(() => window.AeroAmp.tracks.map(t => t.name.slice(0, 22) + '=' + (t.bpmInfo ? t.bpmInfo.bpm : '-')).join(' | ')));
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) fs.unlinkSync(path.join(SHOTS, f));
  // stopped / idle shot
  await page.evaluate(() => { const A = window.AeroAmp; A.applyTheme('aero', 'aero'); });
  await page.click('#btnStop'); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/idle-stopped-aero.png` });
  const pick = { aero: 1, blue: 3, red: 4, slime: 2 };
  for (const skin of ['aero', 'classic']) {
    for (const pal of ['aero', 'blue', 'red', 'slime']) {
      await page.evaluate(([pal, skin, idx]) => { const A = window.AeroAmp; A.setScene('auto', true); A.applyTheme(pal, skin); A.applyPreset({ aero: 'Pop', blue: 'Electronic', red: 'Rock', slime: 'Bass Boost' }[pal], true); if (A.current !== A.tracks[idx] || A.engine.audio.paused) A.playTrack(A.tracks[idx]); A.engine.audio.currentTime = 6; }, [pal, skin, pick[pal]]);
      await page.waitForTimeout(3600);
      const f = `${SHOTS}/${skin}-${pal}.png`;
      await page.screenshot({ path: f });
      console.log('shot', f, await page.evaluate(() => { const A = window.AeroAmp; return [A.luciel.scene.id, A.luciel.st.tier, A.tracker.bpm].join(' '); }));
    }
  }
  const scenes = [['jazz', 'blue', 'aero', 1], ['synthwave', 'red', 'aero', 2], ['mood-sleepy', 'aero', 'aero', 1], ['pixel-blue', 'blue', 'classic', 3], ['hiphop', 'slime', 'classic', 4]];
  for (const [id, pal, skin, idx] of scenes) {
    await page.evaluate(([id, pal, skin, idx]) => { const A = window.AeroAmp; A.applyTheme(pal, skin); if (A.current !== A.tracks[idx]) A.playTrack(A.tracks[idx]); A.engine.audio.currentTime = 8; A.setScene(id, true); }, [id, pal, skin, idx]);
    await page.waitForTimeout(4200);
    const f = `${SHOTS}/scene-${id}-${skin}-${pal}.png`;
    await page.screenshot({ path: f }); console.log('shot', f);
  }
  await page.evaluate(() => window.AeroAmp.setScene('auto', true));
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  console.log('favorite:', await page.evaluate(() => window.AeroAmp.settings.favorites.includes(window.AeroAmp.current.id)), 'row hearts:', await page.$$eval('.pl-fav', e => e.length));
  await page.evaluate(() => window.AeroAmp.applyTheme('aero', 'aero'));
  await page.waitForTimeout(400);
  await page.click('#stage'); await page.waitForTimeout(400);
  console.log('click emote layer:', await page.evaluate(() => window.AeroAmp.luciel.behavior && JSON.stringify(window.AeroAmp.luciel.behavior.current || null)));
  await page.click('#btnTheme'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/theme-picker.png` });
  await page.keyboard.press('Escape');
  // keyboard: space pauses
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  const pausedAfterSpace = await page.evaluate(() => window.AeroAmp.engine.audio.paused);
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  const playingAfterSpace = await page.evaluate(() => !window.AeroAmp.engine.audio.paused);
  console.log('space toggles:', pausedAfterSpace, playingAfterSpace);
  // search
  await page.fill('#plSearch', 'slime'); await page.waitForTimeout(200);
  const rows = await page.$$eval('#plList .pl-row', (els) => els.length);
  console.log('search "slime" rows:', rows);
  await page.fill('#plSearch', '');
  // persistence: reload and confirm tracks restored + theme kept
  await page.evaluate(() => window.AeroAmp.applyTheme('slime', 'classic'));
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ n: window.AeroAmp.tracks.length, pal: document.body.dataset.palette, skin: document.body.dataset.skin, cur: window.AeroAmp.current && window.AeroAmp.current.name }));
  console.log('after reload:', after);
  // folder input (webkitdirectory) + extra behaviours
  await page.evaluate(() => window.AeroAmp.applyTheme('aero', 'aero'));
  await page.click('#plClear'); await page.waitForTimeout(300);
  await page.setInputFiles('#folderInput', MEDIA).catch(e => console.log('folder setInputFiles unsupported:', e.message));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8, null, { timeout: 20000 }).catch(() => {});
  console.log('tracks after folder add:', await page.evaluate(() => window.AeroAmp.tracks.length));
  await page.waitForTimeout(1500);
  // reorder: select row 2 and Alt+Up
  await page.click('#plList .pl-row:nth-child(2)'); await page.focus('#plList'); await page.keyboard.press('Alt+ArrowUp');
  console.log('after alt+up first:', await page.evaluate(() => window.AeroAmp.tracks[0].name));
  await page.keyboard.press('r'); await page.keyboard.press('r');
  await page.keyboard.press('s');
  console.log('repeat/shuffle:', await page.evaluate(() => [window.AeroAmp.settings.repeat, window.AeroAmp.settings.shuffle]));
  await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(500);
  console.log('next (shuffle) ->', await page.evaluate(() => window.AeroAmp.current.name));
  console.log('mediaSession:', await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title));
  // drag-drop reorder via DOM events
  await page.dragAndDrop('#plList .pl-row:nth-child(1)', '#plList .pl-row:nth-child(4)');
  console.log('after drag order:', await page.evaluate(() => window.AeroAmp.tracks.slice(0,4).map(t => t.name.slice(0,2)).join(',')));
  await page.keyboard.press('k'); await page.waitForTimeout(1200);
  console.log('marquee:', await page.textContent('#marqueeText'));
  await page.click('#plClear'); await page.waitForTimeout(300);
  const BPMDIR = path.resolve(__dirname, 'bpm');
  await page.setInputFiles('#fileInput', fs.readdirSync(BPMDIR).sort().map(f => path.join(BPMDIR, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length >= 6 && window.AeroAmp.tracks.every(t => t.bpmInfo || !t.supported), null, { timeout: 60000 });
  const bres = await page.evaluate(() => window.AeroAmp.tracks.map(t => ({ name: t.name, bpm: t.bpmInfo.bpm, src: t.bpmInfo.source, conf: Math.round((t.bpmInfo.confidence || 0) * 100) / 100 })));
  console.table(bres);
  for (const r of bres) { const m = r.name.match(/(?:click|tbpm)-(\d+)/); if (m) console.log(r.name, Math.abs(r.bpm - +m[1]) <= 2 ? 'PASS' : 'FAIL (expected ' + m[1] + ')'); }
  console.log('ERRORS:', errors.length ? errors : 'none');
  console.log('aborted requests (blob src swaps):', reqfail.length, reqfail.slice(0,3));
  fs.writeFileSync('/tmp/console.log', logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
