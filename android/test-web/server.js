// Stand-in for the Android side of https://appassets.androidplatform.net: serves the synced web app plus the /_n/*
// endpoints (content:// streaming with Range, album art, outside-player cover) from local test files.
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const WWW = process.env.WWW || path.resolve(__dirname, '../app/src/main/assets/www');
const MEDIA = process.env.MEDIA || '/workspace/aero-player-test/media';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma' };
const stats = { range: 0, full: 0, art: 0 };
function contentFile(u) { const m = /^content:\/\/test\/(.+)$/.exec(u || ''); return m ? path.join(MEDIA, decodeURIComponent(m[1])) : null; }
const server = http.createServer((req, res) => {
  const q = url.parse(req.url, true);
  if (q.pathname === '/_stats') { res.end(JSON.stringify(stats)); return; }
  if (q.pathname === '/_n/c') {
    const f = contentFile(q.query.u); if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      stats.range++;
      let s = m[1] ? +m[1] : size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(f, { start: s, end: e }).pipe(res);
    } else { stats.full++; res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(res); }
    return;
  }
  if (q.pathname === '/_n/art') { stats.art++; res.writeHead(404); res.end(); return; }
  if (q.pathname === '/_n/ext-art') { const f = path.join(WWW, 'art/thumb/synthwave.webp'); res.writeHead(200, { 'Content-Type': 'image/webp' }); fs.createReadStream(f).pipe(res); return; }
  let p = path.join(WWW, decodeURIComponent(q.pathname === '/' ? '/index.html' : q.pathname));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
module.exports = { start: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server))), stats, MEDIA };
if (require.main === module) server.listen(+process.env.PORT || 8960, '127.0.0.1', () => console.log('listening'));
