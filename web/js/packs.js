/* Luciel visual packs: format constants, manifest validation, a small hand-written unzip (stored + deflate via the
 * browser's DecompressionStream, CRC-checked), and pack -> scene conversion. No DOM in the core so the Electron main
 * process can require() this file and re-validate installs with exactly the same rules. See PACKS.md for the format. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LucielPacks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FORMAT = 'luciel-pack/1';
  const LIMITS = {
    zipBytes: 200 * 1024 * 1024,      // the .zip itself
    packBytes: 150 * 1024 * 1024,     // all files, uncompressed
    fileBytes: 60 * 1024 * 1024,      // any single video / audio file
    imageBytes: 20 * 1024 * 1024,     // any single image
    manifestBytes: 256 * 1024,
    files: 400, scenes: 48, effects: 8,
  };
  // only media + JSON. Everything else is refused (scripts, HTML, SVG, executables) or skipped (readme / license text).
  const TYPES = {
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image',
    mp4: 'video', webm: 'video', m4v: 'video',
    mp3: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio',
    json: 'json',
  };
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', json: 'application/json' };
  const SKIP = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\.git\/)|(^|\/)(readme|license|licence|credits|changelog)(\.(txt|md))?$|\.(txt|md)$/i;
  const DANGEROUS = /\.(js|mjs|cjs|ts|html?|xhtml|svg|svgz|xml|xsl|php|py|rb|pl|sh|bash|ps1|psm1|bat|cmd|com|exe|dll|scr|msi|jar|vbs|vbe|wsf|hta|lnk|reg|wasm|swf|css|appimage|apk|dmg|pkg|deb|rpm|so|dylib)$/i;
  const EFFECTS = ['dither', 'rgb-split', 'datamosh', 'pixel-sort', 'scanlines', 'cyber'];
  const PARTICLES = ['bubbles', 'sparkles', 'rain', 'embers', 'slime', 'smoke', 'dust', 'sparks', 'feathers', 'notes', 'confetti', 'hearts', 'petals', 'stars', 'zzz', 'grid', 'glyphs', 'leaves', 'steam', 'neon'];
  const PALETTES = ['aero', 'blue', 'red', 'slime'];
  const SKINS = ['aero', 'classic'];
  const TIERS = ['slow', 'mid', 'fast'];
  const EMOTES = ['idle', 'happy', 'love', 'shy', 'smug', 'surprised', 'confused', 'flying', 'music', 'angry', 'bored', 'crying', 'sleepy', 'cloud', 'cloud-sleep'];
  // music events a pack character can react to (js/luciel.js detects them from the live spectrum) -> character.events
  const EVENTS = ['start', 'drop', 'hit', 'quiet', 'rise', 'sad', 'vocals'];
  const EMOTE_RE = /^[a-z][a-z0-9-]{0,23}$/;
  const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const MOODS = {   // default auto-pick ranges for packs that name a mood but give no explicit bpm / energy window
    sad: { energy: [0, 0.3], bpm: [0, 95] }, sleepy: { energy: [0, 0.2], bpm: [0, 82] }, calm: { energy: [0, 0.32], bpm: [0, 100] },
    chill: { energy: [0, 0.45], bpm: [60, 108] }, romantic: { energy: [0.1, 0.5], bpm: [60, 112] }, groove: { energy: [0.3, 0.72], bpm: [88, 126] },
    happy: { energy: [0.4, 0.9], bpm: [100, 140] }, hype: { energy: [0.62, 1], bpm: [122, 999] }, angry: { energy: [0.6, 1], bpm: [110, 999] }, dark: { energy: [0.2, 0.7], bpm: [70, 140] },
  };
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/, SCENE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const RESERVED = new Set(['luciel-core', 'core', 'auto', 'builtin', 'luciel']);

  const extOf = (p) => { const m = /\.([a-z0-9]+)$/i.exec(p || ''); return m ? m[1].toLowerCase() : ''; };
  const typeOf = (p) => TYPES[extOf(p)] || null;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => typeof v === 'number' && isFinite(v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** a pack-relative path: forward slashes, no '..', no absolute / drive / scheme, sane characters */
  function safePath(p) {
    if (typeof p !== 'string' || !p || p.length > 200) return null;
    if (/[\\\u0000-\u001f]/.test(p) || /^[a-z]+:/i.test(p) || p.startsWith('/') || p.startsWith('~')) return null;
    const parts = p.split('/');
    if (parts.some((s) => s === '' || s === '.' || s === '..' || /^\s|\s$/.test(s) || /[<>:"|?*]/.test(s))) return null;
    return parts.join('/');
  }

  // ------------------------------------------------------------------ magic-number sniffing (a .png must be a PNG)
  const at = (b, i, arr) => arr.every((v, k) => b[i + k] === v);
  const str = (b, i, s) => at(b, i, [...s].map((c) => c.charCodeAt(0)));
  function sniff(b, ext) {
    if (!b || b.length < 4) return false;
    switch (ext) {
      case 'png': return at(b, 0, [0x89, 0x50, 0x4e, 0x47]);
      case 'jpg': case 'jpeg': return at(b, 0, [0xff, 0xd8, 0xff]);
      case 'gif': return str(b, 0, 'GIF8');
      case 'webp': return str(b, 0, 'RIFF') && str(b, 8, 'WEBP');
      case 'wav': return str(b, 0, 'RIFF') && str(b, 8, 'WAVE');
      case 'avif': return str(b, 4, 'ftyp') && (str(b, 8, 'avif') || str(b, 8, 'avis'));
      case 'mp4': case 'm4v': case 'm4a': return str(b, 4, 'ftyp');
      case 'webm': return at(b, 0, [0x1a, 0x45, 0xdf, 0xa3]);
      case 'mp3': return str(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
      case 'ogg': case 'oga': case 'opus': return str(b, 0, 'OggS');
      case 'flac': return str(b, 0, 'fLaC');
      case 'json': { let i = 0; if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3; while (i < b.length && /\s/.test(String.fromCharCode(b[i]))) i++; return b[i] === 0x7b || b[i] === 0x5b; }
      default: return false;
    }
  }

  // ------------------------------------------------------------------ CRC-32 + unzip
  let CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function inflateRaw(u8, expected) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack compressed zips (no DecompressionStream). Import the unzipped folder instead.');
    const rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const out = new Uint8Array(expected); let n = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      if (n + value.length > expected) { try { await rd.cancel(); } catch (e) {} throw new Error('entry is larger than its header says (possible zip bomb)'); }
      out.set(value, n); n += value.length;
    }
    if (n !== expected) throw new Error('entry is truncated');
    return out;
  }
  /** -> [{path, data: Uint8Array}] ; enforces LIMITS before inflating anything */
  async function unzip(buf, limits = LIMITS) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (b.length > limits.zipBytes) throw new PackError([`The zip is ${mb(b.length)}; the limit is ${mb(limits.zipBytes)}.`]);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new PackError(['This is not a zip file (no central directory found).']);
    const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOff === 0xffffffff) throw new PackError(['ZIP64 archives are not supported. Re-zip with a standard zip tool.']);
    if (cdOff + cdSize > b.length) throw new PackError(['The zip is damaged (central directory out of range).']);
    if (count > limits.files * 2) throw new PackError([`The zip has ${count} entries; a pack may contain at most ${limits.files} files.`]);
    const entries = []; let p = cdOff, total = 0;
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new PackError(['The zip is damaged (bad central directory entry).']);
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const ext = dv.getUint32(p + 38, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;                                    // directory
      if (csize === 0xffffffff || usize === 0xffffffff || lo === 0xffffffff) throw new PackError(['ZIP64 entries are not supported.']);
      if ((ext >>> 16 & 0o170000) === 0o120000) throw new PackError([`“${name}” is a symbolic link; links are not allowed in packs.`]);
      entries.push({ name, flags, method, crc, csize, usize, lo });
    }
    const out = [];
    for (const e of entries) {
      if (SKIP.test(e.name)) { out.push({ path: e.name, skipped: true, size: e.usize }); continue; }
      if (e.flags & 1) throw new PackError([`“${e.name}” is encrypted; password-protected zips are not supported.`]);
      if (e.method !== 0 && e.method !== 8) throw new PackError([`“${e.name}” uses an unsupported compression method (${e.method}). Use normal (deflate) zip compression.`]);
      total += e.usize;
      if (total > limits.packBytes) throw new PackError([`The pack unpacks to more than ${mb(limits.packBytes)}.`]);
      if (DANGEROUS.test(e.name)) { out.push({ path: e.name, size: e.usize, data: null }); continue; }   // reported by validate()
      if (dv.getUint32(e.lo, true) !== 0x04034b50) throw new PackError([`The zip is damaged at “${e.name}”.`]);
      const start = e.lo + 30 + dv.getUint16(e.lo + 26, true) + dv.getUint16(e.lo + 28, true);
      const raw = b.subarray(start, start + e.csize);
      if (raw.length !== e.csize) throw new PackError([`The zip is truncated at “${e.name}”.`]);
      let data;
      try { data = e.method === 0 ? raw.slice() : await inflateRaw(raw, e.usize); } catch (x) { throw new PackError([`Could not unpack “${e.name}”: ${x.message}`]); }
      if (crc32(data) !== e.crc) throw new PackError([`“${e.name}” failed its CRC check; the zip is corrupt.`]);
      out.push({ path: e.name, size: data.length, data });
    }
    return out;
  }

  class PackError extends Error { constructor(errors, warnings) { super(errors[0] || 'Invalid pack'); this.errors = errors; this.warnings = warnings || []; } }
  const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

  /** files: [{path, size, data?: Uint8Array, blob?: Blob, head?: Uint8Array, skipped?}] (from unzip or a folder pick).
   *  Strips a single wrapping folder, drops junk, finds pack.json. -> {manifestText, files: Map(path -> entry), skipped[]} */
  function collect(files) {
    let list = files.filter((f) => f && f.path).map((f) => Object.assign({}, f, { path: String(f.path).replace(/\\/g, '/').replace(/^\.\//, '') }));
    const skipped = list.filter((f) => f.skipped || SKIP.test(f.path)).map((f) => f.path);
    list = list.filter((f) => !f.skipped && !SKIP.test(f.path));
    if (!list.some((f) => f.path === 'pack.json')) {              // zipped "my-pack/pack.json" -> strip "my-pack/"
      const top = list.filter((f) => /^[^/]+\/pack\.json$/.test(f.path));
      if (top.length === 1) { const pre = top[0].path.slice(0, -'pack.json'.length); list = list.filter((f) => f.path.startsWith(pre)).map((f) => Object.assign(f, { path: f.path.slice(pre.length) })); }
    }
    const map = new Map(); list.forEach((f) => map.set(f.path, f));
    return { files: map, skipped };
  }

  /** Validate a manifest object against the files it ships with. -> {ok, errors[], warnings[], pack (normalized)} */
  function validate(manifest, files, opts = {}) {
    const E = [], W = [];
    const fileMap = files instanceof Map ? files : new Map((files || []).map((f) => [f.path, f]));
    const limits = Object.assign({}, LIMITS, opts.limits || {});
    if (!isObj(manifest)) return { ok: false, errors: ['pack.json must contain a JSON object ({ … }).'], warnings: W };
    const m = manifest;
    // ---- files: types, sizes, magic numbers
    let total = 0;
    const bad = [];
    for (const [p, f] of fileMap) {
      if (!safePath(p)) { E.push(`Illegal file path “${p}” (no absolute paths, “..”, backslashes or special characters).`); continue; }
      if (DANGEROUS.test(p)) { bad.push(p); continue; }
      const t = typeOf(p);
      if (!t) { E.push(`“${p}”: .${extOf(p) || '(no extension)'} files are not allowed. Packs may only contain images (png/jpg/webp/gif/avif), video (mp4/webm), audio and JSON.`); continue; }
      const size = f.size != null ? f.size : f.data ? f.data.length : f.blob ? f.blob.size : 0;
      total += size;
      if (t === 'image' && size > limits.imageBytes) E.push(`“${p}” is ${mb(size)}; images may be at most ${mb(limits.imageBytes)}.`);
      else if (size > limits.fileBytes) E.push(`“${p}” is ${mb(size)}; a single file may be at most ${mb(limits.fileBytes)}.`);
      const head = f.head || f.data;
      if (head && !sniff(head.subarray ? head.subarray(0, 16) : head, extOf(p))) E.push(`“${p}” is not really a .${extOf(p)} file (its contents don’t match the extension).`);
    }
    if (bad.length) E.push(`Scripts and executable/markup files are not allowed in packs: ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ` (+${bad.length - 6} more)` : ''}.`);
    if (fileMap.size > limits.files) E.push(`The pack has ${fileMap.size} files; the limit is ${limits.files}.`);
    if (total > limits.packBytes) E.push(`The pack is ${mb(total)}; the limit is ${mb(limits.packBytes)}.`);
    // ---- header
    const need = (k) => { if (typeof m[k] !== 'string' || !m[k].trim()) { E.push(`pack.json: “${k}” is required and must be a non-empty string.`); return false; } return true; };
    if (m.format !== undefined && m.format !== FORMAT) E.push(`pack.json: “format” must be "${FORMAT}" (got ${JSON.stringify(m.format)}).`);
    if (m.format === undefined) W.push(`pack.json has no “format”; assuming "${FORMAT}".`);
    if (need('id')) {
      if (!ID_RE.test(m.id)) E.push(`pack.json: “id” must be 2–40 characters of a–z, 0–9 and “-” (got ${JSON.stringify(m.id)}).`);
      else if (RESERVED.has(m.id) && !opts.builtin) E.push(`pack.json: the id “${m.id}” is reserved.`);
    }
    need('name'); if (typeof m.name === 'string' && m.name.length > 60) E.push('pack.json: “name” may be at most 60 characters.');
    if (need('version') && !/^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]+)?$/.test(m.version)) E.push(`pack.json: “version” must look like 1.0 or 1.2.3 (got ${JSON.stringify(m.version)}).`);
    if (m.author === undefined) W.push('pack.json: no “author” given.'); else if (typeof m.author !== 'string') E.push('pack.json: “author” must be a string.');
    if (m.description !== undefined && typeof m.description !== 'string') E.push('pack.json: “description” must be a string.');
    const fileRef = (where, p, kinds, required) => {
      if (p === undefined || p === null || p === '') { if (required) E.push(`${where} is required.`); return undefined; }
      if (typeof p !== 'string') { E.push(`${where} must be a file path string.`); return undefined; }
      const sp = safePath(p);
      if (!sp) { E.push(`${where}: illegal path “${p}”.`); return undefined; }
      if (!opts.builtin && !fileMap.has(sp)) { E.push(`${where}: file “${p}” is not in the pack.`); return undefined; }
      if (!opts.builtin && kinds && !kinds.includes(typeOf(sp))) { E.push(`${where}: “${p}” must be ${kinds.join(' or ')}.`); return undefined; }
      return sp;
    };
    const strList = (where, v, allowed) => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { E.push(`${where} must be a list of strings.`); return []; }
      const out = v.map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (allowed) { const unk = out.filter((x) => !allowed.includes(x)); if (unk.length) W.push(`${where}: unknown value(s) ${unk.join(', ')} ignored (allowed: ${allowed.join(', ')}).`); return out.filter((x) => allowed.includes(x)); }
      return out;
    };
    const range = (where, v, lo, hi) => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1]) || v[0] > v[1] || v[0] < lo || v[1] > hi) { E.push(`${where} must be [min, max] with ${lo} ≤ min ≤ max ≤ ${hi}.`); return undefined; }
      return [v[0], v[1]];
    };
    const preview = fileRef('pack.json: “preview”', m.preview, ['image'], false);
    if (m.preview === undefined) W.push('pack.json: no “preview” image; the first scene’s image is used in the Packs manager.');
    // ---- scenes
    const scenes = [];
    if (!Array.isArray(m.scenes) || !m.scenes.length) E.push('pack.json: “scenes” must be a non-empty list.');
    else if (m.scenes.length > limits.scenes) E.push(`pack.json: at most ${limits.scenes} scenes per pack (got ${m.scenes.length}).`);
    else {
      const seen = new Set();
      m.scenes.forEach((s, i) => {
        const at = `scenes[${i}]${isObj(s) && typeof s.id === 'string' ? ` (“${s.id}”)` : ''}`;
        if (!isObj(s)) { E.push(`${at} must be an object.`); return; }
        if (typeof s.id !== 'string' || !SCENE_ID_RE.test(s.id)) { E.push(`${at}: “id” must be 1–40 characters of a–z, 0–9 and “-”.`); return; }
        if (seen.has(s.id)) { E.push(`${at}: duplicate scene id “${s.id}”.`); return; } seen.add(s.id);
        if (typeof s.name !== 'string' || !s.name.trim()) E.push(`${at}: “name” is required.`);
        const bg = s.background;
        if (!isObj(bg)) { E.push(`${at}: “background” is required ({ "image": "…" }).`); return; }
        const n = {
          id: s.id, name: String(s.name || s.id).slice(0, 60),
          thumb: fileRef(`${at}.thumb`, s.thumb, ['image'], false),
          background: {
            image: fileRef(`${at}.background.image`, bg.image, ['image'], true),
            video: fileRef(`${at}.background.video`, bg.video, ['video'], false),
            pixel: fileRef(`${at}.background.pixel`, bg.pixel, ['image'], false),
            pixelVideo: fileRef(`${at}.background.pixelVideo`, bg.pixelVideo, ['video'], false),
            glow: fileRef(`${at}.background.glow`, bg.glow, ['image'], false),
            loopBpm: bg.loopBpm === undefined ? undefined : num(bg.loopBpm) && bg.loopBpm >= 40 && bg.loopBpm <= 240 ? bg.loopBpm : (E.push(`${at}.background.loopBpm must be a number between 40 and 240.`), undefined),
            loopDuration: num(bg.loopDuration) ? bg.loopDuration : undefined,
            tempoSync: bg.tempoSync === undefined ? true : !!bg.tempoSync,
            motion: bg.motion === undefined ? 'static' : ['static', 'drift'].includes(bg.motion) ? bg.motion : (E.push(`${at}.background.motion must be "static" or "drift".`), 'static'),
            featuresCharacter: !!bg.featuresCharacter,
          },
          pixel: !!s.pixel,
          themeDefault: s.themeDefault === undefined ? undefined : PALETTES.includes(s.themeDefault) ? s.themeDefault : (E.push(`${at}.themeDefault must be one of ${PALETTES.join(', ')}.`), undefined),
          particles: strList(`${at}.particles`, s.particles, PARTICLES),
        };
        // character
        const c = s.character === undefined ? {} : s.character;
        if (!isObj(c)) E.push(`${at}.character must be an object.`);
        else {
          const use = c.use === undefined ? (c.dance ? 'custom' : 'lucielle') : c.use;
          if (!['lucielle', 'custom', 'none'].includes(use)) E.push(`${at}.character.use must be "lucielle", "custom" or "none".`);
          const ch = { use, name: typeof c.name === 'string' ? c.name.slice(0, 40) : undefined, tier: undefined, dance: {}, emotes: {}, poses: strList(`${at}.character.poses`, c.poses, EMOTES), scale: 1 };
          if (c.tier !== undefined) { if (['auto', ...TIERS].includes(c.tier)) ch.tier = c.tier; else E.push(`${at}.character.tier must be auto, slow, mid or fast.`); }
          if (c.scale !== undefined) { if (num(c.scale) && c.scale >= 0.3 && c.scale <= 1.6) ch.scale = c.scale; else E.push(`${at}.character.scale must be between 0.3 and 1.6.`); }
          if (c.dance !== undefined) {
            if (!isObj(c.dance)) E.push(`${at}.character.dance must be an object with slow / mid / fast loops.`);
            else for (const k of Object.keys(c.dance)) {
              const d = c.dance[k], w = `${at}.character.dance.${k}`;
              if (!TIERS.includes(k)) { W.push(`${w}: unknown tempo tier ignored (use slow, mid, fast).`); continue; }
              if (!isObj(d)) { E.push(`${w} must be an object.`); continue; }
              const loopBpm = num(d.loopBpm) && d.loopBpm >= 40 && d.loopBpm <= 240 ? d.loopBpm : (d.loopBpm === undefined ? { slow: 90, mid: 120, fast: 150 }[k] : (E.push(`${w}.loopBpm must be between 40 and 240.`), 120));
              if (d.video !== undefined) {
                const v = fileRef(`${w}.video`, d.video, ['video'], true);
                const beats = num(d.beats) && d.beats >= 1 && d.beats <= 64 ? d.beats : (E.push(`${w}.beats (loop length in beats, 1–64) is required for a video loop.`), 8);
                if (v) ch.dance[k] = { video: v, loopBpm, beats };
                if (v && extOf(v) !== 'webm') W.push(`${w}.video: use a transparent WebM (VP9 with alpha) so the scene shows through.`);
              } else {
                const sh = fileRef(`${w}.sheet`, d.sheet, ['image'], true);
                const frames = Number.isInteger(d.frames) && d.frames >= 1 && d.frames <= 512 ? d.frames : (E.push(`${w}.frames must be a whole number 1–512.`), 1);
                const cols = Number.isInteger(d.columns) && d.columns >= 1 && d.columns <= 64 ? d.columns : (E.push(`${w}.columns must be a whole number 1–64.`), 1);
                let beats = num(d.beats) && d.beats >= 1 && d.beats <= 64 ? d.beats : undefined;
                if (!beats && num(d.fps) && d.fps > 0 && d.fps <= 60) beats = Math.max(1, Math.round(frames / d.fps * loopBpm / 60));
                if (!beats) { E.push(`${w}: give “beats” (loop length in beats) or “fps”.`); beats = 4; }
                if (sh) ch.dance[k] = { sheet: sh, frames, columns: cols, loopBpm, beats };
              }
            }
          }
          if (c.idle !== undefined) ch.idle = fileRef(`${at}.character.idle`, c.idle, ['image'], false);
          if (c.emotes !== undefined) {
            if (!isObj(c.emotes)) E.push(`${at}.character.emotes must be an object like { "happy": "emotes/happy.png" }.`);
            else for (const k of Object.keys(c.emotes)) {
              const w = `${at}.character.emotes.${k}`, v = c.emotes[k];
              if (!EMOTE_RE.test(k)) { E.push(`${w}: emote names are 1–24 characters of a–z, 0–9 and “-”.`); continue; }
              if (isObj(v)) {                                   // animated emote: a tempo-synced sprite-sheet loop
                const sh = fileRef(`${w}.sheet`, v.sheet, ['image'], true);
                const frames = Number.isInteger(v.frames) && v.frames >= 1 && v.frames <= 512 ? v.frames : (E.push(`${w}.frames must be a whole number 1–512.`), 1);
                const cols = Number.isInteger(v.columns) && v.columns >= 1 && v.columns <= 64 ? v.columns : (E.push(`${w}.columns must be a whole number 1–64.`), 1);
                const loopBpm = num(v.loopBpm) && v.loopBpm >= 40 && v.loopBpm <= 240 ? v.loopBpm : 120;
                let beats = num(v.beats) && v.beats >= 1 && v.beats <= 64 ? v.beats : undefined;
                if (!beats && num(v.fps) && v.fps > 0 && v.fps <= 60) beats = Math.max(1, Math.round(frames / v.fps * loopBpm / 60));
                if (!beats) { E.push(`${w}: give “beats” or “fps” for an animated emote.`); beats = 4; }
                if (sh) ch.emotes[k] = { sheet: sh, frames, columns: cols, loopBpm, beats };
              } else { const f = fileRef(w, v, ['image'], true); if (f) ch.emotes[k] = f; }
            }
          }
          if (c.events !== undefined) {
            ch.events = {};
            if (!isObj(c.events)) E.push(`${at}.character.events must be an object like { "drop": "headbang" }.`);
            else for (const k of Object.keys(c.events)) {
              const v = c.events[k], w = `${at}.character.events.${k}`;
              if (!EVENTS.includes(k)) { W.push(`${w}: unknown music event ignored (allowed: ${EVENTS.join(', ')}).`); continue; }
              if (typeof v !== 'string' || !EMOTE_RE.test(v)) { E.push(`${w} must be an emote name.`); continue; }
              if (!ch.emotes[v] && !EMOTES.includes(v)) { E.push(`${w}: “${v}” is not one of this character's emotes.`); continue; }
              ch.events[k] = v;
            }
          }
          for (const k of Object.keys(ch.emotes)) if (!EMOTES.includes(k) && !Object.values(ch.events || {}).includes(k)) W.push(`${at}.character.emotes.${k}: custom emote is not mapped in “events”, so it will never be shown.`);
          if (ch.use === 'custom' && !Object.keys(ch.dance).length && !ch.idle) E.push(`${at}.character: a custom character needs at least one dance loop (slow / mid / fast) or an idle image.`);
          n.character = ch;
        }
        // effects
        n.effects = [];
        if (s.effects !== undefined) {
          if (!Array.isArray(s.effects)) E.push(`${at}.effects must be a list like [{ "type": "dither", "intensity": 0.5 }].`);
          else s.effects.slice(0, limits.effects).forEach((fx, j) => {
            const f = typeof fx === 'string' ? { type: fx } : fx;
            if (!isObj(f) || !EFFECTS.includes(f.type)) { E.push(`${at}.effects[${j}]: “type” must be one of ${EFFECTS.join(', ')}.`); return; }
            const it = f.intensity === undefined ? 0.6 : f.intensity;
            if (!num(it) || it < 0 || it > 1) { E.push(`${at}.effects[${j}].intensity must be between 0 and 1.`); return; }
            n.effects.push({ type: f.type, intensity: it });
          });
        }
        // audio reactivity
        const r = s.reactivity === undefined ? {} : s.reactivity;
        n.reactivity = { beatZoom: 1, bassGlow: 1, shake: 1, flash: 1, particles: 1, glowColor: undefined };
        if (!isObj(r)) E.push(`${at}.reactivity must be an object.`);
        else for (const k of Object.keys(r)) {
          if (k === 'beatBurst') { if (PARTICLES.includes(r[k])) n.reactivity.beatBurst = r[k]; else E.push(`${at}.reactivity.beatBurst must be a particle type (${PARTICLES.join(', ')}).`); }
          else if (k === 'glowColor') { if (typeof r[k] === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(r[k])) n.reactivity.glowColor = r[k]; else E.push(`${at}.reactivity.glowColor must be a hex colour like "#ff4fd8".`); }
          else if (k in n.reactivity) { if (num(r[k]) && r[k] >= 0 && r[k] <= 2) n.reactivity[k] = r[k]; else E.push(`${at}.reactivity.${k} must be a number from 0 to 2 (1 = normal).`); }
          else W.push(`${at}.reactivity.${k}: unknown setting ignored.`);
        }
        // scene colour theme (applied to the player while the scene is showing)
        if (s.colors !== undefined) {
          const cl = s.colors, w = `${at}.colors`;
          if (!isObj(cl)) E.push(`${w} must be an object.`);
          else {
            const o = {};
            if (cl.base !== undefined) { if (PALETTES.includes(cl.base)) o.base = cl.base; else E.push(`${w}.base must be one of ${PALETTES.join(', ')}.`); }
            for (const k of ['accent', 'accent2', 'glow', 'lcd', 'text']) if (cl[k] !== undefined) { if (typeof cl[k] === 'string' && COLOR_RE.test(cl[k])) o[k] = cl[k]; else E.push(`${w}.${k} must be a hex colour.`); }
            if (cl.bg !== undefined) { if (Array.isArray(cl.bg) && cl.bg.length === 3 && cl.bg.every((x) => typeof x === 'string' && COLOR_RE.test(x))) o.bg = cl.bg.slice(); else E.push(`${w}.bg must be a list of 3 hex colours (light to dark).`); }
            if (cl.frame !== undefined) { if (Array.isArray(cl.frame) && cl.frame.length === 3 && cl.frame.every((x) => typeof x === 'string' && COLOR_RE.test(x))) o.frame = cl.frame.slice(); else E.push(`${w}.frame must be a list of 3 hex colours (Classic frame, light to dark).`); }
            if (Object.keys(o).length) n.colors = o;
          }
        }
        // auto-selection
        const mt = s.match === undefined ? {} : s.match;
        if (!isObj(mt)) E.push(`${at}.match must be an object.`);
        n.match = {
          genres: strList(`${at}.match.genres`, mt.genres), coverGenres: strList(`${at}.match.coverGenres`, mt.coverGenres),
          moods: strList(`${at}.match.moods`, mt.moods), themes: strList(`${at}.match.themes`, mt.themes, PALETTES), skins: strList(`${at}.match.skins`, mt.skins, SKINS),
          bpm: range(`${at}.match.bpm`, mt.bpm, 0, 999), energy: range(`${at}.match.energy`, mt.energy, 0, 1),
        };
        if (!opts.builtin && !n.match.genres.length && !n.match.moods.length && !n.match.bpm) W.push(`${at}: no genres, moods or bpm in “match”, so it will only appear when picked by hand.`);
        scenes.push(n);
      });
    }
    const pack = { format: FORMAT, id: m.id, name: typeof m.name === 'string' ? m.name.trim().slice(0, 60) : m.id, author: typeof m.author === 'string' ? m.author.slice(0, 60) : 'Unknown', version: m.version,
      description: typeof m.description === 'string' ? m.description.slice(0, 400) : '', preview, scenes, bytes: total };
    return { ok: !E.length, errors: E, warnings: W, pack };
  }

  /** parse + validate pack.json text -> same shape as validate() */
  function check(manifestText, files, opts) {
    if (manifestText == null) return { ok: false, errors: ['No pack.json found. A pack is a folder or .zip with pack.json at its top level.'], warnings: [] };
    if (manifestText.length > LIMITS.manifestBytes) return { ok: false, errors: [`pack.json is larger than ${LIMITS.manifestBytes / 1024} KB.`], warnings: [] };
    let m;
    try { m = JSON.parse(String(manifestText).replace(/^\uFEFF/, '')); }
    catch (e) { return { ok: false, errors: [`pack.json is not valid JSON: ${e.message}`], warnings: [] }; }
    return validate(m, files, opts);
  }

  /** normalized pack -> scene objects for the renderer (js/luciel.js). url(path) resolves a pack file to a loadable URL. */
  function toScenes(pack, url, opts = {}) {
    const builtin = !!opts.builtin;
    return pack.scenes.map((s) => {
      const bg = s.background, fx = s.effects || [], has = (t) => fx.some((f) => f.type === t);
      const kind = bg.featuresCharacter ? 'full' : s.pixel ? 'pixel' : bg.video || bg.motion === 'drift' ? 'video' : 'layered';
      const style = has('cyber') ? 'cyber' : has('datamosh') ? 'datamosh' : has('dither') && kind === 'video' && !bg.video ? 'dither' : '';
      const ch = s.character || { use: 'lucielle', poses: [], dance: {}, emotes: {} };
      const o = { id: builtin ? s.id : `${pack.id}/${s.id}`, name: s.name, kind };
      if (style) o.style = style;
      o.image = url(bg.image); o.thumb = url(s.thumb || bg.image); o.px = url(bg.pixel || bg.image);
      o.particles = s.particles.slice(); o.palette = s.themeDefault || null;
      o.genres = s.match.genres.slice(); o.moods = s.match.moods.slice();
      o.poses = ch.poses && ch.poses.length ? ch.poses.slice() : ['music'];
      o.hasCharacter = !!bg.featuresCharacter;
      if (ch.tier) o.dance = ch.tier;
      let energy = s.match.energy, bpm = s.match.bpm;
      if (!builtin && (!energy || !bpm)) { const mood = s.match.moods.map((x) => MOODS[x]).find(Boolean); if (mood) { energy = energy || mood.energy; bpm = bpm || mood.bpm; } }
      if (energy) o.energy = energy.slice(); if (bpm) o.bpm = bpm.slice();
      if (s.match.coverGenres.length) o.coverGenres = s.match.coverGenres.slice();
      if (s.match.skins.length === 1) o.skin = s.match.skins[0];
      if (kind === 'video') { o.still = !bg.video; o.loopBpm = bg.loopBpm || 120; }
      if (kind === 'pixel' && (bg.pixelVideo || bg.video)) { o.video = url(bg.pixelVideo || bg.video); o.loopBpm = bg.loopBpm || 120; o.pixelVideo = true; }
      if (bg.glow) o.glow = url(bg.glow);
      if (s.colors) o.colors = Object.assign({}, s.colors);
      if (bg.video && !o.video) o.video = url(bg.video);
      if (bg.loopDuration) o.loopDuration = bg.loopDuration;
      if (!builtin) {
        o.pack = pack.id; o.packName = pack.name;
        o.fx = fx.filter((f) => !(f.type === style)).map((f) => Object.assign({}, f));
        o.styleIntensity = (fx.find((f) => f.type === style) || {}).intensity;
        o.react = Object.assign({}, s.reactivity);
        o.themes = s.match.themes.slice(); o.skins = s.match.skins.slice();
        o.tempoSync = bg.tempoSync !== false;
        if (ch.use === 'none') o.char = { use: 'none' };
        else if (ch.use === 'custom' || Object.keys(ch.dance || {}).length || Object.keys(ch.emotes || {}).length || ch.idle) {
          const d = {}; for (const k of Object.keys(ch.dance || {})) { const x = ch.dance[k]; d[k] = Object.assign({}, x, x.sheet ? { sheet: url(x.sheet) } : { video: url(x.video) }); }
          const em = {}; for (const k of Object.keys(ch.emotes || {})) { const e = ch.emotes[k]; em[k] = typeof e === 'string' ? url(e) : Object.assign({}, e, { sheet: url(e.sheet) }); }
          o.char = { use: ch.use === 'lucielle' ? 'lucielle' : 'custom', name: ch.name, dance: d, emotes: em, idle: ch.idle ? url(ch.idle) : undefined, scale: ch.scale || 1, events: ch.events ? Object.assign({}, ch.events) : undefined };
        } else if (ch.scale && ch.scale !== 1) o.char = { use: 'lucielle', scale: ch.scale, dance: {}, emotes: {} };
      }
      return o;
    });
  }

  return { FORMAT, LIMITS, TYPES, MIME, EFFECTS, PARTICLES, PALETTES, SKINS, TIERS, EMOTES, EVENTS, MOODS, ID_RE, extOf, typeOf, safePath, sniff, crc32, unzip, collect, validate, check, toScenes, PackError, DANGEROUS, SKIP, mb };
});
