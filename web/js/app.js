/* Luciel — main application controller */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { Engine, BANDS, PRESETS, GENRE_PRESET } = window.AeroAudio;
  const { Settings, Tracks: DBTracks } = window.AeroStore;

  const PALETTES = [
    { id: 'aero',  name: 'Frutiger Aero Grey', desc: 'silver glass · sky blue' },
    { id: 'blue',  name: 'Midnight Blue',      desc: 'deep navy · cyan glow' },
    { id: 'red',   name: 'Crimson Night',      desc: 'dark red · ember' },
    { id: 'slime', name: 'Toxic Slime',        desc: 'neon green · black' },
  ];
  const SKINS = [{ id: 'aero', name: 'Aero' }, { id: 'classic', name: 'Classic' }];
  const THEMES = [];
  SKINS.forEach((s) => PALETTES.forEach((p) => THEMES.push({ palette: p.id, skin: s.id })));

  const AUDIO_EXT = {
    mp3: 'audio/mpeg', mp2: 'audio/mpeg', mpga: 'audio/mpeg',
    wav: 'audio/wav', wave: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus',
    m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', alac: 'audio/mp4',
    webm: 'audio/webm', weba: 'audio/webm', mka: 'audio/x-matroska',
    aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf',
    wma: 'audio/x-ms-wma', ape: 'audio/x-ape', wv: 'audio/x-wavpack', mid: 'audio/midi', midi: 'audio/midi',
  };

  const engine = new Engine();
  const tracker = new window.LucielBPM.Tracker();
  const luciel = window.Luciel.create({ elements: {
    stage: $('stage'), pxStage: $('pxStage'), backArt: $('sceneArt'), backGlow: $('sceneGlow'), fx: $('fxCanvas'), sceneCanvas: $('sceneCanvas'),
    onScene: (sc) => { try { applySceneColors(sc); } catch (e) { /* before the player UI exists; applyTheme re-applies */ } $('sceneName').textContent = sc.name; renderMasInfo(); markSceneGrid(); if (current) refreshCover(); miniPush(); },
  } });
  const audio = engine.audio;

  const defaults = {
    palette: 'aero', skin: 'aero', volume: 0.8, muted: false, balance: 0,
    eq: BANDS.map(() => 0), preamp: 0, eqOn: true, eqAuto: false, preset: 'Flat',
    shuffle: false, repeat: 'off', vizMode: 'spectrum', showEq: true, showPl: true,
    bubbles: true, remember: true, order: [], currentId: null, position: 0, remaining: false,
    sceneColors: true, mascot: true, mascotSize: 'm', doze: true, strict: false, scene: 'auto', favorites: [],
    miniHideMain: true, miniBox: null, miniLarge: false,
  };
  const S = Object.assign({}, defaults, Settings.load());
  if (!Array.isArray(S.eq) || S.eq.length !== BANDS.length) S.eq = defaults.eq.slice();

  let tracks = [];            // the play queue ("Now playing")
  const lib = new Map();       // every song in the library, by id
  let current = null;
  const selection = new Set();
  let anchorId = null;
  let history = [];
  let errorStreak = 0;
  let seeking = false;
  let lcdMessage = null, lcdMessageUntil = 0;
  let nextId = Date.now();

  // ------------------------------------------------------------------ utils
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const fmt2 = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return `${String(Math.min(m, 99)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const extOf = (n) => { const m = /\.([a-z0-9]+)$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = (name, el = document.body) => getComputedStyle(el).getPropertyValue(name).trim();

  function toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }
  function lcdFlash(msg) { lcdMessage = msg; lcdMessageUntil = performance.now() + 1100; renderMarquee(true); }

  const saveNow = () => {
    S.order = tracks.map((t) => t.id);
    S.currentId = current ? current.id : null;
    S.position = current ? audio.currentTime || 0 : 0;
    Settings.save(S);
  };
  const save = debounce(saveNow, 250);
  window.addEventListener('beforeunload', saveNow);
  setInterval(() => { if (!audio.paused) saveNow(); }, 5000);

  // -------------------------------------------------------------- tracks
  function mimeFor(file) {
    const ext = extOf(file.name);
    if (AUDIO_EXT[ext]) return AUDIO_EXT[ext];
    return file.type || '';
  }
  function isAudioFile(file) {
    const ext = extOf(file.name);
    return !!AUDIO_EXT[ext] || /^audio\//.test(file.type) || file.type === 'video/webm';
  }
  function supportLevel(mime) {
    if (!mime) return 'maybe';
    let r = audio.canPlayType(mime);
    if (!r && mime === 'audio/wav') r = audio.canPlayType('audio/wave') || audio.canPlayType('audio/x-wav');
    if (!r && mime === 'audio/aac') r = audio.canPlayType('audio/mp4; codecs="mp4a.40.2"');
    if (!r && mime === 'audio/x-matroska') r = audio.canPlayType('audio/webm');
    return r; // '', 'maybe', 'probably'
  }
  // Fallback naming from "NN - Artist - Title.ext" style file names
  function nameParts(t) {
    const base = t.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}\s*(?:[-.)]\s*|\s+)/, '');
    const parts = base.split(/\s+-\s+/);
    return parts.length > 1 ? { artist: parts[0], title: parts.slice(1).join(' - ') } : { artist: '', title: base };
  }
  function displayTitle(t) {
    const m = t.meta || {};
    return m.title || nameParts(t).title;
  }
  function displayArtist(t) {
    const m = t.meta || {};
    return m.artist || nameParts(t).artist;
  }
  function makeTrack(file, rec) {
    const name = rec ? rec.name : (file.webkitRelativePath || file.name).split('/').pop();
    const mime = rec ? (rec.mime || mimeFor({ name, type: rec.type })) : mimeFor(file);
    const t = {
      id: rec ? rec.id : 't' + (nextId++).toString(36),
      name, file, size: file.size, type: file.type || (rec && rec.type) || '', mime,
      ext: extOf(name), supported: supportLevel(mime), meta: rec ? rec.meta : null,
      duration: rec ? rec.duration : NaN, coverUrl: null, path: rec ? rec.path : (file.__path || file.webkitRelativePath || name),
      addedAt: rec ? rec.addedAt || 0 : Date.now(), plays: rec ? rec.plays || 0 : 0, lastPlayed: rec ? rec.lastPlayed || 0 : 0,
      handle: rec ? rec.handle || null : file.__handle || null, nativePath: rec ? rec.nativePath || null : file.__nativePath || file.path || nativePathOf(file), metaSource: rec ? rec.metaSource || 'file' : 'file',
    };
    lib.set(t.id, t);
    if (t.meta && t.meta.picture) t.coverUrl = URL.createObjectURL(new Blob([t.meta.picture.data], { type: t.meta.picture.mime }));
    if (t.meta && t.meta.unplayable) t.supported = '';
    if (t.meta && t.meta.bpmInfo) t.bpmInfo = t.meta.bpmInfo;
    return t;
  }

  async function addFiles(list, { playFirst = false } = {}) {
    const files = Array.from(list).filter(isAudioFile);
    const skipped = list.length - files.length;
    if (!files.length) { toast(skipped ? 'No audio files found in selection' : 'Nothing to add', 'warn'); return; }
    files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
    // already in the library (same name + size)? reuse it instead of duplicating
    const known = new Map([...lib.values()].map((t) => [t.name + '\u0000' + t.size, t]));
    const added = [], fresh = [];
    for (const f of files) {
      const name = (f.webkitRelativePath || f.name).split('/').pop();
      const hit = known.get(name + '\u0000' + f.size);
      if (hit) { if (f.__handle && !hit.handle) { hit.handle = f.__handle; persist(hit); } if (f.__nativePath && hit.nativePath !== f.__nativePath) { hit.nativePath = f.__nativePath; persist(hit); } added.push(hit); }
      else { const t = makeTrack(f); added.push(t); fresh.push(t); }
    }
    const inQueue = new Set(tracks.map((t) => t.id));
    tracks.push(...added.filter((t) => !inQueue.has(t.id)));
    renderPlaylist();
    const unsup = added.filter((t) => !t.supported).length;
    toast(`Added ${added.length} track${added.length > 1 ? 's' : ''}` + (added.length - fresh.length ? ` (${added.length - fresh.length} already in library)` : '') + (unsup ? ` · ${unsup} not playable in this browser` : ''), unsup ? 'warn' : '');
    if ((playFirst || !current) && added.length) {
      const first = added.find((t) => t.supported);
      if (first) playTrack(first, { autoplay: playFirst || audio.paused === false || true });
    }
    // Parse metadata + durations with small concurrency
    let i = 0;
    const worker = async () => {
      while (i < fresh.length) {
        const t = fresh[i++];
        await enrich(t);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    library.refresh();
    save();
  }

  async function enrich(t) {
    if (!t.meta) {
      t.meta = await window.AeroMeta.read(t.file);
      if (t.meta.picture) t.coverUrl = URL.createObjectURL(new Blob([t.meta.picture.data], { type: t.meta.picture.mime }));
    }
    if (!isFinite(t.duration) && t.supported) t.duration = await probeDuration(t);
    analyzeBpm(t, false);
    updateRow(t);
    if (t === current) updateNowPlaying();
    persist(t);
    renderTotals();
  }

  function probeDuration(t) {
    return new Promise((res) => {
      const a = new Audio(); const url = URL.createObjectURL(t.file);
      let done = false;
      const fin = (d, bad) => {
        if (done) return; done = true;
        a.onloadedmetadata = a.onerror = a.ontimeupdate = null;
        a.removeAttribute('src'); a.load(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (bad) { t.supported = ''; if (t.meta) t.meta.unplayable = true; }
        res(d);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        if (a.duration === Infinity) { // some webm/ogg: force duration calc
          a.currentTime = 1e7;
          a.ontimeupdate = () => fin(a.duration);
        } else fin(a.duration);
      };
      a.onerror = () => fin(NaN, true);
      setTimeout(() => fin(NaN), 10000);
      a.src = url;
    });
  }

  function persist(t) {
    if (!S.remember) return;
    const rec = { id: t.id, name: t.name, type: t.type, mime: t.mime, size: t.size, blob: t.file, meta: t.meta, duration: t.duration, path: t.path,
      addedAt: t.addedAt, plays: t.plays, lastPlayed: t.lastPlayed, metaSource: t.metaSource, nativePath: t.nativePath, handle: t.handle || null };
    DBTracks.put(rec).catch(() => { rec.handle = null; return DBTracks.put(rec); })
      .catch((e) => { if (!persist.warned) { persist.warned = true; toast('Browser storage is full — some tracks won’t be remembered', 'warn'); } console.warn(e); });
  }

  async function restore() {
    if (!S.remember) return;
    let recs;
    try { recs = await DBTracks.all(); } catch (e) { return; }
    if (!recs || !recs.length) return;
    recs.filter((r) => r.blob).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).forEach((r) => makeTrack(r.blob, r));
    // queue = saved order; libraries from before the library existed had every song in the queue
    tracks = S.queueV2 ? (S.order || []).map((id) => lib.get(id)).filter(Boolean) : [...(S.order || []).map((id) => lib.get(id)).filter(Boolean), ...[...lib.values()].filter((t) => !(S.order || []).includes(t.id))];
    S.queueV2 = true;
    renderPlaylist(); library.refresh();
    const cur = tracks.find((t) => t.id === S.currentId);
    if (cur) playTrack(cur, { autoplay: false, startAt: S.position || 0 });
  }

  function removeTracks(ids) {
    if (!ids.size) return;
    if (current && ids.has(current.id)) { stop(); current = null; audio.removeAttribute('src'); audio.load(); updateNowPlaying(); }
    tracks = tracks.filter((t) => !ids.has(t.id));   // songs stay in the library
    ids.forEach((id) => selection.delete(id));
    history = history.filter((id) => !ids.has(id));
    renderPlaylist(); save(); library.refresh();
  }
  function removeFromLibrary(ids) {
    removeTracks(ids);
    ids.forEach((id) => { const t = lib.get(id); if (!t) return; if (t.coverUrl) URL.revokeObjectURL(t.coverUrl); lib.delete(id); DBTracks.remove(id).catch(() => {}); });
    S.favorites = S.favorites.filter((id) => !ids.has(id));
    library.forgetTracks(ids); library.refresh(); save();
    toast(`Removed ${ids.size} song${ids.size > 1 ? 's' : ''} from the library`);
  }
  function playList(list, start = 0) {
    list = list.filter(Boolean); if (!list.length) return;
    tracks = list.slice(); renderPlaylist(); save();
    const t = list[start] && list[start].supported ? list[start] : list.slice(start).find((x) => x.supported) || list.find((x) => x.supported);
    if (t) playTrack(t);
    library.refresh();
  }
  function enqueue(list, playNext) {
    const ids = new Set(list.map((t) => t.id));
    tracks = tracks.filter((t) => !ids.has(t.id) || t === current);
    const add = list.filter((t) => t !== current);
    const at = playNext && current ? tracks.indexOf(current) + 1 : tracks.length;
    tracks.splice(at, 0, ...add);
    renderPlaylist(); save(); library.refresh();
    toast(`${add.length} song${add.length > 1 ? 's' : ''} ${playNext ? 'will play next' : 'added to the queue'}`);
    if (!current) { const t = add.find((x) => x.supported); if (t) playTrack(t); }
  }

  // ------------------------------------------------------------ playback
  let objectUrl = null;
  function playTrack(t, { autoplay = true, startAt = 0 } = {}) {
    if (!t) return false;
    if (!t.supported) {
      luciel.failed();
      toast(`“${displayTitle(t)}” (${t.ext.toUpperCase() || 'unknown'}) can’t be decoded by this browser`, 'warn');
      return false;
    }
    if (autoplay) engine.ensure();
    if (current && current !== t) { history.push(current.id); if (history.length > 200) history.shift(); }
    current = t;
    const oldUrl = objectUrl;
    objectUrl = URL.createObjectURL(t.file);
    if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 3000);
    audio.src = objectUrl;
    if (startAt > 0) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(startAt, (audio.duration || startAt) - 0.5); } catch (e) {} }, { once: true });
    if (autoplay) audio.play().catch((e) => { if (e.name !== 'AbortError') console.warn(e); });
    if (S.eqAuto && t.meta && t.meta.genre) {
      const hit = GENRE_PRESET.find(([re]) => re.test(t.meta.genre));
      applyPreset(hit ? hit[1] : 'Flat', true);
    }
    tracker.reset(); moodChecked = false; t.counted = false;
    if (t.bpmInfo) tracker.setGrid(t.bpmInfo.bpm, t.bpmInfo.t0, t.bpmInfo.source, t.bpmInfo.confidence);
    else analyzeBpm(t, true);
    if (autoplay) luciel.trackStarted(t.meta, displayTitle(t));
    updateNowPlaying(); markPlaying(); save();
    if (!autoplay) setState('stop');
    return true;
  }
  // ---------------------------------------------------------- tempo analysis
  let moodChecked = false;
  const bpmQueue = []; let bpmBusy = false;
  function analyzeBpm(t, priority) {
    if (!t || t.bpmInfo || !t.supported || t.bpmPending) return;
    t.bpmPending = true;
    priority ? bpmQueue.unshift(t) : bpmQueue.push(t);
    pumpBpm();
  }
  async function pumpBpm() {
    if (bpmBusy) return;
    const t = bpmQueue.shift(); if (!t) return;
    bpmBusy = true;
    try {
      const tag = t.meta && t.meta.bpm && t.meta.bpm >= 40 && t.meta.bpm <= 250 ? t.meta.bpm : 0;
      const r = await window.LucielBPM.analyzeBlob(t.file, { tagBpm: tag });
      if (r && !r.error && r.bpm) {
        t.bpmInfo = { bpm: tag || r.bpm, t0: r.t0, period: 60 / (tag || r.bpm), confidence: r.confidence, source: tag ? 'tag' : 'analysis' };
        if (t.meta) t.meta.bpmInfo = t.bpmInfo;
        persist(t);
        if (t === current) { tracker.setGrid(t.bpmInfo.bpm, t.bpmInfo.t0, t.bpmInfo.source, t.bpmInfo.confidence); renderBpm(); }
      }
    } catch (e) { console.warn('[bpm]', t.name, e && e.message); }
    t.bpmPending = false; bpmBusy = false;
    setTimeout(pumpBpm, 60);
  }
  function toggleFavorite() {
    if (!current) return;
    const i = S.favorites.indexOf(current.id);
    if (i >= 0) S.favorites.splice(i, 1); else { S.favorites.push(current.id); luciel.favorite(); lcdFlash('FAVORITED <3'); }
    $('btnFav').classList.toggle('on', i < 0); updateRow(current); save();
  }

  function togglePlay() {
    if (!current) {
      const sel = tracks.find((t) => selection.has(t.id) && t.supported) || tracks.find((t) => t.supported);
      if (sel) playTrack(sel); else openFiles();
      return;
    }
    engine.ensure();
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function play() { if (!current) return togglePlay(); engine.ensure(); if (audio.paused) audio.play().catch(() => {}); }
  function pause() { if (!audio.paused) audio.pause(); else if (current && audio.currentTime > 0) play(); }
  function stop() { audio.pause(); try { audio.currentTime = 0; } catch (e) {} setState('stop'); updateTime(); }

  function playable() { return tracks.filter((t) => t.supported); }
  function next(auto = false) {
    const list = playable();
    if (!list.length) return;
    if (S.shuffle) {
      const recent = new Set(history.slice(-Math.floor(list.length / 2)));
      let pool = list.filter((t) => t !== current && !recent.has(t.id));
      if (!pool.length) pool = list.filter((t) => t !== current);
      if (!pool.length) pool = list;
      return playTrack(pool[Math.floor(Math.random() * pool.length)]);
    }
    let i = current ? tracks.indexOf(current) : -1;
    for (let k = 0; k < tracks.length; k++) {
      i++;
      if (i >= tracks.length) {
        if (auto && S.repeat !== 'all') { stop(); lcdFlash('END OF PLAYLIST'); return; }
        i = 0;
      }
      if (tracks[i].supported) return playTrack(tracks[i]);
    }
  }
  function prev() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (S.shuffle && history.length) {
      const id = history.pop(); const t = tracks.find((x) => x.id === id);
      if (t) { const c = current; current = null; playTrack(t); history = history.filter((h) => h !== (c && c.id)); return; }
    }
    let i = current ? tracks.indexOf(current) : 0;
    for (let k = 0; k < tracks.length; k++) {
      i = i - 1 < 0 ? tracks.length - 1 : i - 1;
      if (tracks[i].supported) return playTrack(tracks[i]);
    }
  }

  audio.addEventListener('play', () => setState('play'));
  audio.addEventListener('playing', () => { errorStreak = 0; setState('play'); });
  audio.addEventListener('pause', () => setState(audio.currentTime === 0 ? 'stop' : 'pause'));
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('durationchange', () => { if (current && isFinite(audio.duration)) { current.duration = audio.duration; updateRow(current); renderTotals(); } updateTime(); updateQuality(); });
  audio.addEventListener('ended', () => {
    const last = current && tracks.indexOf(current) === tracks.length - 1 && !S.shuffle && S.repeat === 'off';
    if (last) luciel.playlistFinished(); else luciel.trackFinished();
    if (S.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    next(true);
  });
  audio.addEventListener('timeupdate', () => {
    if (!moodChecked && audio.currentTime > 8) { moodChecked = true; luciel.moodCheck(); }
    if (current && !current.counted && (audio.currentTime > 30 || (audio.duration && audio.currentTime > audio.duration * 0.5))) {
      current.counted = true; current.plays = (current.plays || 0) + 1; current.lastPlayed = Date.now(); persist(current); library.refresh();
    }
  });
  audio.addEventListener('error', () => {
    if (!current || !audio.getAttribute('src')) return;
    const t = current;
    t.supported = ''; if (t.meta) t.meta.unplayable = true;
    updateRow(t);
    toast(`Couldn’t decode “${displayTitle(t)}” — skipping`, 'warn');
    luciel.failed();
    if (++errorStreak < tracks.length) setTimeout(() => next(true), 350); else stop();
  });

  function setState(st) {
    document.body.classList.toggle('is-playing', st === 'play');
    document.body.classList.toggle('is-paused', st === 'pause');
    document.body.classList.toggle('is-stopped', st === 'stop');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st === 'play' ? 'playing' : st === 'pause' ? 'paused' : 'none';
  }

  // --------------------------------------------------------------- UI: now playing
  // Media Session artwork must be http(s)/blob/data: under file:// or a custom app:// scheme, hand it a cached blob: URL instead
  const artBlobs = new Map();
  function sessionArt(src) {
    if (/^https?:$/.test(location.protocol)) return [{ src, sizes: '1024x1024', type: 'image/webp' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    if (location.protocol === 'file:') return [];
    if (artBlobs.has(src)) { const u = artBlobs.get(src); return u ? [{ src: u, sizes: '1024x1024', type: 'image/webp' }] : []; }
    artBlobs.set(src, null);
    fetch(src).then((r) => r.blob()).then((b) => { artBlobs.set(src, URL.createObjectURL(b)); if (current) updateMediaSession(current); }).catch(() => {});
    return [];
  }
  function updateNowPlaying() {
    const t = current;
    const m = (t && t.meta) || {};
    $('tTitle').textContent = t ? displayTitle(t) : 'Nothing playing';
    $('tArtist').textContent = t ? (displayArtist(t) || 'Unknown artist') : 'Drop audio files or folders anywhere';
    const albumBits = [m.album, m.year, m.genre].filter(Boolean);
    $('tAlbum').textContent = albumBits.join('  ·  ');
    refreshCover();
    $('btnFav').classList.toggle('on', !!(t && S.favorites.includes(t.id)));
    renderBpm();
    $('badgeFormat').textContent = t ? (m.format && m.format !== 'Ogg' ? m.format : (t.ext || 'audio').toUpperCase()) : 'READY';
    updateQuality();
    document.title = t ? `${displayTitle(t)}${displayArtist(t) ? ' – ' + displayArtist(t) : ''} · Luciel` : 'Luciel';
    marqueePos = 0; renderMarquee(true);
    updateMediaSession();
    updateTime();
  }
  /** Real cover art, or Lucielle scene art (by genre tag, else palette) when the track has none */
  function fallbackCover(t) { return window.Luciel.Scenes.coverFor(t && t.meta, S.palette); }
  function refreshCover() {
    const t = current, img = $('cover');
    const src = t ? (t.coverUrl || fallbackCover(t)) : fallbackCover(null);
    if (img.getAttribute('src') !== src) img.src = src;
    img.hidden = false; $('coverPh').hidden = true;
    $('coverWrap').classList.toggle('fallback', !(t && t.coverUrl));
    document.body.classList.toggle('has-cover', !!(t && t.coverUrl));
  }
  function renderBpm() {
    const b = current && current.bpmInfo;
    $('badgeBpm').hidden = !b;
    $('bpmVal').textContent = b ? Math.round(b.bpm) : '--';
    $('badgeBpm').title = b ? `Tempo ${b.bpm} BPM (${b.source}${b.confidence != null ? ', confidence ' + Math.round(b.confidence * 100) + '%' : ''})` : '';
    $('lcdBpm').textContent = b ? String(Math.round(b.bpm)) : '---';
    renderMasInfo();
  }
  function renderMasInfo() {
    const b = current && current.bpmInfo;
    const tier = luciel.st.tier || '';
    $('masInfo').textContent = `${b ? Math.round(b.bpm) + ' BPM' : '--- BPM'} ${tier && tier !== 'still' ? '· ' + tier.toUpperCase() : ''}`;
    $('masInfo').title = luciel.scene ? luciel.scene.name : '';
  }
  function kbpsOf(t) {
    if (!t) return 0;
    if (t.meta && t.meta.bitrate) return Math.round(t.meta.bitrate);
    const d = isFinite(t.duration) && t.duration > 0 ? t.duration : audio.duration;
    if (!isFinite(d) || d <= 0) return 0;
    const art = t.meta && t.meta.picture ? t.meta.picture.data.length : 0;
    return Math.round(((t.size - art) * 8) / d / 1000);
  }
  function updateQuality() {
    const t = current, m = (t && t.meta) || {};
    const kb = kbpsOf(t);
    const bits = [];
    if (m.sampleRate) bits.push(`${(m.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`);
    if (m.bitsPerSample) bits.push(`${m.bitsPerSample}-bit`);
    if (kb) bits.push(`${kb} kbps`);
    if (m.channels) bits.push(m.channels === 1 ? 'mono' : m.channels === 2 ? 'stereo' : `${m.channels} ch`);
    $('badgeQuality').textContent = bits.join(' · ');
    $('badgeQuality').hidden = !bits.length;
    $('lcdKbps').textContent = kb ? String(Math.min(kb, 9999)).padStart(3, ' ') : '---';
    $('lcdKhz').textContent = m.sampleRate ? String(Math.round(m.sampleRate / 1000)) : (t ? '44' : '--');
    const ch = m.channels || (t ? 2 : 0);
    $('lcdMono').classList.toggle('on', ch === 1);
    $('lcdStereo').classList.toggle('on', ch >= 2);
  }
  function updateTime() {
    const d = isFinite(audio.duration) ? audio.duration : (current && current.duration) || 0;
    const c = audio.currentTime || 0;
    if (!seeking) {
      const p = d ? (c / d) * 1000 : 0;
      $('seek').value = p;
      $('seek').parentNode.style.setProperty('--p', p / 10);
      $('timeCur').textContent = fmt(c);
    }
    $('timeDur').textContent = fmt(d);
    $('lcdTimeText').textContent = S.remaining && d ? fmt2(d - c) : fmt2(c);
    $('lcdTime').classList.toggle('remaining', !!(S.remaining && d));
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && d && isFinite(d)) {
      const now = performance.now();
      if (!updateTime._last || now - updateTime._last > 1000) {
        updateTime._last = now;
        try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: audio.playbackRate || 1 }); } catch (e) {}
      }
    }
  }

  // Marquee (classic LCD) — Winamp-style rotating text
  let marqueePos = 0;
  function marqueeText() {
    if (!current) return 'LUCIEL  ***  DROP SOME MUSIC IN  ***  ';
    const n = tracks.indexOf(current) + 1;
    const a = displayArtist(current);
    const d = isFinite(current.duration) ? ` (${fmt(current.duration)})` : '';
    return `${n}. ${a ? a + ' - ' : ''}${displayTitle(current)}${d}  ***  `;
  }
  function renderMarquee(force) {
    if (document.body.dataset.skin !== 'classic' && !force) return;
    const el = $('marqueeText');
    const now = performance.now();
    if (lcdMessage && now < lcdMessageUntil) { el.textContent = lcdMessage; return; }
    lcdMessage = null;
    const txt = marqueeText();
    const room = marqueeRoom();
    if (txt.length - 7 <= room) { el.textContent = txt.replace(/\s+\*\*\*\s+$/, ''); return; }
    const s = txt + txt;
    el.textContent = s.substr(marqueePos % txt.length, room + 2);
  }
  let roomCache = 0;
  function marqueeRoom() {
    if (roomCache) return roomCache;
    const host = $('marquee'); const probe = document.createElement('span');
    probe.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'; probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    host.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 30; probe.remove();
    const w = host.clientWidth - 16;
    if (cw > 0 && w > 0) roomCache = Math.max(10, Math.floor(w / cw));
    return roomCache || 31;
  }
  setInterval(() => { marqueePos++; renderMarquee(); }, 220);

  // Media Session
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = current;
    if (!t) { navigator.mediaSession.metadata = null; return; }
    const m = t.meta || {};
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle(t), artist: displayArtist(t), album: m.album || '',
        artwork: t.coverUrl ? [{ src: t.coverUrl, sizes: '512x512', type: m.picture.mime }] : sessionArt(fallbackCover(t)),
      });
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
    h('play', play); h('pause', () => audio.pause()); h('stop', stop);
    h('previoustrack', prev); h('nexttrack', () => next());
    h('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
    h('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
    h('seekto', (d) => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime; });
  }

  // --------------------------------------------------------------- UI: playlist
  function rowHTML(t, i) {
    const m = t.meta || {};
    const sub = [displayArtist(t), m.album].filter(Boolean).join(' · ');
    const cls = ['pl-row'];
    if (t === current) cls.push('playing');
    if (selection.has(t.id)) cls.push('selected');
    if (!t.supported) cls.push('unsupported');
    return `<li class="${cls.join(' ')}" data-id="${t.id}" draggable="true">
      <span class="pl-grip"><svg><use href="#i-grip"/></svg></span>
      <span class="pl-idx">${i + 1}.</span>
      <span class="pl-thumb${t.coverUrl ? '' : ' fallback'}"><img src="${t.coverUrl || fallbackCover(t).replace('art/', 'art/thumb/')}" alt="" loading="lazy"><i class="eqbars"><b></b><b></b><b></b></i></span>
      <span class="pl-main"><span class="pl-title">${esc(displayTitle(t))}</span><span class="pl-sub">${esc(sub || t.name)}</span>
        <span class="pl-classic">${esc(displayArtist(t) ? displayArtist(t) + ' - ' : '')}${esc(displayTitle(t))}</span></span>
      ${S.favorites.includes(t.id) ? '<span class="pl-fav" title="Favorite">&#9829;</span>' : ''}
      <span class="pl-fmt" title="${t.supported ? esc(t.mime) : 'Not supported by this browser'}">${t.supported ? esc(t.ext.toUpperCase()) : 'N/A'}</span>
      <span class="pl-dur">${isFinite(t.duration) ? fmt(t.duration) : (t.supported ? '…' : '--:--')}</span>
      <button class="pl-ed" title="Edit tags (F2)" data-ed="${t.id}">✎</button>
      <button class="pl-del" title="Remove from queue" data-del="${t.id}"><svg><use href="#i-close"/></svg></button>
    </li>`;
  }
  function query() { return $('plSearch').value.trim().toLowerCase(); }
  function matches(t, q) {
    if (!q) return true;
    const m = t.meta || {};
    return [displayTitle(t), displayArtist(t), m.album, m.genre, t.name, m.year].join(' ').toLowerCase().includes(q);
  }
  function renderPlaylist() {
    const q = query();
    const html = [];
    tracks.forEach((t, i) => { if (matches(t, q)) html.push(rowHTML(t, i)); });
    $('plList').innerHTML = html.join('');
    $('plList').classList.toggle('filtered', !!q);
    $('plEmpty').hidden = tracks.length > 0;
    if (q && !html.length && tracks.length) $('plList').innerHTML = `<li class="pl-noresult">No matches for “${esc(q)}”</li>`;
    renderTotals();
  }
  function updateRow(t) {
    const li = $('plList').querySelector(`[data-id="${t.id}"]`);
    if (!li) return;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(t, tracks.indexOf(t));
    li.replaceWith(tmp.firstElementChild);
  }
  function markPlaying() {
    $('plList').querySelectorAll('.pl-row').forEach((li) => li.classList.toggle('playing', !!current && li.dataset.id === current.id));
    const li = current && $('plList').querySelector(`[data-id="${current.id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  }
  function markSelection() {
    $('plList').querySelectorAll('.pl-row').forEach((li) => li.classList.toggle('selected', selection.has(li.dataset.id)));
  }
  function renderTotals() {
    const total = tracks.reduce((a, t) => a + (isFinite(t.duration) ? t.duration : 0), 0);
    $('plTotal').textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${fmt(total)}`;
    $('plCount').textContent = tracks.length ? `(${tracks.length})` : '';
  }

  const plList = $('plList');
  plList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { removeTracks(new Set([del.dataset.del])); return; }
    const ed = e.target.closest('[data-ed]');
    if (ed) { const t = lib.get(ed.dataset.ed); editTracks(selection.has(t.id) && selection.size > 1 ? tracks.filter((x) => selection.has(x.id)) : [t]); return; }
    const li = e.target.closest('.pl-row'); if (!li) return;
    const id = li.dataset.id;
    if (e.shiftKey && anchorId) {
      const vis = [...plList.querySelectorAll('.pl-row')].map((x) => x.dataset.id);
      const a = vis.indexOf(anchorId), b = vis.indexOf(id);
      if (!(e.ctrlKey || e.metaKey)) selection.clear();
      vis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => selection.add(x));
    } else if (e.ctrlKey || e.metaKey) {
      selection.has(id) ? selection.delete(id) : selection.add(id); anchorId = id;
    } else { selection.clear(); selection.add(id); anchorId = id; }
    markSelection();
  });
  plList.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.pl-row'); if (!li || e.target.closest('[data-del]')) return;
    playTrack(tracks.find((t) => t.id === li.dataset.id));
  });
  plList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.pl-row'); if (!li) return;
    e.preventDefault();
    if (!selection.has(li.dataset.id)) { selection.clear(); selection.add(li.dataset.id); anchorId = li.dataset.id; markSelection(); }
    library.ctxMenu(e.clientX, e.clientY, tracks.filter((t) => selection.has(t.id)), 'queue');
  });
  // songs dragged from the library onto the queue
  plList.addEventListener('dragover', (e) => { if (!dragIds && [...e.dataTransfer.types].includes('text/x-luciel-ids')) { e.preventDefault(); e.stopPropagation(); } });
  plList.addEventListener('drop', (e) => {
    const ids = e.dataTransfer.getData('text/x-luciel-ids'); if (!ids || dragIds) return;
    e.preventDefault(); e.stopPropagation(); enqueue(ids.split(',').map((id) => lib.get(id)).filter(Boolean), false);
  });
  // drag to reorder
  let dragIds = null;
  plList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.pl-row'); if (!li || query()) { e.preventDefault(); return; }
    if (!selection.has(li.dataset.id)) { selection.clear(); selection.add(li.dataset.id); markSelection(); }
    dragIds = new Set(selection);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-aeroamp', '1');
    li.classList.add('dragging');
  });
  plList.addEventListener('dragover', (e) => {
    if (!dragIds) return;
    e.preventDefault(); e.stopPropagation();
    const li = e.target.closest('.pl-row');
    plList.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (li) { const r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after'); }
  });
  plList.addEventListener('drop', (e) => {
    if (!dragIds) return;
    e.preventDefault(); e.stopPropagation();
    const li = plList.querySelector('.drop-before,.drop-after');
    const moving = tracks.filter((t) => dragIds.has(t.id));
    let rest = tracks.filter((t) => !dragIds.has(t.id));
    let at = rest.length;
    if (li) { const tgt = rest.findIndex((t) => t.id === li.dataset.id); if (tgt >= 0) at = li.classList.contains('drop-before') ? tgt : tgt + 1; }
    rest.splice(at, 0, ...moving);
    tracks = rest; dragIds = null; renderPlaylist(); save();
  });
  plList.addEventListener('dragend', () => { dragIds = null; plList.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });

  function moveSelected(dir) {
    if (!selection.size) return;
    const idx = tracks.map((t, i) => (selection.has(t.id) ? i : -1)).filter((i) => i >= 0);
    if (dir < 0 && idx[0] === 0) return;
    if (dir > 0 && idx[idx.length - 1] === tracks.length - 1) return;
    (dir < 0 ? idx : idx.reverse()).forEach((i) => { const t = tracks[i]; tracks[i] = tracks[i + dir]; tracks[i + dir] = t; });
    renderPlaylist(); save();
  }
  function moveCursor(dir, extend) {
    const vis = [...plList.querySelectorAll('.pl-row')].map((x) => x.dataset.id);
    if (!vis.length) return;
    let i = vis.indexOf(anchorId);
    i = i < 0 ? 0 : Math.max(0, Math.min(vis.length - 1, i + dir));
    if (!extend) selection.clear();
    selection.add(vis[i]); anchorId = vis[i]; markSelection();
    const li = plList.querySelector(`[data-id="${vis[i]}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
  }

  $('plSearch').addEventListener('input', renderPlaylist);
  $('plSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; renderPlaylist(); e.target.blur(); } if (e.key === 'Enter') { const li = plList.querySelector('.pl-row'); if (li) playTrack(tracks.find((t) => t.id === li.dataset.id)); } });
  $('plAddFiles').onclick = openFiles; $('btnEject').onclick = openFiles;
  $('plAddFolder').onclick = openFolder;
  $('plRemove').onclick = () => removeTracks(new Set(selection));
  function clearQueue() { if (!tracks.length) return; removeTracks(new Set(tracks.map((t) => t.id))); toast('Queue cleared — songs stay in your library'); }
  $('plClear').onclick = clearQueue;
  $('plSort').onclick = (e) => { e.stopPropagation(); $('sortMenu').classList.toggle('open'); };
  document.addEventListener('click', () => $('sortMenu').classList.remove('open'));
  $('sortMenu').addEventListener('click', (e) => {
    const k = e.target.dataset.sort; if (!k) return;
    const key = (t) => {
      const m = t.meta || {};
      if (k === 'title') return displayTitle(t).toLowerCase();
      if (k === 'artist') return (displayArtist(t) + ' ' + (m.album || '') + ' ' + String(parseInt(m.track) || 0).padStart(4, '0')).toLowerCase();
      if (k === 'album') return ((m.album || '~') + ' ' + String(parseInt(m.track) || 0).padStart(4, '0')).toLowerCase();
      return t.name.toLowerCase();
    };
    if (k === 'random') { for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; } }
    else if (k === 'reverse') tracks.reverse();
    else tracks.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
    renderPlaylist(); save();
  });

  // --------------------------------------------------------------- desktop shell (Electron preload: window.lucielNative)
  const NATIVE = window.lucielNative && window.lucielNative.isDesktop ? window.lucielNative : null;
  function nativePathOf(f) { try { return (NATIVE && NATIVE.pathFor && NATIVE.pathFor(f)) || null; } catch (e) { return null; } }
  /** [{path, name, rel, size, mtime, data:Uint8Array}] from the main process -> File objects that remember their disk path */
  function nativeToFiles(list) {
    return (list || []).map((e) => {
      const f = new File([e.data], e.name, { lastModified: e.mtime || Date.now() });
      f.__nativePath = e.path; f.__path = e.rel || e.name;
      if (e.rel) { try { Object.defineProperty(f, 'webkitRelativePath', { value: e.rel }); } catch (x) {} }
      return f;
    });
  }
  async function nativeOpen(paths, opts) {
    if (!NATIVE || !paths || !paths.length) return;
    toast(`Reading ${paths.length > 1 ? paths.length + ' items' : 'file'}…`);
    const files = nativeToFiles(await NATIVE.readPaths(paths));
    if (files.length) addFiles(files, opts); else toast('No audio files found', 'warn');
  }
  if (NATIVE) {
    document.body.classList.add('desktop', 'desktop-' + NATIVE.platform);
    NATIVE.onOpenPaths && NATIVE.onOpenPaths((paths) => nativeOpen(paths, { playFirst: true }));
    NATIVE.onCommand && NATIVE.onCommand((cmd) => {
      if (cmd === 'toggle') togglePlay(); else if (cmd === 'next') next(); else if (cmd === 'prev') prev(); else if (cmd === 'stop') stop(); else if (cmd === 'mini') toggleMini();
    });
    const report = () => NATIVE.setState && NATIVE.setState({ playing: !audio.paused, title: current ? displayTitle(current) : '', artist: current ? displayArtist(current) : '' });
    ['play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => audio.addEventListener(ev, report));
  }

  async function openFiles() {
    if (NATIVE && NATIVE.pickFiles) { const p = await NATIVE.pickFiles(); if (p && p.length) nativeOpen(p); return; }
    if (window.LucielFS.hasFSA()) { try { addFiles(await window.LucielFS.pickFiles()); } catch (e) { if (e.name !== 'AbortError') $('fileInput').click(); } return; }
    $('fileInput').click();
  }
  async function openFolder() {
    if (NATIVE && NATIVE.pickFolder) { const p = await NATIVE.pickFolder(); if (p && p.length) nativeOpen(p); return; }
    if (typeof window.showDirectoryPicker === 'function') { try { addFiles(await window.LucielFS.pickFolder()); } catch (e) { if (e.name !== 'AbortError') $('folderInput').click(); } return; }
    $('folderInput').click();
  }
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('folderInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  // Drag & drop files/folders from the OS
  let dragDepth = 0;
  const isExternal = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (!isExternal(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dropping'); });
  document.addEventListener('dragleave', (e) => { if (!isExternal(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  document.addEventListener('dragover', (e) => { if (isExternal(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', async (e) => {
    if (!isExternal(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
    if (packsUI && packsUI.handleDrop(e.dataTransfer, false)) return;     // a visual pack .zip
    if (NATIVE) {   // desktop: use real disk paths so the tag editor can write the files in place
      const paths = [...e.dataTransfer.files].map(nativePathOf).filter(Boolean);
      if (paths.length) { nativeOpen(paths); return; }
    }
    const items = [...(e.dataTransfer.items || [])];
    if (items.length && typeof items[0].getAsFileSystemHandle === 'function' && window.isSecureContext) {
      const hs = await Promise.all(items.map((it) => it.getAsFileSystemHandle().catch(() => null)));
      if (hs.every(Boolean)) {
        const files = [];
        for (const h of hs) {
          if (h.kind === 'file') { const f = await h.getFile(); f.__handle = h; files.push(f); }
          else await window.LucielFS.walkDir(h, h.name + '/', files);
        }
        addFiles(files); return;
      }
    }
    const entries = items.map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) { addFiles(e.dataTransfer.files); return; }
    const files = [];
    const walk = async (entry, path) => {
      if (entry.isFile) {
        await new Promise((r) => entry.file((f) => { try { Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); } catch (x) {} files.push(f); r(); }, r));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((r) => reader.readEntries(r, () => r([])));
          for (const ch of batch) await walk(ch, path + entry.name + '/');
        } while (batch.length);
      }
    };
    for (const en of entries) await walk(en, '');
    addFiles(files);
  });

  // --------------------------------------------------------------- transport bindings
  $('btnPlay').onclick = togglePlay;
  $('btnPauseC').onclick = pause;
  $('btnStop').onclick = stop;
  $('btnNext').onclick = () => next();
  $('btnPrev').onclick = prev;
  $('lcdTime').onclick = () => { S.remaining = !S.remaining; updateTime(); save(); };

  const seek = $('seek');
  seek.addEventListener('input', () => {
    seeking = true;
    const d = audio.duration || 0, p = +seek.value / 1000;
    seek.parentNode.style.setProperty('--p', p * 100);
    $('timeCur').textContent = fmt(p * d);
    lcdFlash(`SEEK TO: ${fmt2(p * d)}/${fmt2(d)} (${Math.round(p * 100)}%)`);
  });
  seek.addEventListener('change', () => {
    const d = audio.duration;
    if (isFinite(d)) audio.currentTime = (+seek.value / 1000) * d;
    seeking = false; updateTime();
  });

  function setVolume(v, flash = true) {
    v = Math.max(0, Math.min(1, v));
    S.volume = v; engine.setVolume(v);
    if (v > 0 && S.muted) setMuted(false);
    $('volume').value = Math.round(v * 100);
    $('volume').parentNode.style.setProperty('--p', v * 100);
    if (flash) lcdFlash(`VOLUME: ${Math.round(v * 100)}%`);
    save();
  }
  function setMuted(m) {
    S.muted = m; engine.setMuted(m);
    document.body.classList.toggle('is-muted', m);
    save();
  }
  function setBalance(b) {
    S.balance = b; engine.setBalance(b);
    $('balance').value = Math.round(b * 100);
    $('balance').parentNode.style.setProperty('--b', b);
    const pct = Math.round(Math.abs(b) * 100);
    lcdFlash(pct ? `BALANCE: ${pct}% ${b < 0 ? 'LEFT' : 'RIGHT'}` : 'BALANCE: CENTER');
    save();
  }
  $('volume').addEventListener('input', (e) => setVolume(+e.target.value / 100));
  $('balance').addEventListener('input', (e) => { let v = +e.target.value; if (Math.abs(v) < 6) v = 0; setBalance(v / 100); });
  $('balance').addEventListener('dblclick', () => setBalance(0));
  $('btnMute').onclick = () => setMuted(!S.muted);

  function setShuffle(on) { S.shuffle = on; $('btnShuffle').classList.toggle('on', on); save(); }
  function cycleRepeat() {
    S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
    applyRepeat(); lcdFlash(`REPEAT: ${S.repeat.toUpperCase()}`); save();
  }
  function applyRepeat() {
    const b = $('btnRepeat');
    b.classList.toggle('on', S.repeat !== 'off'); b.classList.toggle('one', S.repeat === 'one');
    b.title = `Repeat: ${S.repeat} (R)`;
  }
  $('btnShuffle').onclick = () => { setShuffle(!S.shuffle); lcdFlash(`SHUFFLE: ${S.shuffle ? 'ON' : 'OFF'}`); };
  $('btnRepeat').onclick = cycleRepeat;

  function showWin(which, on) {
    if (which === 'eq') S.showEq = on; else S.showPl = on;
    document.body.classList.toggle('hide-eq', !S.showEq);
    document.body.classList.toggle('hide-pl', !S.showPl);
    $('btnShowEq').classList.toggle('on', S.showEq);
    $('btnShowPl').classList.toggle('on', S.showPl);
    requestAnimationFrame(() => { resizeViz(); drawEqGraph(); });
    save();
  }
  $('btnShowEq').onclick = () => showWin('eq', !S.showEq);
  $('btnShowPl').onclick = () => showWin('pl', !S.showPl);
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => showWin(b.dataset.close, false); });

  // --------------------------------------------------------------- EQ UI
  const bandInputs = [];
  (function buildEq() {
    const host = $('eqSliders');
    BANDS.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'eq-band';
      const lbl = f >= 1000 ? (f / 1000) + 'K' : String(f);
      d.innerHTML = `<span class="eq-val">0</span><div class="vslider"><input type="range" min="-12" max="12" step="0.5" value="0" aria-label="${lbl} Hz"></div><span class="eq-lbl">${lbl}</span>`;
      const inp = d.querySelector('input');
      inp.addEventListener('input', () => {
        S.eq[i] = +inp.value; engine.setBand(i, S.eq[i]);
        S.preset = 'Custom'; $('eqPreset').value = 'Custom';
        syncEqLabels(); drawEqGraph(); save();
      });
      inp.addEventListener('dblclick', () => { inp.value = 0; inp.dispatchEvent(new Event('input')); });
      bandInputs.push(inp);
      host.appendChild(d);
    });
    const sel = $('eqPreset');
    [...Object.keys(PRESETS), 'Custom'].forEach((n) => { const o = document.createElement('option'); o.value = o.textContent = n; sel.appendChild(o); });
    sel.addEventListener('change', () => { if (sel.value !== 'Custom') applyPreset(sel.value); });
    $('preamp').addEventListener('input', (e) => { S.preamp = +e.target.value; engine.setPreamp(S.preamp); syncEqLabels(); drawEqGraph(); save(); });
    $('preamp').addEventListener('dblclick', (e) => { e.target.value = 0; e.target.dispatchEvent(new Event('input')); });
    $('eqOn').onclick = () => { S.eqOn = !S.eqOn; engine.setEqOn(S.eqOn); syncEqUI(); drawEqGraph(); save(); };
    $('eqAuto').onclick = () => { S.eqAuto = !S.eqAuto; syncEqUI(); save(); toast(S.eqAuto ? 'Auto EQ: presets follow the track’s genre tag' : 'Auto EQ off'); };
    $('eqReset').onclick = () => applyPreset('Flat');
  })();
  function applyPreset(name, quiet) {
    const g = PRESETS[name]; if (!g) return;
    S.eq = g.slice(); S.preset = name;
    engine.setGains(S.eq); syncEqUI(); drawEqGraph(); save();
    if (!quiet) lcdFlash(`EQ PRESET: ${name.toUpperCase()}`);
  }
  function syncEqLabels() {
    bandInputs.forEach((inp, i) => {
      const v = S.eq[i];
      inp.closest('.eq-band').querySelector('.eq-val').textContent = (v > 0 ? '+' : '') + (Math.round(v * 10) / 10);
      inp.parentNode.style.setProperty('--p', ((v + 12) / 24) * 100);
    });
    $('preampVal').textContent = (S.preamp > 0 ? '+' : '') + S.preamp;
    $('preamp').parentNode.style.setProperty('--p', ((S.preamp + 12) / 24) * 100);
  }
  function syncEqUI() {
    bandInputs.forEach((inp, i) => { inp.value = S.eq[i]; });
    $('preamp').value = S.preamp;
    $('eqPreset').value = PRESETS[S.preset] ? S.preset : 'Custom';
    $('eqOn').classList.toggle('on', S.eqOn);
    $('eqAuto').classList.toggle('on', S.eqAuto);
    $('winEq').classList.toggle('eq-off', !S.eqOn);
    syncEqLabels();
  }
  function drawEqGraph() {
    const c = $('eqGraph'); const g = c.getContext('2d');
    const classic = document.body.dataset.skin === 'classic';
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = classic ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const W = classic ? 113 : Math.round(r.width * dpr), H = classic ? 19 : Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.clearRect(0, 0, W, H);
    const N = W; const fr = new Float32Array(N);
    for (let i = 0; i < N; i++) fr[i] = 20 * Math.pow(1000, i / (N - 1));
    const resp = engine.response(fr);
    const y = (db) => H / 2 - (Math.max(-18, Math.min(18, db)) / 18) * (H / 2 - 2 * dpr);
    const accent = css('--eq-line') || '#fff', glow = css('--viz-glow') || accent;
    g.strokeStyle = css('--eq-grid') || 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Math.round(H / 2) + 0.5); g.lineTo(W, Math.round(H / 2) + 0.5); g.stroke();
    if (classic) {
      // pixel line, color by height like Winamp
      for (let i = 0; i < N; i++) {
        const yy = Math.round(y(resp[i]));
        g.fillStyle = Math.abs(resp[i]) > 8 ? css('--viz-3') : Math.abs(resp[i]) > 3 ? css('--viz-2') : css('--viz-1');
        g.fillRect(i, yy, 1, 1);
      }
      return;
    }
    BANDS.forEach((f) => { const x = (Math.log10(f / 20) / 3) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); });
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, css('--eq-fill-1') || 'rgba(255,255,255,.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.beginPath(); g.moveTo(0, H / 2);
    for (let i = 0; i < N; i++) g.lineTo(i, y(resp[i]));
    g.lineTo(W, H / 2); g.closePath(); g.fillStyle = grad; g.fill();
    g.save(); g.shadowColor = glow; g.shadowBlur = 8 * dpr; g.strokeStyle = accent; g.lineWidth = 2 * dpr;
    g.beginPath(); for (let i = 0; i < N; i++) i ? g.lineTo(i, y(resp[i])) : g.moveTo(0, y(resp[0])); g.stroke(); g.restore();
  }

  // --------------------------------------------------------------- Visualizer
  const vizBig = new window.AeroViz.Visualizer($('viz'), 'aero');
  const vizMini = new window.AeroViz.Visualizer($('miniViz'), 'classic');
  function vizColors() {
    const c = { v1: css('--viz-1'), v2: css('--viz-2'), v3: css('--viz-3'), peak: css('--viz-peak'), glow: css('--viz-glow'), scope: css('--viz-scope'), grid: css('--viz-grid') };
    const cm = { v1: css('--cviz-1') || c.v1, v2: css('--cviz-2') || c.v2, v3: css('--cviz-3') || c.v3, peak: css('--cviz-peak') || c.peak, glow: c.glow, scope: c.scope, grid: css('--cviz-grid') || c.grid };
    vizBig.colors = c; vizMini.colors = cm;
  }
  function setVizMode(m) {
    S.vizMode = m; vizBig.mode = vizMini.mode = m;
    $('vizLabel').textContent = { spectrum: 'SPECTRUM', scope: 'OSCILLOSCOPE', both: 'SPECTRUM + SCOPE', off: 'OFF' }[m];
    $('vizWrap').classList.remove('label-flash'); void $('vizWrap').offsetWidth; $('vizWrap').classList.add('label-flash');
    save();
  }
  function cycleViz() { const M = window.AeroViz.MODES; setVizMode(M[(M.indexOf(S.vizMode) + 1) % M.length]); }
  $('vizWrap').onclick = cycleViz; $('miniViz').onclick = cycleViz;
  function resizeViz() { vizBig.resize(); }
  new ResizeObserver(() => { resizeViz(); drawEqGraph(); }).observe($('vizWrap'));
  window.addEventListener('resize', () => { resizeViz(); drawEqGraph(); });

  let last = performance.now(), lastBeat = -1, analyserBound = false;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!document.hidden) {
      if (engine.analyser && !analyserBound) { vizBig.setAnalyser(engine.analyser, engine.anL, engine.anR); vizMini.setAnalyser(engine.analyser, engine.anL, engine.anR); analyserBound = true; }
      const active = !!engine.ctx && !audio.paused;
      const classic = document.body.dataset.skin === 'classic';
      const e = classic ? vizMini.draw(active, dt) : vizBig.draw(active, dt);
      // energy for Lucielle / scenes
      let energy = 0, bass = 0, vocal = 0, high = 0;
      if (engine.analyser && active) {
        if (!frame.buf) frame.buf = new Uint8Array(engine.analyser.frequencyBinCount);
        const f = frame.buf; engine.analyser.getByteFrequencyData(f);
        const hz = engine.ctx.sampleRate / engine.analyser.fftSize;
        const bEnd = Math.max(2, Math.round(160 / hz)), eEnd = Math.round(8000 / hz);
        let a = 0; for (let i = 1; i < bEnd; i++) a += f[i]; bass = a / ((bEnd - 1) * 255);
        let b = 0; for (let i = 1; i < eEnd; i++) b += f[i]; energy = Math.min(1, (b / ((eEnd - 1) * 255)) * 1.8);
        // speech band (300 Hz–3.4 kHz) and air (5–10 kHz) for the vocals event
        const v0 = Math.round(300 / hz), v1 = Math.round(3400 / hz), h0 = Math.round(5000 / hz), h1 = Math.min(f.length - 1, Math.round(10000 / hz));
        let v = 0; for (let i = v0; i < v1; i++) v += f[i]; vocal = v / ((v1 - v0) * 255);
        let h = 0; for (let i = h0; i < h1; i++) h += f[i]; high = h / (Math.max(1, h1 - h0) * 255);
        if (tracker.feed(bass, audio.currentTime) && !current.bpmInfo) renderBpm();
      }
      if (current && !current.bpmInfo && tracker.bpm && $('lcdBpm').textContent === '---') { $('lcdBpm').textContent = Math.round(tracker.bpm); }
      luciel.tick({ playing: active, bpm: tracker.bpm, beatPos: tracker.beatAt(audio.currentTime), time: audio.currentTime, energy, bass, vocal, high, hasTracks: tracks.length > 0, pointerX, pointerY });
      if (now - (frame.lastInfo || 0) > 1000) { frame.lastInfo = now; renderMasInfo(); }
      const beat = active ? Math.round(Math.min(1, e * 1.25) * 20) / 20 : 0;
      if (beat !== lastBeat) { document.documentElement.style.setProperty('--beat', beat); lastBeat = beat; }
    }
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------- Themes
  // ---- scene colour themes (pack "colors"): the scene's palette base + accent / background overrides while it shows
  const SCOL = { key: null, vars: null };
  function hexA(hex, a) {
    let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function sceneColorVars(c) {
    const v = {};
    if (c.accent) Object.assign(v, { '--accent': c.accent, '--eq-line': c.accent, '--viz-1': c.accent, '--c-led': c.accent, '--cviz-1': c.accent, '--vol-1': c.accent, '--orb-2': c.accent,
      '--aurora-1': hexA(c.accent, 0.38), '--eq-fill-1': hexA(c.accent, 0.3), '--row-sel': hexA(c.accent, 0.18), '--c-pl-sel': hexA(c.accent, 0.45),
      '--row-play': `linear-gradient(90deg, ${hexA(c.accent, 0.3)}, ${hexA(c.accent2 || c.accent, 0.08)})` });
    if (c.accent2) Object.assign(v, { '--accent-2': c.accent2, '--viz-2': c.accent2, '--cviz-2': c.accent2, '--vol-2': c.accent2, '--c-title-2': c.accent2, '--aurora-2': hexA(c.accent2, 0.25) });
    if (c.glow) Object.assign(v, { '--accent-glow': hexA(c.glow, 0.55), '--viz-glow': hexA(c.glow, 0.95), '--lcd-glow': hexA(c.glow, 0.55) });
    if (c.lcd) Object.assign(v, { '--lcd-fg': c.lcd, '--c-pl-fg': c.lcd });
    if (c.text) v['--text'] = c.text;
    if (c.bg) Object.assign(v, { '--bg-1': c.bg[0], '--bg-2': c.bg[1], '--bg-3': c.bg[2] });
    if (c.frame) Object.assign(v, { '--c-frame-1': c.frame[0], '--c-frame-2': c.frame[1], '--c-frame-3': c.frame[2] });
    return v;
  }
  function applySceneColors(sc) {
    const c = S.sceneColors !== false && S.bubbles && sc && sc.colors ? sc.colors : null;
    const key = c ? JSON.stringify(c) : '';
    if (key === SCOL.key) return;
    const b = document.body;
    for (const k of Object.keys(SCOL.vars || {})) b.style.removeProperty(k);
    SCOL.key = key; SCOL.vars = c ? sceneColorVars(c) : null;
    b.dataset.palette = (c && c.base) || S.palette;
    b.classList.toggle('scene-colors', !!c);
    for (const [k, val] of Object.entries(SCOL.vars || {})) b.style.setProperty(k, val);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = css('--bg-2') || '#222';
    vizColors(); roomCache = 0;
    if (vizBig.peaks) { vizBig.peaks = []; vizBig.levels = []; vizMini.peaks = []; vizMini.levels = []; }
    requestAnimationFrame(() => { try { drawEqGraph(); renderMarquee(true); } catch (e) {} });
    miniPush();
  }
  function applyTheme(palette, skin, announce) {
    if (!PALETTES.find((p) => p.id === palette)) palette = 'aero';
    if (!SKINS.find((s) => s.id === skin)) skin = 'aero';
    S.palette = palette; S.skin = skin;
    document.body.dataset.palette = palette; document.body.dataset.skin = skin; SCOL.key = null;
    document.body.classList.toggle('skin-aero', skin === 'aero'); document.body.classList.toggle('skin-classic', skin === 'classic');
    document.querySelectorAll('.tm-card').forEach((c) => c.classList.toggle('active', c.dataset.palette === palette && c.dataset.skin === skin));
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = css('--bg-2') || '#222';
    vizColors();
    luciel.setTheme(palette, skin);
    applySceneColors(luciel.scene);
    if (current) refreshCover();
    vizBig.peaks = []; vizBig.levels = []; vizMini.peaks = []; vizMini.levels = [];
    roomCache = 0;
    requestAnimationFrame(() => { resizeViz(); drawEqGraph(); renderMarquee(true); });
    if (announce) toast(`${PALETTES.find((p) => p.id === palette).name} · ${skin === 'aero' ? 'Aero' : 'Classic'}`);
    $('miniHost').dataset.skin = skin;
    miniPush();
    save();
  }
  (function buildThemeMenu() {
    document.querySelectorAll('[data-skin-grid]').forEach((grid) => {
      const skin = grid.dataset.skinGrid;
      PALETTES.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'tm-card'; b.dataset.palette = p.id; b.dataset.skin = skin;
        b.innerHTML = `<span class="tm-prev tm-prev-${skin}"><span class="pv-bg"></span><span class="pv-win"><span class="pv-lcd"></span><span class="pv-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="pv-orb"></span></span>${skin === 'classic' ? '<span class="pv-win2"></span><span class="pv-win3"></span>' : ''}<span class="pv-bub b1"></span><span class="pv-bub b2"></span></span><span class="tm-name">${p.name}</span><span class="tm-desc">${p.desc}</span>`;
        b.onclick = () => applyTheme(p.id, skin, true);
        grid.appendChild(b);
      });
    });
  })();
  function cycleTheme() {
    const i = THEMES.findIndex((t) => t.palette === S.palette && t.skin === S.skin);
    const t = THEMES[(i + 1) % THEMES.length]; applyTheme(t.palette, t.skin, true);
  }
  function openOverlay(id) { const o = $(id); o.hidden = false; requestAnimationFrame(() => o.classList.add('open')); }
  function closeOverlays() { document.querySelectorAll('.overlay').forEach((o) => { o.classList.remove('open'); o.hidden = true; }); }
  $('btnTheme').onclick = () => openOverlay('themeOverlay');
  $('btnKeys').onclick = () => openOverlay('keysOverlay');
  document.querySelectorAll('.overlay:not(.edit-overlay):not(.ask-overlay)').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-dismiss]')) closeOverlays(); }));
  $('optBubbles').addEventListener('change', (e) => { S.bubbles = e.target.checked; document.body.classList.toggle('no-anim', !S.bubbles); applyMascotOpts(); save(); });
  $('optRemember').addEventListener('change', (e) => {
    S.remember = e.target.checked; save();
    if (S.remember) tracks.forEach(persist); else DBTracks.clear().catch(() => {});
    toast(S.remember ? 'Tracks will be remembered in this browser' : 'Tracks will be forgotten on reload');
  });

  // Floating bubbles
  (function bubbles() {
    const host = $('bubbles');
    for (let i = 0; i < 22; i++) {
      const b = document.createElement('i');
      const s = 14 + Math.random() * 90;
      b.style.cssText = `--s:${s.toFixed(0)}px;--x:${(Math.random() * 100).toFixed(1)}%;--d:${(14 + Math.random() * 22).toFixed(1)}s;--delay:${(-Math.random() * 30).toFixed(1)}s;--drift:${(Math.random() * 80 - 40).toFixed(0)}px`;
      host.appendChild(b);
    }
  })();

  // --------------------------------------------------------------- Lucielle UI
  let pointerX = 0, pointerY = 0;
  document.addEventListener('pointermove', (e) => { pointerX = e.clientX / innerWidth - 0.5; pointerY = e.clientY / innerHeight - 0.5; }, { passive: true });
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, () => luciel.input(), { passive: true, capture: true }));
  [$('stage'), $('pxStage'), $('peekPl'), $('peekPx'), $('peekEq')].forEach((el) => el && el.addEventListener('click', () => luciel.clickReact()));
  $('btnFav').onclick = toggleFavorite;
  const sceneIds = () => ['auto', ...window.Luciel.Scenes.list.map((x) => x.id)];
  function setScene(id, quiet) { S.scene = id; luciel.setManual(id); markSceneGrid(); save(); if (!quiet) toast(id === 'auto' ? 'Scene: auto (genre / tempo / mood)' : `Scene: ${window.Luciel.Scenes.byId(id).name}`); }
  function stepScene(d) { const ids = sceneIds(); setScene(ids[(ids.indexOf(S.scene) + d + ids.length) % ids.length]); }
  ['scPrev', 'scPrevA'].forEach((id) => { $(id).onclick = (e) => { e.stopPropagation(); stepScene(-1); }; });
  ['scNext', 'scNextA'].forEach((id) => { $(id).onclick = (e) => { e.stopPropagation(); stepScene(1); }; });
  function renderSceneGrid() {
    const g = $('sceneGrid');
    const items = [{ id: 'auto', name: 'Auto', thumb: 'icons/icon-192.png', kind: 'auto' }, ...window.Luciel.Scenes.list];
    g.innerHTML = items.map((x) => `<button class="sc-card${x.pack ? ' from-pack' : ''}" data-scene="${esc(x.id)}" title="${esc(x.name)}${x.packName ? ' — pack: ' + esc(x.packName) : ''}${x.genres && x.genres.length ? ' — ' + esc(x.genres.slice(0, 4).join(', ')) : ''}"><img src="${esc(x.thumb)}" alt="" loading="lazy"><span>${esc(x.name)}</span>${x.pack ? '<i class="pk">PACK</i>' : x.kind === 'pixel' ? '<i>PIXEL</i>' : x.kind === 'layered' ? '<i>LIVE</i>' : x.kind === 'video' ? `<i>${x.still ? 'DITHER' : 'VIDEO'}</i>` : ''}</button>`).join('');
    markSceneGrid();
  }
  renderSceneGrid();
  $('sceneGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) setScene(b.dataset.scene); });
  function markSceneGrid() { document.querySelectorAll('.sc-card').forEach((b) => b.classList.toggle('active', b.dataset.scene === S.scene)); }

  // --------------------------------------------------------------- Visual packs (js/packs.js + js/packs-ui.js, format in PACKS.md)
  const packsUI = window.LucielPackUI.create({
    toast, esc, luciel, openOverlay: (id) => openOverlay(id), closeOverlays: () => closeOverlays(),
    setScene: (id) => setScene(id),
    scenesChanged: () => { if (S.scene !== 'auto' && !window.Luciel.Scenes.byId(S.scene)) { S.scene = 'auto'; save(); } renderSceneGrid(); },
  });

  // --------------------------------------------------------------- Mini player / floater (js/mini.js)
  // Audio always stays here; the mini player is a remote. Desktop: a frameless always-on-top window (IPC).
  // Browser: an in-page draggable overlay that can pop out into Document Picture-in-Picture.
  const MINI = { overlay: null, pip: null, pipWin: null, native: false, timer: 0, thumbs: new Map() };
  const miniIsOpen = () => !!(MINI.overlay || MINI.pip || MINI.native);
  function miniState() {
    const t = current, sc = luciel.scene, d = audio.duration;
    let bp = 0; try { bp = tracker.bpm ? tracker.beatAt(audio.currentTime) || 0 : 0; } catch (e) {}
    return { title: t ? displayTitle(t) : '', artist: t ? displayArtist(t) : '', hasCover: !!(t && t.coverUrl), cover: t && t.coverUrl ? t.coverUrl : fallbackCover(t),
      sceneThumb: sc ? sc.thumb : '', scenePx: sc ? sc.px : '', sceneName: sc ? sc.name : '',
      playing: !audio.paused && !!t, time: audio.currentTime || 0, duration: isFinite(d) ? d : 0, volume: S.volume, muted: S.muted,
      palette: document.body.dataset.palette || S.palette, colorVars: SCOL.vars, skin: S.skin, bpm: tracker.bpm || 0, beatPos: bp, hasTracks: tracks.length > 0 };
  }
  /** blob: covers live in this page; the desktop floater gets a small data: URL thumbnail instead */
  function coverThumb(url) {
    if (MINI.thumbs.has(url)) return MINI.thumbs.get(url);
    MINI.thumbs.set(url, null);
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'), k = Math.min(1, 320 / Math.max(im.naturalWidth, im.naturalHeight)); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); try { MINI.thumbs.set(url, c.toDataURL('image/jpeg', 0.86)); } catch (e) {} if (MINI.thumbs.size > 40) MINI.thumbs.delete(MINI.thumbs.keys().next().value); miniPush(); };
    im.src = url; return null;
  }
  function miniPush() {
    if (!miniIsOpen()) return;
    const s = miniState();
    if (MINI.overlay) MINI.overlay.update(s);
    if (MINI.pip) MINI.pip.update(s);
    if (MINI.native && NATIVE && NATIVE.mini) {
      const n = Object.assign({}, s);
      if (n.hasCover && /^blob:/.test(n.cover)) { const d = coverThumb(n.cover); if (d) n.cover = d; else { n.cover = fallbackCover(current); n.hasCover = false; } }
      NATIVE.mini.state(n);
    }
  }
  function miniTimer() { clearInterval(MINI.timer); MINI.timer = miniIsOpen() ? setInterval(miniPush, 500) : 0; $('btnMini').classList.toggle('on', miniIsOpen()); }
  ['play', 'pause', 'ended', 'loadedmetadata', 'seeked', 'volumechange', 'emptied'].forEach((ev) => audio.addEventListener(ev, () => miniPush()));
  function miniCmd(c, a) {
    switch (c) {
      case 'toggle': if (!tracks.length) { if (NATIVE && NATIVE.mini) NATIVE.mini.showMain(); openFiles(); } else togglePlay(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'seek': if (current && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, +a || 0)) * audio.duration; break;
      case 'seekBy': if (current) audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + (+a || 0))); break;
      case 'volume': setVolume(+a, false); break;
      case 'mute': setMuted(!S.muted); break;
      case 'pin': popOutMini(); break;                       // browser overlay: pop out into an always-on-top PiP window
      case 'expand': closeMini(); window.focus(); break;
      case 'close': closeMini(); break;
    }
    setTimeout(miniPush, 40);
  }
  function placeMiniHost() {
    const h = $('miniHost'), b = S.miniBox;
    h.dataset.skin = S.skin;
    if (b && b.w && b.h) {
      const w = Math.min(b.w, innerWidth - 8), hh = Math.min(b.h, innerHeight - 8);
      Object.assign(h.style, { width: w + 'px', height: hh + 'px', left: Math.max(0, Math.min(b.x, innerWidth - w)) + 'px', top: Math.max(0, Math.min(b.y, innerHeight - hh)) + 'px', right: 'auto', bottom: 'auto' });
    } else Object.assign(h.style, { width: '340px', height: S.miniLarge ? '330px' : '120px', left: '', top: '', right: '', bottom: '' });
  }
  const saveMiniBox = debounce(() => { const h = $('miniHost'); if (h.hidden) return; const r = h.getBoundingClientRect(); S.miniBox = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; save(); }, 300);
  new ResizeObserver(saveMiniBox).observe($('miniHost'));
  function openMiniOverlay() {
    const h = $('miniHost');
    h.hidden = false; placeMiniHost();
    if (!MINI.overlay) MINI.overlay = window.LucielMini.mount(h, { kind: 'overlay', send: miniCmd, dragHost: h, canPop: 'documentPictureInPicture' in window, state: miniState(),
      onMoved: saveMiniBox,
      onMode: (m) => { S.miniLarge = m === 'large'; const r = h.getBoundingClientRect(); const nh = m === 'large' ? Math.max(300, r.width * 0.95) : 120; h.style.height = Math.min(nh, innerHeight - 8) + 'px'; if (r.top + nh > innerHeight) h.style.top = Math.max(0, innerHeight - nh - 8) + 'px'; saveMiniBox(); } });
    miniTimer(); miniPush();
  }
  async function popOutMini() {
    if (!('documentPictureInPicture' in window)) { toast('Pop-out needs Chrome or Edge 116+ — the mini player stays in the page', 'warn'); return; }
    if (MINI.pip) { MINI.pipWin.focus(); return; }
    let w;
    try { w = await window.documentPictureInPicture.requestWindow({ width: 340, height: S.miniLarge ? 330 : 120 }); } catch (e) { toast('Couldn’t open the pop-out window: ' + e.message, 'warn'); return; }
    const d = w.document; d.documentElement.className = 'mini-pip'; d.title = 'Luciel Mini';
    ['css/palettes.css', 'css/mini.css'].forEach((href) => { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(href, location.href).href; d.head.appendChild(l); });
    MINI.pipWin = w;
    MINI.pip = window.LucielMini.mount(d.body, { kind: 'pip', base: new URL('.', location.href).href, send: miniCmd, state: miniState(),
      onTheme: (p, sk) => { d.body.dataset.palette = p; d.body.dataset.skin = sk; d.documentElement.style.background = getComputedStyle(document.body).getPropertyValue('--bg-2'); },
      onMode: (m) => { S.miniLarge = m === 'large'; try { w.resizeTo(w.outerWidth, m === 'large' ? 360 : 150); } catch (e) {} save(); } });
    if (MINI.overlay) { MINI.overlay.destroy(); MINI.overlay = null; } $('miniHost').hidden = true;
    w.addEventListener('pagehide', () => { if (MINI.pip) MINI.pip.destroy(); MINI.pip = null; MINI.pipWin = null; if (!MINI.closing) openMiniOverlay(); MINI.closing = false; miniTimer(); });
    miniTimer(); miniPush();
  }
  function closeMini() {
    if (MINI.overlay) { MINI.overlay.destroy(); MINI.overlay = null; $('miniHost').hidden = true; }
    if (MINI.pipWin) { MINI.closing = true; MINI.pipWin.close(); }
    if (MINI.native && NATIVE && NATIVE.mini) NATIVE.mini.close();
    miniTimer();
  }
  function toggleMini() {
    if (NATIVE && NATIVE.mini) { NATIVE.mini.toggle({ hideMain: !!S.miniHideMain }); return; }
    if (MINI.overlay || MINI.pip) closeMini(); else openMiniOverlay();
  }
  if (NATIVE && NATIVE.mini) {
    NATIVE.mini.onOpen((open) => { MINI.native = !!open; miniTimer(); if (open) miniPush(); });
    NATIVE.mini.onCmd((m) => m && miniCmd(m.cmd, m.arg));
    document.body.classList.add('has-floater');
  }
  $('btnMini').onclick = toggleMini;
  $('optMiniHide').checked = !!S.miniHideMain;
  $('optMiniHide').addEventListener('change', (e) => { S.miniHideMain = e.target.checked; save(); });
  function applyMascotOpts() {
    document.body.classList.toggle('no-mascot', !S.mascot);
    document.body.dataset.msize = S.mascotSize;
    document.body.classList.toggle('dither-fx', !!S.ditherFx);
    luciel.setOptions({ enabled: S.mascot, size: S.mascotSize, doze: S.doze, strict: S.strict, sceneOn: S.bubbles, ditherFx: !!S.ditherFx });
  }
  $('optMascot').addEventListener('change', (e) => { S.mascot = e.target.checked; applyMascotOpts(); save(); });
  $('optSize').addEventListener('change', (e) => { S.mascotSize = e.target.value; applyMascotOpts(); save(); });
  $('optDoze').addEventListener('change', (e) => { S.doze = e.target.checked; applyMascotOpts(); save(); });
  $('optSceneColors').addEventListener('change', (e) => { S.sceneColors = e.target.checked; SCOL.key = null; applySceneColors(luciel.scene); save(); toast(S.sceneColors ? 'Scene colours on — pack scenes recolour the player' : 'Scene colours off'); });
  $('optDither').addEventListener('change', (e) => { S.ditherFx = e.target.checked; applyMascotOpts(); save(); toast(S.ditherFx ? 'Dither FX on — ordered Bayer dither over the scene' : 'Dither FX off'); });
  $('optStrict').addEventListener('change', (e) => { S.strict = e.target.checked; applyMascotOpts(); save(); toast(S.strict ? 'Strict: dances only on events (played once), no idle timers' : 'Tempo-driven dancing enabled'); });
  // sparkle burst on button press
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.tbtn, .tog, .pbtn, .ibtn, .fav, .tb-btn, .st-btn'); if (!b) return;
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 7; i++) {
      const sp = document.createElement('i'); sp.className = 'spark-fx';
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5, d = 18 + Math.random() * 22 + r.width * 0.3;
      sp.style.cssText = `left:${cx}px;top:${cy}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${0.6 + Math.random() * 0.7}`;
      document.body.appendChild(sp); setTimeout(() => sp.remove(), 700);
    }
  });

  // --------------------------------------------------------------- Library + tag editor
  const bpmOf = (t) => (t.bpmInfo && t.bpmInfo.bpm) || (t.meta && t.meta.bpm) || 0;
  const coverFor = (t, thumb) => (t && t.coverUrl) || (thumb ? fallbackCover(t).replace('art/', 'art/thumb/') : fallbackCover(t));
  const libApi = {
    esc, fmt, S, save, toast,
    all: () => [...lib.values()], queue: () => tracks, current: () => current, byId: (id) => lib.get(id),
    title: displayTitle, artist: displayArtist, bpm: bpmOf, cover: coverFor,
    genreArt: (g) => window.Luciel.Scenes.coverFor({ genre: g }, S.palette).replace('art/', 'art/thumb/'),
    isFav: (t) => S.favorites.includes(t.id),
    setFav: (list, on) => { list.forEach((t) => { const i = S.favorites.indexOf(t.id); if (on && i < 0) S.favorites.push(t.id); if (!on && i >= 0) S.favorites.splice(i, 1); updateRow(t); }); if (on) luciel.favorite(); if (current) $('btnFav').classList.toggle('on', S.favorites.includes(current.id)); save(); },
    playList, enqueue, clearQueue, removeFromLibrary,
    queueRemove: (ids) => removeTracks(ids),
    setQueue: (ids) => { tracks = ids.map((id) => lib.get(id)).filter(Boolean); renderPlaylist(); save(); },
    edit: (list) => editTracks(list), openFiles, openFolder,
  };
  const library = window.LucielLibrary.create(libApi);
  const editor = window.LucielEditor.create(Object.assign({}, libApi, {
    persist: (t) => persist(t),
    /** apply an edit: new file bytes (tags written in-file) or library overrides, plus rename */
    async commit(t, { blob, name, fields, cover, written }) {
      const keepBpm = t.bpmInfo;
      if (written) {
        t.file = new File([blob], name, { type: blob.type || t.type });
        t.size = t.file.size;
        const m = await window.AeroMeta.read(t.file);
        if (t.meta && t.meta.unplayable) m.unplayable = true;
        t.meta = m; t.metaSource = 'file';
      } else {
        const m = Object.assign({}, t.meta || {});
        for (const k in fields) m[k] = k === 'bpm' ? (parseFloat(fields[k]) || 0) : fields[k];
        if (cover !== undefined) m.picture = cover ? { mime: cover.mime, data: cover.data } : null;
        t.meta = m;
        if (Object.keys(fields).length || cover !== undefined) t.metaSource = 'library';
        if (name !== t.name) t.file = new File([t.file], name, { type: t.file.type });
      }
      t.name = name; t.ext = extOf(name);
      if (t.path) t.path = t.path.replace(/[^/]*$/, name);
      // a typed BPM becomes the beat grid's tempo (tag wins); otherwise keep the analysis
      if (fields.bpm && parseFloat(fields.bpm) > 0) { t.bpmInfo = Object.assign({}, keepBpm || { t0: 0, confidence: 1 }, { bpm: parseFloat(fields.bpm), period: 60 / parseFloat(fields.bpm), source: 'tag' }); }
      else if (keepBpm) t.bpmInfo = keepBpm;
      if (t.meta) t.meta.bpmInfo = t.bpmInfo;
      if (t.coverUrl) URL.revokeObjectURL(t.coverUrl);
      t.coverUrl = t.meta && t.meta.picture ? URL.createObjectURL(new Blob([t.meta.picture.data], { type: t.meta.picture.mime })) : null;
      persist(t); updateRow(t);
      if (t === current) { updateNowPlaying(); if (t.bpmInfo) tracker.setGrid(t.bpmInfo.bpm, t.bpmInfo.t0, t.bpmInfo.source, t.bpmInfo.confidence); }
      library.refresh();
    },
  }));
  function editTracks(list) { list = (list || []).filter(Boolean); if (!list.length) { toast('Nothing selected to edit', 'warn'); return; } editor.open(list); }
  $('btnLibrary').onclick = () => library.toggle();
  $('plLib').onclick = () => library.toggle();
  $('plEdit').onclick = () => { const sel = tracks.filter((t) => selection.has(t.id)); editTracks(sel.length ? sel : [current]); };

  // --------------------------------------------------------------- Keyboard
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = (tag === 'input' && /^(text|search)$/.test(e.target.type)) || tag === 'select' || tag === 'textarea';
    if (e.key === 'Escape') { if (!$('editOverlay').hidden) editor.close(); else if (!$('askOverlay').hidden) return; else if (library.isOpen() && !document.querySelector('.overlay.open')) library.close(); closeOverlays(); return; }
    if (e.altKey && e.key.toLowerCase() === 'l') { e.preventDefault(); library.toggle(); return; }
    if (typing) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'a' && document.activeElement === plList) { e.preventDefault(); tracks.forEach((t) => selection.add(t.id)); markSelection(); }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); const sel = tracks.filter((t) => selection.has(t.id)); editTracks(sel.length ? sel : [current]); }
      return;
    }
    const k = e.key;
    const onRange = tag === 'input' && e.target.type === 'range';
    let handled = true;
    switch (k) {
      case ' ': togglePlay(); break;
      case 'x': case 'X': play(); break;
      case 'c': case 'C': pause(); break;
      case 'v': stop(); break;
      case 'V': cycleViz(); break;
      case 'z': case 'Z': prev(); break;
      case 'b': case 'B': next(); break;
      case 'ArrowLeft': if (onRange && !e.shiftKey) { handled = false; break; } if (e.shiftKey) prev(); else if (current) audio.currentTime = Math.max(0, audio.currentTime - 5); break;
      case 'ArrowRight': if (onRange && !e.shiftKey) { handled = false; break; } if (e.shiftKey) next(); else if (current) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
      case 'ArrowUp': if (onRange) { handled = false; break; } if (e.altKey) moveSelected(-1); else if (document.activeElement === plList) moveCursor(-1, e.shiftKey); else setVolume(S.volume + 0.05); break;
      case 'ArrowDown': if (onRange) { handled = false; break; } if (e.altKey) moveSelected(1); else if (document.activeElement === plList) moveCursor(1, e.shiftKey); else setVolume(S.volume - 0.05); break;
      case 'm': case 'M': setMuted(!S.muted); lcdFlash(S.muted ? 'MUTED' : `VOLUME: ${Math.round(S.volume * 100)}%`); break;
      case 's': case 'S': $('btnShuffle').click(); break;
      case 'r': case 'R': cycleRepeat(); break;
      case 'e': case 'E': showWin('eq', !S.showEq); break;
      case 'p': case 'P': showWin('pl', !S.showPl); break;
      case 't': cycleTheme(); break;
      case 'T': openOverlay('themeOverlay'); break;
      case 'k': case 'K': applyTheme(S.palette, S.skin === 'aero' ? 'classic' : 'aero', true); break;
      case 'l': openFiles(); break;
      case 'L': openFolder(); break;
      case 'g': case 'G': library.toggle(); break;
      case 'F2': { const sel = tracks.filter((t) => selection.has(t.id)); editTracks(sel.length ? sel : [current]); break; }
      case '/': $('plSearch').focus(); break;
      case 'f': case 'F': toggleFavorite(); break;
      case 'n': stepScene(1); break;
      case 'N': stepScene(-1); break;
      case '?': openOverlay('keysOverlay'); break;
      case 'o': case 'O': toggleMini(); break;
      case 'Enter': { const t = tracks.find((x) => selection.has(x.id)); if (t) playTrack(t); else handled = false; break; }
      case 'Delete': case 'Backspace': removeTracks(new Set(selection)); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // --------------------------------------------------------------- Format support chips
  (function formats() {
    const list = [['MP3', 'audio/mpeg'], ['WAV', 'audio/wav'], ['FLAC', 'audio/flac'], ['OGG', 'audio/ogg; codecs=vorbis'], ['OPUS', 'audio/ogg; codecs=opus'], ['M4A/AAC', 'audio/mp4; codecs="mp4a.40.2"'], ['ALAC', 'audio/mp4; codecs="alac"'], ['WEBM', 'audio/webm; codecs=opus'], ['AIFF', 'audio/aiff']];
    $('fmtSupport').innerHTML = list.map(([n, m]) => `<span class="chip ${audio.canPlayType(m) ? 'ok' : 'no'}" title="${m}: ${audio.canPlayType(m) || 'not supported'}">${n}</span>`).join('');
  })();

  // --------------------------------------------------------------- Init
  function init() {
    applyTheme(S.palette, S.skin);
    document.body.classList.toggle('no-anim', !S.bubbles);
    $('optBubbles').checked = S.bubbles; $('optRemember').checked = S.remember;
    $('optMascot').checked = S.mascot; $('optSize').value = S.mascotSize; $('optDoze').checked = S.doze; $('optStrict').checked = S.strict; $('optDither').checked = !!S.ditherFx; $('optSceneColors').checked = S.sceneColors !== false;
    applyMascotOpts(); luciel.setManual(S.scene || 'auto'); markSceneGrid();
    engine.volume = S.volume; engine.muted = S.muted; engine.balance = S.balance;
    engine.gains = S.eq.slice(); engine.preampDb = S.preamp; engine.eqOn = S.eqOn;
    setVolume(S.volume, false); setMuted(S.muted);
    $('balance').value = Math.round(S.balance * 100); $('balance').parentNode.style.setProperty('--b', S.balance);
    setShuffle(S.shuffle); applyRepeat();
    showWin('eq', S.showEq); showWin('pl', S.showPl);
    syncEqUI(); setVizMode(S.vizMode); $('vizWrap').classList.remove('label-flash');
    setState('stop'); updateNowPlaying(); renderPlaylist();
    restore();
    packsUI.load().then(() => markSceneGrid());
    requestAnimationFrame(frame);
    document.fonts && document.fonts.ready.then(() => { roomCache = 0; drawEqGraph(); resizeViz(); renderMarquee(true); });
  }

  // test/debug hook
  window.Luciel.app = window.AeroAmp = { packs: packsUI, mini: { toggle: toggleMini, open: openMiniOverlay, close: closeMini, popOut: popOutMini, state: miniState, cmd: miniCmd, get overlay() { return MINI.overlay; }, get pip() { return MINI.pip; }, get isOpen() { return miniIsOpen(); } }, nativeOpen, library, editor, lib, editTracks, playList, enqueue, removeFromLibrary, luciel, tracker, setScene, toggleFavorite, addFiles, applyTheme, applyPreset, get settings() { return S; }, get tracks() { return tracks; }, get current() { return current; }, engine, playTrack, next, prev, THEMES, setVizMode };
  init();
})();
