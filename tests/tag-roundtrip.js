// Round-trip test: write tags + cover with js/tagwriter.js, re-read with js/metadata.js and ffprobe, and decode the audio.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
globalThis.window = globalThis;
eval(fs.readFileSync('/workspace/aero-player/js/metadata.js', 'utf8'));
eval(fs.readFileSync('/workspace/aero-player/js/tagwriter.js', 'utf8'));
const media = process.env.MEDIA || '/workspace/aero-player-test/media';
const cover = new Uint8Array(fs.readFileSync('/workspace/aero-player/icons/icon-192.png'));
const jpg = '/tmp/luc/rt/cover.jpg';
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', '/workspace/aero-player/art/thumb/jazz.webp', jpg]);
const cover2 = new Uint8Array(fs.readFileSync(jpg));
const fields = { title: 'Ünïcödé Title ★', artist: 'Lucielle feat. Halo', album: 'Round Trip', albumArtist: 'Luciel Allstars', track: '7/12', disc: '2/3', year: '2026', genre: 'Synthwave', bpm: '133' };
const files = fs.readdirSync(media).filter((f) => /\.(mp3|flac|m4a|ogg)$/.test(f));
let fail = 0;
const pcm = (p) => execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-map', '0:a', '-f', 'md5', '-']).toString().trim();
(async () => {
  for (const f of files) {
    const src = new Blob([fs.readFileSync(path.join(media, f))]);
    let out;
    try { out = await LucielTags.write(src, fields, { mime: 'image/png', data: cover }); }
    catch (e) { console.log(f.padEnd(28), e.unsupported ? 'NOT WRITABLE (override only): ' + e.message : 'ERROR ' + e.message); continue; }
    const dst = path.join('/tmp/luc/rt', 'rt-' + f);
    fs.writeFileSync(dst, Buffer.from(await out.blob.arrayBuffer()));
    // second pass: replace cover with a JPEG and change two fields, then remove nothing else
    const out2 = await LucielTags.write(new Blob([fs.readFileSync(dst)]), { title: 'Second Pass', bpm: '134' }, { mime: 'image/jpeg', data: cover2 });
    const dst2 = dst.replace('rt-', 'rt2-'); fs.writeFileSync(dst2, Buffer.from(await out2.blob.arrayBuffer()));
    const m = await AeroMeta.read(Object.assign(new Blob([fs.readFileSync(dst)]), { name: f }));
    const m2 = await AeroMeta.read(Object.assign(new Blob([fs.readFileSync(dst2)]), { name: f }));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', dst2]).toString());
    const tags = Object.fromEntries(Object.entries(probe.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v]));
    let decodeErr = '';
    try { execFileSync('ffmpeg', ['-v', 'error', '-i', dst2, '-map', '0:a', '-f', 'null', '-'], { stdio: 'pipe' }); } catch (e) { decodeErr = String(e.stderr).slice(0, 200); }
    const checks = {
      title: m.title === fields.title, artist: m.artist === fields.artist, album: m.album === fields.album, albumArtist: m.albumArtist === fields.albumArtist,
      track: /^7/.test(m.track), disc: /^2/.test(m.disc), year: m.year === '2026', genre: m.genre === 'Synthwave', bpm: m.bpm === 133,
      cover: !!m.picture && m.picture.mime === 'image/png' && m.picture.data.length === cover.length,
      pass2title: m2.title === 'Second Pass' && m2.artist === fields.artist, pass2bpm: m2.bpm === 134,
      pass2cover: !!m2.picture && m2.picture.mime === 'image/jpeg' && m2.picture.data.length === cover2.length,
      ffprobeTitle: tags.title === 'Second Pass', ffprobeArtist: tags.artist === fields.artist, ffprobeAlbum: tags.album === 'Round Trip',
      ffprobeAlbumArtist: (tags.album_artist || tags.albumartist || tags['album artist']) === 'Luciel Allstars',
      ffprobeGenre: tags.genre === 'Synthwave', ffprobeDate: /^2026/.test(tags.date || tags.year || ''),
      ffprobeCoverStream: probe.streams.some((s) => s.disposition && s.disposition.attached_pic),
      ffprobeDuration: Math.abs(+probe.format.duration - +JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', path.join(media, f)]).toString()).format.duration) < 0.1,
      decodesClean: !decodeErr,
      samePCM: pcm(path.join(media, f)) === pcm(dst2),
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) fail++;
    console.log(f.padEnd(28), bad.length ? 'FAIL ' + bad.join(',') : 'PASS (' + Object.keys(checks).length + ' checks)', decodeErr, bad.length ? JSON.stringify({ m: { ...m, picture: m.picture && m.picture.mime }, tags }) : '');
  }
  process.exit(fail ? 1 : 0);
})();
