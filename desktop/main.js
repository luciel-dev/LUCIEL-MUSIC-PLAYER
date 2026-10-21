// Luciel desktop shell (Electron). Serves the web app from app://luciel/ (standard + secure origin, so WebGL,
// getImageData, IndexedDB and video range requests behave exactly like https), with a frameless skinned window,
// tray, taskbar thumbnail buttons, single-instance file opening and native file IO for the tag editor.
'use strict';
const { app, BrowserWindow, protocol, ipcMain, dialog, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('path'), fs = require('fs'), fsp = require('fs/promises');

const APP_DIR = path.join(__dirname, 'app');
const ASSETS = path.join(__dirname, 'assets');
const AUDIO_EXT = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'aac', 'wav', 'webm', 'weba', 'aif', 'aiff', 'wma', 'mka']);
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', txt: 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob: data: https://api.open-meteo.com https://geocoding-api.open-meteo.com; object-src 'none'; base-uri 'self'; form-action 'none'";
const DESIGN = { aero: [1280, 800], classic: [900, 720] };   // the size each skin was laid out for; the page is zoomed to fit
const MIN_W = 800, MIN_H = 520;
const isTest = !!process.env.LUCIEL_TEST;
// visual-pack rules (format, limits, allowed file types) are shared with the renderer: the same file validates both sides
const Packs = require(path.join(APP_DIR, 'js', 'packs.js'));
const PACKS_DIR = () => path.join(app.getPath('userData'), 'packs');

app.setName('Luciel');
if (process.platform === 'win32') app.setAppUserModelId('com.pj.luciel');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');   // software WebGL fallback (dither shader) on PCs whose GPU is blocklisted; content is local-only
if (process.env.LUCIEL_USER_DATA) app.setPath('userData', process.env.LUCIEL_USER_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);

// ------------------------------------------------------------------ single instance + files from the OS
const pendingPaths = [];
const audioPathsFrom = (argv) => argv.filter((a) => a && !a.startsWith('-') && AUDIO_EXT.has(path.extname(a).slice(1).toLowerCase()) && fs.existsSync(a));
const primary = (isTest && process.env.LUCIEL_TEST !== 'lock') || app.requestSingleInstanceLock();
if (!primary) app.quit();   // a second launch forwards its files to the running instance (second-instance) and exits
app.on('second-instance', (_e, argv) => { const p = audioPathsFrom(argv.slice(1)); if (p.length) sendPaths(p); showWindow(); });
app.on('open-file', (e, p) => { e.preventDefault(); sendPaths([p]); });   // macOS
pendingPaths.push(...audioPathsFrom(process.argv.slice(app.isPackaged ? 1 : 2)));

let win = null, tray = null, rendererReady = false, state = { playing: false, title: '', artist: '' }, skin = 'aero';
function sendPaths(paths) { if (win && rendererReady) win.webContents.send('open-paths', paths); else pendingPaths.push(...paths); }
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

// ------------------------------------------------------------------ window state
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() {
  let s = {}; try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) {}
  const w = Math.max(MIN_W, s.width || 1280), h = Math.max(MIN_H, s.height || 820);
  const out = { width: w, height: h, maximized: !!s.maximized };
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {   // only restore a position that is still on a connected display
    const d = screen.getDisplayMatching({ x: s.x, y: s.y, width: w, height: h }).workArea;
    if (s.x < d.x + d.width - 80 && s.x + w > d.x + 80 && s.y >= d.y - 10 && s.y < d.y + d.height - 60) { out.x = s.x; out.y = s.y; }
  }
  return out;
}
let saveT = 0;
function saveWinState() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.isMaximized() || win.isMinimized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) {}
  }, 250);
}

// ------------------------------------------------------------------ fit-to-window zoom
function applyZoom() {
  if (!win || win.isDestroyed()) return;
  const [cw, ch] = win.getContentSize(), [dw, dh] = DESIGN[skin] || DESIGN.aero;
  const k = Math.max(0.55, Math.min(2.0, Math.min(cw / dw, (ch) / dh)));
  win.webContents.setZoomFactor(Math.round(k * 1000) / 1000);
}

