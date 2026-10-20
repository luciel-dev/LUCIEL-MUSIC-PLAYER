/* Luciel visual packs: storage (IndexedDB in the browser, userData/packs via the desktop bridge), import from a .zip or
 * folder, and the Packs manager dialog. Format + validation live in js/packs.js; see PACKS.md. */
(function (global) {
  'use strict';
  const P = global.LucielPacks;
  const $ = (id) => document.getElementById(id);

  function create(app) {
    const { toast, esc, luciel } = app;
    const NATIVE = global.lucielNative && global.lucielNative.isDesktop && global.lucielNative.packs ? global.lucielNative.packs : null;
    const urls = new Map();            // browser: pack id -> Map(path -> blob: URL)
    let installed = [];                // [{id, pack, enabled, bytes, installedAt, scenes}]
    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

    // ------------------------------------------------------------------ storage backends
    const IDB = {
      async list() { return ((await global.AeroStore.Packs.all()) || []).map((r) => ({ id: r.id, text: r.text, enabled: r.enabled !== false, installedAt: r.installedAt, files: r.files })); },
      async install(text, files, pack) {
        const rec = { id: pack.id, text, enabled: true, installedAt: Date.now(), bytes: pack.bytes, files: {} };
        for (const [p, f] of files) rec.files[p] = new Blob([f.data], { type: P.MIME[P.extOf(p)] || 'application/octet-stream' });
        await global.AeroStore.Packs.put(rec);
      },
      async remove(id) { await global.AeroStore.Packs.remove(id); },
      async setEnabled(id, on) { const r = await global.AeroStore.Packs.get(id); if (r) { r.enabled = on; await global.AeroStore.Packs.put(r); } },
    };
    const NAT = NATIVE && {
      list: () => NATIVE.list(),       // main re-validates every pack on disk
      install: (text, files) => NATIVE.install({ text, files: [...files].map(([path, f]) => ({ path, data: f.data })) }),
      remove: (id) => NATIVE.remove(id),
      setEnabled: (id, on) => NATIVE.setEnabled(id, on),
    };
    const store = NAT || IDB;

    function urlFor(id, path) {
      if (NAT) return `packs/${enc(id)}/${enc(path)}`;          // app://luciel/packs/... served from userData/packs
      const m = urls.get(id); return (m && m.get(path)) || '';
    }
    function revoke(id) { const m = urls.get(id); if (m) { m.forEach((u) => URL.revokeObjectURL(u)); urls.delete(id); } }

    /** (re)load installed packs and push their scenes into the scene engine */
    async function load() {
      let list = [];
      try { list = await store.list(); } catch (e) { console.warn('[packs] list failed', e); }
      const out = [];
      for (const r of list) {
        let files;
        if (!NAT) {
          files = new Map(Object.entries(r.files || {}).map(([p, b]) => [p, { path: p, size: b.size }]));
          revoke(r.id); const m = new Map(); Object.entries(r.files || {}).forEach(([p, b]) => m.set(p, URL.createObjectURL(b))); urls.set(r.id, m);
        } else files = new Map((r.files || []).map((f) => [f.path, f]));
        const v = P.check(r.text, files);
        if (!v.ok) { out.push({ id: r.id, broken: v.errors, enabled: false, pack: { id: r.id, name: r.id, scenes: [] }, scenes: [] }); continue; }
        const scenes = P.toScenes(v.pack, (p) => urlFor(r.id, p));
        out.push({ id: r.id, pack: v.pack, enabled: r.enabled !== false, installedAt: r.installedAt, bytes: v.pack.bytes, scenes });
      }
      out.sort((a, b) => (a.installedAt || 0) - (b.installedAt || 0));
      installed = out;
      apply();
      return installed;
    }
    function apply() {
      global.Luciel.Scenes.setExtra(installed.filter((p) => p.enabled).flatMap((p) => p.scenes));
      luciel.scenesChanged();
      app.scenesChanged && app.scenesChanged();
      render(); summary();
    }

    // ------------------------------------------------------------------ import
    const readU8 = (f) => (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer()).then((b) => new Uint8Array(b));
    /** zip File/Blob -> [{path,size,data}] */
    async function fromZip(file) {
      if (file.size > P.LIMITS.zipBytes) throw new P.PackError([`“${file.name}” is ${P.mb(file.size)}; the limit is ${P.mb(P.LIMITS.zipBytes)}.`]);
      return P.unzip(await readU8(file));
    }
    /** files from <input webkitdirectory> / drag & drop (webkitRelativePath) -> [{path,size,data}] */
    async function fromFolder(fileList) {
      const files = [...fileList];
      if (files.length > P.LIMITS.files * 2) throw new P.PackError([`That folder has ${files.length} files; a pack may contain at most ${P.LIMITS.files}.`]);
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > P.LIMITS.packBytes) throw new P.PackError([`That folder holds ${P.mb(total)}; a pack may be at most ${P.mb(P.LIMITS.packBytes)}.`]);
      const out = [];
      for (const f of files) {
        const path = (f.webkitRelativePath || f.__path || f.name).replace(/\\/g, '/');
        if (P.SKIP.test(path)) { out.push({ path, skipped: true, size: f.size }); continue; }
        out.push({ path, size: f.size, data: P.DANGEROUS.test(path) ? null : await readU8(f) });
      }
      // a picked folder arrives as "my-pack/…": collect() strips the wrapper when pack.json sits one level down
      return out;
    }
    let busy = false;
    async function importFiles(getFiles, label) {
      if (busy) return; busy = true; showMsg('busy', [`Reading ${label}…`]);
      try {
        const list = await getFiles();
        const { files, skipped } = P.collect(list);
        const mf = files.get('pack.json');
        const text = mf && mf.data ? new TextDecoder().decode(mf.data) : null;
        const v = P.check(text, files);
        if (skipped.length) v.warnings.push(`Skipped ${skipped.length} non-media file(s): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);
        if (!v.ok) { showMsg('error', v.errors, v.warnings, `Couldn’t import ${label}`); openManager(); return false; }
        const refs = new Set(JSON.stringify(JSON.parse(text)).match(/"[^"]+\.[a-z0-9]{2,5}"/gi) || []);
        const unused = [...files.keys()].filter((p) => p !== 'pack.json' && !refs.has(`"${p}"`));
        if (unused.length) v.warnings.push(`${unused.length} file(s) are not used by pack.json: ${unused.slice(0, 4).join(', ')}${unused.length > 4 ? '…' : ''}`);
        const prev = installed.find((p) => p.id === v.pack.id);
        await store.install(text, files, v.pack);
        await load();
        const msg = `${prev ? 'Updated' : 'Installed'} “${v.pack.name}” v${v.pack.version} — ${v.pack.scenes.length} scene${v.pack.scenes.length === 1 ? '' : 's'} added to the scene picker`;
        showMsg('ok', [msg], v.warnings);
        toast(msg);
        return v.pack.id;
      } catch (e) {
        const errs = e && e.errors ? e.errors : [String(e && e.message || e)];
        showMsg('error', errs, e && e.warnings, `Couldn’t import ${label}`); openManager(); return false;
      } finally { busy = false; }
    }
    const importZip = (file) => importFiles(() => fromZip(file), `“${file.name}”`);
    const importFolder = (fileList) => importFiles(() => fromFolder(fileList), 'the folder');
    /** desktop / FSA folder handle -> files */
    async function importDirHandle(h) {
      return importFiles(async () => { const files = []; await global.LucielFS.walkDir(h, h.name + '/', files); return fromFolder(files); }, `“${h.name}”`);
    }
    async function pickFolder() {
      if (typeof global.showDirectoryPicker === 'function' && !NATIVE) {
        try { const h = await global.showDirectoryPicker(); return importDirHandle(h); } catch (e) { if (e.name === 'AbortError') return; }
      }
      $('packDirInput').click();
    }

    async function remove(id) {
      const p = installed.find((x) => x.id === id); if (!p) return;
      await store.remove(id); revoke(id);
      await load(); toast(`Deleted pack “${p.pack.name}”`);
    }
    async function setEnabled(id, on) {
      const p = installed.find((x) => x.id === id); if (!p) return;
      await store.setEnabled(id, on); p.enabled = on; apply();
      toast(`${p.pack.name}: ${on ? 'enabled' : 'disabled'}`);
    }

    // ------------------------------------------------------------------ manager UI
    function summary() {
      const n = installed.filter((p) => p.enabled).length, sc = global.Luciel.Scenes.list.length;
      const el = $('packSummary'); if (el) el.textContent = `Luciel Core${installed.length ? ` + ${installed.length} imported pack${installed.length === 1 ? '' : 's'}${n < installed.length ? ` (${installed.length - n} off)` : ''}` : ''} · ${sc} scenes`;
    }
    function showMsg(kind, lines, warnings, title) {
      const box = $('pkMsg'); if (!box) return;
      box.hidden = false; box.className = 'pk-msg ' + kind;
      box.innerHTML = (title ? `<b>${esc(title)}</b>` : '') + `<ul>${(lines || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` +
        (warnings && warnings.length ? `<details${kind === 'ok' ? '' : ' open'}><summary>${warnings.length} note${warnings.length === 1 ? '' : 's'}</summary><ul>${warnings.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : '');
    }
    const fmtSize = (n) => n ? P.mb(n) : '';
    function card(p, core) {
      const pk = p.pack, sc = p.scenes || [];
      const prev = core ? 'icons/icon-192.png' : (pk.preview ? urlFor(p.id, pk.preview) : (sc[0] && sc[0].thumb) || 'icons/icon-192.png');
      const thumbs = sc.slice(0, 12).map((s) => `<button class="pk-sc" data-scene="${esc(s.id)}" title="Preview “${esc(s.name)}”${s.genres && s.genres.length ? ' — ' + esc(s.genres.slice(0, 4).join(', ')) : ''}"><img src="${esc(s.thumb)}" alt="" loading="lazy"><span>${esc(s.name)}</span></button>`).join('') + (sc.length > 12 ? `<span class="pk-more">+${sc.length - 12}</span>` : '');
      return `<div class="pk-card${p.enabled ? '' : ' off'}${p.broken ? ' broken' : ''}" data-pack="${esc(p.id)}">
        <img class="pk-prev" src="${esc(prev)}" alt="">
        <div class="pk-info">
          <div class="pk-name">${esc(pk.name)} <span class="pk-ver">v${esc(pk.version || '')}</span>${core ? '<span class="pk-tag">BUILT-IN</span>' : ''}</div>
          <div class="pk-meta">${esc(pk.author || '')}${pk.author ? ' · ' : ''}${sc.length} scene${sc.length === 1 ? '' : 's'}${p.bytes ? ' · ' + fmtSize(p.bytes) : ''}${p.installedAt ? ' · added ' + new Date(p.installedAt).toLocaleDateString() : ''}</div>
          ${pk.description ? `<div class="pk-desc">${esc(pk.description)}</div>` : ''}
          ${p.broken ? `<div class="pk-desc err">This pack no longer validates: ${esc(p.broken[0])}</div>` : ''}
          <div class="pk-scenes">${thumbs}</div>
        </div>
        <div class="pk-acts">
          <label class="chk pk-on" title="${core ? 'The built-in pack is always on' : 'Enable / disable this pack'}"><input type="checkbox" data-act="toggle" ${p.enabled ? 'checked' : ''} ${core || p.broken ? 'disabled' : ''}> On</label>
          <button class="pbtn" data-act="preview" ${sc.length && p.enabled ? '' : 'disabled'} title="Show this pack’s scenes on the stage, one after another">Preview</button>
          ${core ? '' : '<button class="pbtn danger" data-act="delete" title="Remove this pack">Delete</button>'}
        </div>
      </div>`;
    }
    function render() {
      const host = $('pkList'); if (!host) return;
      const core = { id: 'luciel-core', pack: Object.assign({ name: 'Luciel Core', version: '1.0.1', author: 'Luciel' }, global.LUCIEL_CORE_PACK || {}), enabled: true, scenes: global.Luciel.Scenes.core };
      host.innerHTML = card(core, true) + (installed.length ? installed.map((p) => card(p, false)).join('') : '<div class="pk-empty">No imported packs yet. Import a <b>.zip</b> or a folder that contains a <code>pack.json</code> — see PACKS.md for the format.</div>');
    }
    let previewT = 0;
    function preview(id) {
      const p = id === 'luciel-core' ? { scenes: global.Luciel.Scenes.core } : installed.find((x) => x.id === id); if (!p || !p.scenes.length) return;
      clearInterval(previewT); let i = 0;
      const step = () => { if (i >= p.scenes.length) { clearInterval(previewT); return; } app.setScene(p.scenes[i++].id); };
      app.closeOverlays(); step(); if (p.scenes.length > 1) previewT = setInterval(step, 2600);
    }
    function wire() {
      $('pkList').addEventListener('click', (e) => {
        clearInterval(previewT);
        const sc = e.target.closest('.pk-sc'); if (sc) { app.setScene(sc.dataset.scene); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const id = b.closest('[data-pack]').dataset.pack;
        if (b.dataset.act === 'preview') preview(id);
        if (b.dataset.act === 'delete') {
          if (b.dataset.armed) { remove(id); return; }
          b.dataset.armed = '1'; b.textContent = 'Really delete?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 3500);
        }
      });
      $('pkList').addEventListener('change', (e) => { const c = e.target.closest('[data-act="toggle"]'); if (c) setEnabled(c.closest('[data-pack]').dataset.pack, c.checked); });
      ['packImportZip', 'pkImportZip'].forEach((id) => { const b = $(id); if (b) b.onclick = () => $('packZipInput').click(); });
      ['packImportDir', 'pkImportDir'].forEach((id) => { const b = $(id); if (b) b.onclick = () => pickFolder(); });
      $('packManage').onclick = () => openManager();
      $('packZipInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importZip(f); });
      $('packDirInput').addEventListener('change', (e) => { const fl = [...e.target.files]; e.target.value = ''; if (fl.length) importFolder(fl); });
      const dz = $('pkDrop');
      dz.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); handleDrop(e.dataTransfer); });
    }
    function openManager() { if ($('packsOverlay').hidden) { app.closeOverlays(); app.openOverlay('packsOverlay'); } render(); }
    /** a dropped .zip / pack folder anywhere in the app: returns true when it was a pack */
    function handleDrop(dt) {
      const files = [...(dt && dt.files || [])];
      const zip = files.find((f) => /\.(zip|lucielpack)$/i.test(f.name));
      if (zip) { importZip(zip); return true; }
      const items = [...(dt && dt.items || [])];
      const entry = items.length === 1 && items[0].webkitGetAsEntry && items[0].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        // only claim the folder if it is a pack (has pack.json at its top); otherwise the caller adds it as music
        return new Promise((res) => entry.createReader().readEntries((list) => {
          if (!list.some((x) => x.isFile && x.name === 'pack.json')) return res(false);
          const out = [];
          const walk = async (en, path) => {
            if (en.isFile) await new Promise((r) => en.file((f) => { f.__path = path + f.name; out.push(f); r(); }, r));
            else if (en.isDirectory) { const rd = en.createReader(); let b; do { b = await new Promise((r) => rd.readEntries(r, () => r([]))); for (const c of b) await walk(c, path + en.name + '/'); } while (b.length); }
          };
          walk(entry, '').then(() => { importFolder(out); res(true); });
        }, () => res(false)));
      }
      return false;
    }
    wire();
    return { load, importZip, importFolder, remove, setEnabled, openManager, handleDrop, get installed() { return installed; }, urlFor, render };
  }
  global.LucielPackUI = { create };
})(window);
