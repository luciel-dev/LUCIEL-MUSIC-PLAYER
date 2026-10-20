// Real-input test for the frameless windows (floater + main title bar).
// Clicks are made with xdotool, i.e. real X server pointer events that go through Electron's native non-client hit test
// (the drag-region / HTCAPTION logic that swallowed every floater click on Windows in 1.0.1). CDP clicks (page.click)
// and webContents.sendInputEvent are injected straight into the renderer, *after* that hit test, so they cannot catch
// this class of bug — the static audit below plus these OS-level clicks can.
//   run inside xvfb + a window manager: see test/run.sh
const { _electron } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.LUCIEL_EXE || path.join(ROOT, 'dist/linux-unpacked/luciel');
const SAMPLES = '/workspace/aero-player/samples', UD = '/tmp/luciel-ri/userdata', WORK = '/tmp/luciel-ri/music';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xdo = (args) => cp.execFileSync('xdotool', args.split(' ').filter(Boolean));

// ---- static audit, runs inside a page: no interactive element may be (or sit under) a drag region
function auditFn() {
  const INTER = 'button, input, select, textarea, a[href], [data-c], [tabindex]:not([tabindex="-1"]), .lm-art, .lm-range, .dtb-btn';
  const reg = (e) => { const cs = getComputedStyle(e); return cs.getPropertyValue('app-region') || cs.webkitAppRegion || 'none'; };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0; };
  const inter = [...document.querySelectorAll(INTER)].filter(vis);
  const drags = [...document.querySelectorAll('*')].filter((e) => reg(e) === 'drag' && vis(e));
  const name = (e) => (e.id ? '#' + e.id : '') + (e.className && e.className.baseVal === undefined ? '.' + String(e.className).trim().split(/\s+/).join('.') : e.tagName.toLowerCase());
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const problems = [];
  for (const e of inter) if (reg(e) === 'drag') problems.push(`${name(e)} is itself a drag region`);
  for (const d of drags) {
    const kid = d.querySelector(INTER); if (kid) problems.push(`drag region ${name(d)} contains control ${name(kid)}`);
    const dr = d.getBoundingClientRect();
    for (const e of inter) if (!d.contains(e) && !e.contains(d) && hit(dr, e.getBoundingClientRect())) problems.push(`drag region ${name(d)} overlaps control ${name(e)}`);
  }
  return { controls: inter.length, drags: drags.map(name), problems };
}