function createWindow() {
  const ws = loadWinState();
  win = new BrowserWindow({
    ...ws, minWidth: MIN_W, minHeight: MIN_H, show: false, frame: false, title: 'Luciel',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined, trafficLightPosition: { x: 12, y: 9 },
    backgroundColor: '#0b1530', icon: path.join(ASSETS, process.platform === 'win32' ? 'icon-256.png' : 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  if (ws.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!process.env.LUCIEL_HIDDEN) win.show(); });
  win.loadURL('app://luciel/index.html');
  const st = () => { win.webContents.send('win-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() }); };
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'].forEach((ev) => win.on(ev, () => { st(); saveWinState(); }));
  ['resize', 'move'].forEach((ev) => win.on(ev, saveWinState));
  win.on('resize', applyZoom);
  win.webContents.on('did-finish-load', () => { applyZoom(); st(); });
  win.on('close', () => { clearTimeout(saveT); try { const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds(); fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) {} });
  win.on('closed', () => { win = null; if (floater && !floater.isDestroyed()) floater.destroy(); });
  // links open in the real browser; never navigate the app window away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://luciel/')) e.preventDefault(); });
  win.webContents.on('console-message', (e) => { if (isTest) { const lv = e.level; if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) console.log(`[renderer:${lv}] ${e.message}`); } });
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer gone]', d.reason));
  updateThumbar();
}

// ------------------------------------------------------------------ tray + thumbnail toolbar
const img = (n) => nativeImage.createFromPath(path.join(ASSETS, n));
function cmd(c) { if (win) win.webContents.send('command', c); }
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: state.title ? `${state.title}${state.artist ? ' – ' + state.artist : ''}`.slice(0, 60) : 'Luciel', enabled: false },
    { type: 'separator' },
    { label: state.playing ? 'Pause' : 'Play', click: () => cmd('toggle') },
    { label: 'Next', click: () => cmd('next') },
    { label: 'Previous', click: () => cmd('prev') },
    { type: 'separator' },
    { label: 'Mini player', type: 'checkbox', checked: !!floater, click: () => (floater ? closeFloater() : openFloater({ hideMain: !!fl().hideMain })) },
    { label: 'Show Luciel', click: showWindow },
    { label: 'Quit', click: () => app.quit() },
  ]);
}
const refreshTray = () => { if (tray) tray.setContextMenu(trayMenu()); };

