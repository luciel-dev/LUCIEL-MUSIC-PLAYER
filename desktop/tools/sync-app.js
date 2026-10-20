// Copies the web app (../web in the monorepo, or $LUCIEL_WEB) into ./app, minus samples/screenshots/tools/tests,
// and injects the desktop shell layer (desktop/desktop.css + desktop/desktop.js) into index.html.
const fs = require('fs'), path = require('path');
const SRC = process.env.LUCIEL_WEB || path.resolve(__dirname, '../../web');
const ROOT = path.resolve(__dirname, '..'), DST = path.join(ROOT, 'app');
const SKIP = new Set(['samples', 'screenshots', 'tools', 'test', 'tests', '.git', 'node_modules', '__pycache__']);
const SKIP_FILES = /\.(py|pyc|zip|md)$|^\.DS_Store$/;
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
fs.cpSync(path.join(ROOT, 'desktop'), path.join(DST, 'desktop'), { recursive: true });
const idx = path.join(DST, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
html = html.replace('</head>', '<link rel="stylesheet" href="desktop/desktop.css">\n</head>')
           .replace(/<\/body>/, '<script src="desktop/desktop.js"></script>\n</body>');
fs.writeFileSync(idx, html);
console.log(`synced ${n} files (${(bytes / 1e6).toFixed(1)} MB) from ${SRC} -> app/ (+ desktop layer)`);
