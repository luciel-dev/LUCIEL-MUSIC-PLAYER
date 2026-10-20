const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message));
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', [path.resolve('media/02 - Glass Lagoon.flac')]);
  await page.waitForFunction(() => window.AeroAmp.tracks.length >= 1);
  await page.waitForTimeout(800);
  await page.evaluate(() => { const A = window.AeroAmp; A.applyTheme('aero','aero'); A.playTrack(A.tracks[A.tracks.length-1]); A.setScene('mood-sleepy'); });
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(600);
    console.log(await page.evaluate(() => { const L = window.AeroAmp.luciel; const r = L.behavior.reaction; return JSON.stringify({ r: r && [r.name, Math.round(r.until - performance.now())], q: L.behavior.queue.length, tier: L.st.tier, scene: L.scene.id, playing: L.st.playing }); }));
  }
  await browser.close();
})();
