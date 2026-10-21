/* Luciel — genre-pack features that live in the app (PACKS.md › "Genre packs"): they switch on when a pack declares
 * the data (character.instruments, variants.day/night, character.rareOutfits) and stay out of the way otherwise.
 *   InstrumentPicker  live band energies -> bass | drums | vocals | guitar, with hysteresis (no flapping)
 *   dayPart           Auto / Day / Night -> 'day' | 'night' (local clock)
 *   RareStore + roll  1-in-20 per track (pack "chance"), play-milestone unlocks, first-sighting sparkle, collection
 *   Weather           Open-Meteo (no key): city geocoding or coarse location, 30-min cache, silent failure
 * Pure logic, no DOM: unit-tested in node (aero-player-test/genres-unit.js) and used by js/luciel.js + js/app.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LucielGenres = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------ Alt Rock: which instrument is she playing?
  const INSTRUMENTS = ['bass', 'drums', 'vocals', 'guitar'];
  /**
   * bands per frame (0..1): bass (20–150 Hz), kick (low-end onset strength), vocal (300 Hz–3.4 kHz),
   * guitar (guitar-heavy mids: 150–300 Hz + 3.4–6 kHz body/bite), energy (overall). Each band is compared with its
   * own slow average, so the instrument that *stands out* wins; chorus lifts (energy well above its average) favour
   * guitar. Hysteresis: a challenger must beat the current pick by `margin` for `confirm` s, and a pick holds for at
   * least `hold` s.
   */
  function createInstrumentPicker(o) {
    o = Object.assign({ hold: 2.5, confirm: 0.6, margin: 1.18, fast: 0.35, slow: 40, warm: 1 }, o || {});
    // typical level of each band in a balanced mix; the track's own long average is blended in so a bass-heavy master
    // does not show bass forever (dominance = "this band is louder than usual for this song / for music")
    const REF = { bass: 0.35, drums: 0.3, vocals: 0.3, guitar: 0.3 };
    const s = { bass: 0, drums: 0, vocals: 0, guitar: 0 }, avg = Object.assign({}, REF);
    const st = { cur: null, since: 0, cand: null, candFor: 0, t: 0, t0: 0, eAvg: 0.3, eFast: 0.3, prevBass: null, hit: 0, log: [] };
    function raw(b, dt) {
      const bass = b.bass || 0, energy = b.energy || 0;
      if (st.prevBass == null) st.prevBass = bass;
      // kick / transient: a sharp rise of the low end (or the beat flag), held ~0.25 s so a hit counts like a sustained band
      const onset = b.kick != null ? b.kick : Math.max(0, bass - st.prevBass - 0.08) * 4 + (b.beat ? 0.25 : 0);
      st.prevBass = bass;
      st.hit = Math.max(clamp(onset, 0, 1.5), st.hit * Math.exp(-dt / 0.25));
      const chorus = Math.max(0, st.eFast / Math.max(0.05, st.eAvg) - 1);
      return { bass, drums: st.hit, vocals: b.vocal || 0, guitar: (b.guitar != null ? b.guitar : (b.mid || 0)) * (1 + chorus * 1.5) };
    }
    return {
      get current() { return st.cur; },
      get scores() { return Object.assign({}, s); },
      get log() { return st.log.slice(); },
      reset() { st.cur = null; st.cand = null; st.candFor = 0; st.since = st.t; st.t0 = st.t; st.prevBass = null; st.hit = 0; for (const k of INSTRUMENTS) { s[k] = 0; avg[k] = REF[k]; } },
      /** feed one analysis frame; dt in seconds; returns the instrument to show */
      update(b, dt) {
        dt = clamp(dt || 0, 0, 0.25); st.t += dt;
        const e = (b && b.energy) || 0; st.eFast += (e - st.eFast) * clamp(dt / 1.2, 0, 1); st.eAvg += (e - st.eAvg) * clamp(dt / 10, 0, 1);
        const r = raw(b || {}, dt);
        const kf = clamp(dt / o.fast, 0, 1), ks = clamp(dt / o.slow, 0, 1);
        for (const k of INSTRUMENTS) { s[k] += (r[k] - s[k]) * kf; avg[k] += (r[k] - avg[k]) * ks; }
        const dom = {}; for (const k of INSTRUMENTS) dom[k] = s[k] / (0.6 * REF[k] + 0.4 * avg[k] + 0.03);
        // vocals need a real voice level, drums need actual hits
        if (s.vocals < 0.18) dom.vocals *= 0.5;
        if (s.drums < 0.1) dom.drums *= 0.5;
        let best = 'guitar'; for (const k of INSTRUMENTS) if (dom[k] > dom[best] * (k === 'guitar' ? 1 : 1.05)) best = k;
        if (!st.cur) { if (e > 0.02 && st.t - st.t0 >= o.warm) { st.cur = best; st.since = st.t; st.log.push({ t: +st.t.toFixed(2), to: best }); } return st.cur || 'guitar'; }
        if (best !== st.cur && dom[best] > dom[st.cur] * o.margin) {
          if (st.cand === best) st.candFor += dt; else { st.cand = best; st.candFor = dt; }
          if (st.candFor >= o.confirm && st.t - st.since >= o.hold) {
            st.cur = best; st.since = st.t; st.cand = null; st.candFor = 0; st.log.push({ t: +st.t.toFixed(2), to: best }); if (st.log.length > 50) st.log.shift();
          }
        } else { st.cand = null; st.candFor = 0; }
        return st.cur;
      },
    };
  }

  // ------------------------------------------------------------------ day / night
  const DAY = { start: 7, end: 19 };
  /** mode 'auto' | 'day' | 'night' -> which variant to show at `date` (local time) */
  function dayPart(mode, date, o) {
    if (mode === 'day' || mode === 'night') return mode;
    const d = date || new Date(), h = d.getHours() + d.getMinutes() / 60, c = Object.assign({}, DAY, o || {});
    return h >= c.start && h < c.end ? 'day' : 'night';
  }
  /** ms until the next automatic day/night change */
  function msToNextPart(date, o) {
    const d = date || new Date(), c = Object.assign({}, DAY, o || {}), n = new Date(d.getTime());
    const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    const next = h < c.start ? c.start : h < c.end ? c.end : 24 + c.start;
    n.setHours(0, 0, 0, 0); return Math.max(1000, n.getTime() + next * 3600000 - d.getTime());
  }
  /** a scene's background for the part of the day (falls back to the scene's own background) */
  function variantOf(scene, part) { const v = scene && scene.variants && scene.variants[part]; return v && v.image ? v : null; }

  // ------------------------------------------------------------------ rare outfits
  const RARE_KEY = 'luciel.rareOutfits';
  /** progress: plays per scene, found / unlocked outfits, which sparkle was shown; storage = localStorage-like */
  function createRareStore(storage, key) {
    key = key || RARE_KEY;
    let d = { plays: {}, found: {}, unlocked: {}, sparkled: {} };
    try { const j = storage && JSON.parse(storage.getItem(key) || 'null'); if (j && typeof j === 'object') d = Object.assign(d, j); } catch (e) {}
    const save = () => { try { storage && storage.setItem(key, JSON.stringify(d)); } catch (e) {} };
    return {
      get data() { return JSON.parse(JSON.stringify(d)); },
      plays: (sceneId) => d.plays[sceneId] || 0,
      isFound: (id) => !!d.found[id], isUnlocked: (id) => !!(d.unlocked[id] || d.found[id]),
      /** one counted play of a genre scene; returns the rare outfits unlocked by this play (milestones) */
      countPlay(scene) {
        if (!scene || !scene.id) return [];
        d.plays[scene.id] = (d.plays[scene.id] || 0) + 1; const got = [];
        for (const r of rareList(scene)) if (r.unlock && r.unlock.plays && d.plays[scene.id] >= r.unlock.plays && !d.unlocked[r.key]) { d.unlocked[r.key] = Date.now(); got.push(r); }
        save(); return got;
      },
      /** mark seen; true the first time (= show the "rare!" sparkle) */
      sighted(r) { const k = r.key || r.id; d.found[k] = d.found[k] || Date.now(); if (d.sparkled[k]) { save(); return false; } d.sparkled[k] = Date.now(); save(); return true; },
      reset() { d = { plays: {}, found: {}, unlocked: {}, sparkled: {} }; save(); },
    };
  }
  /** a scene's rare outfits with a global key (scene id + outfit id) */
  function rareList(scene) {
    const l = (scene && scene.char && scene.char.rareOutfits) || [];
    return l.map((r) => Object.assign({}, r, { key: `${scene.id}#${r.id}`, scene: scene.id }));
  }
  /** per-track roll: returns the rare outfit to wear for this track or null. rng() in [0,1) */
  function rollRare(scene, rng) {
    const l = rareList(scene); if (!l.length) return null;
    for (const r of l) { const c = typeof r.chance === 'number' ? clamp(r.chance, 0, 1) : 0.05; if ((rng || Math.random)() < c) return r; }
    return null;
  }
  /** collection rows for Settings: every rare outfit of the given scenes with its progress */
  function collection(scenes, store) {
    const out = [];
    for (const s of scenes || []) for (const r of rareList(s)) {
      const need = (r.unlock && r.unlock.plays) || 0, plays = store.plays(s.id);
      out.push({ key: r.key, id: r.id, name: r.name, scene: s.id, sceneName: s.name, thumb: r.thumb || r.idle, found: store.isFound(r.key), unlocked: store.isUnlocked(r.key), plays, need, chance: typeof r.chance === 'number' ? r.chance : 0.05 });
    }
    return out;
  }

  // ------------------------------------------------------------------ weather (Open-Meteo, no key)
  /** WMO weather interpretation code -> overlay kind (null = clear / cloudy: no layer) */
  function wmoKind(code) {
    const c = Number(code);
    if (!isFinite(c)) return null;
    if (c === 45 || c === 48) return 'fog';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95 && c <= 99) return 'storm';
    return null;
  }
  const forecastUrl = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${(+lat).toFixed(2)}&longitude=${(+lon).toFixed(2)}&current=weather_code,is_day,temperature_2m&timezone=auto`;
  const geocodeUrl = (name) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(String(name).trim().slice(0, 80))}&count=1&language=en&format=json`;
  function parseForecast(j) {
    const c = j && j.current; if (!c || c.weather_code == null) return null;
    return { code: Number(c.weather_code), kind: wmoKind(c.weather_code), isDay: c.is_day == null ? null : !!c.is_day, temp: typeof c.temperature_2m === 'number' ? c.temperature_2m : null, time: c.time || null };
  }
  function parseGeocode(j) {
    const r = j && Array.isArray(j.results) && j.results[0]; if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    return { name: String(r.name || ''), country: String(r.country_code || r.country || ''), lat: r.latitude, lon: r.longitude };
  }
  const WX_KEY = 'luciel.weather', TTL = 30 * 60 * 1000;
  /**
   * opts: fetch (window.fetch), storage (localStorage), now() (Date.now), locate() -> Promise<{lat, lon}> (coarse location)
   * settings: { on, city, useLocation }. refresh() never throws; on any failure the kind is null (no layer).
   */
  function createWeather(opts) {
    opts = opts || {}; const now = opts.now || (() => Date.now()), fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
    let cfg = { on: false, city: '', useLocation: false }, cache = null, timer = 0, busy = null; const subs = [];
    try { cache = JSON.parse((opts.storage && opts.storage.getItem(WX_KEY)) || 'null'); } catch (e) { cache = null; }
    const saveCache = () => { try { opts.storage && opts.storage.setItem(WX_KEY, JSON.stringify(cache)); } catch (e) {} };
    const placeKey = () => cfg.city ? 'city:' + cfg.city.trim().toLowerCase() : cfg.useLocation ? 'loc' : '';
    const emit = () => subs.forEach((f) => { try { f(api.kind); } catch (e) {} });
    async function getJson(url) {
      if (!fetchFn) throw new Error('no fetch');
      const r = await fetchFn(url, { credentials: 'omit', cache: 'no-store' }); if (!r || !r.ok) throw new Error('http ' + (r && r.status));
      return r.json();
    }
    async function place() {
      if (cfg.city && cfg.city.trim()) {
        if (cache && cache.geo && cache.geo.q === cfg.city.trim().toLowerCase()) return cache.geo;
        const g = parseGeocode(await getJson(geocodeUrl(cfg.city))); if (!g) throw new Error('city not found');
        return Object.assign(g, { q: cfg.city.trim().toLowerCase() });
      }
      if (cfg.useLocation && opts.locate) { const p = await opts.locate(); if (p && isFinite(p.lat) && isFinite(p.lon)) return { name: '', lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10, q: 'loc' }; }
      throw new Error('no place');
    }
    const api = {
      get kind() { return cfg.on && cache && cache.key === placeKey() && now() - cache.at < TTL * 4 ? cache.kind : null; },
      get state() { return { on: cfg.on, kind: api.kind, at: cache && cache.at, place: cache && cache.geo ? cache.geo.name : '', code: cache && cache.code, error: cache && cache.error || '' }; },
      onChange(f) { subs.push(f); },
      configure(c) {
        const before = placeKey(), wasOn = cfg.on; cfg = Object.assign({}, cfg, c || {});
        clearInterval(timer); timer = 0;
        if (cfg.on) { timer = setInterval(() => api.refresh(), TTL); if (!wasOn || before !== placeKey() || !cache || now() - cache.at >= TTL) api.refresh(); }
        emit();
      },
      /** fetch now unless the cache is fresh (force = ignore the cache); resolves to the kind (or null) */
      refresh(force) {
        if (!cfg.on) return Promise.resolve(null);
        if (!force && cache && cache.key === placeKey() && now() - cache.at < TTL) return Promise.resolve(api.kind);
        if (busy) return busy;
        busy = (async () => {
          try {
            const g = await place(); const f = parseForecast(await getJson(forecastUrl(g.lat, g.lon)));
            if (!f) throw new Error('bad forecast');
            cache = { key: placeKey(), at: now(), kind: f.kind, code: f.code, isDay: f.isDay, geo: g }; saveCache();
          } catch (e) {
            // silent: keep nothing on screen (a stale cache older than its TTL stops counting), remember the reason for Settings
            cache = { key: placeKey(), at: now(), kind: null, code: null, error: String(e && e.message || e), geo: cache && cache.geo && cache.key === placeKey() ? cache.geo : null }; saveCache();
          } finally { busy = null; emit(); }
          return api.kind;
        })();
        return busy;
      },
      stop() { clearInterval(timer); timer = 0; },
    };
    return api;
  }

  // ------------------------------------------------------------------ auto-switch by genre (at track boundaries)
  /** combine the tag genre and Spotify artist genres into one genre string for Scenes.matchGenre */
  function genreText(tag, artistGenres) {
    const t = String(tag || '').trim(); if (t) return t;
    const l = (artistGenres || []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 6);
    return l.join(' / ');
  }

  return { INSTRUMENTS, createInstrumentPicker, dayPart, msToNextPart, variantOf, RARE_KEY, createRareStore, rareList, rollRare, collection,
    wmoKind, forecastUrl, geocodeUrl, parseForecast, parseGeocode, createWeather, WX_TTL: TTL, genreText };
});
