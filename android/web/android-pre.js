/* Luciel for Android – part 1 (runs before js/app.js).
 * Phone songs are not copied into the page: each one is a tiny "lazy" File that points at
 * https://appassets.androidplatform.net/_n/c?u=<content uri>, which the app streams from Android with Range support.
 * This file teaches the existing modules (storage, tags, BPM, file output) to work with those lazy files. */
(function () {
  'use strict';
  const N = window.LucielAndroid;
  if (!N) return;                       // plain browser / desktop: do nothing
  document.documentElement.classList.add('android');

  // ------------------------------------------------------------- async calls into Android
  const pend = new Map(); let seq = 1;
  function call(method, ...args) {
    return new Promise((res, rej) => {
      const id = seq++; pend.set(id, { res, rej });
      try { N[method](id, ...args); } catch (e) { pend.delete(id); rej(e); }
    });
  }
  const B = window.LucielAndroidBridge = window.LucielAndroidBridge || {};
  B._resolve = (id, ok, v) => { const p = pend.get(id); if (!p) return; pend.delete(id); ok ? p.res(v) : p.rej(new Error(typeof v === 'string' ? v : 'failed')); };
  B.call = call;

  // ------------------------------------------------------------- lazy files
  const ORIGIN = location.origin;
  const urlFor = (uri) => ORIGIN + '/_n/c?u=' + encodeURIComponent(uri);
  const artFor = (uri) => /^content:\/\/media\//.test(uri) ? ORIGIN + '/_n/art?u=' + encodeURIComponent(uri) : '';
  /** e = {uri, url, name, size, mime, rel, durationMs, title, artist, album, ...} */
  function lazyFile(e) {
    const f = new File([], e.name || 'audio', { type: e.mime || '', lastModified: e.added || Date.now() });
    Object.defineProperty(f, 'size', { value: +e.size || 0 });
    f.__url = e.url || urlFor(e.uri); f.__nativePath = e.uri; f.__path = e.rel || e.name;
    f.__art = e.art || artFor(e.uri);
    if (e.durationMs > 0) f.__duration = e.durationMs / 1000;
    f.__ms = e;
    return f;
  }
  const isLazy = (b) => !!(b && b.__url);
  /** the real bytes of a lazy file (tag editor, BPM analysis) */
  async function materialize(b) {
    if (!isLazy(b)) return b;
    const r = await fetch(b.__url); if (!r.ok) throw new Error('Could not read the file (' + r.status + ')');
    const blob = await r.blob();
    return new File([blob], b.name, { type: b.type || blob.type });
  }
  /** Blob-like view that reads byte ranges on demand (metadata parser only needs a few KB) */
  function rangeView(b) {
    return {
      name: b.name, type: b.type, size: b.size,
      slice(a, z) {
        a = Math.max(0, a | 0); z = Math.min(b.size, z == null ? b.size : z);
        return { size: Math.max(0, z - a), arrayBuffer: async () => {
          if (z <= a) return new ArrayBuffer(0);
          const r = await fetch(b.__url, { headers: { Range: `bytes=${a}-${z - 1}` } });
          if (!r.ok) throw new Error('range ' + r.status);
          return r.arrayBuffer();
        } };
      },
      arrayBuffer: () => fetch(b.__url).then((r) => r.arrayBuffer()),
    };
  }
  window.LucielLazy = { lazyFile, isLazy, materialize, urlFor, artFor, rangeView };

  // blob: URLs for lazy files are just their stream URL (playTrack / duration probe use URL.createObjectURL(t.file))
  const origCreate = URL.createObjectURL.bind(URL), origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => (isLazy(o) ? o.__url : origCreate(o));
  URL.revokeObjectURL = (u) => { if (typeof u === 'string' && u.startsWith('blob:')) origRevoke(u); };

  // storage: restore lazy files from their saved content:// path (IndexedDB only keeps an empty placeholder)
  const T = window.AeroStore && window.AeroStore.Tracks;
  if (T && T.all) {
    const all = T.all.bind(T);
    T.all = async () => (await all()).map((r) => {
      if (r && r.nativePath && /^content:/.test(r.nativePath) && (!r.blob || !r.blob.size)) {
        r.blob = lazyFile({ uri: r.nativePath, name: r.name, size: r.size, mime: r.mime || r.type, rel: r.path });
      }
      return r;
    });
  }

  // metadata: parse tags with ranged reads, fill the gaps from Android's MediaStore, fall back to its album art
  const M = window.AeroMeta;
  if (M && M.read) {
    const read = M.read.bind(M);
    M.read = async (file) => {
      if (!isLazy(file)) return read(file);
      let m;
      try { m = await read(rangeView(file)); } catch (e) { m = null; }
      m = m || { title: '', artist: '', album: '', albumArtist: '', year: '', genre: '', track: '', disc: '', compilation: false, picture: null, format: '' };
      const s = file.__ms || {};
      for (const k of ['title', 'artist', 'album', 'albumArtist', 'year', 'genre', 'track']) if (!m[k] && s[k]) m[k] = String(s[k]);
      if (!m.picture && file.__art) {
        try { const r = await fetch(file.__art); if (r.ok) { const d = new Uint8Array(await r.arrayBuffer()); if (d.length > 64) m.picture = { mime: 'image/jpeg', data: d }; } } catch (e) {}
      }
      if (!m.format) m.format = (file.name.split('.').pop() || '').toUpperCase();
      return m;
    };
  }

  // BPM: only analyse lazy files when they are actually playing (decoding a whole phone library in the background
  // would eat battery); the live beat tracker covers the rest
  const BPM = window.LucielBPM;
  if (BPM && BPM.analyzeBlob) {
    const analyze = BPM.analyzeBlob.bind(BPM);
    BPM.analyzeBlob = async (blob, opts) => {
      if (!isLazy(blob)) return analyze(blob, opts);
      const app = window.Luciel && window.Luciel.app;
      if (!app || !app.current || app.current.file !== blob) return { error: 'deferred' };
      return analyze({ arrayBuffer: () => fetch(blob.__url).then((r) => r.arrayBuffer()), size: blob.size, type: blob.type }, opts);
    };
  }

  // tag editor: needs real bytes
  const TG = window.LucielTags;
  if (TG) {
    const fmt = TG.formatOf.bind(TG), write = TG.write.bind(TG);
    TG.formatOf = async (b) => fmt(isLazy(b) ? rangeView(b) : b);
    TG.write = async (b, ...rest) => write(await materialize(b), ...rest);
  }

  // file output: phone files are overwritten through Android (with its consent dialog), others get "Save a copy"
  const toB64 = (ab) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(new Blob([ab])); });
  const FS = window.LucielFS;
  if (FS) {
    const canNative = (t) => t && t.nativePath && /^content:/.test(t.nativePath);
    const mode = FS.mode.bind(FS), describe = FS.describe.bind(FS), save = FS.save.bind(FS);
    FS.mode = (t) => (canNative(t) ? 'native' : mode(t) === 'download' ? 'android-copy' : mode(t));
    FS.describe = (t) => (canNative(t) ? 'Save into the file on your phone (Android asks first)' : FS.mode(t) === 'android-copy' ? 'Save a copy with the Android file dialog' : describe(t));
    FS.save = async (t, blob, newName) => {
      if (canNative(t)) {
        await call('writeFile', t.nativePath, await toB64(await blob.arrayBuffer()));
        const onDisk = (t.__diskName || (t.file && t.file.name) || t.name);
        let renamed = false;
        if (newName && newName !== onDisk) { t.nativePath = await call('renameFile', t.nativePath, newName); renamed = true; t.__diskName = newName; }
        // go back to streaming from the (now updated) file instead of keeping the whole song in memory / IndexedDB
        t.file = lazyFile({ uri: t.nativePath, name: newName || t.name, size: blob.size, mime: t.mime, rel: t.path, durationMs: (t.duration || 0) * 1000 });
        t.size = blob.size;
        return { mode: 'native', renamed, name: newName || t.name };
      }
      if (mode(t) === 'download') {
        const r = await call('saveAs', newName || t.name, blob.type || 'audio/*', await toB64(await blob.arrayBuffer()));
        if (r && r.cancelled) return { mode: 'android-copy', cancelled: true };
        return { mode: 'android-copy', renamed: true, name: (r && r.name) || newName || t.name };
      }
      return save(t, blob, newName);
    };
  }
})();
