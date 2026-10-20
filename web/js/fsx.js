/* Luciel file output: where edited files go.
 *   'native'  -> a desktop shell (e.g. Electron preload) exposes window.lucielNative = { writeFile(path, ArrayBuffer), rename(path, newName) -> newPath }
 *   'handle'  -> File System Access API: the track was opened with a FileSystemFileHandle, so it is overwritten (and renamed with handle.move) in place
 *   'picker'  -> showSaveFilePicker() save-as
 *   'download'-> a regular browser download of the edited file
 */
(function (global) {
  'use strict';
  const native = () => global.lucielNative && typeof global.lucielNative.writeFile === 'function';
  const hasFSA = () => typeof global.showOpenFilePicker === 'function';
  function mode(t) {
    if (native() && t.nativePath) return 'native';
    if (t.handle && typeof t.handle.createWritable === 'function') return 'handle';
    if (typeof global.showSaveFilePicker === 'function') return 'picker';
    return 'download';
  }
  function describe(t) {
    return { native: 'Write the file on disk', handle: 'Overwrite the original file on disk', picker: 'Save a copy with a Save dialog', download: 'Download the edited file' }[mode(t)];
  }
  async function verifyPermission(h) {
    if (!h.queryPermission) return true;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  /** save blob for track t under newName. Returns { mode, renamed, name } */
  async function save(t, blob, newName) {
    const m = mode(t);
    if (m === 'native') {
      await global.lucielNative.writeFile(t.nativePath, await blob.arrayBuffer());
      const onDisk = String(t.nativePath).split(/[\\/]/).pop();   // t.name may already carry the new name (library commit runs first)
      let renamed = false;
      if (newName && newName !== onDisk && global.lucielNative.rename) { t.nativePath = await global.lucielNative.rename(t.nativePath, newName); renamed = true; }
      return { mode: m, renamed, name: newName || t.name };
    }
    if (m === 'handle') {
      if (!(await verifyPermission(t.handle))) throw new Error('Permission to write the file was denied');
      const w = await t.handle.createWritable(); await w.write(blob); await w.close();
      let renamed = false;
      if (newName && newName !== t.handle.name && typeof t.handle.move === 'function') { try { await t.handle.move(newName); renamed = true; } catch (e) { console.warn('[fsx] rename failed', e); } }
      return { mode: m, renamed, name: renamed ? newName : t.handle.name };
    }
    if (m === 'picker') {
      try {
        const h = await global.showSaveFilePicker({ suggestedName: newName || t.name });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        t.handle = h;
        return { mode: m, renamed: true, name: h.name };
      } catch (e) { if (e && e.name === 'AbortError') return { mode: m, cancelled: true }; throw e; }
    }
    download(blob, newName || t.name);
    return { mode: m, renamed: true, name: newName || t.name };
  }
  async function pickFiles() {
    const hs = await global.showOpenFilePicker({ multiple: true, types: [{ description: 'Audio', accept: { 'audio/*': ['.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.mp4', '.aac', '.wav', '.webm', '.weba', '.aif', '.aiff', '.wma', '.mka'] } }], excludeAcceptAllOption: false });
    return Promise.all(hs.map(async (h) => { const f = await h.getFile(); f.__handle = h; return f; }));
  }
  async function walkDir(dir, path = '', out = []) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file') { const f = await h.getFile(); f.__handle = h; f.__path = path + name; out.push(f); }
      else await walkDir(h, path + name + '/', out);
    }
    return out;
  }
  async function pickFolder() { const d = await global.showDirectoryPicker({ mode: 'readwrite' }); return walkDir(d, d.name + '/'); }
  global.LucielFS = { mode, describe, save, download, hasFSA, pickFiles, pickFolder, walkDir };
})(window);
