/* Luciel tag writer: rewrites tags inside the audio file bytes.
 *   MP3  -> ID3v2.3 (or keeps v2.4 if the file already uses it) incl. APIC front cover; updates an ID3v1 trailer if present
 *   FLAC -> VORBIS_COMMENT + METADATA_BLOCK_PICTURE (front cover); other blocks kept, padding rebuilt
 *   M4A/MP4 -> moov/udta/meta/ilst items incl. covr; stco/co64 chunk offsets are shifted when moov precedes mdat
 * Other formats are not written (callers keep the edits as library overrides).
 * API: LucielTags.write(blob, fields, cover) -> Promise<{ blob, format }>
 *   fields: any of { title, artist, album, albumArtist, track, disc, year, genre, bpm } (only present keys change;
 *           an empty string removes the tag). cover: undefined = keep, null = remove, { mime, data:Uint8Array } = replace.
 *   LucielTags.formatOf(blob) -> 'mp3' | 'flac' | 'mp4' | other ; LucielTags.canWrite(fmt)
 */
(function (global) {
  'use strict';
  const enc8 = new TextEncoder();
  const latin1 = (s) => Uint8Array.from(String(s), (c) => (c.charCodeAt(0) <= 255 ? c.charCodeAt(0) : 63));
  const dec8 = new TextDecoder('utf-8');
  const strAt = (u, a, b) => String.fromCharCode(...u.subarray(a, b));
  const be32 = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
  const le32 = (u, o) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
  const synch = (u, o) => (u[o] << 21) | (u[o + 1] << 14) | (u[o + 2] << 7) | u[o + 3];
  const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const u32le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const u16be = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
  const synchBytes = (n) => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
  function cat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const has = (f, k) => Object.prototype.hasOwnProperty.call(f, k) && f[k] != null;
  const num = (v) => { const m = /^\s*(\d+)/.exec(String(v || '')); return m ? +m[1] : 0; };
  const tot = (v) => { const m = /\/\s*(\d+)/.exec(String(v || '')); return m ? +m[1] : 0; };

  async function bytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }

  function imageInfo(d) {
    if (d[0] === 0x89 && d[1] === 0x50) return { w: be32(d, 16), h: be32(d, 20), mime: 'image/png' };
    if (d[0] === 0xFF && d[1] === 0xD8) {
      let i = 2;
      while (i + 9 < d.length) {
        if (d[i] !== 0xFF) { i++; continue; }
        const m = d[i + 1], len = (d[i + 2] << 8) | d[i + 3];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (d[i + 5] << 8) | d[i + 6], w: (d[i + 7] << 8) | d[i + 8], mime: 'image/jpeg' };
        i += 2 + len;
      }
      return { w: 0, h: 0, mime: 'image/jpeg' };
    }
    if (d[0] === 0x52 && d[1] === 0x49 && d[8] === 0x57) return { w: 0, h: 0, mime: 'image/webp' };
    return { w: 0, h: 0, mime: 'image/jpeg' };
  }

  async function formatOf(blob) {
    const h = await bytes(blob, 0, 12);
    const s4 = strAt(h, 0, 4);
    if (strAt(h, 0, 3) === 'ID3') {
      const size = synch(h, 6) + 10 + ((h[5] & 0x10) ? 10 : 0);
      const n = await bytes(blob, size, size + 4);
      return strAt(n, 0, 4) === 'fLaC' ? 'flac' : 'mp3';
    }
    if (s4 === 'fLaC') return 'flac';
    if (strAt(h, 4, 8) === 'ftyp') return 'mp4';
    if (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0 && (h[1] & 0x06) !== 0) return 'mp3';
    if (s4 === 'OggS') return 'ogg';
    if (s4 === 'RIFF') return 'wav';
    if (h[0] === 0x1A && h[1] === 0x45) return 'webm';
    return 'unknown';
  }
  const canWrite = (fmt) => fmt === 'mp3' || fmt === 'flac' || fmt === 'mp4';

  // ------------------------------------------------------------------ ID3v2
  const GENRES = (global.AeroMeta && global.AeroMeta.GENRES) || [];
  async function writeMP3(blob, f, cover) {
    const h = await bytes(blob, 0, 10);
    let ver = 3, kept = [], audioStart = 0;
    if (strAt(h, 0, 3) === 'ID3') {
      const major = h[3], flags = h[5], size = synch(h, 6);
      audioStart = 10 + size + ((flags & 0x10) ? 10 : 0);
      let body = await bytes(blob, 10, 10 + size);
      if (major === 3 && (flags & 0x80)) { // tag-level unsynchronisation: undo it before reading frames
        const out = []; for (let i = 0; i < body.length; i++) { out.push(body[i]); if (body[i] === 0xFF && body[i + 1] === 0) i++; }
        body = Uint8Array.from(out);
      }
      let p = 0;
      if (flags & 0x40) p = major === 4 ? synch(body, 0) : be32(body, 0) + 4;
      if (major === 3 || major === 4) {
        ver = major;
        while (p + 10 <= body.length && body[p] !== 0) {
          const id = strAt(body, p, p + 4);
          const fs = major === 4 ? synch(body, p + 4) : be32(body, p + 4);
          if (!/^[A-Z0-9]{4}$/.test(id) || fs <= 0 || p + 10 + fs > body.length) break;
          kept.push({ id, raw: body.subarray(p, p + 10 + fs) });
          p += 10 + fs;
        }
      } // ID3v2.2 frames are dropped and rewritten as v2.3
    }
    const MAP = { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2', track: 'TRCK', disc: 'TPOS', genre: 'TCON', bpm: 'TBPM' };
    const drop = new Set();
    for (const k in MAP) if (has(f, k)) drop.add(MAP[k]);
    if (has(f, 'year')) { drop.add('TYER'); drop.add('TDRC'); drop.add('TDAT'); }
    if (cover !== undefined) drop.add('APIC');
    kept = kept.filter((fr) => !drop.has(fr.id));
    const frame = (id, payload) => cat([latin1(id), ver === 4 ? synchBytes(payload.length) : u32be(payload.length), new Uint8Array(2), payload]);
    const text = (s) => {
      s = String(s);
      if (ver === 4) return cat([new Uint8Array([3]), enc8.encode(s)]);
      if (/^[\x00-\xff]*$/.test(s)) return cat([new Uint8Array([0]), latin1(s)]);
      const u = new Uint8Array(3 + s.length * 2); u[0] = 1; u[1] = 0xFF; u[2] = 0xFE;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[3 + i * 2] = c & 255; u[4 + i * 2] = c >> 8; }
      return u;
    };
    const fresh = [];
    for (const k in MAP) if (has(f, k) && String(f[k]).trim() !== '') fresh.push(frame(MAP[k], text(String(f[k]).trim())));
    if (has(f, 'year') && String(f.year).trim()) fresh.push(frame(ver === 4 ? 'TDRC' : 'TYER', text(String(f.year).trim())));
    if (cover && cover.data) {
      const mime = cover.mime || imageInfo(cover.data).mime;
      fresh.push(frame('APIC', cat([new Uint8Array([0]), latin1(mime), new Uint8Array([0, 3, 0]), cover.data])));
    }
    const frames = cat([...fresh, ...kept.map((k) => k.raw)]);
    const pad = new Uint8Array(2048);
    const header = cat([latin1('ID3'), new Uint8Array([ver, 0, 0]), synchBytes(frames.length + pad.length)]);
    // ID3v1 trailer
    let tailEnd = blob.size, v1 = null;
    if (blob.size > 128 + audioStart) {
      const t = await bytes(blob, blob.size - 128, blob.size);
      if (strAt(t, 0, 3) === 'TAG') {
        tailEnd = blob.size - 128; v1 = t.slice();
        const put = (s, a, n) => { const b = latin1(String(s).slice(0, n)); v1.fill(0, a, a + n); v1.set(b, a); };
        if (has(f, 'title')) put(f.title, 3, 30);
        if (has(f, 'artist')) put(f.artist, 33, 30);
        if (has(f, 'album')) put(f.album, 63, 30);
        if (has(f, 'year')) put(f.year, 93, 4);
        if (has(f, 'track') && v1[125] === 0) v1[126] = Math.min(255, num(f.track));
        if (has(f, 'genre')) { const gi = GENRES.findIndex((g) => g.toLowerCase() === String(f.genre).toLowerCase()); v1[127] = gi >= 0 ? gi : 255; }
      }
    }
    const parts = [header, frames, pad, blob.slice(audioStart, tailEnd)];
    if (v1) parts.push(v1);
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // ------------------------------------------------------------------ FLAC
  async function writeFLAC(blob, f, cover) {
    const h = await bytes(blob, 0, 10);
    let start = 0;
    if (strAt(h, 0, 3) === 'ID3') start = 10 + synch(h, 6) + ((h[5] & 0x10) ? 10 : 0);
    // read metadata blocks (grow the window until we hit the last block)
    let win = 1 << 20, u, blocks, end;
    for (;;) {
      u = await bytes(blob, start, start + win);
      blocks = []; let p = 4, ok = true, last = false;
      while (!last) {
        if (p + 4 > u.length) { ok = false; break; }
        last = !!(u[p] & 0x80); const type = u[p] & 0x7F, len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
        if (p + 4 + len > u.length) { ok = false; break; }
        blocks.push({ type, data: u.subarray(p + 4, p + 4 + len) }); p += 4 + len;
      }
      if (ok) { end = start + p; break; }
      if (start + win >= blob.size) throw new Error('truncated FLAC metadata');
      win *= 4;
    }
    if (strAt(u, 0, 4) !== 'fLaC') throw new Error('not FLAC');
    // vorbis comment
    const vcb = blocks.find((b) => b.type === 4);
    let vendor = 'Luciel', comments = [];
    if (vcb) {
      const d = vcb.data, vl = le32(d, 0); vendor = dec8.decode(d.subarray(4, 4 + vl));
      let p = 4 + vl; const n = le32(d, p); p += 4;
      for (let i = 0; i < n && p + 4 <= d.length; i++) { const l = le32(d, p); comments.push(dec8.decode(d.subarray(p + 4, p + 4 + l))); p += 4 + l; }
    }
    const KEYS = { title: ['TITLE'], artist: ['ARTIST'], album: ['ALBUM'], albumArtist: ['ALBUMARTIST', 'ALBUM ARTIST'], track: ['TRACKNUMBER', 'TRACKTOTAL', 'TOTALTRACKS'], disc: ['DISCNUMBER', 'DISCTOTAL', 'TOTALDISCS'], year: ['DATE', 'YEAR'], genre: ['GENRE'], bpm: ['BPM'] };
    const drop = new Set(); for (const k in KEYS) if (has(f, k)) KEYS[k].forEach((x) => drop.add(x));
    comments = comments.filter((c) => !drop.has(c.split('=')[0].toUpperCase()));
    const add = (k, v) => { v = String(v).trim(); if (v) comments.push(k + '=' + v); };
    if (has(f, 'title')) add('TITLE', f.title);
    if (has(f, 'artist')) add('ARTIST', f.artist);
    if (has(f, 'album')) add('ALBUM', f.album);
    if (has(f, 'albumArtist')) add('ALBUMARTIST', f.albumArtist);
    if (has(f, 'track') && num(f.track)) { add('TRACKNUMBER', num(f.track)); if (tot(f.track)) add('TRACKTOTAL', tot(f.track)); }
    if (has(f, 'disc') && num(f.disc)) { add('DISCNUMBER', num(f.disc)); if (tot(f.disc)) add('DISCTOTAL', tot(f.disc)); }
    if (has(f, 'year')) add('DATE', f.year);
    if (has(f, 'genre')) add('GENRE', f.genre);
    if (has(f, 'bpm')) add('BPM', f.bpm);
    const vb = enc8.encode(vendor);
    const vc = cat([u32le(vb.length), vb, u32le(comments.length), ...comments.map((c) => { const b = enc8.encode(c); return cat([u32le(b.length), b]); })]);
    let out = blocks.filter((b) => b.type !== 1 && b.type !== 4 && !(cover !== undefined && b.type === 6));
    const si = out.findIndex((b) => b.type === 0);
    out.splice(si + 1, 0, { type: 4, data: vc });
    if (cover && cover.data) {
      const info = imageInfo(cover.data), mime = latin1(cover.mime || info.mime);
      out.push({ type: 6, data: cat([u32be(3), u32be(mime.length), mime, u32be(0), u32be(info.w || 0), u32be(info.h || 0), u32be(24), u32be(0), u32be(cover.data.length), cover.data]) });
    }
    out.push({ type: 1, data: new Uint8Array(4096) });
    const meta = cat(out.map((b, i) => cat([new Uint8Array([(i === out.length - 1 ? 0x80 : 0) | b.type, (b.data.length >> 16) & 255, (b.data.length >> 8) & 255, b.data.length & 255]), b.data])));
    return new Blob([await bytes(blob, 0, start), latin1('fLaC'), meta, blob.slice(end)], { type: 'audio/flac' });
  }

  // ------------------------------------------------------------------ MP4
  function atoms(u, a, b) {
    const list = [];
    let p = a;
    while (p + 8 <= b) {
      let size = be32(u, p), hdr = 8; const type = strAt(u, p + 4, p + 8);
      if (size === 1) { size = be32(u, p + 8) * 4294967296 + be32(u, p + 12); hdr = 16; } else if (size === 0) size = b - p;
      if (size < hdr || p + size > b) break;
      list.push({ type, start: p, size, hdr }); p += size;
    }
    return list;
  }
  const box = (type, ...parts) => { const body = cat(parts); return cat([u32be(body.length + 8), latin1(type), body]); };
  function rebuild(u, parent, bodyStart, replaceType, replacement) {
    // rebuild a container with the child of `replaceType` replaced (or appended when missing)
    const kids = atoms(u, bodyStart, parent.start + parent.size);
    const pre = u.subarray(parent.start + parent.hdr, bodyStart); // e.g. meta full-box version/flags
    let found = false;
    const parts = kids.map((k) => { if (k.type === replaceType) { found = true; return replacement; } return u.subarray(k.start, k.start + k.size); });
    if (!found) parts.push(replacement);
    return box(parent.type, pre, ...parts);
  }
  async function writeMP4(blob, f, cover) {
    const u = new Uint8Array(await blob.arrayBuffer());
    const top = atoms(u, 0, u.length);
    if (top.some((a) => a.type === 'moof')) throw new Error('fragmented MP4 is not supported');
    const moov = top.find((a) => a.type === 'moov'); if (!moov) throw new Error('no moov');
    const mk = atoms(u, moov.start + moov.hdr, moov.start + moov.size);
    const udta = mk.find((a) => a.type === 'udta');
    const uk = udta ? atoms(u, udta.start + udta.hdr, udta.start + udta.size) : [];
    const meta = uk.find((a) => a.type === 'meta');
    let metaBody = meta ? meta.start + meta.hdr : 0;
    if (meta && strAt(u, metaBody + 4, metaBody + 8) !== 'hdlr') metaBody += 4; // iTunes meta is a full box (version/flags)
    const mkids = meta ? atoms(u, metaBody, meta.start + meta.size) : [];
    const ilst = mkids.find((a) => a.type === 'ilst');
    const items = ilst ? atoms(u, ilst.start + ilst.hdr, ilst.start + ilst.size) : [];
    const MAP = { title: '\xa9nam', artist: '\xa9ART', album: '\xa9alb', albumArtist: 'aART', year: '\xa9day', genre: '\xa9gen', track: 'trkn', disc: 'disk', bpm: 'tmpo' };
    const drop = new Set(); for (const k in MAP) if (has(f, k)) drop.add(MAP[k]);
    if (has(f, 'genre')) drop.add('gnre');
    if (cover !== undefined) drop.add('covr');
    const data = (type, payload) => box('data', u32be(type), u32be(0), payload);
    const fresh = [];
    for (const k of ['title', 'artist', 'album', 'albumArtist', 'year', 'genre']) if (has(f, k) && String(f[k]).trim()) fresh.push(box(MAP[k], data(1, enc8.encode(String(f[k]).trim()))));
    if (has(f, 'track') && num(f.track)) fresh.push(box('trkn', data(0, cat([u16be(0), u16be(num(f.track)), u16be(tot(f.track)), u16be(0)]))));
    if (has(f, 'disc') && num(f.disc)) fresh.push(box('disk', data(0, cat([u16be(0), u16be(num(f.disc)), u16be(tot(f.disc))]))));
    if (has(f, 'bpm') && Math.round(+f.bpm) > 0) fresh.push(box('tmpo', data(21, u16be(Math.round(+f.bpm)))));
    if (cover && cover.data) fresh.push(box('covr', data(imageInfo(cover.data).mime === 'image/png' ? 14 : 13, cover.data)));
    const newIlst = box('ilst', ...fresh, ...items.filter((i) => !drop.has(i.type)).map((i) => u.subarray(i.start, i.start + i.size)));
    const hdlr = box('hdlr', new Uint8Array(8), latin1('mdirappl'), new Uint8Array(9));
    const newMeta = meta ? rebuild(u, meta, metaBody, 'ilst', newIlst) : box('meta', new Uint8Array(4), hdlr, newIlst);
    const newUdta = udta ? rebuild(u, udta, udta.start + udta.hdr, 'meta', newMeta) : box('udta', newMeta);
    const newMoov = rebuild(u, moov, moov.start + moov.hdr, 'udta', newUdta);
    const delta = newMoov.length - moov.size;
    // shift chunk offsets if media data sits after moov
    if (delta && top.some((a) => a.type === 'mdat' && a.start > moov.start)) {
      const walk = (a, b) => {
        for (const k of atoms(newMoov, a, b)) {
          if (['trak', 'mdia', 'minf', 'stbl'].includes(k.type)) walk(k.start + k.hdr, k.start + k.size);
          else if (k.type === 'stco' || k.type === 'co64') {
            const n = be32(newMoov, k.start + 12); let p = k.start + 16;
            const dv = new DataView(newMoov.buffer, newMoov.byteOffset);
            for (let i = 0; i < n; i++) {
              if (k.type === 'stco') { const v = dv.getUint32(p); if (v > moov.start) dv.setUint32(p, v + delta); p += 4; }
              else { const v = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); if (v > moov.start) { const nv = v + delta; dv.setUint32(p, Math.floor(nv / 4294967296)); dv.setUint32(p + 4, nv >>> 0); } p += 8; }
            }
          }
        }
      };
      walk(8, newMoov.length);
    }
    return new Blob([u.subarray(0, moov.start), newMoov, u.subarray(moov.start + moov.size)], { type: 'audio/mp4' });
  }

  async function write(blob, fields, cover) {
    const fmt = await formatOf(blob);
    if (fmt === 'mp3') return { blob: await writeMP3(blob, fields || {}, cover), format: fmt };
    if (fmt === 'flac') return { blob: await writeFLAC(blob, fields || {}, cover), format: fmt };
    if (fmt === 'mp4') return { blob: await writeMP4(blob, fields || {}, cover), format: fmt };
    const e = new Error(`In-file tag writing isn't supported for ${fmt.toUpperCase()} files`); e.unsupported = true; throw e;
  }
  global.LucielTags = { write, formatOf, canWrite, imageInfo };
})(typeof window !== 'undefined' ? window : globalThis);
