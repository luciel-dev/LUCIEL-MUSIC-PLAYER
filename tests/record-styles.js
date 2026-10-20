// short recordings of each Lucielle Styles scene playing (Aero + Classic): frames via screenshots -> mp4 + gif (ffmpeg)
const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ZIP = process.env.STYLES || '/workspace/luciel-dist/lucielle-styles-pack.zip', OUT = process.env.OUT || '/workspace/luciel-dist/screenshots/styles/rec';
const MEDIA = path.resolve(__dirname, 'media');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#packZipInput', ZIP);
  await page.waitForFunction(() => !/Reading/.test(document.getElementById('pkMsg').innerText), null, { timeout: 120000 });
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 });
  for (const [id, skin] of [['arcade-angel', 'aero'], ['city-punk', 'aero'], ['fall-girl', 'aero'], ['arcade-angel-pixel', 'classic'], ['city-punk-pixel', 'classic'], ['fall-girl-pixel', 'classic']]) {
    await page.evaluate(([id, skin]) => { const A = window.AeroAmp; A.applyTheme('aero', skin); A.playTrack(A.tracks[0]); A.setScene('lucielle-styles/' + id, true); }, [id, skin]);
    await page.waitForTimeout(2600);
    const dir = `/tmp/luc/rec/${id}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      if (i === 15) await page.evaluate(() => window.AeroAmp.luciel.musicEvent('drop'));
      if (i === 38) await page.evaluate(() => { window.AeroAmp.luciel.behavior.reaction = null; window.AeroAmp.luciel.musicEvent('rise'); });
      await page.screenshot({ path: `${dir}/f${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 85 });
      await page.waitForTimeout(40);
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', `${dir}/f%03d.jpg`, '-vf', 'scale=960:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', `${OUT}/${id}.mp4`]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', `${dir}/f%03d.jpg`, '-vf', 'scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer', `${OUT}/${id}.gif`]);
    console.log('recorded', id);
  }
  await browser.close();
})();