async function launch() {
  const app = await _electron.launch({ executablePath: EXE, args: ['--no-sandbox'], env: { ...process.env, LUCIEL_TEST: '1', LUCIEL_USER_DATA: UD } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.AeroAmp && document.getElementById('desktopTitlebar'), null, { timeout: 30000 });
  await page.evaluate((d) => window.AeroAmp.nativeOpen([d]), WORK);
  await page.waitForFunction(() => window.AeroAmp.tracks.length >= 3, null, { timeout: 30000 });
  await page.evaluate(() => { const a = window.AeroAmp; if (!a.current) a.playTrack(a.tracks[0]); });
  await page.waitForFunction(() => window.AeroAmp.current && !window.AeroAmp.engine.audio.paused, null, { timeout: 15000 });
  return { app, page };
}

(async () => {
  fs.rmSync('/tmp/luciel-ri', { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  for (const f of fs.readdirSync(SAMPLES).filter((f) => /\.(mp3|flac|m4a|ogg)$/.test(f))) fs.copyFileSync(path.join(SAMPLES, f), path.join(WORK, f));
  const { app, page } = await launch();
  await sleep(1500);
  const A = (fn, arg) => app.evaluate(fn, arg);
  const mstate = () => page.evaluate(() => { const a = window.AeroAmp, au = a.engine.audio; return { paused: au.paused, title: a.mini.state().title, t: au.currentTime, dur: au.duration, vol: a.settings.volume, muted: !!a.settings.muted }; });

  // screen point of an element centre (or of a fraction across it), in a given page/window
  async function pt(pg, getWin, sel, fx = 0.5, fy = 0.5) {
    const cb = await A(getWin === 'floater' ? () => global.__lucielFloater().getContentBounds() : () => global.__lucielMain().getContentBounds());
    const r = await pg.evaluate(([s, fx, fy]) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(), z = devicePixelRatio; return { x: (b.left + b.width * fx) * z, y: (b.top + b.height * fy) * z }; }, [sel, fx, fy]);
    if (!r) throw new Error('no element ' + sel);
    return { x: Math.round(cb.x + r.x), y: Math.round(cb.y + r.y) };
  }
  async function realClick(pg, win, sel, fx, fy) {
    const p = await pt(pg, win, sel, fx, fy);
    await pg.evaluate(() => { window.__hits = []; });
    xdo(`mousemove ${p.x} ${p.y} sleep 0.12 click 1`); await sleep(500);
    return pg.evaluate(() => (window.__hits || []).slice()).catch(() => ['(window closed)']);
  }
  const record = (pg) => pg.evaluate(() => { window.__hits = []; if (!window.__rec) { window.__rec = 1; document.addEventListener('mousedown', (e) => window.__hits.push(((e.target.closest && e.target.closest('[data-c], button, input, .lm-art')) || e.target).className || e.target.tagName), true); } });

  // ---------- main window title bar
  await page.evaluate(() => window.AeroAmp.applyTheme('blue', 'aero'));
  await A(() => { const w = global.__lucielMain(); w.unmaximize(); w.setBounds({ x: 200, y: 120, width: 1280, height: 820 }); w.focus(); }); await sleep(800);
  for (const skin of ['aero', 'classic']) {
    await page.evaluate((s) => window.AeroAmp.applyTheme(s === 'aero' ? 'blue' : 'red', s), skin); await sleep(500);
    const au = await page.evaluate(auditFn);
    ok(!au.problems.length && au.drags.length >= 1, `main window (${skin}): no control is a drag region or under one (${au.controls} controls, drag: ${au.drags.join(', ')})${au.problems.length ? ' :: ' + au.problems.slice(0, 6).join(' | ') : ''}`);
  }
  await page.evaluate(() => window.AeroAmp.applyTheme('blue', 'aero')); await sleep(400);
  await record(page);
  let h = await realClick(page, 'main', '#dtbMax'); await sleep(700);
  const mx1 = await A(() => global.__lucielMain().isMaximized());
  h = h.concat(await realClick(page, 'main', '#dtbMax')); await sleep(700);
  const mx2 = await A(() => global.__lucielMain().isMaximized());
  ok(mx1 === true && mx2 === false, `real click on title-bar maximize/restore works (${mx1} -> ${mx2}; page saw ${h.length} mousedowns)`);
  let b0 = await A(() => global.__lucielMain().getBounds()), g = await pt(page, 'main', '.dtb-title');
  xdo(`mousemove ${g.x} ${g.y} sleep 0.15 mousedown 1 sleep 0.15 mousemove ${g.x + 40} ${g.y + 30} sleep 0.15 mousemove ${g.x + 120} ${g.y + 80} sleep 0.3 mouseup 1`); await sleep(700);
  let b1 = await A(() => global.__lucielMain().getBounds());
  ok(b1.x !== b0.x || b1.y !== b0.y, `dragging the title-bar grip moves the main window (${b0.x},${b0.y} -> ${b1.x},${b1.y})`);

  // ---------- open the floater with a real click on the app's Mini button
  h = await realClick(page, 'main', '#btnMini'); await sleep(2000);
  let fp = app.windows().find((w) => /floater\.html/.test(w.url()));
  ok(!!fp && (await A(() => !!global.__lucielFloater())), `real click on the "Mini" button opens the floater (main hidden: ${!(await A(() => global.__lucielMain().isVisible()))})`);
  await fp.waitForSelector('.lm-title-in'); await record(fp);
  const errs = []; fp.on('pageerror', (e) => errs.push(e.message)); fp.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  // ---------- audit every theme/skin x compact/large (and pkg-size 490x125 like the Windows report)
  for (const [pal, skin] of [['aero', 'aero'], ['blue', 'aero'], ['red', 'classic'], ['slime', 'classic']]) {
    for (const [w, hh] of [[490, 125], [340, 120], [340, 360]]) {
      await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]);
      await A((_, [w, h]) => global.__lucielFloater().setBounds({ x: 1500, y: 700, width: w, height: h }), [w, hh]); await sleep(700);
      const au = await fp.evaluate(auditFn);
      ok(!au.problems.length && au.drags.some((d) => /lm-grip-text/.test(d)) && au.controls >= 10, `floater ${pal}/${skin} ${w}x${hh}: ${au.controls} controls, none draggable or under a drag region; grips: ${au.drags.join(', ')}${au.problems.length ? ' :: ' + au.problems.slice(0, 6).join(' | ') : ''}`);
    }
  }

  // ---------- real clicks on every floater control, both skins, compact (490x125 as reported) and large
  for (const [pal, skin, w, hh] of [['blue', 'aero', 490, 125], ['blue', 'aero', 340, 360], ['red', 'classic', 490, 125], ['red', 'classic', 340, 360]]) {
    const tag = `${skin} ${w}x${hh}`;
    await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]);
    await A((_, [w, h]) => { const f = global.__lucielFloater(); f.setBounds({ x: 1500, y: 700, width: w, height: h }); }, [w, hh]); await sleep(900);
    await page.evaluate(() => { const a = window.AeroAmp; a.mini.cmd('volume', 0.8); if (a.settings.muted) a.mini.cmd('mute'); if (a.engine.audio.paused) a.engine.audio.play(); }); await sleep(500);
    const res = [];
    const check = async (label, sel, verify, fx, fy) => { if (!(await fp.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0; }, sel))) { res.push(label + '(hidden in this layout)'); return true; } const before = await mstate(); const hits = await realClick(fp, 'floater', sel, fx, fy); await sleep(350); const after = await mstate(); const good = hits.length > 0 && (await verify(before, after)); res.push(label + (good ? '' : `✗(hits=${hits.length})`)); return good; };
    let all = true;
    all &= await check('play/pause', '[data-c="toggle"]', (b, a) => a.paused !== b.paused);
    all &= await check('play/pause', '[data-c="toggle"]', (b, a) => a.paused !== b.paused);
    all &= await check('next', '[data-c="next"]', async (b, a) => { await sleep(400); return (await mstate()).title !== b.title; });
    all &= await check('prev', '[data-c="prev"]', async (b, a) => { await sleep(400); return (await mstate()).title !== b.title; });
    all &= await check('seek', '.lm-seek-in', async (b, a) => { await sleep(300); const s = await mstate(); return Math.abs(s.t / s.dur - 0.75) < 0.1; }, 0.75);
    all &= await check('volume', '.lm-vol-in', (b, a) => Math.abs(a.vol - 0.3) < 0.12, 0.3);
    all &= await check('mute', '[data-c="mute"]', (b, a) => a.muted !== b.muted);
    all &= await check('unmute', '[data-c="mute"]', (b, a) => a.muted !== b.muted);
    all &= await check('art', '.lm-art', async () => true, 0.5, 0.6);
    const top0 = await A(() => global.__lucielFloater().isAlwaysOnTop());
    all &= await check('pin', '[data-c="pin"]', async () => (await A(() => global.__lucielFloater().isAlwaysOnTop())) !== top0);
    all &= await check('pin', '[data-c="pin"]', async () => (await A(() => global.__lucielFloater().isAlwaysOnTop())) === top0);
    const h0 = (await A(() => global.__lucielFloater().getBounds())).height;
    all &= await check('mode', '[data-c="mode"]', async () => { await sleep(500); return (await A(() => global.__lucielFloater().getBounds())).height !== h0; });
    await sleep(600);
    all &= await check('mode back', '[data-c="mode"]', async () => { await sleep(500); return (await A(() => global.__lucielFloater().getBounds())).height !== h0 || true; });
    await A((_, [w, h]) => global.__lucielFloater().setBounds({ x: 1500, y: 700, width: w, height: h }), [w, hh]); await sleep(700);
    // drag by the title grip -> the window moves, and nothing is triggered
    const fb0 = await A(() => global.__lucielFloater().getBounds()); g = await pt(fp, 'floater', skin === 'classic' ? '.lm-tb-title' : '.lm-grip-text', 0.3);
    xdo(`mousemove ${g.x} ${g.y} sleep 0.15 mousedown 1 sleep 0.15 mousemove ${g.x - 40} ${g.y - 30} sleep 0.15 mousemove ${g.x - 160} ${g.y - 110} sleep 0.3 mouseup 1`); await sleep(700);
    const fb1 = await A(() => global.__lucielFloater().getBounds());
    const moved = fb1.x !== fb0.x || fb1.y !== fb0.y; all &= moved; res.push('drag-by-' + (skin === 'classic' ? 'title-strip' : 'title-text') + (moved ? '' : '✗'));
    await A((_, [w, h]) => global.__lucielFloater().setBounds({ x: 1500, y: 700, width: w, height: h }), [w, hh]); await sleep(700);
    g = await pt(fp, 'floater', '.lm-grip-text', 0.5);
    xdo(`mousemove ${g.x} ${g.y} sleep 0.15 mousedown 1 sleep 0.15 mousemove ${g.x - 40} ${g.y - 30} sleep 0.15 mousemove ${g.x - 160} ${g.y - 110} sleep 0.3 mouseup 1`); await sleep(700);
    const fb2 = await A(() => global.__lucielFloater().getBounds()), moved2 = fb2.x !== 1500 || fb2.y !== 700;
    all &= moved2; res.push('drag-by-song-text' + (moved2 ? '' : '✗'));
    await A((_, [w, h]) => global.__lucielFloater().setBounds({ x: 1500, y: 700, width: w, height: h }), [w, hh]); await sleep(500);
    ok(!!all, `${tag}: real OS clicks land on every control -> ${res.join(', ')}`);
  }

  // ---------- expand + close buttons (real clicks), reopen with the real Mini button in between
  await page.evaluate(() => window.AeroAmp.applyTheme('blue', 'aero'));
  await A(() => global.__lucielFloater().setBounds({ x: 1500, y: 700, width: 490, height: 125 })); await sleep(700);
  await realClick(fp, 'floater', '[data-c="expand"]'); await sleep(900);
  let st = await A(() => ({ fl: !!global.__lucielFloater(), main: global.__lucielMain().isVisible() }));
  ok(!st.fl && st.main, 'real click on "back to the full player": floater closes, main window returns');
  await A(() => global.__lucielMain().focus()); await sleep(500); await record(page);
  await realClick(page, 'main', '#btnMini'); await sleep(2000);
  fp = app.windows().find((w) => /floater\.html/.test(w.url()) && !w.isClosed());
  await fp.waitForSelector('.lm-title-in'); await record(fp);
  await realClick(fp, 'floater', '[data-c="close"]'); await sleep(900);
  st = await A(() => ({ fl: !!global.__lucielFloater(), main: global.__lucielMain().isVisible() }));
  ok(!st.fl && st.main, 'real click on close: floater closes, main window returns');
  ok(!errs.length, 'no floater console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await app.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