// ------------------------------------------------------------------ floater: the always-on-top mini player window
// A remote for the main window: audio keeps playing there; state comes in on 'mini:state' and is forwarded to the
// floater, button presses come back on 'mini:cmd'. Position, size per mode (compact / large) and pin are remembered.
const FL_DEF = { compact: { w: 340, h: 120 }, large: { w: 340, h: 360 } };
let floater = null, miniLast = null, flState = null, flSaveT = 0;
const flFile = () => path.join(app.getPath('userData'), 'floater-state.json');
function fl() {
  if (!flState) { try { flState = JSON.parse(fs.readFileSync(flFile(), 'utf8')); } catch (e) { flState = {}; } }
  if (flState.pinned === undefined) flState.pinned = true;
  if (flState.mode !== 'large') flState.mode = 'compact';
  return flState;
}
function flSave() { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(flFile(), JSON.stringify(fl())); } catch (e) {} }
const modeFor = (h) => (h >= 190 ? 'large' : 'compact');
function sizeFor(mode) {
  const s = fl()[mode], d = FL_DEF[mode];
  if (!s || !(s.w >= 260) || !(s.h >= 96) || modeFor(s.h) !== mode) return { ...d };
  return { w: Math.min(900, s.w), h: Math.min(900, s.h) };
}
function onScreen(x, y, w, h) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const d = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return x < d.x + d.width - 60 && x + w > d.x + 60 && y >= d.y - 10 && y < d.y + d.height - 40 ? { x, y } : null;
}
function openFloater(opts = {}) {
  if (!win) return;
  const s = fl();
  if (opts.hideMain !== undefined) s.hideMain = !!opts.hideMain;
  if (floater) { floater.show(); floater.focus(); }
  else {
    const sz = sizeFor(s.mode);
    let pos = onScreen(s.x, s.y, sz.w, sz.h);
    if (!pos) { const wa = screen.getDisplayMatching(win.getBounds()).workArea; pos = { x: wa.x + wa.width - sz.w - 24, y: wa.y + wa.height - sz.h - 24 }; }
    floater = new BrowserWindow({
      x: pos.x, y: pos.y, width: sz.w, height: sz.h, minWidth: 260, minHeight: 96, maxWidth: 900, maxHeight: 900,
      frame: false, resizable: true, maximizable: false, fullscreenable: false, minimizable: true, skipTaskbar: true, alwaysOnTop: !!s.pinned, show: false,
      title: 'Luciel Mini', backgroundColor: '#0b1530', icon: path.join(ASSETS, 'icon-256.png'),
      webPreferences: { preload: path.join(__dirname, 'preload-mini.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
    });
    if (s.pinned) floater.setAlwaysOnTop(true, 'floating');
    floater.loadURL('app://luciel/floater.html');
    floater.once('ready-to-show', () => { if (floater && !process.env.LUCIEL_HIDDEN) floater.show(); });
    ['move', 'resize'].forEach((ev) => floater.on(ev, saveFloater));
    floater.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    floater.webContents.on('will-navigate', (e) => e.preventDefault());
    floater.webContents.on('console-message', (e) => { if (isTest) { const lv = e.level; if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) console.log(`[floater:${lv}] ${e.message}`); } });
    floater.on('closed', () => {
      floater = null; flSave();
      if (win && !win.isDestroyed()) { win.webContents.send('mini-open', false); if (!win.isVisible()) showWindow(); }
      refreshTray();
    });
  }
  if (s.hideMain && win.isVisible()) win.hide();     // main goes to the tray; music keeps playing in it
  win.webContents.send('mini-open', true);
  refreshTray();
}
function closeFloater() { if (floater && !floater.isDestroyed()) floater.close(); }
function saveFloater() {
  clearTimeout(flSaveT);
  flSaveT = setTimeout(() => {
    if (!floater || floater.isDestroyed() || floater.isMinimized()) return;
    const b = floater.getBounds(), s = fl(), m = modeFor(b.height);
    s.x = b.x; s.y = b.y; s[m] = { w: b.width, h: b.height }; s.mode = m; flSave();
  }, 200);
}
function setFloaterMode(mode) {
  if (!floater) return;
  const s = fl(), sz = sizeFor(mode), b = floater.getBounds(), wa = screen.getDisplayMatching(b).workArea;
  let y = b.y; if (y + sz.h > wa.y + wa.height) y = Math.max(wa.y, b.y + b.height - sz.h);   // grow upward near the bottom edge
  s.mode = mode; floater.setBounds({ x: b.x, y, width: sz.w, height: sz.h }); flSave();
  floater.webContents.send('mini-win', { mode });
}
function setPinned(p) {
  const s = fl(); s.pinned = !!p; flSave();
  if (floater) { floater.setAlwaysOnTop(s.pinned, 'floating'); floater.webContents.send('mini-win', { pinned: s.pinned }); }
}
const MINI_REMOTE = new Set(['toggle', 'next', 'prev', 'seek', 'seekBy', 'volume', 'mute']);
const fromMain = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
const fromFloater = (e) => floater && !floater.isDestroyed() && e.sender === floater.webContents;
ipcMain.on('mini:toggle', (e, o) => { if (fromMain(e)) { if (floater) closeFloater(); else openFloater(o || {}); } });
ipcMain.on('mini:open', (e, o) => { if (fromMain(e)) openFloater(o || {}); });
ipcMain.on('mini:close', (e) => { if (fromMain(e)) closeFloater(); });
ipcMain.on('mini:showMain', (e) => { if (fromMain(e)) showWindow(); });
ipcMain.on('mini:state', (e, st) => {
  if (!fromMain(e) || !st || typeof st !== 'object') return;
  miniLast = st;
  if (floater && !floater.isDestroyed()) floater.webContents.send('mini-state', st);
});
ipcMain.on('mini:ready', (e) => {
  if (!fromFloater(e)) return;
  e.sender.send('mini-win', { pinned: !!fl().pinned, mode: fl().mode });
  if (miniLast) e.sender.send('mini-state', miniLast);
  if (win) win.webContents.send('mini-open', true);     // ask the main window for a fresh push
});
ipcMain.on('mini:cmd', (e, c, arg) => {
  if (!fromFloater(e)) return;
  if (c === 'pin') setPinned(!fl().pinned);
  else if (c === 'mode') setFloaterMode(arg === 'large' ? 'large' : 'compact');
  else if (c === 'expand') { showWindow(); closeFloater(); }
  else if (c === 'close') closeFloater();
  else if (c === 'minimize') floater.minimize();
  else if (MINI_REMOTE.has(c) && win) win.webContents.send('mini-cmd', { cmd: c, arg: typeof arg === 'number' ? arg : undefined });
});

// ------------------------------------------------------------------ visual packs on disk: userData/packs/<id>/...
// The renderer unpacks + validates; main re-validates with the same rules before anything touches the disk.
const packsIndexFile = () => path.join(PACKS_DIR(), 'index.json');
function packsIndex() { try { return JSON.parse(fs.readFileSync(packsIndexFile(), 'utf8')) || {}; } catch (e) { return {}; } }
function savePacksIndex(ix) { fs.mkdirSync(PACKS_DIR(), { recursive: true }); fs.writeFileSync(packsIndexFile(), JSON.stringify(ix, null, 1)); }
async function listFiles(dir, base = '', out = []) {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) { if (out.length < 2000) await listFiles(path.join(dir, d.name), rel, out); }
    else if (d.isFile()) out.push({ path: rel, size: (await fsp.stat(path.join(dir, d.name))).size });
  }
  return out;
}
ipcMain.handle('packs:list', async (e) => {
  if (!fromMain(e)) return [];
  const ix = packsIndex(), out = [];
  let dirs = []; try { dirs = await fsp.readdir(PACKS_DIR(), { withFileTypes: true }); } catch (x) { return []; }
  for (const d of dirs) {
    if (!d.isDirectory() || !Packs.ID_RE.test(d.name)) continue;
    const dir = path.join(PACKS_DIR(), d.name);
    let text; try { text = await fsp.readFile(path.join(dir, 'pack.json'), 'utf8'); } catch (x) { continue; }
    out.push({ id: d.name, text, enabled: !ix[d.name] || ix[d.name].enabled !== false, installedAt: (ix[d.name] && ix[d.name].installedAt) || 0, files: await listFiles(dir) });
  }
  return out;
});
ipcMain.handle('packs:install', async (e, req) => {
  if (!fromMain(e)) throw new Error('not allowed');
  const files = new Map();
  for (const f of (req && req.files) || []) {
    const data = f && f.data instanceof Uint8Array ? f.data : f && f.data && new Uint8Array(f.data);
    if (!data) continue;
    files.set(String(f.path), { path: String(f.path), size: data.length, data });
  }
  const v = Packs.check(req && req.text, files);
  if (!v.ok) { const err = new Error(v.errors.join('\n')); throw err; }
  const id = v.pack.id, root = PACKS_DIR(), dst = path.join(root, id), tmp = path.join(root, `.tmp-${id}-${Date.now()}`);
  if (path.dirname(dst) !== root) throw new Error('bad pack id');
  await fsp.mkdir(tmp, { recursive: true });
  try {
    for (const [p, f] of files) {
      const sp = Packs.safePath(p); if (!sp || p === 'pack.json') continue;
      const out = path.join(tmp, ...sp.split('/'));
      if (!out.startsWith(tmp + path.sep)) throw new Error('bad path ' + p);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
    }
    await fsp.writeFile(path.join(tmp, 'pack.json'), String(req.text));
    await fsp.rm(dst, { recursive: true, force: true });
    await fsp.rename(tmp, dst);
  } catch (x) { await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); throw x; }
  const ix = packsIndex(); ix[id] = { enabled: true, installedAt: Date.now(), version: v.pack.version }; savePacksIndex(ix);
  return { ok: true, id, warnings: v.warnings };
});
ipcMain.handle('packs:remove', async (e, id) => {
  if (!fromMain(e) || !Packs.ID_RE.test(String(id))) throw new Error('bad pack id');
  await fsp.rm(path.join(PACKS_DIR(), id), { recursive: true, force: true });
  const ix = packsIndex(); delete ix[id]; savePacksIndex(ix); return true;
});
ipcMain.handle('packs:setEnabled', async (e, id, on) => {
  if (!fromMain(e) || !Packs.ID_RE.test(String(id))) throw new Error('bad pack id');
  const ix = packsIndex(); ix[id] = Object.assign(ix[id] || {}, { enabled: !!on }); savePacksIndex(ix); return true;
});
function createTray() {
  try {
    tray = new Tray(img(process.platform === 'win32' ? 'tray-16.png' : 'tray-32.png'));
    tray.setToolTip('Luciel'); tray.setContextMenu(trayMenu());
    tray.on('click', () => { if (win && win.isVisible() && win.isFocused()) win.minimize(); else showWindow(); });
  } catch (e) { console.warn('[tray]', e.message); }
}
function updateThumbar() {
  if (!win || process.platform !== 'win32') return;
  win.setThumbarButtons([
    { tooltip: 'Previous', icon: img('tb-prev.png'), click: () => cmd('prev') },
    { tooltip: state.playing ? 'Pause' : 'Play', icon: img(state.playing ? 'tb-pause.png' : 'tb-play.png'), click: () => cmd('toggle') },
    { tooltip: 'Next', icon: img('tb-next.png'), click: () => cmd('next') },
  ]);
}

