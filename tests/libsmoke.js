const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('g'); await page.waitForTimeout(500);
  for (const v of ['songs', 'artists', 'albums', 'genres']) { await page.click(`[data-nav="${v}"]`); await page.waitForTimeout(400); await page.screenshot({ path: `/tmp/luc/lib-${v}.png` }); }
  console.log('errors', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
