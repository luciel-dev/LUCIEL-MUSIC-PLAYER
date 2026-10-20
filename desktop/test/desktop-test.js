// Desktop smoke/integration test: drives the packaged Linux build with Playwright's Electron driver under xvfb.
//   xvfb-run -a -s "-screen 0 2560x1440x24" node test/desktop-test.js
const { _electron } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.LUCIEL_EXE || path.join(ROOT, 'dist/linux-unpacked/luciel');
const SHOTS = path.join(ROOT, 'screenshots'), APPSHOTS = '/workspace/aero-player/screenshots';
const EXAMPLE = '/workspace/luciel-dist/example-pack.zip', BADPACKS = '/tmp/luc/packs';
const SAMPLES = '/workspace/aero-player/samples';
const UD = '/tmp/luciel-dt/userdata', WORK = '/tmp/luciel-dt/music';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /dbus|Gtk|libva|viz_main|GPU process|gl_surface|shared_image|ui\/gfx|Fontconfig|ALSA|pulse|xdg|org\.freedesktop|StatusNotifier|libEGL|MESA|vaInitialize|Debugger|nodejs\.org|sandbox/i;

async function launch(args = [], env = {}) {
  const app = await _electron.launch({ executablePath: EXE, args: ['--no-sandbox', ...args], env: { ...process.env, LUCIEL_TEST: '1', LUCIEL_TRAY: '1', LUCIEL_USER_DATA: UD, ...env } });
  const logs = [];
  app.process().stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => logs.push(l)));
  app.process().stderr.on('data', (d) => String(d).split('\n').filter((l) => l && !NOISE.test(l)).forEach((l) => logs.push('[stderr] ' + l)));
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.AeroAmp && document.getElementById('desktopTitlebar'));
  return { app, page, logs, errors };
}
const W = (app, fn, arg) => app.evaluate(fn, arg);
async function flShot(app, name) {
  const png = await app.evaluate(async () => (await global.__lucielFloater().capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(APPSHOTS, name), Buffer.from(png, 'base64')); console.log('  shot', path.join(APPSHOTS, name));
}
async function shot(app, name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await global.__lucielMain().capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(png, 'base64')); console.log('  shot', name);
}

