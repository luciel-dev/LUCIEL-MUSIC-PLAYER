const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media');
const OUT = process.env.OUT || '/tmp/luc/sc';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 }); await page.waitForTimeout(4000);
  const shots = [['cyber', 'blue', 'aero', 2], ['datamosh', 'slime', 'aero', 2], ['dither', 'aero', 'aero', 0], ['cyber', 'red', 'classic', 2], ['dither', 'blue', 'classic', 0]];
  for (const [id, pal, skin, idx] of shots) {
    await page.evaluate(([id, pal, skin, idx]) => { const A = window.AeroAmp; A.applyTheme(pal, skin); if (A.current !== A.tracks[idx]) A.playTrack(A.tracks[idx]); A.engine.audio.currentTime = 8; A.setScene(id, true); }, [id, pal, skin, idx]);
    await page.waitForTimeout(2500);
    const f = `${OUT}/scene-${id}-${skin}-${pal}.png`;
    await page.screenshot({ path: f });
    console.log('shot', f, await page.evaluate(() => { const A = window.AeroAmp, L = A.luciel; const v = document.querySelector('video'); return JSON.stringify({ scene: L.scene.id, top: document.body.classList.contains('canvas-back'), tier: L.st.tier, bpm: A.tracker.bpm }); }));
  }
  // dither FX over a regular scene
  await page.evaluate(() => { const A = window.AeroAmp; A.applyTheme('aero', 'aero'); A.setScene('jazz', true); });
  await page.click('#optDither', { force: true }).catch(async () => { await page.evaluate(() => { const c = document.getElementById('optDither'); c.checked = true; c.dispatchEvent(new Event('change')); }); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/ditherfx-jazz-aero.png` });
  console.log('ditherFx', await page.evaluate(() => window.AeroAmp.luciel.st.ditherFx));
  // auto mode genre mapping
  console.log('auto:', await page.evaluate(() => ['electronic', 'techno', 'glitch', 'IDM', 'synthwave', 'cyberpunk', 'industrial', 'chiptune', '8-bit', 'lo-fi', 'Lofi Hip Hop', 'jazz'].map(g => g + '→' + ((window.Luciel.Scenes.matchGenre(g, '', ['layered', 'full', 'video']) || {}).id)).join(' ')));
  console.log('covers:', await page.evaluate(() => ['electronic', 'lo-fi', 'chiptune', 'synthwave'].map(g => g + '→' + window.Luciel.Scenes.coverFor({ genre: g }, 'aero')).join(' ')));
  console.log('rates:', await page.evaluate(() => [...document.querySelectorAll('video')].map(v => (v.currentSrc || v.src).split('/').pop() + ':' + v.playbackRate.toFixed(2) + (v.paused ? ' paused' : '')).join(' ')));
  console.log('errors', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