// ------------------------------------------------------------------ IPC
const okAudio = (p) => typeof p === 'string' && path.isAbsolute(p) && AUDIO_EXT.has(path.extname(p).slice(1).toLowerCase());
async function walk(p, base, out, depth = 0) {
  let st; try { st = await fsp.stat(p); } catch (e) { return; }
  if (st.isDirectory()) {
    if (depth > 12) return;
    const ents = await fsp.readdir(p).catch(() => []);
    for (const n of ents.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) if (!n.startsWith('.')) await walk(path.join(p, n), base, out, depth + 1);
  } else if (st.isFile() && okAudio(p)) out.push({ p, st, rel: base ? path.relative(base, p).split(path.sep).join('/') : '' });
}
ipcMain.handle('fs:readPaths', async (_e, paths) => {
  const found = [];
  for (const p of (paths || []).slice(0, 5000)) {
    let st; try { st = await fsp.stat(p); } catch (e) { continue; }
    if (st.isDirectory()) await walk(p, path.dirname(p), found); else await walk(p, '', found);
  }
  const out = [];
  for (const f of found.slice(0, 20000)) {
    try { const data = await fsp.readFile(f.p); out.push({ path: f.p, name: path.basename(f.p), rel: f.rel, size: f.st.size, mtime: f.st.mtimeMs, data }); } catch (e) {}
  }
  return out;
});
ipcMain.handle('fs:writeFile', async (_e, p, data) => {
  if (!okAudio(p)) throw new Error('Refusing to write a non-audio path');
  await fsp.access(p, fs.constants.W_OK);                    // only existing files (the ones the library opened)
  const tmp = p + '.luciel-tmp';
  await fsp.writeFile(tmp, Buffer.from(data));
  await fsp.rename(tmp, p);                                   // atomic replace on the same volume
  return true;
});
ipcMain.handle('fs:rename', async (_e, p, newName) => {
  if (!okAudio(p)) throw new Error('Refusing to rename a non-audio path');
  const clean = String(newName).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
  if (!clean || !okAudio(path.join(path.dirname(p), clean))) throw new Error('Invalid file name');
  const dst = path.join(path.dirname(p), clean);
  if (dst === p) return p;
  if (fs.existsSync(dst) && dst.toLowerCase() !== p.toLowerCase()) throw new Error(`“${clean}” already exists`);
  await fsp.rename(p, dst); return dst;
});
const AUDIO_FILTER = [{ name: 'Audio', extensions: [...AUDIO_EXT] }, { name: 'All files', extensions: ['*'] }];
ipcMain.handle('dlg:pickFiles', async () => (await dialog.showOpenDialog(win, { title: 'Add music', properties: ['openFile', 'multiSelections'], filters: AUDIO_FILTER })).filePaths);
ipcMain.handle('dlg:pickFolder', async () => (await dialog.showOpenDialog(win, { title: 'Add a music folder', properties: ['openDirectory'] })).filePaths);
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:toggleMaximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
ipcMain.on('win:close', () => win && win.close());
ipcMain.handle('win:state', () => ({ maximized: !!(win && win.isMaximized()), platform: process.platform }));
ipcMain.on('app:ready', () => { rendererReady = true; if (pendingPaths.length) { win.webContents.send('open-paths', pendingPaths.splice(0)); } });
ipcMain.on('app:state', (_e, s) => {
  const was = state.playing; state = { ...state, ...s };
  if (tray) { tray.setToolTip(state.title ? `Luciel – ${state.title}${state.artist ? ' – ' + state.artist : ''}`.slice(0, 120) : 'Luciel'); tray.setContextMenu(trayMenu()); }
  if (was !== state.playing) updateThumbar();
});
ipcMain.on('app:skin', (_e, s) => { if (DESIGN[s]) { skin = s; applyZoom(); } });