(async () => {
  fs.rmSync('/tmp/luciel-dt', { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SAMPLES).filter((f) => /\.(mp3|flac|m4a|ogg)$/.test(f))) fs.copyFileSync(path.join(SAMPLES, f), path.join(WORK, f));
  const song = path.join(WORK, '01 - Skyline Bubbles.mp3');

  // ---------- 1. launch with a file argument ("Open with Luciel") -> it plays
  let { app, page, logs, errors } = await launch([song]);
  const info = await page.evaluate(() => ({ url: location.href, secure: isSecureContext, native: !!window.lucielNative, desktop: document.body.classList.contains('desktop') }));
  ok(info.url === 'app://luciel/index.html' && info.secure && info.native && info.desktop, `served from app:// (secure context, native bridge): ${JSON.stringify(info)}`);
  await page.waitForFunction(() => window.AeroAmp.current && !window.AeroAmp.engine.audio.paused && window.AeroAmp.engine.audio.currentTime > 1.5, null, { timeout: 20000 }).catch(() => {});
  const play = await page.evaluate(() => { const a = window.AeroAmp; return { name: a.current && a.current.name, t: a.engine.audio.currentTime, paused: a.engine.audio.paused, native: a.current && a.current.nativePath, ctx: a.engine.ctx && a.engine.ctx.state }; });
  ok(play.name === '01 - Skyline Bubbles.mp3' && !play.paused && play.t > 1.5 && play.native === song, `file argument opened and autoplayed without a gesture: ${JSON.stringify(play)}`);
  await shot(app, 'desktop-aero-playing.png');

  // ---------- 2. folder via the native bridge (what the DIR button / drag-drop do)
  await page.evaluate((dir) => window.lucielNative.readPaths([dir]).then((l) => window.__n = l.length), WORK);
  const n = await page.evaluate(() => window.__n); ok(n === 4, `readPaths walks a folder (${n} audio files)`);
  await page.evaluate((dir) => window.AeroAmp.nativeOpen([dir]), WORK);
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 4 && window.AeroAmp.tracks.every((t) => t.nativePath), null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => window.AeroAmp.tracks.length) === 4, 'folder queued (deduped against the already-open file), every track keeps its disk path');

  // ---------- 3. WebGL dither / pixel reads / video loops / IndexedDB all work on app://
  await page.evaluate(() => window.AeroAmp.setScene('dither', true)); await sleep(1500);
  const gfx = await page.evaluate(() => {
    const st = document.getElementById('stage'); let read = false; try { st.getContext('2d').getImageData(0, 0, 4, 4); read = true; } catch (e) {}
    const gl = !!document.createElement('canvas').getContext('webgl');
    return { read, gl, backdrop: document.body.classList.contains('canvas-back') };
  });
  ok(gfx.read && gfx.gl && gfx.backdrop, `stage canvas is untainted (getImageData OK), WebGL available, dither backdrop active: ${JSON.stringify(gfx)}`);
  await shot(app, 'desktop-aero-dither.png');
  await page.evaluate(() => window.AeroAmp.setScene('cyber', true)); await sleep(2000);
  const vid = await page.evaluate(async () => {
    const c = document.getElementById('sceneCanvas'), t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d', { willReadFrequently: true });
    const grab = () => { g.drawImage(c, 0, 0); return g.getImageData(0, 0, t.width, t.height).data.slice(); };
    const a = grab(); await new Promise((r) => setTimeout(r, 400)); const b = grab();
    let diff = 0; for (let i = 0; i < a.length; i += 4 * 97) diff += Math.abs(a[i] - b[i]);
    return { moving: diff > 0, diff };
  });
  vid.served = (await W(app, () => global.__lucielServed.filter((x) => /cyber\.mp4/.test(x)))).slice(0, 3);
  vid.fetched = vid.served.length;
  ok(vid.fetched > 0 && vid.moving, `cyber video loop streams over app:// (range requests) and animates the backdrop: ${JSON.stringify(vid)}`);
  await shot(app, 'desktop-aero-cyber.png');

  // ---------- 4. window controls through the custom title bar (IPC)
  const isMax = () => W(app, ({ BrowserWindow }) => global.__lucielMain().isMaximized());
  await page.click('#dtbMax'); await sleep(800); const m1 = await isMax();
  await shot(app, 'desktop-maximized.png');
  await page.click('#dtbMax'); await sleep(800); const m2 = await isMax();
  ok(m1 === true && m2 === false, `maximize / restore button (${m1} -> ${m2})`);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.dtb-drag')).webkitAppRegion || getComputedStyle(document.querySelector('.dtb-drag')).getPropertyValue('app-region')) === 'drag', 'title bar grip is a drag region');
  await page.click('#dtbMin'); await sleep(800);
  const mn = await W(app, ({ BrowserWindow }) => { const w = global.__lucielMain(); const r = w.isMinimized(); w.restore(); return r; });
  ok(mn === true, 'minimize button');

  // ---------- 5. resize: 900x600 and 1920x1080, both skins
  for (const [w, h] of [[900, 600], [1920, 1080], [800, 520]]) {
    for (const skin of ['aero', 'classic']) {
      await page.evaluate((s) => window.AeroAmp.applyTheme(s === 'aero' ? 'aero' : 'blue', s), skin);
      await page.evaluate(() => window.AeroAmp.setScene('auto', true));
      await W(app, ({ BrowserWindow }, [w, h]) => global.__lucielMain().setSize(w, h), [w, h]); await sleep(900);
      const m = await page.evaluate(() => {
        const r = document.getElementById('app').getBoundingClientRect(), bar = document.querySelector('.dtb').getBoundingClientRect();
        const wins = [...document.querySelectorAll('#app > .win, #app > section')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
        let overlap = 0; for (let i = 0; i < wins.length; i++) for (let j = i + 1; j < wins.length; j++) { const a = wins[i], b = wins[j]; const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 4 && oy > 4) overlap++; }
        return { iw: innerWidth, ih: innerHeight, zoom: Math.round(devicePixelRatio * 1000) / 1000, fits: r.left >= -1 && r.top >= bar.bottom - 1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, overlap, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
      });
      const size = await W(app, ({ BrowserWindow }) => global.__lucielMain().getSize());
      ok(m.fits && !m.overlap && size[0] === w && size[1] === h, `${skin} at ${w}x${h}: zoom ${m.zoom}, css viewport ${m.iw}x${m.ih}, app fits below the title bar, ${m.overlap} overlapping panels`);
      await shot(app, `desktop-${skin}-${w}x${h}.png`);
    }
  }
  await page.evaluate(() => window.AeroAmp.applyTheme('aero', 'aero'));
  await W(app, ({ BrowserWindow }) => global.__lucielMain().setSize(1280, 820)); await sleep(600);

  // ---------- 6. tray / thumbar commands reach the renderer
  const send = (c) => W(app, ({ BrowserWindow }, c) => global.__lucielMain().webContents.send('command', c), c);
  await page.evaluate(() => { if (window.AeroAmp.engine.audio.paused) window.AeroAmp.engine.audio.play(); }); await sleep(300);
  await send('toggle'); await sleep(400); const p1 = await page.evaluate(() => window.AeroAmp.engine.audio.paused);
  await send('toggle'); await sleep(400); const p2 = await page.evaluate(() => window.AeroAmp.engine.audio.paused);
  const c0 = await page.evaluate(() => window.AeroAmp.current.name); await send('next'); await sleep(800); const c1 = await page.evaluate(() => window.AeroAmp.current.name);
  ok(p1 === true && p2 === false && c0 !== c1, `tray/thumbar commands: pause=${p1} play=${!p2} next ${c0} -> ${c1}`);


  // ---------- 6b. mini player floater window
  const FL = (fn, arg) => W(app, fn, arg);
  await page.evaluate(() => { const A = window.AeroAmp; A.applyTheme('aero', 'aero'); if (A.engine.audio.paused) A.engine.audio.play(); });
  await page.keyboard.press('o');
  await page.waitForFunction(() => true); await sleep(300);
  let fpage = null; for (let i = 0; i < 40 && !fpage; i++) { fpage = app.windows().find((w) => /floater\.html/.test(w.url())); if (!fpage) await sleep(250); }
  ok(!!fpage, "key 'o' opens the floater window (app://luciel/floater.html)");
  const ferr = []; fpage.on('console', (m) => { if (m.type() === 'error') ferr.push(m.text()); }); fpage.on('pageerror', (e) => ferr.push(e.message));
  await fpage.waitForSelector('.lm-title-in'); await sleep(1200);
  let fw = await FL(() => { const f = global.__lucielFloater(), m = global.__lucielMain(); return { b: f.getBounds(), top: f.isAlwaysOnTop(), mainVisible: m.isVisible(), skip: true }; });
  ok(fw.b.width === 340 && fw.b.height === 120 && fw.top && !fw.mainVisible, `floater 340x120, always on top, main window hidden to tray: ${JSON.stringify(fw)}`);
  const ftitle = () => fpage.evaluate(() => document.querySelector('.lm-title-in').textContent);
  const mstate = () => page.evaluate(() => { const s = window.AeroAmp.mini.state(); return { title: s.title, playing: s.playing, vol: window.AeroAmp.settings.volume }; });
  ok((await ftitle()) === (await mstate()).title, `floater shows the playing track: "${await ftitle()}"`);
  await fpage.click('[data-c="toggle"]'); await sleep(500); const fp1 = (await mstate()).playing;
  await fpage.click('[data-c="toggle"]'); await sleep(500); const fp2 = (await mstate()).playing;
  const ft0 = await ftitle(); await fpage.click('[data-c="next"]'); await sleep(1200); const ft1 = await ftitle();
  ok(fp1 === false && fp2 === true && ft1 !== ft0 && ft1 === (await mstate()).title, `floater buttons drive the main player: pause/play ok, next "${ft0}" -> "${ft1}"`);
  await fpage.evaluate(() => { const i = document.querySelector('.lm-vol-in'); i.value = i.max * 0.4; i.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(400);
  ok(Math.abs((await mstate()).vol - 0.4) < 0.05, 'floater volume slider -> main volume ' + (await mstate()).vol);
  await page.evaluate(() => { window.AeroAmp.settings.volume = 0.8; window.AeroAmp.engine.audio.volume = 0.8; }); await page.evaluate(() => window.AeroAmp.mini.cmd('volume', 0.8));
  for (const [pal, skin] of [['aero', 'aero'], ['blue', 'aero'], ['red', 'classic'], ['slime', 'classic']]) {
    await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]); await sleep(900);
    const th = await fpage.evaluate(() => ({ palette: document.body.dataset.palette, skin: document.body.dataset.skin }));
    ok(th.palette === pal && th.skin === skin, `floater follows theme ${pal}/${skin}`);
    await flShot(app, `floater-${skin}-${pal}.png`);
  }
  await fpage.click('[data-c="pin"]'); await sleep(400); const pinA = await FL(() => global.__lucielFloater().isAlwaysOnTop());
  await fpage.click('[data-c="pin"]'); await sleep(400); const pinB = await FL(() => global.__lucielFloater().isAlwaysOnTop());
  ok(pinA === false && pinB === true, `pin button toggles always-on-top (${pinA} -> ${pinB})`);
  await fpage.click('[data-c="mode"]'); await sleep(900);
  fw = await FL(() => ({ b: global.__lucielFloater().getBounds(), mode: global.__lucielFl().mode }));
  ok(fw.b.height === 360 && fw.mode === 'large', `mode button -> large art mode ${fw.b.width}x${fw.b.height}`);
  for (const [pal, skin] of [['slime', 'aero'], ['blue', 'classic']]) { await page.evaluate(([p, s]) => window.AeroAmp.applyTheme(p, s), [pal, skin]); await sleep(1200); await flShot(app, `floater-large-${skin}-${pal}.png`); }
  await fpage.click('[data-c="mode"]'); await sleep(700);
  await FL(() => global.__lucielFloater().setBounds({ x: 300, y: 200, width: 380, height: 130 })); await sleep(900);
  let fs1 = {}; try { fs1 = JSON.parse(fs.readFileSync(path.join(UD, 'floater-state.json'), 'utf8')); } catch (e) {}
  ok(fs1.x === 300 && fs1.y === 200 && fs1.compact && fs1.compact.w === 380 && fs1.mode === 'compact' && fs1.pinned === true, `position/size saved: ${JSON.stringify(fs1)}`);
  await fpage.click('[data-c="expand"]'); await sleep(900);
  fw = await FL(() => ({ fl: !!global.__lucielFloater(), main: global.__lucielMain().isVisible() }));
  ok(!fw.fl && fw.main, 'expand button closes the floater and brings the main window back');
  await page.evaluate(() => window.AeroAmp.applyTheme('aero', 'aero'));
  await page.click('#btnMini'); await sleep(1500);
  fw = await FL(() => { const f = global.__lucielFloater(); return f && f.getBounds(); });
  ok(fw && fw.x === 300 && fw.y === 200 && fw.width === 380, `titlebar Mini button reopens it where it was: ${JSON.stringify(fw)}`);
  fpage = app.windows().find((w) => /floater\.html/.test(w.url()));
  await send('mini'); await sleep(900);   // tray / thumbar "Mini player" command toggles it closed
  fw = await FL(() => ({ fl: !!global.__lucielFloater(), main: global.__lucielMain().isVisible() }));
  ok(!fw.fl && fw.main, 'mini command closes it again and the main window returns');
  ok(!ferr.length, 'no floater console errors' + (ferr.length ? ': ' + ferr.join(' | ') : ''));

  // ---------- 6c. visual packs on disk (userData/packs) served over app://
  await page.setInputFiles('#packZipInput', EXAMPLE);
  await page.waitForFunction(() => window.AeroAmp.packs.installed.some((p) => p.id === 'cyber-night'), null, { timeout: 30000 }).catch(() => {});
  const pdir = path.join(UD, 'packs', 'cyber-night');
  ok(fs.existsSync(path.join(pdir, 'pack.json')) && fs.existsSync(path.join(pdir, 'dance', 'neon-mid.webp')) && fs.existsSync(path.join(pdir, 'bg', 'cyber-night.mp4')), 'example pack installed to userData/packs/cyber-night');
  await page.evaluate(() => { window.AeroAmp.applyTheme('blue', 'aero'); window.AeroAmp.setScene('cyber-night/cyber-night', true); }); await sleep(2500);
  const ps = await page.evaluate(async () => {
    const r = await fetch('packs/cyber-night/preview.jpg'), bad = await fetch('packs/cyber-night/..%2F..%2Fwindow-state.json').catch(() => ({ status: 'err' }));
    const core = await fetch('packs/luciel-core/pack.json');
    return { status: r.status, type: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options'), traversal: bad.status, core: core.status, scene: window.AeroAmp.luciel.scene.id };
  });
  const servedPk = (await W(app, () => global.__lucielServed.filter((x) => /\/packs\/cyber-night\//.test(x)))).length;
  ok(ps.status === 200 && ps.type === 'image/jpeg' && ps.nosniff === 'nosniff' && ps.traversal !== 200 && ps.core === 200 && ps.scene === 'cyber-night/cyber-night' && servedPk > 0, `pack files served over app:// with fixed types, traversal blocked: ${JSON.stringify(ps)} (${servedPk} requests)`);
  await shot(app, 'desktop-pack-cyber-night.png');
  // Lucielle Styles: the big real pack through the same import path (main-process validation + write to userData)
  const STYLES = '/workspace/luciel-dist/lucielle-styles-pack.zip';
  if (fs.existsSync(STYLES)) {
    await page.setInputFiles('#packZipInput', STYLES);
    await page.waitForFunction(() => window.AeroAmp.packs.installed.some((p) => p.id === 'lucielle-styles'), null, { timeout: 120000 }).catch(() => {});
    const sdir = path.join(UD, 'packs', 'lucielle-styles');
    const sm = await page.evaluate(() => document.getElementById('pkMsg').textContent.replace(/\s+/g, ' '));
    ok(fs.existsSync(path.join(sdir, 'bg', 'city-punk.mp4')) && fs.existsSync(path.join(sdir, 'bg', 'city-punk-px.mp4')) && fs.existsSync(path.join(sdir, 'char', 'city-punk-headbang.webp')) && !/warning|Couldn/i.test(sm), 'Lucielle Styles installed to userData/packs (no errors/warnings): ' + sm.slice(0, 90));
    for (const [id, skin, base, acc] of [['lucielle-styles/city-punk', 'aero', 'red', '#ff2a3d'], ['lucielle-styles/arcade-angel-pixel', 'classic', 'blue', '#ff3fd0'], ['lucielle-styles/fall-girl', 'aero', 'aero', '#d9692b']]) {
      await page.evaluate(([id, skin]) => { const A = window.AeroAmp; A.applyTheme('aero', skin); A.setScene(id, true); A.luciel.musicEvent('drop'); }, [id, skin]); await sleep(2200);
      const st = await page.evaluate(() => ({ pal: document.body.dataset.palette, acc: document.body.style.getPropertyValue('--accent'), layer: window.AeroAmp.luciel.layer, scene: window.AeroAmp.luciel.scene.id }));
      ok(st.scene === id && st.pal === base && st.acc === acc && st.layer && /emote-headbang|\|(slow|mid|fast)/.test(st.layer.name), `${id} [${skin}] on desktop: colours ${st.pal}/${st.acc}, stage ${st.layer && st.layer.name}`);
      await shot(app, `desktop-styles-${id.split('/')[1]}-${skin}.png`);
    }
    const servedSt = (await W(app, () => global.__lucielServed.filter((x) => /\/packs\/lucielle-styles\/(bg\/.*\.mp4|bg\/.*glow|char\/)/.test(x)))).length;
    ok(servedSt >= 3, `styles videos / glow maps / sheets served over app:// (${servedSt} requests)`);
    await page.evaluate(() => { window.AeroAmp.applyTheme('blue', 'aero'); window.AeroAmp.setScene('cyber-night/cyber-night', true); }); await sleep(500);
  }
  await page.setInputFiles('#packZipInput', path.join(BADPACKS, 'script.zip')); await sleep(1200);
  ok(!fs.existsSync(path.join(UD, 'packs', 'evil')) && /payload\.js/.test(await page.evaluate(() => document.getElementById('pkMsg').textContent)), 'pack with a script is rejected, nothing written');
  const rev = await page.evaluate(() => window.lucielNative.packs.install({ text: JSON.stringify({ id: 'sneaky', name: 'S', version: '1', scenes: [{ id: 'a', name: 'A', background: { image: 'a.png' } }] }), files: [{ path: 'a.png', data: new TextEncoder().encode('<script>x</script>') }, { path: '../../evil.js', data: new Uint8Array([1]) }] }).then(() => 'installed', (e) => 'rejected: ' + e.message));
  ok(/^rejected/.test(rev) && !fs.existsSync(path.join(UD, 'packs', 'sneaky')) && !fs.existsSync(path.join(UD, 'evil.js')), 'main process re-validates installs (bypassing the UI is refused): ' + rev.slice(0, 120));
  await shot(app, 'desktop-packs-manager.png');
  await page.evaluate(() => { const o = document.getElementById('packsOverlay'); if (o) o.hidden = true; window.AeroAmp.applyTheme('aero', 'aero'); window.AeroAmp.setScene('auto', true); });

  // ---------- 7. tag editor writes the file on disk and renames it (window.lucielNative.writeFile / rename)
  await page.evaluate((p) => { const a = window.AeroAmp; const t = [...a.lib.values()].find((x) => x.nativePath === p); a.editTracks([t]); }, song);
  await page.waitForSelector('#editOverlay:not([hidden]) input[data-k="title"]'); await sleep(600);
  const diskChecked = await page.isChecked('#edDisk');
  await page.fill('#editOverlay input[data-k="title"]', 'Skyline Bubbles (Desktop Edit)');
  await page.fill('#editOverlay input[data-k="genre"]', 'Synthwave');
  await page.click('#editOverlay [data-x="pattern"]'); await sleep(200);
  console.log('  new name:', await page.inputValue('#edName'));
  await shot(app, 'desktop-tag-editor.png');
  await page.click('#editOverlay [data-x="save"]'); await page.waitForSelector('#editOverlay', { state: 'hidden', timeout: 15000 });
  await sleep(500);
  const renamed = path.join(WORK, 'Aqua Vista - Skyline Bubbles (Desktop Edit).mp3');
  const exists = fs.existsSync(renamed), oldGone = !fs.existsSync(song);
  let tags = {}; try { tags = JSON.parse(cp.execSync(`ffprobe -v error -show_entries format_tags -of json "${renamed}"`).toString()).format.tags; } catch (e) {}
  ok(diskChecked && exists && oldGone && tags.title === 'Skyline Bubbles (Desktop Edit)' && tags.genre === 'Synthwave', `tag editor saved in place + renamed on disk: ${path.basename(renamed)} ${JSON.stringify({ title: tags.title, genre: tags.genre })}`);
  const np = await page.evaluate(() => [...window.AeroAmp.lib.values()].find((x) => /Desktop Edit/.test(x.meta.title || '')).nativePath);
  ok(np === renamed, 'library keeps the new disk path');

  // ---------- 8. IndexedDB persists across a reload
  await page.reload(); await page.waitForFunction(() => window.AeroAmp && window.AeroAmp.lib.size >= 1, null, { timeout: 20000 }); await sleep(800);
  ok(await page.evaluate(() => window.AeroAmp.lib.size) >= 4, 'library restored from IndexedDB after reload');
  await page.waitForFunction(() => window.AeroAmp.packs.installed.length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(await page.evaluate(() => window.AeroAmp.packs.installed.some((p) => p.id === 'cyber-night') && window.Luciel.Scenes.list.some((x) => x.id === 'cyber-night/neon-glitch')), 'installed pack is loaded again after reload');
  await page.evaluate(() => window.AeroAmp.packs.remove('cyber-night')); await sleep(500);
  ok(!fs.existsSync(path.join(UD, 'packs', 'cyber-night')) && !(await page.evaluate(() => window.Luciel.Scenes.list.some((x) => x.id.startsWith('cyber-night/')))), 'deleting a pack removes its folder and scenes');

  // ---------- 9. close button -> app quits, window state saved
  await W(app, ({ BrowserWindow }) => global.__lucielMain().setBounds({ x: 120, y: 90, width: 1100, height: 700 })); await sleep(600);
  const closed = new Promise((r) => app.process().on('exit', r));
  await page.click('#dtbClose').catch(() => {});
  const code = await Promise.race([closed, sleep(8000).then(() => 'timeout')]);
  let ws = {}; try { ws = JSON.parse(fs.readFileSync(path.join(UD, 'window-state.json'), 'utf8')); } catch (e) {}
  ok(code !== 'timeout', `close button quits the app (exit ${code})`);
  ok(ws.width === 1100 && ws.height === 700 && ws.maximized === false, `window size/position remembered: ${JSON.stringify(ws)}`);
  const errs1 = errors.slice(), logs1 = logs.filter((l) => /renderer:|error|Error/i.test(l));

  // ---------- 10. relaunch restores the bounds; maximized state is remembered too
  ({ app, page, logs, errors } = await launch());
  await sleep(1000);
  const b = await W(app, ({ BrowserWindow }) => global.__lucielMain().getBounds());
  ok(b.width === 1100 && b.height === 700, `relaunch restores ${b.width}x${b.height} at ${b.x},${b.y}`);
  await page.click('#dtbMax'); await sleep(700); await W(app, ({ BrowserWindow }) => global.__lucielMain().close()); await sleep(1500);
  ({ app, page, logs, errors } = await launch()); await sleep(1200);
  ok(await isMax(), 'relaunch restores the maximized state');
  await app.close();

  // ---------- 11. single instance: a second launch forwards its file to the running app and exits
  fs.rmSync(path.join(UD, 'window-state.json'), { force: true });
  ({ app, page, logs, errors } = await launch([], { LUCIEL_TEST: 'lock' })); await sleep(1500);
  const before = await page.evaluate(() => window.AeroAmp.tracks.length);
  const second = cp.spawn(EXE, ['--no-sandbox', path.join(WORK, '05 - Ember Signal.m4a')], { env: { ...process.env, LUCIEL_USER_DATA: UD }, stdio: 'ignore' });
  const sc = await Promise.race([new Promise((r) => second.on('exit', (c) => r(c))), sleep(15000).then(() => 'timeout')]);
  await page.waitForFunction(() => window.AeroAmp.current && /Ember Signal/.test(window.AeroAmp.current.name), null, { timeout: 15000 }).catch(() => {});
  const cur = await page.evaluate(() => window.AeroAmp.current && window.AeroAmp.current.name);
  ok(sc !== 'timeout' && /Ember Signal/.test(cur || ''), `second instance exited (${sc}) and the running app opened its file: ${cur}`);
  if (sc === 'timeout') second.kill();
  const errs2 = errors.slice();
  await app.close();

  let allErr = errs1.concat(errs2);
  const i403 = allErr.findIndex((e) => /status of 403/.test(e)); if (i403 >= 0) allErr.splice(i403, 1);   // the deliberate ../ traversal probe in 6c
  ok(!allErr.length, 'no renderer console errors/warnings' + (allErr.length ? ': ' + allErr.join(' | ') : ''));
  if (logs1.length) console.log('main-process notes:', logs1.slice(0, 8));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
