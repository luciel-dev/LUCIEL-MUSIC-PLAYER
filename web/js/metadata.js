/* Luciel metadata reader — dependency-free tag parser.
 * Supports: ID3v2.2/2.3/2.4 (+APIC/PIC), ID3v1, FLAC (Vorbis comments + PICTURE),
 * Ogg Vorbis/Opus (comments + METADATA_BLOCK_PICTURE), MP4/M4A (iTunes ilst + covr),
 * WAV (RIFF LIST/INFO + embedded "id3 " chunk).
 * Usage: AeroMeta.read(file) -> Promise<{title, artist, album, albumArtist, year, genre, track, picture:{mime,data}|null, format}>
 */
(function (global) {
  'use strict';

  const GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','AlternRock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychadelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'];

  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  const utf16le = new TextDecoder('utf-16le');
  const utf16be = new TextDecoder('utf-16be');

  async function readBytes(file, start, len) {
    const end = Math.min(file.size, start + len);
    if (start >= end) return new Uint8Array(0);
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }
  const str = (u8, a, b) => latin1.decode(u8.subarray(a, b));
  const be32 = (u, o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
  const le32 = (u, o) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
  const be24 = (u, o) => (u[o] << 16) + (u[o + 1] << 8) + u[o + 2];
  const synch = (u, o) => (u[o] << 21) | (u[o + 1] << 14) | (u[o + 2] << 7) | u[o + 3];
  const clean = (s) => (s || '').replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();

  function emptyMeta() {
    return { title: '', artist: '', album: '', albumArtist: '', year: '', genre: '', track: '', disc: '', compilation: false, picture: null, format: '' };
  }

  function genreName(g) {
    g = clean(g);
    const m = g.match(/^\((\d+)\)(.*)$/);
    if (m) return m[2] || GENRES[+m[1]] || g;
    if (/^\d+$/.test(g) && GENRES[+g]) return GENRES[+g];
    return g;
  }

  // ---------- ID3v2 ----------
  function decodeText(enc, u8) {
    if (!u8.length) return '';
    switch (enc) {
      case 0: return latin1.decode(u8);
      case 1:
        if (u8[0] === 0xFE && u8[1] === 0xFF) return utf16be.decode(u8.subarray(2));
        if (u8[0] === 0xFF && u8[1] === 0xFE) return utf16le.decode(u8.subarray(2));
        return utf16le.decode(u8);
      case 2: return utf16be.decode(u8);
      default: return utf8.decode(u8);
    }
  }
  function findTerm(u8, start, enc) {
    if (enc === 1 || enc === 2) {
      for (let i = start; i + 1 < u8.length; i += 2) if (u8[i] === 0 && u8[i + 1] === 0) return i;
      return u8.length;
    }
    for (let i = start; i < u8.length; i++) if (u8[i] === 0) return i;
    return u8.length;
  }
  function unsync(u8) {
    const out = new Uint8Array(u8.length); let j = 0;
    for (let i = 0; i < u8.length; i++) {
      out[j++] = u8[i];
      if (u8[i] === 0xFF && u8[i + 1] === 0x00) i++;
    }
    return out.subarray(0, j);
  }

  function parseID3v2(tag, meta) {
    const ver = tag[3];
    const flags = tag[5];
    let body = tag.subarray(10);
    if (ver < 4 && (flags & 0x80)) body = unsync(body);
    let pos = 0;
    if (flags & 0x40) { // extended header
      const sz = ver === 4 ? synch(body, 0) : be32(body, 0) + 4;
      pos = sz;
    }
    const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
    while (pos + hdrLen <= body.length) {
      const id = str(body, pos, pos + idLen);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      let size = ver === 2 ? be24(body, pos + 3) : ver === 4 ? synch(body, pos + 4) : be32(body, pos + 4);
      const fflags = ver === 2 ? 0 : (body[pos + 9]);
      let data = body.subarray(pos + hdrLen, pos + hdrLen + size);
      pos += hdrLen + size;
      if (size <= 0) continue;
      if (ver === 4 && (fflags & 0x02)) data = unsync(data);
      if (ver === 4 && (fflags & 0x01)) data = data.subarray(4); // data length indicator
      if (fflags & 0x0C) continue; // compressed/encrypted -> skip
      const key = id;
      if (key[0] === 'T' && key !== 'TXXX' && key !== 'TXX') {
        const v = clean(decodeText(data[0], data.subarray(1)));
        switch (key) {
          case 'TIT2': case 'TT2': meta.title = v; break;
          case 'TPE1': case 'TP1': meta.artist = v; break;
          case 'TALB': case 'TAL': meta.album = v; break;
          case 'TPE2': case 'TP2': meta.albumArtist = v; break;
          case 'TRCK': case 'TRK': meta.track = v; break;
          case 'TCON': case 'TCO': meta.genre = genreName(v); break;
          case 'TDRC': case 'TYER': case 'TYE': if (!meta.year) meta.year = v.slice(0, 4); break;
          case 'TPOS': case 'TPA': meta.disc = v; break;
          case 'TCMP': case 'TCP': meta.compilation = v === '1'; break;
          case 'TBPM': case 'TBP': if (parseFloat(v) > 0) meta.bpm = parseFloat(v); break;
        }
      } else if ((key === 'APIC' || key === 'PIC') && !meta.picture) {
        const enc = data[0];
        let mime, p;
        if (key === 'PIC') { const fmt = str(data, 1, 4).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
        else { const e = findTerm(data, 1, 0); mime = str(data, 1, e) || 'image/jpeg'; p = e + 1; }
        p += 1; // picture type
        const d = findTerm(data, p, enc);
        p = d + ((enc === 1 || enc === 2) ? 2 : 1);
        if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'png' ? 'png' : 'jpeg');
        meta.picture = { mime, data: data.slice(p) };
      }
    }
  }

  function parseID3v1(u8, meta) {
    if (u8.length < 128 || str(u8, 0, 3) !== 'TAG') return false;
    const f = (a, b) => clean(latin1.decode(u8.subarray(a, b)));
    meta.title = meta.title || f(3, 33);
    meta.artist = meta.artist || f(33, 63);
    meta.album = meta.album || f(63, 93);
    meta.year = meta.year || f(93, 97);
    if (u8[125] === 0 && u8[126] && !meta.track) meta.track = String(u8[126]);
    if (!meta.genre && GENRES[u8[127]]) meta.genre = GENRES[u8[127]];
    return true;
  }

  // ---------- Vorbis comments / FLAC ----------
  function parseFlacPicture(u8, meta) {
    if (meta.picture) return;
    let p = 4;
    const ml = be32(u8, p); p += 4;
    const mime = str(u8, p, p + ml); p += ml;
    const dl = be32(u8, p); p += 4 + dl;
    p += 16;
    const len = be32(u8, p); p += 4;
    meta.picture = { mime: mime || 'image/jpeg', data: u8.slice(p, p + len) };
  }
  function parseVorbisComment(u8, meta) {
    let p = 0;
    const vl = le32(u8, p); p += 4 + vl;
    const n = le32(u8, p); p += 4;
    for (let i = 0; i < n && p + 4 <= u8.length; i++) {
      const l = le32(u8, p); p += 4;
      const s = utf8.decode(u8.subarray(p, p + l)); p += l;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
      switch (k) {
        case 'TITLE': meta.title = v; break;
        case 'ARTIST': meta.artist = meta.artist ? meta.artist : v; break;
        case 'ALBUM': meta.album = v; break;
        case 'ALBUMARTIST': case 'ALBUM ARTIST': meta.albumArtist = v; break;
        case 'DATE': case 'YEAR': meta.year = v.slice(0, 4); break;
        case 'GENRE': meta.genre = v; break;
        case 'TRACKNUMBER': meta.track = v; break;
        case 'DISCNUMBER': meta.disc = v; break;
        case 'TRACKTOTAL': case 'TOTALTRACKS': meta.trackTotal = v; break;
        case 'COMPILATION': meta.compilation = v === '1'; break;
        case 'BPM': case 'TEMPO': if (parseFloat(v) > 0) meta.bpm = parseFloat(v); break;
        case 'METADATA_BLOCK_PICTURE':
          try {
            const bin = atob(v); const b = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j);
            parseFlacPicture(b, meta);
          } catch (e) { /* ignore */ }
          break;
      }
    }
  }

  async function parseFLAC(file, offset, meta) {
    let p = offset + 4;
    for (let guard = 0; guard < 64; guard++) {
      const h = await readBytes(file, p, 4);
      if (h.length < 4) break;
      const last = h[0] & 0x80, type = h[0] & 0x7F, len = be24(h, 1);
      if (type === 0 || type === 4 || type === 6) {
        const b = await readBytes(file, p + 4, len);
        if (type === 0) {
          meta.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
          meta.channels = ((b[12] >> 1) & 7) + 1;
          meta.bitsPerSample = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
        } else if (type === 4) parseVorbisComment(b, meta); else parseFlacPicture(b, meta);
      }
      p += 4 + len;
      if (last) break;
    }
  }

  // ---------- Ogg ----------
  async function parseOgg(file, meta) {
    let limit = 1 << 18;
    while (true) {
      const u8 = await readBytes(file, 0, limit);
      const packets = []; let cur = []; let p = 0;
      while (p + 27 <= u8.length && str(u8, p, p + 4) === 'OggS' && packets.length < 2) {
        const nseg = u8[p + 26];
        if (p + 27 + nseg > u8.length) break;
        const segs = u8.subarray(p + 27, p + 27 + nseg);
        let dp = p + 27 + nseg;
        let truncated = false;
        for (let i = 0; i < nseg; i++) {
          const s = segs[i];
          if (dp + s > u8.length) { truncated = true; break; }
          cur.push(u8.subarray(dp, dp + s)); dp += s;
          if (s < 255) {
            const total = cur.reduce((a, c) => a + c.length, 0);
            const pk = new Uint8Array(total); let o = 0;
            for (const c of cur) { pk.set(c, o); o += c.length; }
            packets.push(pk); cur = [];
            if (packets.length >= 2) break;
          }
        }
        if (truncated) break;
        p = dp;
      }
      if (packets.length >= 2) {
        const id = packets[0];
        if (str(id, 0, 8) === 'OpusHead') { meta.channels = id[9]; meta.sampleRate = 48000; }
        else if (id[0] === 1 && str(id, 1, 7) === 'vorbis') { meta.channels = id[11]; meta.sampleRate = le32(id, 12); const br = le32(id, 20); if (br > 0 && br < 2e6) meta.bitrate = br / 1000; }
        const pk = packets[1];
        if (str(pk, 0, 8) === 'OpusTags') { meta.format = 'Opus'; parseVorbisComment(pk.subarray(8), meta); }
        else if (pk[0] === 3 && str(pk, 1, 7) === 'vorbis') { meta.format = 'Vorbis'; parseVorbisComment(pk.subarray(7), meta); }
        else if (pk[0] === 0x84 || pk[0] === 0x04) { meta.format = 'FLAC'; parseVorbisComment(pk.subarray(4), meta); }
        return;
      }
      if (limit >= file.size || limit >= (1 << 25)) return;
      limit *= 4;
    }
  }

  // ---------- MP4 ----------
  async function findAtom(file, start, end, name) {
    let p = start;
    while (p + 8 <= end) {
      const h = await readBytes(file, p, 16);
      if (h.length < 8) return null;
      let size = be32(h, 0); const type = str(h, 4, 8); let hdr = 8;
      if (size === 1) { size = be32(h, 8) * 4294967296 + be32(h, 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < 8) return null;
      if (type === name) return { start: p, size, hdr };
      p += size;
    }
    return null;
  }
  function childAtoms(u8, start, end) {
    const out = []; let p = start;
    while (p + 8 <= end) {
      const size = be32(u8, p); const type = str(u8, p + 4, p + 8);
      if (size < 8 || p + size > end) break;
      out.push({ type, start: p, size }); p += size;
    }
    return out;
  }
  async function parseMP4(file, meta) {
    const moov = await findAtom(file, 0, file.size, 'moov');
    if (!moov) return;
    const u8 = await readBytes(file, moov.start, Math.min(moov.size, 64 << 20));
    const find = (list, t) => list.find((a) => a.type === t);
    for (let i = 4; i + 32 < u8.length; i++) {
      if ((u8[i] === 0x6D && str(u8, i, i + 4) === 'mp4a') || (u8[i] === 0x61 && str(u8, i, i + 4) === 'alac')) {
        const ch = (u8[i + 20] << 8) | u8[i + 21], sr = (u8[i + 28] << 8) | u8[i + 29];
        if (ch > 0 && ch <= 8 && sr >= 8000) { meta.channels = ch; meta.sampleRate = sr; meta.codec = str(u8, i, i + 4); break; }
      }
    }
    meta.format = meta.codec === 'alac' ? 'ALAC' : 'AAC';
    const udta = find(childAtoms(u8, 8, u8.length), 'udta');
    if (!udta) return;
    const metaA = find(childAtoms(u8, udta.start + 8, udta.start + udta.size), 'meta');
    if (!metaA) return;
    let cs = metaA.start + 8;
    if (!/^[a-z]{4}$/.test(str(u8, cs + 4, cs + 8))) cs += 4; // full box version/flags
    const ilst = find(childAtoms(u8, cs, metaA.start + metaA.size), 'ilst');
    if (!ilst) return;
    for (const item of childAtoms(u8, ilst.start + 8, ilst.start + ilst.size)) {
      const data = find(childAtoms(u8, item.start + 8, item.start + item.size), 'data');
      if (!data) continue;
      const dtype = be24(u8, data.start + 9);
      const payload = u8.subarray(data.start + 16, data.start + data.size);
      const txt = () => utf8.decode(payload).trim();
      switch (item.type) {
        case '\xa9nam': meta.title = txt(); break;
        case '\xa9ART': meta.artist = txt(); break;
        case '\xa9alb': meta.album = txt(); break;
        case 'aART': meta.albumArtist = txt(); break;
        case '\xa9day': meta.year = txt().slice(0, 4); break;
        case '\xa9gen': meta.genre = txt(); break;
        case 'gnre': { const g = (payload[0] << 8) | payload[1]; if (GENRES[g - 1]) meta.genre = GENRES[g - 1]; break; }
        case 'tmpo': { const b = (payload[0] << 8) | payload[1]; if (b) meta.bpm = b; break; }
        case 'trkn': { const n = (payload[2] << 8) | payload[3], tot = (payload[4] << 8) | payload[5]; if (n) meta.track = String(n) + (tot ? '/' + tot : ''); break; }
        case 'disk': { const n = (payload[2] << 8) | payload[3], tot = (payload[4] << 8) | payload[5]; if (n) meta.disc = String(n) + (tot ? '/' + tot : ''); break; }
        case 'cpil': meta.compilation = payload[0] === 1; break;
        case 'covr':
          if (!meta.picture) meta.picture = { mime: dtype === 14 ? 'image/png' : 'image/jpeg', data: payload.slice() };
          break;
      }
    }
  }

  // ---------- WAV ----------
  async function parseWAV(file, meta) {
    let p = 12;
    for (let guard = 0; guard < 128 && p + 8 <= file.size; guard++) {
      const h = await readBytes(file, p, 12);
      const id = str(h, 0, 4); const size = le32(h, 4);
      if (id === 'fmt ') {
        const f = await readBytes(file, p + 8, 16);
        meta.channels = f[2] | (f[3] << 8); meta.sampleRate = le32(f, 4); meta.bitsPerSample = f[14] | (f[15] << 8);
      } else if (id === 'LIST' && str(h, 8, 12) === 'INFO') {
        const b = await readBytes(file, p + 12, size - 4);
        let q = 0;
        while (q + 8 <= b.length) {
          const k = str(b, q, q + 4); const l = le32(b, q + 4);
          const v = clean(utf8.decode(b.subarray(q + 8, q + 8 + l)));
          switch (k) {
            case 'INAM': meta.title = v; break;
            case 'IART': meta.artist = v; break;
            case 'IPRD': meta.album = v; break;
            case 'ICRD': meta.year = v.slice(0, 4); break;
            case 'IGNR': meta.genre = v; break;
            case 'ITRK': case 'IPRT': meta.track = v; break;
          }
          q += 8 + l + (l & 1);
        }
      } else if (id === 'id3 ' || id === 'ID3 ') {
        const b = await readBytes(file, p + 8, size);
        if (str(b, 0, 3) === 'ID3') parseID3v2(b, meta);
      }
      p += 8 + size + (size & 1);
    }
  }

  // ---------- Matroska / WebM (EBML) ----------
  async function parseMKV(file, meta) {
    const u8 = await readBytes(file, 0, 1 << 20);
    const vint = (p, keepMarker) => {
      const b = u8[p]; if (b === undefined) return null;
      let len = 1, mask = 0x80;
      while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
      if (len > 8) return null;
      let v = keepMarker ? b : (b & (mask - 1)), allOnes = (b & (mask - 1)) === mask - 1;
      for (let i = 1; i < len; i++) { v = v * 256 + u8[p + i]; if (u8[p + i] !== 0xFF) allOnes = false; }
      return { v, len, unknown: !keepMarker && allOnes };
    };
    const MASTER = new Set([0x18538067, 0x1549A966, 0x1254C367, 0x7373, 0x67C8, 0x1654AE6B, 0xAE, 0xE1]);
    const walk = (start, end, depth, ctx) => {
      let p = start;
      while (p < end && p < u8.length) {
        const id = vint(p, true); if (!id) return; const sz = vint(p + id.len); if (!sz) return;
        const ds = p + id.len + sz.len; const de = sz.unknown ? end : Math.min(end, ds + sz.v);
        if (id.v === 0x1F43B675) return; // Cluster: audio data begins
        if (MASTER.has(id.v) && depth < 6) {
          const c = id.v === 0x67C8 ? {} : ctx;
          walk(ds, de, depth + 1, c);
          if (id.v === 0x67C8 && c.name && c.value) {
            const k = c.name.toUpperCase(), v = c.value;
            if (k === 'TITLE') meta.title = meta.title || v; else if (k === 'ARTIST') meta.artist = v; else if (k === 'ALBUM') meta.album = v;
            else if (k === 'DATE' || k === 'DATE_RELEASED') meta.year = v.slice(0, 4); else if (k === 'GENRE') meta.genre = v;
            else if (k === 'PART_NUMBER' || k === 'TRACKNUMBER') meta.track = v;
            else if (k === 'BPM' && parseFloat(v) > 0) meta.bpm = parseFloat(v);
          }
        } else if (id.v === 0x45A3) ctx.name = utf8.decode(u8.subarray(ds, de));
        else if (id.v === 0x4487) ctx.value = utf8.decode(u8.subarray(ds, de)).trim();
        else if (id.v === 0x7BA9) meta.title = meta.title || utf8.decode(u8.subarray(ds, de)).trim();
        else if (id.v === 0xB5) { const dv = new DataView(u8.buffer, u8.byteOffset + ds, de - ds); meta.sampleRate = Math.round(de - ds === 4 ? dv.getFloat32(0) : dv.getFloat64(0)); }
        else if (id.v === 0x9F) meta.channels = u8[ds];
        else if (id.v === 0x86) { const c = str(u8, ds, de); meta.codec = c; if (/OPUS/.test(c)) meta.format = 'Opus'; else if (/VORBIS/.test(c)) meta.format = 'Vorbis'; }
        p = de;
      }
    };
    walk(0, u8.length, 0, {});
    if (meta.format === 'Opus' || meta.format === 'Vorbis') meta.format = 'WebM ' + meta.format;
  }

  // MPEG audio frame header -> sample rate / channels / bitrate (CBR or Xing/VBRI aware)
  function mp3Info(u8, meta) {
    for (let i = 0; i + 4 < u8.length; i++) {
      if (u8[i] !== 0xFF || (u8[i + 1] & 0xE0) !== 0xE0) continue;
      const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, bri = u8[i + 2] >> 4, sri = (u8[i + 2] >> 2) & 3;
      if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) continue;
      const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
      const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      meta.sampleRate = rates[sri];
      meta.channels = (u8[i + 3] >> 6) === 3 ? 1 : 2;
      if (layer === 1) meta.bitrate = (ver === 3 ? v1 : v2)[bri];
      const side = ver === 3 ? (meta.channels === 1 ? 17 : 32) : (meta.channels === 1 ? 9 : 17);
      const x = i + 4 + side, tag = str(u8, x, x + 4);
      if ((tag === 'Xing' || tag === 'Info') && (u8[x + 7] & 1)) {
        const frames = be32(u8, x + 8), spf = ver === 3 ? 1152 : 576;
        meta.vbrFrames = frames; meta.vbrSpf = spf; meta.vbr = tag === 'Xing';
        meta.durationHint = frames * spf / meta.sampleRate;
        delete meta.bitrate; // let the app compute from size/duration
      }
      return;
    }
  }

  async function read(file) {
    const meta = emptyMeta();
    try {
      const head = await readBytes(file, 0, 16);
      const magic = str(head, 0, 4);
      let offset = 0;
      if (str(head, 0, 3) === 'ID3') {
        const size = synch(head, 6) + 10 + ((head[5] & 0x10) ? 10 : 0);
        parseID3v2(await readBytes(file, 0, size), meta);
        offset = size;
        const next = await readBytes(file, offset, 4);
        if (str(next, 0, 4) === 'fLaC') { meta.format = 'FLAC'; await parseFLAC(file, offset, meta); }
        else { meta.format = 'MP3'; mp3Info(await readBytes(file, offset, 8192), meta); }
      } else if (magic === 'fLaC') { meta.format = 'FLAC'; await parseFLAC(file, 0, meta); }
      else if (magic === 'OggS') { meta.format = 'Ogg'; await parseOgg(file, meta); }
      else if (str(head, 4, 8) === 'ftyp') { meta.format = 'MP4'; await parseMP4(file, meta); }
      else if (magic === 'RIFF' && str(head, 8, 12) === 'WAVE') { meta.format = 'WAV'; await parseWAV(file, meta); }
      else if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) { meta.format = 'WebM'; await parseMKV(file, meta); }
      else if (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0) {
        meta.format = (head[1] & 0x06) === 0 ? 'AAC' : 'MP3';
        if (meta.format === 'MP3') mp3Info(await readBytes(file, 0, 8192), meta);
        else { const sri = (head[2] >> 2) & 15; meta.sampleRate = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000][sri]; meta.channels = ((head[2] & 1) << 2) | (head[3] >> 6); }
      }
      if (!meta.title && !meta.artist && file.size > 128) {
        parseID3v1(await readBytes(file, file.size - 128, 128), meta);
      }
    } catch (e) {
      console.warn('[AeroMeta] parse failed for', file.name, e);
    }
    if (meta.picture && (!meta.picture.data || meta.picture.data.length < 16)) meta.picture = null;
    return meta;
  }

  global.AeroMeta = { read, GENRES };
})(window);