// ------------------------------------------------------------------ app:// protocol (with HTTP range support for <video>/<audio>)
const served = (global.__lucielServed = []);
function serve(req) {
  const u = new URL(req.url);
  if (isTest && served.length < 2000) served.push(`${req.headers.get('range') ? 'RANGE ' : ''}${u.pathname}`);
  let rel; try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'; } catch (e) { return new Response('Bad request', { status: 400 }); }
  let file, type;
  const pk = /^packs\/([^/]+)\/(.+)$/.exec(rel);
  if (pk && pk[1] !== 'luciel-core') {
    // imported visual pack: media + JSON only, never scripts / html, served with nosniff
    const sub = Packs.safePath(pk[2]);
    if (!Packs.ID_RE.test(pk[1]) || !sub || !Packs.typeOf(sub)) return new Response('Forbidden', { status: 403 });
    const root = path.join(PACKS_DIR(), pk[1]);
    file = path.normalize(path.join(root, ...sub.split('/')));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    type = Packs.MIME[Packs.extOf(sub)] || 'application/octet-stream';
  } else {
    file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  }
  let st; try { st = fs.statSync(file); } catch (e) { return new Response('Not found', { status: 404 }); }
  if (st.isDirectory()) return new Response('Not found', { status: 404 });
  const headers = { 'Content-Security-Policy': CSP, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
  const range = req.headers.get('range'); const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    let start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const buf = Buffer.alloc(end - start + 1); const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    return new Response(buf, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(buf.length) } });
  }
  return new Response(fs.readFileSync(file), { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
}

app.whenReady().then(() => {
  if (!primary) return;
  protocol.handle('app', serve);
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  createWindow();
  if (!isTest || process.env.LUCIEL_TRAY) createTray();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else showWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });
if (isTest) { global.__lucielMain = () => win; global.__lucielFloater = () => floater; global.__lucielFl = () => fl(); }
module.exports = { applyZoom };
