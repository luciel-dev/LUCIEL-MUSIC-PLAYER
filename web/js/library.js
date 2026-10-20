/* Luciel media library: Songs / Artists / Albums / Genres / Playlists (+ smart playlists), search, M3U import/export.
 * The app passes an `api` object (see app.js) — this module owns the library UI and the saved playlists. */
(function (global) {
  'use strict';
  const FEAT = /\s+(?:feat\.?|ft\.?|featuring|with)\s+/i;
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
  const num = (v) => { const m = /^\s*(\d+)/.exec(String(v || '')); return m ? +m[1] : 0; };
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ------------------------------------------------------------ grouping (pure)
  function splitArtist(artist, title) {
    let a = String(artist || '').trim();
    const feats = [];
    const parts = a.split(FEAT);
    if (parts.length > 1) { a = parts[0].trim(); parts.slice(1).join(', ').split(/\s*(?:,|&|\band\b)\s*/i).forEach((x) => x.trim() && feats.push(x.trim())); }
    const primary = a.split(/\s*(?:;|\s\/\s)\s*/)[0].trim();
    const tm = /[([](?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/i.exec(title || '');
    if (tm) tm[1].split(/\s*(?:,|&|\band\b)\s*/i).forEach((x) => x.trim() && feats.push(x.trim()));
    return { primary, feats };
  }
  /** Build artist/album/genre groupings. h = { title(t), artist(t) } */
  function group(tracks, h) {
    const info = new Map();
    // 1) detect compilations: same album name in the same folder with no album artist and >=3 different primary artists (or the compilation flag)
    const byAlbumDir = new Map();
    for (const t of tracks) {
      const m = t.meta || {};
      const sa = splitArtist(h.artist(t), h.title(t));
      info.set(t, { primary: sa.primary || 'Unknown Artist', feats: sa.feats });
      if (!m.album) continue;
      const dir = (t.path || '').split('/').slice(0, -1).join('/');
      const k = norm(m.album) + '\u001f' + dir;
      if (!byAlbumDir.has(k)) byAlbumDir.set(k, []);
      byAlbumDir.get(k).push(t);
    }
    const comp = new Set();
    for (const list of byAlbumDir.values()) {
      const noAA = list.filter((t) => !(t.meta || {}).albumArtist);
      const prim = new Set(noAA.map((t) => norm(info.get(t).primary)));
      if (list.some((t) => (t.meta || {}).compilation)) list.forEach((t) => { if (!(t.meta || {}).albumArtist) comp.add(t); });
      else if (prim.size >= 3) noAA.forEach((t) => comp.add(t));   // songs that do carry an album artist keep it
    }
    const albums = new Map(), artists = new Map(), genres = new Map();
    const artistEntry = (name) => {
      const k = norm(name) || 'unknown artist';
      if (!artists.has(k)) artists.set(k, { key: k, name, tracks: new Set(), albums: new Set(), appears: new Set() });
      return artists.get(k);
    };
    for (const t of tracks) {
      const m = t.meta || {}, inf = info.get(t);
      const albumArtist = m.albumArtist ? splitArtist(m.albumArtist).primary : comp.has(t) ? 'Various Artists' : inf.primary;
      inf.albumArtist = albumArtist;
      const albumName = m.album || '';
      if (albumName) {
        const k = norm(albumArtist) + '\u001f' + norm(albumName);
        if (!albums.has(k)) albums.set(k, { key: k, name: albumName, artist: albumArtist, tracks: [], year: '', genre: '', compilation: comp.has(t) || albumArtist === 'Various Artists' });
        const al = albums.get(k); al.tracks.push(t); if (!al.year && m.year) al.year = m.year; if (!al.genre && m.genre) al.genre = m.genre;
        inf.albumKey = k;
      }
      const own = artistEntry(albumArtist === 'Various Artists' ? inf.primary : albumArtist);
      own.tracks.add(t); if (inf.albumKey && albumArtist !== 'Various Artists') own.albums.add(inf.albumKey);
      if (norm(inf.primary) !== norm(own.name)) { const p = artistEntry(inf.primary); p.tracks.add(t); if (inf.albumKey) p.appears.add(inf.albumKey); }
      for (const f of inf.feats) { const a = artistEntry(f); a.tracks.add(t); if (inf.albumKey) a.appears.add(inf.albumKey); }
      if (albumArtist === 'Various Artists' && inf.albumKey) { const va = artistEntry('Various Artists'); va.albums.add(inf.albumKey); va.tracks.add(t); }
      const g = (m.genre || '').trim() || 'Unknown';
      if (!genres.has(norm(g))) genres.set(norm(g), { key: norm(g), name: g, tracks: [] });
      genres.get(norm(g)).tracks.push(t);
    }
    for (const al of albums.values()) al.tracks.sort(albumOrder);
    return { info, albums, artists, genres };
  }
  function albumOrder(a, b) {
    const ma = a.meta || {}, mb = b.meta || {};
    return (num(ma.disc) || 1) - (num(mb.disc) || 1) || (num(ma.track) || 999) - (num(mb.track) || 999) || String(ma.title || a.name).localeCompare(String(mb.title || b.name));
  }

  // ------------------------------------------------------------ M3U
  function toM3U(list, h) {
    const lines = ['#EXTM3U'];
    for (const t of list) {
      lines.push(`#EXTINF:${isFinite(t.duration) ? Math.round(t.duration) : -1},${[h.artist(t), h.title(t)].filter(Boolean).join(' - ')}`);
      lines.push(t.path || t.name);
    }
    return lines.join('\r\n') + '\r\n';
  }
  function parseM3U(text) {
    const out = []; let inf = null;
    for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const l = raw.trim(); if (!l) continue;
      if (l.startsWith('#EXTINF:')) { const c = l.indexOf(','); inf = { duration: parseFloat(l.slice(8)), label: c >= 0 ? l.slice(c + 1).trim() : '' }; continue; }
      if (l.startsWith('#')) continue;
      out.push({ path: l, label: inf ? inf.label : '', duration: inf ? inf.duration : NaN }); inf = null;
    }
    return out;
  }
  function matchM3U(entries, tracks, h) {
    const base = (p) => decodeURIComponent(String(p).replace(/\\/g, '/').split('/').pop()).toLowerCase();
    const byPath = new Map(), byBase = new Map(), byLabel = new Map();
    for (const t of tracks) {
      byPath.set(String(t.path || '').toLowerCase(), t);
      byBase.set(t.name.toLowerCase(), t);
      byLabel.set(norm([h.artist(t), h.title(t)].filter(Boolean).join(' - ')), t);
    }
    const found = [], missing = [];
    for (const e of entries) {
      const p = e.path.replace(/\\/g, '/').replace(/^file:\/\/\/?/, '');
      const t = byPath.get(p.toLowerCase()) || byBase.get(base(p)) || (e.label && byLabel.get(norm(e.label)));
      if (t) found.push(t); else missing.push(e);
    }
    return { found, missing };
  }

  // ------------------------------------------------------------ UI
  function create(api) {
    const $ = (id) => document.getElementById(id);
    const { esc, fmt, S } = api;
    const win = $('winLib'), nav = $('libNav'), main = $('libMain'), search = $('libSearch');
    let playlists = [];
    let view = { type: 'songs' }; const back = [];
    let G = null, dirty = true;
    const sel = new Set(); let anchor = null; let shown = [];
    S.libSort = S.libSort || { key: 'artist', dir: 1 };
    S.smartBpm = S.smartBpm || { min: 110, max: 130 };

    const SMART = [
      { id: 'smart:recent', name: 'Recently added', icon: '✚', list: () => api.all().slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 100) },
      { id: 'smart:most', name: 'Most played', icon: '▲', list: () => api.all().filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 100) },
      { id: 'smart:played', name: 'Recently played', icon: '◷', list: () => api.all().filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 100) },
      { id: 'smart:fav', name: 'Favorites', icon: '♥', list: () => api.all().filter((t) => api.isFav(t)) },
      { id: 'smart:bpm', name: 'By BPM range', icon: '♩', list: () => api.all().filter((t) => { const b = api.bpm(t); return b && b >= S.smartBpm.min && b <= S.smartBpm.max; }).sort((a, b) => api.bpm(a) - api.bpm(b)) },
    ];
    const groups = () => { if (dirty || !G) { G = group(api.all(), api); dirty = false; } return G; };

    // ---------- playlists
    async function loadPlaylists() {
      try { playlists = (await global.AeroStore.Playlists.all()) || []; } catch (e) { playlists = []; }
      playlists.sort((a, b) => a.created - b.created);
      renderNav();
    }
    const persistPl = (p) => { p.updated = Date.now(); global.AeroStore.Playlists.put(p).catch((e) => console.warn('[library] playlist save', e)); };
    function createPlaylist(name, ids = []) {
      const p = { id: uid(), name: name || 'New playlist', ids: ids.slice(), created: Date.now(), updated: Date.now() };
      playlists.push(p); persistPl(p); renderNav(); return p;
    }
    function addToPlaylist(pid, list) {
      const p = playlists.find((x) => x.id === pid); if (!p) return;
      p.ids.push(...list.map((t) => t.id)); persistPl(p); api.toast(`Added ${list.length} song${list.length > 1 ? 's' : ''} to “${p.name}”`);
      renderNav(); if (view.type === 'playlist' && view.key === pid) render();
    }
    function playlistTracks(p) { const byId = api.byId; return p.ids.map((id) => byId(id)).filter(Boolean); }
    function deletePlaylist(p) { playlists = playlists.filter((x) => x !== p); global.AeroStore.Playlists.remove(p.id).catch(() => {}); go({ type: 'songs' }, true); }
    function forgetTracks(ids) { for (const p of playlists) { const n = p.ids.length; p.ids = p.ids.filter((id) => !ids.has(id)); if (p.ids.length !== n) persistPl(p); } }

    // ---------- small modal prompt (no window.prompt: keeps headless runs and the skins consistent)
    function ask(title, value = '', { confirm = false, okText = 'OK' } = {}) {
      return new Promise((res) => {
        const o = $('askOverlay');
        o.querySelector('.ask-title').textContent = title;
        const inp = o.querySelector('input'); inp.hidden = confirm; inp.value = value;
        o.querySelector('.ask-ok').textContent = okText;
        o.hidden = false; requestAnimationFrame(() => o.classList.add('open'));
        if (!confirm) setTimeout(() => { inp.focus(); inp.select(); }, 30);
        const done = (v) => { o.classList.remove('open'); o.hidden = true; o.onclick = null; inp.onkeydown = null; res(v); };
        o.onclick = (e) => { if (e.target.closest('.ask-ok')) done(confirm ? true : inp.value.trim() || null); else if (e.target.closest('.ask-cancel') || e.target === o) done(null); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      });
    }

    // ---------- navigation
    function go(v, replace) { if (!replace) back.push(view); view = v; sel.clear(); render(); main.scrollTop = 0; }
    function navItem(id, label, icon, count, extra = '') {
      const active = (view.type === 'smart' || view.type === 'playlist' || view.type === 'queue') ? view.key === id : view.type === id || view.type + 's' === id;
      return `<button class="ln-item${active ? ' active' : ''}" data-nav="${esc(id)}" ${extra}><i>${icon}</i><span>${esc(label)}</span>${count != null ? `<em>${count}</em>` : ''}</button>`;
    }
    function renderNav() {
      if (!win || win.hidden) return;
      const g = groups();
      nav.innerHTML = `<div class="ln-head">Library</div>
        ${navItem('songs', 'Songs', '♪', api.all().length)}${navItem('artists', 'Artists', '☺', g.artists.size)}${navItem('albums', 'Albums', '◉', g.albums.size)}${navItem('genres', 'Genres', '♯', g.genres.size)}
        <div class="ln-head">Playlists <button class="ln-add" data-act="new-pl" title="New playlist">+</button></div>
        ${navItem('queue', 'Now playing (queue)', '▶', api.queue().length, 'data-drop="queue"')}
        ${SMART.map((s) => navItem(s.id, s.name, s.icon, null)).join('')}
        ${playlists.map((p) => navItem(p.id, p.name, '≡', p.ids.length, `data-drop="${p.id}"`)).join('')}
        <button class="ln-item ln-import" data-act="import"><i>⇪</i><span>Import M3U…</span></button>`;
    }

    // ---------- tables
    const COLS = [
      { k: 'title', label: 'Title' }, { k: 'artist', label: 'Artist' }, { k: 'album', label: 'Album' }, { k: 'year', label: 'Year' },
      { k: 'genre', label: 'Genre' }, { k: 'bpm', label: 'BPM' }, { k: 'duration', label: 'Time' }, { k: 'format', label: 'Format' }, { k: 'plays', label: 'Plays' },
    ];
    function sortKey(t, k) {
      const m = t.meta || {};
      switch (k) {
        case 'title': return api.title(t).toLowerCase();
        case 'artist': return norm(api.artist(t)) + '\u001f' + norm(m.album) + '\u001f' + String(num(m.disc) || 1).padStart(2, '0') + String(num(m.track) || 0).padStart(4, '0');
        case 'album': return norm(m.album || '~') + '\u001f' + String(num(m.disc) || 1).padStart(2, '0') + String(num(m.track) || 0).padStart(4, '0');
        case 'year': return m.year || '';
        case 'genre': return norm(m.genre);
        case 'bpm': return api.bpm(t) || 0;
        case 'duration': return isFinite(t.duration) ? t.duration : 0;
        case 'format': return (t.ext || '').toLowerCase();
        case 'plays': return t.plays || 0;
      }
      return '';
    }
    function sorted(list) {
      const { key, dir } = S.libSort;
      return list.slice().sort((a, b) => { const x = sortKey(a, key), y = sortKey(b, key); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; });
    }
    function table(list, opt = {}) {
      shown = list;
      if (!list.length) return `<div class="lib-empty">${opt.empty || 'No songs here yet.'}</div>`;
      const head = `<div class="lt-row lt-head${opt.sortable ? ' sortable' : ''}"><span class="c-n">#</span>${COLS.map((c) => `<span class="c-${c.k}" data-sort="${c.k}">${c.label}${opt.sortable && S.libSort.key === c.k ? (S.libSort.dir > 0 ? ' ▴' : ' ▾') : ''}</span>`).join('')}<span class="c-ed"></span></div>`;
      let lastDisc = null; const multiDisc = opt.discs && new Set(list.map((t) => num((t.meta || {}).disc) || 1)).size > 1;
      const rows = list.map((t, i) => {
        const m = t.meta || {};
        let pre = '';
        if (multiDisc) { const d = num(m.disc) || 1; if (d !== lastDisc) { lastDisc = d; pre = `<div class="lt-disc">Disc ${d}</div>`; } }
        const n = opt.trackNo ? (num(m.track) || '') : i + 1;
        const cls = ['lt-row']; if (sel.has(t.id)) cls.push('selected'); if (api.current() === t) cls.push('playing'); if (!t.supported) cls.push('unsupported');
        return pre + `<div class="${cls.join(' ')}" data-id="${t.id}" data-i="${i}" draggable="true">
          <span class="c-n">${n}</span><span class="c-title">${api.isFav(t) ? '<b class="fv">♥</b>' : ''}${esc(api.title(t))}${t.metaSource === 'library' ? '<i class="ovr" title="Edited in the library only (not written into the file)">✎</i>' : ''}</span>
          <span class="c-artist" data-go-artist="${esc(api.artist(t))}">${esc(api.artist(t))}</span><span class="c-album"${m.album ? ` data-go-album="${esc(groups().info.get(t) && groups().info.get(t).albumKey || '')}"` : ''}>${esc(m.album || '')}</span>
          <span class="c-year">${esc(m.year || '')}</span><span class="c-genre">${esc(m.genre || '')}</span><span class="c-bpm">${api.bpm(t) ? Math.round(api.bpm(t)) : ''}</span>
          <span class="c-duration">${isFinite(t.duration) ? fmt(t.duration) : ''}</span><span class="c-format">${t.supported ? esc((t.ext || '').toUpperCase()) : 'N/A'}</span><span class="c-plays">${t.plays || ''}</span>
          <button class="c-ed" data-edit="${t.id}" title="Edit tags (F2)">✎</button></div>`;
      }).join('');
      return `<div class="lt${opt.reorder ? ' reorder' : ''}" data-ctx="${opt.ctx || 'library'}">${head}${rows}</div>`;
    }
    const coverOf = (al) => { const t = al.tracks.find((x) => x.coverUrl) || al.tracks[0]; return api.cover(t, true); };
    function albumGrid(list) {
      if (!list.length) return '<div class="lib-empty">No albums.</div>';
      return `<div class="al-grid">${list.map((al) => `<button class="al-card" data-album="${esc(al.key)}" title="${esc(al.name)} — ${esc(al.artist)}"><span class="al-cover"><img src="${coverOf(al)}" alt="" loading="lazy">${al.tracks.some((t) => t.coverUrl) ? '' : '<i class="al-fb">scene art</i>'}</span><b>${esc(al.name)}</b><span>${esc(al.artist)}${al.year ? ' · ' + esc(al.year) : ''}</span></button>`).join('')}</div>`;
    }
    const dur = (list) => fmt(list.reduce((a, t) => a + (isFinite(t.duration) ? t.duration : 0), 0));
    const header = (title, sub, actions, img) => `<div class="lib-hdr">${img ? `<img class="lh-img" src="${img}" alt="">` : ''}<div class="lh-text">${back.length ? '<button class="lh-back" data-act="back" title="Back">‹</button>' : ''}<h2>${esc(title)}</h2><p>${sub}</p><div class="lh-acts">${actions}</div></div></div>`;
    const actsFor = (extra = '') => `<button class="pbtn" data-act="play">▶ Play</button><button class="pbtn" data-act="shuffle">⤮ Shuffle</button><button class="pbtn" data-act="enqueue">+ Queue</button><button class="pbtn" data-act="edit-all" title="Batch edit all songs here">✎ Edit</button>${extra}`;

    function render() {
      if (!win || win.hidden) return;
      renderNav();
      const g = groups(), q = search.value.trim().toLowerCase();
      if (q) return renderSearch(q, g);
      let html = '';
      switch (view.type) {
        case 'songs': { const list = sorted(api.all()); html = header('Songs', `${list.length} songs · ${dur(list)}`, actsFor()) + table(list, { sortable: true, empty: 'Your library is empty. Add files or a folder, or drop music anywhere.' }); break; }
        case 'artists': {
          const list = [...g.artists.values()].sort((a, b) => (a.name === 'Various Artists') - (b.name === 'Various Artists') || norm(a.name).localeCompare(norm(b.name)));
          html = header('Artists', `${list.length} artists`, '') + `<div class="ar-list">${list.map((a) => { const al = [...a.albums].map((k) => g.albums.get(k)).find(Boolean); const any = [...a.tracks][0]; return `<button class="ar-row" data-artist="${esc(a.key)}"><img src="${al ? coverOf(al) : api.cover(any, true)}" alt="" loading="lazy"><b>${esc(a.name)}</b><span>${a.tracks.size} song${a.tracks.size === 1 ? '' : 's'} · ${a.albums.size} album${a.albums.size === 1 ? '' : 's'}${a.appears.size ? ` · appears on ${a.appears.size}` : ''}</span></button>`; }).join('')}</div>`;
          break;
        }
        case 'artist': {
          const a = g.artists.get(view.key); if (!a) { go({ type: 'artists' }, true); return; }
          const own = [...a.albums].map((k) => g.albums.get(k)).filter(Boolean).sort((x, y) => String(x.year).localeCompare(String(y.year)));
          const app = [...a.appears].filter((k) => !a.albums.has(k)).map((k) => g.albums.get(k)).filter(Boolean);
          const list = [...a.tracks].sort((x, y) => sortKey(x, 'artist').localeCompare(sortKey(y, 'artist')));
          html = header(a.name, `${list.length} songs · ${own.length} albums${app.length ? ` · appears on ${app.length}` : ''} · ${dur(list)}`, actsFor(), own[0] ? coverOf(own[0]) : api.cover(list[0], true))
            + (own.length ? `<h3 class="lib-sec">Albums</h3>${albumGrid(own)}` : '') + (app.length ? `<h3 class="lib-sec">Appears on</h3>${albumGrid(app)}` : '')
            + `<h3 class="lib-sec">Songs</h3>` + table(list, { ctx: 'library' });
          view.list = list; break;
        }
        case 'albums': { const list = [...g.albums.values()].sort((a, b) => norm(a.artist).localeCompare(norm(b.artist)) || String(a.year).localeCompare(String(b.year)) || norm(a.name).localeCompare(norm(b.name))); html = header('Albums', `${list.length} albums`, '') + albumGrid(list); break; }
        case 'album': {
          const al = g.albums.get(view.key); if (!al) { go({ type: 'albums' }, true); return; }
          const discs = new Set(al.tracks.map((t) => num((t.meta || {}).disc) || 1)).size;
          html = header(al.name, `<a data-go-artist="${esc(al.artist)}">${esc(al.artist)}</a>${al.year ? ' · ' + esc(al.year) : ''}${al.genre ? ' · ' + esc(al.genre) : ''} · ${al.tracks.length} songs${discs > 1 ? ` · ${discs} discs` : ''} · ${dur(al.tracks)}${al.compilation ? ' · compilation' : ''}`, actsFor(), coverOf(al))
            + table(al.tracks, { discs: true, trackNo: true, ctx: 'album' });
          view.list = al.tracks; break;
        }
        case 'genres': { const list = [...g.genres.values()].sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name)); html = header('Genres', `${list.length} genres`, '') + `<div class="ge-grid">${list.map((x) => `<button class="ge-card" data-genre="${esc(x.key)}"><img src="${api.genreArt(x.name)}" alt="" loading="lazy"><b>${esc(x.name)}</b><span>${x.tracks.length} song${x.tracks.length === 1 ? '' : 's'}</span></button>`).join('')}</div>`; break; }
        case 'genre': { const x = g.genres.get(view.key); if (!x) { go({ type: 'genres' }, true); return; } const list = sorted(x.tracks); html = header(x.name, `${list.length} songs · ${dur(list)}`, actsFor(), api.genreArt(x.name)) + table(list, { sortable: true }); view.list = list; break; }
        case 'queue': { const list = api.queue(); html = header('Now playing', `The current queue (separate from saved playlists) · ${list.length} songs · ${dur(list)}`, actsFor('<button class="pbtn" data-act="save-queue">Save as playlist</button><button class="pbtn" data-act="export">Export M3U8</button><button class="pbtn" data-act="clear-queue">Clear queue</button>')) + table(list, { ctx: 'queue', reorder: true, empty: 'The queue is empty.' }); view.list = list; break; }
        case 'smart': {
          const s = SMART.find((x) => x.id === view.key); const list = s.list();
          const bpm = s.id === 'smart:bpm' ? `<span class="bpm-range">BPM <input type="number" id="bpmMin" min="30" max="300" value="${S.smartBpm.min}"> – <input type="number" id="bpmMax" min="30" max="300" value="${S.smartBpm.max}"></span>` : '';
          html = header(s.name, `Smart playlist · ${list.length} songs · ${dur(list)}`, actsFor('<button class="pbtn" data-act="snapshot">Save as playlist</button><button class="pbtn" data-act="export">Export M3U8</button>') + bpm) + table(list, { ctx: 'smart', empty: s.id === 'smart:fav' ? 'No favorites yet — press ♥ or F while a song plays.' : 'Nothing here yet.' });
          view.list = list; break;
        }
        case 'playlist': {
          const p = playlists.find((x) => x.id === view.key); if (!p) { go({ type: 'songs' }, true); return; }
          const list = playlistTracks(p);
          html = header(p.name, `Playlist · ${list.length} songs · ${dur(list)}`, actsFor('<button class="pbtn" data-act="rename">Rename</button><button class="pbtn" data-act="duplicate">Duplicate</button><button class="pbtn" data-act="export">Export M3U8</button><button class="pbtn danger" data-act="delete-pl">Delete</button>'))
            + table(list, { ctx: 'playlist', reorder: true, empty: 'Empty playlist — right-click songs and choose “Add to playlist”, or drag them onto it in the sidebar.' });
          view.list = list; break;
        }
      }
      main.innerHTML = html;
      $('libStatus').textContent = `${api.all().length} songs in library`;
    }
    function renderSearch(q, g) {
      const has = (s) => String(s || '').toLowerCase().includes(q);
      const songs = sorted(api.all().filter((t) => { const m = t.meta || {}; return [api.title(t), api.artist(t), m.album, m.albumArtist, m.genre, m.year, t.name].some(has); }));
      const artists = [...g.artists.values()].filter((a) => has(a.name)).slice(0, 24);
      const albums = [...g.albums.values()].filter((a) => has(a.name) || has(a.artist)).slice(0, 24);
      const pls = playlists.filter((p) => has(p.name));
      const genres = [...g.genres.values()].filter((x) => has(x.name));
      view.list = songs;
      main.innerHTML = header(`Search: “${search.value.trim()}”`, `${songs.length} songs · ${artists.length} artists · ${albums.length} albums · ${pls.length} playlists`, songs.length ? actsFor() : '')
        + (artists.length ? `<h3 class="lib-sec">Artists</h3><div class="chips">${artists.map((a) => `<button class="chip" data-artist="${esc(a.key)}">${esc(a.name)} <em>${a.tracks.size}</em></button>`).join('')}</div>` : '')
        + (genres.length ? `<h3 class="lib-sec">Genres</h3><div class="chips">${genres.map((x) => `<button class="chip" data-genre="${esc(x.key)}">${esc(x.name)} <em>${x.tracks.length}</em></button>`).join('')}</div>` : '')
        + (pls.length ? `<h3 class="lib-sec">Playlists</h3><div class="chips">${pls.map((p) => `<button class="chip" data-nav="${p.id}">≡ ${esc(p.name)} <em>${p.ids.length}</em></button>`).join('')}</div>` : '')
        + (albums.length ? `<h3 class="lib-sec">Albums</h3>${albumGrid(albums)}` : '')
        + `<h3 class="lib-sec">Songs</h3>` + table(songs, { sortable: true, empty: 'No songs match.' });
    }

    // ---------- selection helpers
    const selected = () => { const s = shown.filter((t) => sel.has(t.id)); return s.length ? s : []; };
    function markSel() { main.querySelectorAll('.lt-row[data-id]').forEach((r) => r.classList.toggle('selected', sel.has(r.dataset.id))); }
    function currentList() { return view.list || shown; }

    // ---------- context menu
    function ctxMenu(x, y, list, ctx) {
      const m = $('ctxMenu');
      const one = list.length === 1 ? list[0] : null;
      const inf = one && groups().info.get(one);
      const allFav = list.every((t) => api.isFav(t));
      m.innerHTML = `<div class="ctx-head">${list.length === 1 ? esc(api.title(one)) : list.length + ' songs'}</div>
        <button data-c="play">▶ Play now</button><button data-c="next">⤷ Play next</button><button data-c="queue">+ Add to queue</button>
        <div class="ctx-sep"></div><div class="ctx-sub">Add to playlist</div>
        ${playlists.map((p) => `<button data-c="pl" data-pl="${p.id}">≡ ${esc(p.name)}</button>`).join('')}<button data-c="newpl">✚ New playlist…</button>
        <div class="ctx-sep"></div><button data-c="edit">✎ Edit tags${list.length > 1 ? ' (batch)' : ''}…  <kbd>F2</kbd></button>
        <button data-c="fav">${allFav ? '♡ Remove from favorites' : '♥ Add to favorites'}</button>
        ${one && inf ? `<button data-c="artist">☺ Go to artist</button>${inf.albumKey ? '<button data-c="album">◉ Go to album</button>' : ''}` : ''}
        ${ctx === 'playlist' ? '<button data-c="unpl">− Remove from this playlist</button>' : ''}${ctx === 'queue' ? '<button data-c="unq">− Remove from queue</button>' : ''}
        <div class="ctx-sep"></div><button data-c="forget" class="danger">✕ Remove from library…</button>`;
      m.hidden = false;
      const r = m.getBoundingClientRect();
      m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
      m.onclick = async (e) => {
        const b = e.target.closest('[data-c]'); if (!b) return;
        m.hidden = true;
        switch (b.dataset.c) {
          case 'play': api.playList(list, 0); break;
          case 'next': api.enqueue(list, true); break;
          case 'queue': api.enqueue(list, false); break;
          case 'pl': addToPlaylist(b.dataset.pl, list); break;
          case 'newpl': { const n = await ask('New playlist name', 'New playlist'); if (n) { const p = createPlaylist(n); addToPlaylist(p.id, list); } break; }
          case 'edit': api.edit(list); break;
          case 'fav': api.setFav(list, !allFav); render(); break;
          case 'artist': go({ type: 'artist', key: norm(inf.albumArtist === 'Various Artists' ? inf.primary : inf.albumArtist) || norm(inf.primary) }); break;
          case 'album': go({ type: 'album', key: inf.albumKey }); break;
          case 'unpl': { const p = playlists.find((x) => x.id === view.key); const idx = new Set(selectedIdx()); p.ids = p.ids.filter((id, i) => !(idx.has(i))); persistPl(p); render(); break; }
          case 'unq': api.queueRemove(new Set(list.map((t) => t.id))); render(); break;
          case 'forget': if (await ask(`Remove ${list.length} song${list.length > 1 ? 's' : ''} from the library? (Files on disk are not touched.)`, '', { confirm: true, okText: 'Remove' })) { const ids = new Set(list.map((t) => t.id)); forgetTracks(ids); api.removeFromLibrary(ids); } break;
        }
      };
    }
    const selectedIdx = () => [...main.querySelectorAll('.lt-row.selected[data-i]')].map((r) => +r.dataset.i);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxMenu')) $('ctxMenu').hidden = true; }, true);

    // ---------- events
    nav.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'new-pl') { const n = await ask('New playlist name', 'New playlist'); if (n) { const p = createPlaylist(n); go({ type: 'playlist', key: p.id }); } return; }
      if (a && a.dataset.act === 'import') { $('m3uInput').click(); return; }
      const b = e.target.closest('[data-nav]'); if (!b) return;
      search.value = '';
      const id = b.dataset.nav;
      if (id.startsWith('smart:')) go({ type: 'smart', key: id }); else if (id === 'queue') go({ type: 'queue', key: 'queue' });
      else if (['songs', 'artists', 'albums', 'genres'].includes(id)) go({ type: id }); else go({ type: 'playlist', key: id });
    });
    // drag songs onto sidebar playlists / queue
    nav.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d && dragIds) { e.preventDefault(); d.classList.add('drop'); } });
    nav.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop]'); if (d) d.classList.remove('drop'); });
    nav.addEventListener('drop', (e) => {
      const d = e.target.closest('[data-drop]'); if (!d || !dragIds) return; e.preventDefault(); d.classList.remove('drop');
      const list = dragIds.map((id) => api.byId(id)).filter(Boolean);
      if (d.dataset.drop === 'queue') api.enqueue(list, false); else addToPlaylist(d.dataset.drop, list);
      dragIds = null;
    });
    let dragIds = null, dragFrom = null;
    main.addEventListener('dragstart', (e) => {
      const r = e.target.closest('.lt-row[data-id]'); if (!r) return;
      if (!sel.has(r.dataset.id)) { sel.clear(); sel.add(r.dataset.id); markSel(); }
      dragIds = shown.filter((t) => sel.has(t.id)).map((t) => t.id); dragFrom = selectedIdx();
      e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/x-luciel-ids', dragIds.join(','));
    });
    main.addEventListener('dragover', (e) => {
      const lt = e.target.closest('.lt.reorder'); if (!lt || !dragIds) return;
      e.preventDefault(); main.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const r = e.target.closest('.lt-row[data-i]'); if (r) { const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after'); }
    });
    main.addEventListener('drop', (e) => {
      const lt = e.target.closest('.lt.reorder'); if (!lt || !dragIds) return; e.preventDefault();
      const r = main.querySelector('.drop-before,.drop-after');
      const from = new Set(dragFrom);
      const items = currentList().map((t, i) => ({ t, i }));
      const moving = items.filter((x) => from.has(x.i)), rest = items.filter((x) => !from.has(x.i));
      let at = rest.length;
      if (r) { const ti = rest.findIndex((x) => x.i === +r.dataset.i); if (ti >= 0) at = r.classList.contains('drop-before') ? ti : ti + 1; }
      rest.splice(at, 0, ...moving);
      const ids = rest.map((x) => x.t.id);
      if (view.type === 'playlist') { const p = playlists.find((x) => x.id === view.key); p.ids = ids; persistPl(p); } else if (view.type === 'queue') api.setQueue(ids);
      dragIds = null; render();
    });
    main.addEventListener('dragend', () => { dragIds = null; main.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });

    main.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) { const t = api.byId(ed.dataset.edit); const s = selected(); api.edit(s.length > 1 && sel.has(t.id) ? s : [t]); return; }
      const ga = e.target.closest('[data-go-artist]'); if (ga && (e.target.closest('.lib-hdr') || e.detail === 1 && e.altKey)) { go({ type: 'artist', key: norm(ga.dataset.goArtist) }); return; }
      const act = e.target.closest('[data-act]');
      if (act) return doAct(act.dataset.act);
      const al = e.target.closest('[data-album]'); if (al) { go({ type: 'album', key: al.dataset.album }); return; }
      const ar = e.target.closest('[data-artist]'); if (ar) { search.value = ''; go({ type: 'artist', key: ar.dataset.artist }); return; }
      const ge = e.target.closest('[data-genre]'); if (ge) { search.value = ''; go({ type: 'genre', key: ge.dataset.genre }); return; }
      const nv = e.target.closest('[data-nav]'); if (nv) { search.value = ''; go({ type: 'playlist', key: nv.dataset.nav }); return; }
      const h = e.target.closest('.lt-head.sortable [data-sort]');
      if (h) { const k = h.dataset.sort; S.libSort = { key: k, dir: S.libSort.key === k ? -S.libSort.dir : 1 }; api.save(); render(); return; }
      const r = e.target.closest('.lt-row[data-id]'); if (!r) return;
      const id = r.dataset.id;
      if (e.shiftKey && anchor) { const ids = shown.map((t) => t.id); const a = ids.indexOf(anchor), b = ids.indexOf(id); if (!(e.ctrlKey || e.metaKey)) sel.clear(); ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => sel.add(x)); }
      else if (e.ctrlKey || e.metaKey) { sel.has(id) ? sel.delete(id) : sel.add(id); anchor = id; }
      else { sel.clear(); sel.add(id); anchor = id; }
      markSel();
    });
    main.addEventListener('dblclick', (e) => { const r = e.target.closest('.lt-row[data-i]'); if (!r || e.target.closest('[data-edit]')) return; api.playList(shown, +r.dataset.i); });
    main.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.lt-row[data-id]'); if (!r) return; e.preventDefault();
      if (!sel.has(r.dataset.id)) { sel.clear(); sel.add(r.dataset.id); anchor = r.dataset.id; markSel(); }
      ctxMenu(e.clientX, e.clientY, selected(), r.closest('.lt').dataset.ctx);
    });
    main.addEventListener('change', (e) => {
      if (e.target.id === 'bpmMin' || e.target.id === 'bpmMax') { S.smartBpm = { min: +$('bpmMin').value || 0, max: +$('bpmMax').value || 999 }; api.save(); render(); }
    });
    async function doAct(a) {
      const list = currentList();
      const p = view.type === 'playlist' && playlists.find((x) => x.id === view.key);
      switch (a) {
        case 'back': if (back.length) { view = back.pop(); render(); } break;
        case 'play': if (list.length) api.playList(list, 0); break;
        case 'shuffle': if (list.length) { const l = list.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } api.playList(l, 0); } break;
        case 'enqueue': api.enqueue(list, false); break;
        case 'edit-all': if (list.length) api.edit(sel.size ? selected() : list); break;
        case 'rename': { const n = await ask('Rename playlist', p.name); if (n) { p.name = n; persistPl(p); render(); } break; }
        case 'duplicate': { const c = createPlaylist(p.name + ' (copy)', p.ids); go({ type: 'playlist', key: c.id }); break; }
        case 'delete-pl': if (await ask(`Delete playlist “${p.name}”? Songs stay in the library.`, '', { confirm: true, okText: 'Delete' })) deletePlaylist(p); break;
        case 'snapshot': { const s = SMART.find((x) => x.id === view.key); const c = createPlaylist(s.name, list.map((t) => t.id)); go({ type: 'playlist', key: c.id }); break; }
        case 'save-queue': { const n = await ask('Save queue as playlist', 'Queue ' + new Date().toLocaleDateString()); if (n) { const c = createPlaylist(n, list.map((t) => t.id)); go({ type: 'playlist', key: c.id }); } break; }
        case 'clear-queue': api.clearQueue(); render(); break;
        case 'export': exportM3U(list, (p && p.name) || (view.type === 'smart' ? SMART.find((x) => x.id === view.key).name : 'Queue')); break;
      }
    }
    async function exportM3U(list, name) {
      const blob = new Blob([toM3U(list, api)], { type: 'audio/x-mpegurl;charset=utf-8' });
      const file = name.replace(/[\\/:*?"<>|]+/g, '_') + '.m3u8';
      if (typeof global.showSaveFilePicker === 'function') {
        try { const h = await global.showSaveFilePicker({ suggestedName: file, types: [{ description: 'M3U8 playlist', accept: { 'audio/x-mpegurl': ['.m3u8', '.m3u'] } }] }); const w = await h.createWritable(); await w.write(blob); await w.close(); api.toast(`Exported “${h.name}”`); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      global.LucielFS.download(blob, file); api.toast(`Exported ${file}`);
    }
    $('m3uInput').addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        const text = await f.text();
        const { found, missing } = matchM3U(parseM3U(text), api.all(), api);
        const pl = createPlaylist(f.name.replace(/\.m3u8?$/i, ''), found.map((t) => t.id));
        api.toast(`Imported “${pl.name}”: ${found.length} matched${missing.length ? `, ${missing.length} not in the library` : ''}`, missing.length ? 'warn' : '');
        go({ type: 'playlist', key: pl.id });
      }
      e.target.value = '';
    });
    search.addEventListener('input', () => render());
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); search.value = ''; render(); } });
    win.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e')) { const s = selected(); if (s.length) { e.preventDefault(); e.stopPropagation(); api.edit(s); } }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); shown.forEach((t) => sel.add(t.id)); markSel(); }
      else if (e.key === 'Enter') { const s = selected(); if (s.length) { e.stopPropagation(); api.playList(shown, shown.indexOf(s[0])); } }
      else if (e.key === 'Delete' && view.type === 'playlist') { e.stopPropagation(); const p = playlists.find((x) => x.id === view.key); const idx = new Set(selectedIdx()); p.ids = p.ids.filter((id, i) => !idx.has(i)); persistPl(p); render(); }
    }, true);
    $('libClose').onclick = () => close();
    $('libAdd').onclick = () => api.openFiles(); $('libAddDir').onclick = () => api.openFolder();
    $('libNewPl').onclick = async () => { const n = await ask('New playlist name', 'New playlist'); if (n) { const p = createPlaylist(n); go({ type: 'playlist', key: p.id }); } };
    $('libImport').onclick = () => $('m3uInput').click();
    $('libEdit').onclick = () => { const s = selected(); if (s.length) api.edit(s); else api.toast('Select songs to edit first', 'warn'); };

    // background updates (BPM analysis, metadata) are debounced and never re-render under an active drag / menu / prompt
    let rt = 0;
    function scheduleRender() {
      if (win.hidden || rt) return;
      rt = setTimeout(function fire() {
        const busy = dragIds || !$('ctxMenu').hidden || !$('askOverlay').hidden;
        if (busy && !win.hidden) { rt = setTimeout(fire, 400); return; }
        rt = 0; if (!win.hidden) { const y = main.scrollTop; render(); main.scrollTop = y; }
      }, 300);
    }
    function open(v) { win.hidden = false; document.body.classList.add('lib-open'); if (v) { view = v; back.length = 0; } render(); }
    function close() { win.hidden = true; document.body.classList.remove('lib-open'); }
    loadPlaylists();
    return {
      open, close, toggle: () => (win.hidden ? open() : close()), isOpen: () => !win.hidden,
      refresh: () => { dirty = true; scheduleRender(); }, go, ask, addToPlaylist, createPlaylist, forgetTracks,
      get playlists() { return playlists; }, get view() { return view; }, groups, SMART, exportM3U, ctxMenu,
    };
  }
  global.LucielLibrary = { create, group, splitArtist, toM3U, parseM3U, matchM3U };
})(window);
