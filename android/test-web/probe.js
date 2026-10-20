const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'); const srv = require('./server');
(async () => {
  await srv.start(8962);
  const mock = fs.readFileSync(path.join(__dirname, 'mock-bridge.js'), 'utf8').replace('__MEDIA__', '[]');
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(mock); const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/^PROBE/.test(m.text())) console.log(m.text()); });
  await p.goto('http://127.0.0.1:8962/', { waitUntil: 'networkidle' });
  const skin = process.argv[2] || 'classic', pal = process.argv[3] || 'blue';
  await p.evaluate(([pa, s]) => window.Luciel.app.applyTheme(pa, s), [pal, skin]); await p.waitForTimeout(600);
  if (process.argv[4]) await p.evaluate(process.argv[4]);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const out = {}; const q = (s) => [...document.querySelectorAll(s)];
    for (const s of ['.app', '#winMain', '#winEq', '#winPl', '#winMascot', '.main-body', '.stage-wrap', '#winMain .titlebar', '.cover-wrap', '.viz-wrap', '.controls-row', '#winLib']) { const e = document.querySelector(s); if (e) { const r = e.getBoundingClientRect(); out[s] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), getComputedStyle(e).display]; } }
    out.scrollW = document.documentElement.scrollWidth; out.zoomApp = getComputedStyle(document.querySelector('.app')).zoom;
    const wide = q('body *').filter((e) => e.getBoundingClientRect().right > 420 && getComputedStyle(e).position !== 'fixed').slice(0, 12).map((e) => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right));
    out.wide = wide; return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await p.screenshot({ path: process.argv[5] || '/tmp/la/probe.png', fullPage: !!process.env.FULL });
  await b.close(); process.exit(0);
})();
