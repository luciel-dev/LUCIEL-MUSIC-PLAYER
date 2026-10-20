/* Luciel tag editor: single or batch edit of title/artist/album/album artist/track/disc/year/genre/BPM,
 * cover art (file, drag-drop, paste, or a Lucielle scene art), file rename with a pattern, and saving.
 * In-file writes go through LucielTags (MP3/FLAC/M4A); other formats keep the edits as library overrides.
 * Disk output goes through LucielFS (File System Access handle / save dialog / download / desktop shell). */
(function (global) {
  'use strict';
  const FIELDS = [
    ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'],
    ['track', 'Track #', 'e.g. 3 or 3/12'], ['disc', 'Disc #', 'e.g. 1 or 1/2'], ['year', 'Year'], ['genre', 'Genre'], ['bpm', 'BPM'],
  ];
  const FMT_NAME = { mp3: 'MP3', flac: 'FLAC', mp4: 'M4A', ogg: 'OGG', wav: 'WAV', webm: 'WebM', unknown: 'other' };
  const sanitize = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180);
  function applyPattern(pattern, m, t) {
    const ext = (t.name.match(/\.[^.]+$/) || [''])[0];
    const pad = (v) => { const n = parseInt(v, 10); return n ? String(n).padStart(2, '0') : ''; };
    const map = { artist: m.artist, title: m.title, album: m.album, albumartist: m.albumArtist || m.artist, track: pad(m.track), disc: parseInt(m.disc, 10) || '', year: m.year, genre: m.genre, bpm: m.bpm ? Math.round(m.bpm) : '' };
    let out = pattern.replace(/\{(\w+)\}/g, (_, k) => sanitize(map[k.toLowerCase()] || ''));
    out = out.replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, '').replace(/(\s[-–]\s)+(?=\s*$)/, '').replace(/\s[-–]\s\s*[-–]\s/g, ' - ');
    return out ? sanitize(out) + ext : t.name;
  }
  async function normalizeImage(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const info = global.LucielTags.imageInfo(u8);
    if ((info.mime === 'image/jpeg' || info.mime === 'image/png') && info.w && info.w <= 1400 && info.h <= 1400 && /jpeg|png/.test(blob.type || info.mime)) return { mime: info.mime, data: u8 };
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
      const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
      return { mime: 'image/jpeg', data: new Uint8Array(await out.arrayBuffer()) };
    } finally { URL.revokeObjectURL(url); }
  }

  function create(api) {
    const $ = (id) => document.getElementById(id);
    const { esc, S } = api;
    const ov = $('editOverlay');
    let list = [], cover, dirty = new Set(), fmts = [], busy = false;
    S.renamePattern = S.renamePattern || '{artist} - {title}';

    function common(k) {
      const vals = list.map((t) => { const m = t.meta || {}; if (k === 'bpm') return m.bpm ? String(Math.round(m.bpm)) : ''; if (k === 'title') return m.title || api.title(t); if (k === 'artist') return m.artist || api.artist(t); return m[k] ? String(m[k]) : ''; });
      return vals.every((v) => v === vals[0]) ? { v: vals[0] } : { mixed: true };
    }
    async function open(tracks) {
      list = tracks.filter(Boolean); if (!list.length) return;
      cover = undefined; dirty = new Set();
      const single = list.length === 1, t0 = list[0];
      fmts = await Promise.all(list.map((t) => global.LucielTags.formatOf(t.file).catch(() => 'unknown')));
      const counts = {}; fmts.forEach((f) => { counts[f] = (counts[f] || 0) + 1; });
      const wr = Object.entries(counts).filter(([f]) => global.LucielTags.canWrite(f)), ro = Object.entries(counts).filter(([f]) => !global.LucielTags.canWrite(f));
      const note = [wr.length ? `<span class="ok">✔ ${wr.map(([f, n]) => `${n > 1 || !single ? n + ' × ' : ''}${FMT_NAME[f]}`).join(', ')}: tags and cover are written into the file bytes</span>` : '',
        ro.length ? `<span class="warn">⚠ ${ro.map(([f, n]) => `${n > 1 || !single ? n + ' × ' : ''}${FMT_NAME[f] || f}`).join(', ')}: in-file writing isn't supported for this format yet — edits are kept as library overrides</span>` : ''].filter(Boolean).join('');
      const mode = global.LucielFS.mode(t0);
      const pic = single && t0.meta && t0.meta.picture;
      ov.innerHTML = `<div class="win edit-win" role="dialog" aria-label="Edit tags">
        <header class="titlebar small"><span class="tb-logo"><svg><use href="#i-note"/></svg></span><span class="tb-title">${single ? 'Edit song' : `Batch edit · ${list.length} songs`}</span><span class="tb-classic-title">${single ? 'TAG EDITOR' : 'BATCH TAG EDITOR'}</span><span class="tb-spacer"></span><button class="tb-btn close" data-x="cancel" title="Close"><svg><use href="#i-close"/></svg></button></header>
        <div class="ed-body">
          <div class="ed-cover">
            <div class="ed-art" id="edArt" title="Drop or paste an image here">${pic || single ? `<img id="edImg" src="${api.cover(t0)}" alt="">` : '<span class="ed-mixed">Covers vary<br>(kept unless changed)</span><img id="edImg" alt="" hidden>'}<span class="ed-drop">Drop image</span></div>
            <div class="ed-cbtns">
              <button class="pbtn" data-x="cfile">From file…</button><button class="pbtn" data-x="cpaste">Paste</button>
              <button class="pbtn" data-x="cscene">Scene art…</button><button class="pbtn" data-x="cremove">Remove</button>
            </div>
            <div class="ed-cstate" id="edCState">${single ? (pic ? `Embedded cover · ${esc(pic.mime)}` : 'No embedded cover (showing scene art)') : ''}</div>
            <div class="ed-scenes" id="edScenes" hidden>${global.Luciel.Scenes.list.filter((s) => s.kind !== 'pixel').map((s) => `<button data-scene-art="${esc(s.image)}" title="${esc(s.name)}"><img src="${esc(s.thumb)}" alt=""></button>`).join('')}</div>
          </div>
          <div class="ed-fields">
            ${FIELDS.map(([k, label, ph]) => { const c = common(k); return `<label class="ed-f ed-${k}"><span>${label}</span><input data-k="${k}" value="${c.mixed ? '' : esc(c.v)}" placeholder="${c.mixed ? '(multiple values — leave to keep)' : (ph || '')}" ${k === 'bpm' ? 'inputmode="decimal"' : ''} autocomplete="off" spellcheck="false"></label>`; }).join('')}
            <div class="ed-file">
              ${single ? `<label class="ed-f ed-name"><span>File name</span><input id="edName" value="${esc(t0.name)}" spellcheck="false"></label>` : ''}
              <label class="ed-f ed-pat"><span>Rename pattern</span><input id="edPattern" value="${esc(S.renamePattern)}" spellcheck="false" title="Tokens: {artist} {title} {album} {albumartist} {track} {disc} {year} {genre} {bpm}"></label>
              <div class="ed-row">${single ? '<button class="pbtn" data-x="pattern">Apply pattern</button>' : ''}<label class="chk"><input type="checkbox" id="edAuto" ${S.autoRename ? 'checked' : ''}> Auto-rename from tags on save</label></div>
            </div>
          </div>
        </div>
        <div class="ed-note">${note}</div>
        <footer class="ed-foot">
          <label class="chk" title="${esc(global.LucielFS.describe(t0))}"><input type="checkbox" id="edDisk" ${mode === 'handle' || mode === 'native' ? 'checked' : ''}> Also save to disk: ${esc(single ? global.LucielFS.describe(t0) : { handle: 'overwrite the original files', native: 'write the files', picker: 'save copies with a Save dialog', download: 'download the edited files' }[mode])}</label>
          <span class="ed-status" id="edStatus"></span><span class="tb-spacer"></span>
          <button class="pbtn" data-x="cancel">Cancel</button><button class="pbtn primary" data-x="save">Save</button>
        </footer>
        <input type="file" id="edCoverFile" accept="image/*" hidden>
      </div>`;
      ov.hidden = false; requestAnimationFrame(() => ov.classList.add('open'));
      setTimeout(() => { const i = ov.querySelector('input[data-k="title"]'); if (i) i.focus(); }, 40);
    }
    function close() { ov.classList.remove('open'); ov.hidden = true; ov.innerHTML = ''; list = []; }
    async function setCover(blob, label) {
      try {
        cover = await normalizeImage(blob);
        const img = $('edImg'); img.hidden = false; img.src = URL.createObjectURL(new Blob([cover.data], { type: cover.mime }));
        const mx = ov.querySelector('.ed-mixed'); if (mx) mx.remove();
        $('edCState').textContent = `New cover: ${label} · ${cover.mime} · ${Math.round(cover.data.length / 1024)} KB`;
      } catch (e) { api.toast('Could not use that image: ' + e.message, 'warn'); }
    }
    ov.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.k; if (k) { dirty.add(k); e.target.classList.add('dirty'); } });
    ov.addEventListener('click', async (e) => {
      if (e.target === ov) return;
      const sa = e.target.closest('[data-scene-art]');
      if (sa) {
        try { const r = await fetch(sa.dataset.sceneArt); await setCover(await r.blob(), 'scene art'); }
        catch (err) {
          // file:// pages can't fetch local files; fall back to drawing the already-loaded thumbnail-sized art via an <img>
          try { const img = sa.querySelector('img'); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); await setCover(await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9)), 'scene art'); }
          catch (e2) { api.toast('Scene art covers need the app served over http (python3 -m http.server)', 'warn'); }
        }
        $('edScenes').hidden = true; return;
      }
      const b = e.target.closest('[data-x]'); if (!b) return;
      switch (b.dataset.x) {
        case 'cancel': close(); break;
        case 'cfile': $('edCoverFile').click(); break;
        case 'cscene': $('edScenes').hidden = !$('edScenes').hidden; break;
        case 'cremove': cover = null; { const img = $('edImg'); img.hidden = false; img.src = api.cover(null); } $('edCState').textContent = 'Cover will be removed'; break;
        case 'cpaste':
          try {
            const items = await navigator.clipboard.read();
            for (const it of items) { const ty = it.types.find((x) => x.startsWith('image/')); if (ty) { await setCover(await it.getType(ty), 'pasted'); return; } }
            api.toast('No image on the clipboard', 'warn');
          } catch (err) { api.toast('Press Ctrl+V / ⌘V to paste an image', 'warn'); }
          break;
        case 'pattern': { const m = merged(list[0]); $('edName').value = applyPattern($('edPattern').value, m, list[0]); break; }
        case 'save': save(); break;
      }
    });
    ov.addEventListener('change', (e) => { if (e.target.id === 'edCoverFile' && e.target.files[0]) setCover(e.target.files[0], e.target.files[0].name); });
    ov.addEventListener('dragover', (e) => { if (e.target.closest('#edArt')) { e.preventDefault(); e.stopPropagation(); $('edArt').classList.add('over'); } });
    ov.addEventListener('dragleave', (e) => { if (e.target.closest('#edArt')) $('edArt').classList.remove('over'); });
    ov.addEventListener('drop', (e) => { const a = e.target.closest('#edArt'); e.preventDefault(); e.stopPropagation(); if (!a) return; a.classList.remove('over'); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) setCover(f, f.name); });
    document.addEventListener('paste', (e) => {
      if (ov.hidden) return;
      const it = [...(e.clipboardData && e.clipboardData.items || [])].find((x) => x.type.startsWith('image/'));
      if (it) { e.preventDefault(); setCover(it.getAsFile(), 'pasted'); }
    });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } e.stopPropagation(); });

    function values() { const v = {}; ov.querySelectorAll('input[data-k]').forEach((i) => { if (dirty.has(i.dataset.k)) v[i.dataset.k] = i.value.trim(); }); return v; }
    function merged(t) { const m = Object.assign({}, t.meta || {}); if (!m.title) m.title = api.title(t); if (!m.artist) m.artist = api.artist(t); const v = values(); for (const k in v) m[k] = k === 'bpm' ? (parseFloat(v[k]) || 0) : v[k]; return m; }
    function validate(v) {
      if (v.year && !/^\d{4}(-\d\d(-\d\d)?)?$/.test(v.year)) return 'Year should look like 2024';
      if (v.track && !/^\d+(\/\d+)?$/.test(v.track)) return 'Track # should look like 3 or 3/12';
      if (v.disc && !/^\d+(\/\d+)?$/.test(v.disc)) return 'Disc # should look like 1 or 1/2';
      if (v.bpm && !(parseFloat(v.bpm) > 0 && parseFloat(v.bpm) < 400)) return 'BPM should be a number between 1 and 400';
      return '';
    }
    async function save() {
      if (busy) return;
      const v = values(), err = validate(v);
      if (err) { $('edStatus').textContent = err; $('edStatus').className = 'ed-status bad'; return; }
      const pattern = $('edPattern').value.trim() || '{artist} - {title}';
      const auto = $('edAuto').checked, disk = $('edDisk').checked;
      S.renamePattern = pattern; S.autoRename = auto; api.save();
      busy = true; $('edStatus').textContent = 'Saving…'; $('edStatus').className = 'ed-status';
      const res = { written: 0, overrides: 0, renamed: 0, disk: 0, failed: [] };
      for (let i = 0; i < list.length; i++) {
        const t = list[i], fmt = fmts[i];
        try {
          const m = merged(t);
          let name = t.name;
          if (list.length === 1 && $('edName')) name = sanitize($('edName').value.trim()) || t.name;
          if (auto) name = applyPattern(pattern, m, t);
          if (!/\.[a-z0-9]+$/i.test(name)) name += (t.name.match(/\.[^.]+$/) || [''])[0];
          const changed = Object.keys(v).length > 0 || cover !== undefined;
          let blob = t.file, written = false;
          if (changed && global.LucielTags.canWrite(fmt)) {
            const fields = Object.assign({}, v);
            if (fields.bpm) fields.bpm = String(Math.round(parseFloat(fields.bpm)));
            blob = (await global.LucielTags.write(t.file, fields, cover)).blob; written = true;
          }
          const before = t.name;
          await api.commit(t, { blob, name, fields: v, cover, written });
          if (written) res.written++; else if (changed) res.overrides++;
          if (disk && (written || name !== before || changed)) {
            const r = await global.LucielFS.save(t, blob, name);
            if (!r.cancelled) { res.disk++; if (api.persist) api.persist(t); }   // keep the new disk path / handle
          }
        } catch (e) { console.warn('[editor]', t.name, e); res.failed.push(t.name + ': ' + e.message); }
      }
      busy = false;
      const parts = [];
      if (res.written) parts.push(`${res.written} file${res.written > 1 ? 's' : ''} rewritten with new tags`);
      if (res.overrides) parts.push(`${res.overrides} saved as library overrides`);
      if (res.disk) parts.push(`${res.disk} saved to disk`);
      if (res.failed.length) { $('edStatus').textContent = 'Failed: ' + res.failed.join('; '); $('edStatus').className = 'ed-status bad'; api.toast('Some songs could not be saved', 'warn'); return; }
      api.toast(parts.join(' · ') || 'Nothing changed');
      close();
    }
    return { open, close, isOpen: () => !ov.hidden, applyPattern: (p, m, t) => applyPattern(p, m, t) };
  }
  global.LucielEditor = { create, applyPattern, sanitize };
})(window);
