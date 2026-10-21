// Copies the Luciel web app (../web in the monorepo, or $LUCIEL_WEB) into app/src/main/assets/www, minus
// samples/screenshots/tools/tests, applies a few small *anchored* patches for Android (each must match exactly once,
// otherwise the build fails loudly instead of shipping a half-patched app) and injects the Android layer (web/).
// aero-player itself is never modified.
const fs = require('fs'), path = require('path');
const SRC = process.env.LUCIEL_WEB || path.resolve(__dirname, '../../web');
const ROOT = path.resolve(__dirname, '..');
const DST = process.env.LUCIEL_OUT || path.join(ROOT, 'app/src/main/assets/www');
const SKIP = new Set(['samples', 'screenshots', 'tools', 'test', 'tests', '.git', 'node_modules', '__pycache__']);
const SKIP_FILES = /\.(py|pyc|zip|md|txt)$|^\.DS_Store$/;
fs.rmSync(DST, { recursive: true, force: true });
let n = 0, bytes = 0;
(function copy(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const sp = path.join(s, e.name), dp = path.join(d, e.name);
    if (e.isDirectory()) copy(sp, dp);
    else if (!SKIP_FILES.test(e.name)) { fs.copyFileSync(sp, dp); n++; bytes += fs.statSync(sp).size; }
  }
})(SRC, DST);

function patch(file, edits) {
  const p = path.join(DST, file); let s = fs.readFileSync(p, 'utf8');
  for (const [from, to, why] of edits) {
    const count = s.split(from).length - 1;
    if (count !== 1) { console.error(`PATCH FAILED (${count} matches) in ${file}: ${why}\n  anchor: ${from.slice(0, 120)}`); process.exit(2); }
    s = s.replace(from, to);
  }
  fs.writeFileSync(p, s);
}

patch('js/app.js', [
  // scanning the phone library must not start playing or dump thousands of songs into the queue
  ['async function addFiles(list, { playFirst = false } = {}) {',
   'async function addFiles(list, { playFirst = false, noPlay = false, noQueue = false } = {}) {', 'addFiles options'],
  ['    tracks.push(...added.filter((t) => !inQueue.has(t.id)));',
   '    if (!noQueue) tracks.push(...added.filter((t) => !inQueue.has(t.id)));', 'addFiles noQueue'],
  ['    if ((playFirst || !current) && added.length) {',
   '    if (!noPlay && (playFirst || !current) && added.length) {', 'addFiles noPlay'],
  // MediaStore already knows the duration – skip probing every file with an <audio> element
  ['duration: rec ? rec.duration : NaN, coverUrl: null,',
   'duration: rec ? rec.duration : (file && file.__duration > 0 ? file.__duration : NaN), coverUrl: null,', 'native duration'],
  // a rename-only edit of a phone file keeps the lazy (streamed) file object
  ['if (name !== t.name) t.file = new File([t.file], name, { type: t.file.type });',
   'if (name !== t.name && !t.file.__url) t.file = new File([t.file], name, { type: t.file.type });', 'keep lazy file on rename'],
  // "Now playing on Spotify": the frame loop reads beat data from the Android layer instead of the <audio> analyser
  ['      const active = !!engine.ctx && !audio.paused;\n      const classic',
   '      const XT = window.LucielExt && window.LucielExt.on ? window.LucielExt : null;\n      const active = XT ? XT.playing : (!!engine.ctx && !audio.paused);\n      const MT = XT ? XT.time() : audio.currentTime;\n      const classic', 'ext frame source'],
  ['      if (engine.analyser && active) {\n        if (!frame.buf)',
   '      const AN = XT ? XT.analyser : engine.analyser;\n      if (AN && active) {\n        if (!frame.buf)', 'ext analyser'],
  ['        const f = frame.buf; engine.analyser.getByteFrequencyData(f);\n        const hz = engine.ctx.sampleRate / engine.analyser.fftSize;',
   '        const f = frame.buf; AN.getByteFrequencyData(f);\n        const hz = AN.context.sampleRate / AN.fftSize;', 'ext analyser read'],
  ['        if (tracker.feed(bass, audio.currentTime) && !current.bpmInfo) renderBpm();',
   '        if (tracker.feed(bass, MT) && current && !current.bpmInfo && !XT) renderBpm();', 'ext tracker feed'],
  ['      luciel.tick({ playing: active, bpm: tracker.bpm, beatPos: tracker.beatAt(audio.currentTime), time: audio.currentTime, energy, bass, vocal, high, hasTracks: tracks.length > 0, pointerX, pointerY });',
   '      luciel.tick({ playing: active, bpm: tracker.bpm, beatPos: tracker.beatAt(MT), time: MT, energy, bass, vocal, high, hasTracks: tracks.length > 0 || !!XT, pointerX, pointerY });', 'ext tick'],
  // expose a few internals the Android layer needs
  ["window.Luciel.app = window.AeroAmp = { packs: packsUI,",
   "window.Luciel.app = window.AeroAmp = { tracker, vizBig, vizMini, togglePlay, setVolume, openFiles, openFolder, persist, packs: packsUI,", 'expose internals'],
  // let the Android layer wait for installed packs before offering the bundled Styles pack
  ['    packsUI.load().then(() => markSceneGrid());', '    window.LucielPacksReady = packsUI.load().then(() => markSceneGrid());', 'packs ready promise'],
]);

