const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required','--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///workspace/aero-player/index.html'); await p.waitForTimeout(1200);
  await p.setInputFiles('#fileInput', ['/workspace/aero-player-test/media/02 - Glass Lagoon.flac']);
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.AeroAmp.playTrack(window.AeroAmp.tracks[window.AeroAmp.tracks.length-1]));
  await p.waitForFunction(() => window.AeroAmp.current && window.AeroAmp.current.bpmInfo, null, { timeout: 30000 });
  await p.evaluate(() => window.AeroAmp.applyTheme('slime','classic')); await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/luc/file-classic.png' });
  p.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
  console.log('file:// ->', await p.evaluate(() => ({ title: document.getElementById('tTitle').textContent, t: window.AeroAmp.engine.audio.currentTime, bpm: window.AeroAmp.current.bpmInfo, scene: window.AeroAmp.luciel.scene.id })), 'errors:', errs);
  await b.close();
})();
