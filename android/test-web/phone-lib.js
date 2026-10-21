// Shared setup for the phone-layout tests: demo library served as content:// files through the mocked Android bridge.
const fs = require('fs'), path = require('path');
process.env.MEDIA = process.env.MEDIA || path.resolve(__dirname, 'demo-media');
const { chromium } = require(process.env.PW || '/workspace/pwtest/node_modules/playwright-core');
const srv = require('./server');
let started = 0;
async function open({ port = 8970, width = 412, height = 915, insets = [32, 0, 24, 0], android = true, url = '/' } = {}) {
  if (!started) { await srv.start(port); started = port; } port = started;
  const files = fs.readdirSync(srv.MEDIA).filter((f) => !f.startsWith('.')).sort();
  const media = files.map((f) => ({ uri: 'content://test/' + encodeURIComponent(f), url: `http://127.0.0.1:${port}/_n/c?u=` + encodeURIComponent('content://test/' + encodeURIComponent(f)),
    name: f, size: fs.statSync(path.join(srv.MEDIA, f)).size, mime: '', rel: 'Music/' + f, durationMs: 0, title: '', artist: '', album: '', genre: '', art: '' }));
  const mock = fs.readFileSync(path.join(__dirname, 'mock-bridge.js'), 'utf8').replace('__MEDIA__', JSON.stringify(media));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', ...(process.env.JSFLAGS ? ['--js-flags=' + process.env.JSFLAGS] : [])] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 LucielAndroid/1.1.0' });
  if (android) await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + (process.env.STACK ? ' ' + e.stack : '')));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|ERR_ABORTED/.test(m.text())) errors.push(m.text()); if (/^PROBE/.test(m.text())) console.log(m.text()); });
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); return new Promise((r) => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  if (android) await page.evaluate((i) => window.LucielAndroidBridge.insets(...i), insets);
  if (android) await page.waitForFunction((n) => window.Luciel.app.lib.size >= n && [...window.Luciel.app.lib.values()].every((t) => t.meta), files.length, { timeout: 60000 });
  return { browser, ctx, page, errors, files };
}
module.exports = { open, srv };