patch('js/luciel.js', [
  // full-screen phone stage (Spotify mode) is tall: size Lucielle by the narrower side so she doesn't overflow the width
  [": H * (st.size === 's' ? 0.66 : st.size === 'l' ? 0.98 : 0.84);",
   ": Math.min(H, W * 0.8) * (st.size === 's' ? 0.66 : st.size === 'l' ? 0.98 : 0.84);", 'portrait stage character size'],
  // (opacity fixes for Lucielle now live in aero-player itself, since desktop 1.0.4)
]);

patch('js/visualizer.js', [
  // scope / both before anything has played (no analyser yet): draw a flat line instead of throwing every frame
  ['        const t = this.time, step = t.length / W;', '        const t = this.time || new Uint8Array(1024).fill(128), step = t.length / W;', 'scope without analyser'],
]);

patch('js/mobile.js', [
  // 1.1.4: the Spotify tab has its own player, so Luciel's mini bar never sits on top of it (and it gives the space back);
  // on Luciel's own tabs the mini bar only ever shows Luciel's own music (miniInfo() no longer returns Spotify)
  ["    const t = A.current, show = active && (sp ? true : tab !== 'player' && !!t);",
   "    const t = A.current, apart = HAS_SP && !!(SP().hideMini && SP().hideMini(tab)), show = active && !apart && (sp ? true : tab !== 'player' && !!t);", 'mini bar kept apart from the Spotify tab'],
  // Settings > Spotify: the optional Spotify account (Client ID + Connect)
  ["<div class=\"m-sec\">Phone</div><div class=\"m-group\">${navRow('__phone', G_('☏'), 'Phone music, Spotify & permissions', null)}</div>",
   "<div class=\"m-sec\">Phone</div><div class=\"m-group\">${navRow('__phone', G_('☏'), 'Phone music, Spotify & permissions', null)}</div>${window.LucielSpotify && window.LucielSpotify.accountRow ? `<div class=\"m-sec\">Spotify</div><div class=\"m-group\">${navRow('__spAccount', G_('♫'), 'Spotify account · Client ID', null, window.LucielSpotify.accountRow())}</div>` : ''}", 'settings: Spotify account row'],
  ["else if (id === '__pop') popOut(); else if (id === '__phone') window.LucielAndroidUI.openSheet();",
   "else if (id === '__pop') popOut(); else if (id === '__phone') window.LucielAndroidUI.openSheet(); else if (id === '__spAccount') window.LucielSpotify.openAccount();", 'settings: open the Spotify account page'],
]);

// Android layer
fs.cpSync(path.join(ROOT, 'web'), path.join(DST, 'android'), { recursive: true });
// bundled visual packs (installed on first launch, re-installable from the Phone sheet)
const PACKS = (process.env.LUCIEL_PACKS || path.resolve(__dirname, '../../packs/dist/lucielle-styles-pack.zip')).split(':').filter((f) => f && fs.existsSync(f));
fs.mkdirSync(path.join(DST, 'android', 'packs'), { recursive: true });
for (const f of PACKS) fs.copyFileSync(f, path.join(DST, 'android', 'packs', path.basename(f)));
fs.writeFileSync(path.join(DST, 'android', 'packs', 'index.json'), JSON.stringify(PACKS.map((f) => ({ file: path.basename(f), size: fs.statSync(f).size, id: (() => { try { return JSON.parse(require('child_process').execFileSync('unzip', ['-p', f, 'pack.json'])).id; } catch (e) { return ''; } })() }))));
console.log('bundled packs:', PACKS.map((f) => path.basename(f)).join(', ') || 'none');
patch('index.html', [
  ['</head>', '<link rel="stylesheet" href="android/android.css">\n</head>', 'android css'],
]);
// the pre-layer must run after storage/metadata/bpm/tags/fsx are defined but before app.js uses them
let html = fs.readFileSync(path.join(DST, 'index.html'), 'utf8');
const m = html.match(/<script[^>]*src="js\/app\.js"[^>]*><\/script>/g);
if (!m || m.length !== 1) { console.error('PATCH FAILED: app.js script tag'); process.exit(2); }
html = html.replace(m[0], '<script src="android/android-pre.js"></script>\n' + m[0] + '\n<script src="android/android.js"></script>\n<script src="android/spotify.js"></script>');
fs.writeFileSync(path.join(DST, 'index.html'), html);
// the floater page is the desktop mini window – not used on Android
fs.rmSync(path.join(DST, 'floater.html'), { force: true });
console.log(`synced ${n} files (${(bytes / 1e6).toFixed(1)} MB) from ${SRC} -> ${path.relative(ROOT, DST)} (+ Android layer, patches OK)`);
