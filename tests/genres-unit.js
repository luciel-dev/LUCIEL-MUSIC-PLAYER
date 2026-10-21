// Lucielle Genres features, pure logic (node): band -> instrument switching with hysteresis, day / night, rare-outfit
// odds + play-milestone unlocks, weather parsing + service (mocked fetch: cache, 30-min refresh, silent failure),
// genre text for auto-switch, and the pack schema (variants / instruments / rareOutfits / priority) incl. the built pack.
const G = require('/workspace/aero-player/js/genres.js');
const P = require('/workspace/aero-player/js/packs.js');
const fs = require('fs'), path = require('path');
let fails = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ---------------------------------------------------------------- instruments
function run(pk, seq, dt = 1 / 30) { const out = []; for (const [secs, b] of seq) for (let t = 0; t < secs; t += dt) out.push(pk.update(typeof b === 'function' ? b(t) : b, dt)); return out; }
const noise = (seed) => { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x / 2147483647 - 0.5) * 0.06; }; };
{
  const pk = G.createInstrumentPicker(); const r = noise(7);
  const bassy = (t) => ({ bass: 0.75 + r(), vocal: 0.12 + r(), guitar: 0.12 + r(), energy: 0.45 });
  const out = run(pk, [[8, bassy]]);
  ok(out[out.length - 1] === 'bass', 'low end standing out → bass (' + out[out.length - 1] + ')');
  const kicks = (t) => ({ bass: (t * 2) % 1 < 0.08 ? 0.9 : 0.15, vocal: 0.1 + r(), guitar: 0.1 + r(), energy: 0.5 });
  const o2 = run(pk, [[10, kicks]]);
  ok(o2[o2.length - 1] === 'drums', 'kick transients (low-end onsets) → drums (' + o2[o2.length - 1] + ')');
  const voice = (t) => ({ bass: 0.15 + r(), vocal: 0.7 + r(), guitar: 0.15 + r(), energy: 0.45 });
  const o3 = run(pk, [[10, voice]]);
  ok(o3[o3.length - 1] === 'vocals', 'voice band 300 Hz–3.4 kHz → vocals / mic (' + o3[o3.length - 1] + ')');
  const gtr = (t) => ({ bass: 0.2 + r(), vocal: 0.2 + r(), guitar: 0.8 + r(), energy: 0.7 });
  const o4 = run(pk, [[10, gtr]]);
  ok(o4[o4.length - 1] === 'guitar', 'guitar-heavy mids → guitar (' + o4[o4.length - 1] + ')');
  const log = pk.log.map((x) => x.to);
  ok(JSON.stringify(log) === JSON.stringify(['bass', 'drums', 'vocals', 'guitar']), 'exactly one switch per section: ' + log.join(' → '));
  for (let i = 1; i < pk.log.length; i++) ok(pk.log[i].t - pk.log[i - 1].t >= 2.5, `hold ≥ 2.5 s between switches (${(pk.log[i].t - pk.log[i - 1].t).toFixed(2)} s)`);
}
{
  // two bands neck and neck with noise: hysteresis keeps it from flapping
  const pk = G.createInstrumentPicker(); const r = noise(3);
  run(pk, [[30, () => ({ bass: 0.5 + r() * 3, vocal: 0.5 + r() * 3, guitar: 0.3 + r(), energy: 0.5 })]]);
  ok(pk.log.length <= 4, `near-equal bands with noise: ${pk.log.length} switches in 30 s (no flapping)`);
  // a 1-second burst does not switch (confirm + margin)
  const pk2 = G.createInstrumentPicker();
  run(pk2, [[6, { bass: 0.2, vocal: 0.2, guitar: 0.8, energy: 0.6 }], [0.4, { bass: 0.95, vocal: 0.1, guitar: 0.2, energy: 0.6 }], [3, { bass: 0.2, vocal: 0.2, guitar: 0.8, energy: 0.6 }]]);
  ok(pk2.log.length === 1 && pk2.current === 'guitar', 'a 0.4 s bass burst does not steal the pick (' + pk2.log.map((x) => x.to).join(',') + ')');
  const pk3 = G.createInstrumentPicker();
  ok(run(pk3, [[1, { bass: 0, vocal: 0, guitar: 0, energy: 0 }]]).every((x) => x === 'guitar') && pk3.current === null, 'silence: nothing picked yet (guitar shown as the default)');
  // chorus energy favours guitar
  const pk4 = G.createInstrumentPicker();
  run(pk4, [[10, { bass: 0.3, vocal: 0.36, guitar: 0.3, energy: 0.3 }]]);
  const before = pk4.current;
  run(pk4, [[6, { bass: 0.33, vocal: 0.36, guitar: 0.42, energy: 0.85 }]]);
  ok(before === 'vocals' && pk4.current === 'guitar', `chorus lift (energy ↑) → guitar (${before} → ${pk4.current})`);
}
// ---------------------------------------------------------------- day / night
{
  const at = (h, m = 0) => { const d = new Date(2026, 9, 21, h, m, 0); return d; };
  ok(G.dayPart('auto', at(6, 59)) === 'night' && G.dayPart('auto', at(7, 0)) === 'day' && G.dayPart('auto', at(18, 59)) === 'day' && G.dayPart('auto', at(19, 0)) === 'night', 'Auto: 07:00–19:00 day, otherwise night');
  ok(G.dayPart('day', at(23)) === 'day' && G.dayPart('night', at(12)) === 'night', 'Day / Night settings override the clock');
  ok(G.dayPart('bogus', at(12)) === 'day', 'unknown mode behaves like Auto');
  ok(Math.round(G.msToNextPart(at(18, 0)) / 60000) === 60 && Math.round(G.msToNextPart(at(20, 0)) / 3600000) === 11, 'time to the next change (18:00 → 1 h, 20:00 → 11 h)');
  const sc = { variants: { day: { image: 'd.jpg' }, night: { image: 'n.jpg', video: 'n.mp4' } } };
  ok(G.variantOf(sc, 'day').image === 'd.jpg' && G.variantOf(sc, 'night').video === 'n.mp4' && G.variantOf({}, 'day') === null, 'variantOf picks the declared variant, null without variants');
}
// ---------------------------------------------------------------- rare outfits
{
  const mem = new Map(); const storage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)) };
  const scene = { id: 'lucielle-genres/alt-rock', name: 'Alt Rock', char: { rareOutfits: [{ id: 'leather-jacket', name: 'Leather Jacket', chance: 0.05, unlock: { plays: 25 } }] } };
  let seed = 42; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let hits = 0; const N = 20000; for (let i = 0; i < N; i++) if (G.rollRare(scene, rng)) hits++;
  ok(Math.abs(hits / N - 0.05) < 0.006, `1-in-20 chance per track: ${(100 * hits / N).toFixed(2)} % of ${N} songs`);
  ok(G.rollRare(scene, () => 0.049).key === 'lucielle-genres/alt-rock#leather-jacket' && G.rollRare(scene, () => 0.05) === null, 'roll boundary: < 0.05 wears it, ≥ 0.05 does not');
  ok(G.rollRare({ id: 'x', char: {} }, () => 0) === null && G.rollRare(null, () => 0) === null, 'scenes without rare outfits never roll one');
  const st = G.createRareStore(storage);
  let got = []; for (let i = 0; i < 24; i++) got = got.concat(st.countPlay(scene));
  ok(got.length === 0 && !st.isUnlocked(scene.id + '#leather-jacket') && st.plays(scene.id) === 24, '24 plays: still locked');
  got = st.countPlay(scene);
  ok(got.length === 1 && got[0].id === 'leather-jacket' && st.isUnlocked(scene.id + '#leather-jacket'), '25th play unlocks it (milestone)');
  ok(st.countPlay(scene).length === 0, 'unlock is reported once');
  const st2 = G.createRareStore(storage);
  ok(st2.plays(scene.id) === 26 && st2.isUnlocked(scene.id + '#leather-jacket'), 'progress persists (storage)');
  const r = G.rareList(scene)[0];
  ok(st2.sighted(r) === true && st2.sighted(r) === false, 'unlocked by plays, first time worn: sparkle once, then not again');
  const st3 = G.createRareStore(null); const r3 = G.rareList(scene)[0];
  ok(st3.sighted(r3) === true && st3.sighted(r3) === false && st3.isFound(r3.key), 'first sighting → sparkle (true), later → no sparkle; counts as found');
  const col = G.collection([scene, { id: 'core', char: {} }], st3);
  ok(col.length === 1 && col[0].found && col[0].unlocked && col[0].need === 25 && col[0].chance === 0.05, 'collection rows: ' + JSON.stringify(col[0]).slice(0, 140));
  const fresh = G.collection([scene], G.createRareStore(null))[0];
  ok(!fresh.found && !fresh.unlocked && fresh.plays === 0, 'collection: locked outfit shows progress 0/25');
}
// ---------------------------------------------------------------- weather
{
  ok(G.wmoKind(0) === null && G.wmoKind(3) === null && G.wmoKind(45) === 'fog' && G.wmoKind(48) === 'fog' && G.wmoKind(51) === 'rain' && G.wmoKind(63) === 'rain' && G.wmoKind(67) === 'rain' && G.wmoKind(81) === 'rain'
     && G.wmoKind(71) === 'snow' && G.wmoKind(77) === 'snow' && G.wmoKind(86) === 'snow' && G.wmoKind(95) === 'storm' && G.wmoKind(99) === 'storm' && G.wmoKind('x') === null, 'WMO codes → clear / fog / rain / snow / storm');
  const fc = G.parseForecast({ current: { time: '2026-10-21T12:00', weather_code: 61, is_day: 1, temperature_2m: 12.4 } });
  ok(fc && fc.kind === 'rain' && fc.isDay === true && fc.temp === 12.4, 'forecast parsed: ' + JSON.stringify(fc));
  ok(G.parseForecast({}) === null && G.parseForecast(null) === null && G.parseForecast({ current: {} }) === null, 'bad forecast → null');
  const gc = G.parseGeocode({ results: [{ name: 'Chicago', latitude: 41.85, longitude: -87.65, country_code: 'US' }] });
  ok(gc && gc.name === 'Chicago' && gc.lat === 41.85 && gc.country === 'US', 'geocoding parsed');
  ok(G.parseGeocode({ results: [] }) === null && G.parseGeocode({}) === null, 'unknown city → null');
  ok(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=41\.85&longitude=-87\.65&current=weather_code/.test(G.forecastUrl(41.8512, -87.6498)) && /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=S%C3%A3o%20Paulo&count=1/.test(G.geocodeUrl('São Paulo')), 'Open-Meteo URLs (no key)');
}
(async () => {
  // weather service with a mocked fetch (no network)
  let clock = 1e12; const calls = []; let code = 61, fail = false;
  const fetch = async (u) => { calls.push(u); if (fail) throw new Error('offline'); if (/geocoding/.test(u)) return { ok: true, json: async () => ({ results: [{ name: 'Chicago', latitude: 41.85, longitude: -87.65 }] }) }; return { ok: true, json: async () => ({ current: { weather_code: code, is_day: 1 } }) }; };
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
  const W = G.createWeather({ fetch, storage, now: () => clock });
  ok(W.kind === null, 'off by default: no layer');
  W.configure({ on: true, city: 'Chicago' }); await W.refresh();
  ok(W.kind === 'rain' && calls.length === 2 && /geocoding/.test(calls[0]) && /forecast/.test(calls[1]), 'city → geocode + forecast → rain (' + calls.length + ' requests)');
  await W.refresh(); ok(calls.length === 2, 'fresh cache: no new request');
  clock += 29 * 60000; await W.refresh(); ok(calls.length === 2, 'still cached at 29 min');
  code = 71; clock += 2 * 60000; await W.refresh(); ok(calls.length === 3 && W.kind === 'snow', 'after 30 min: refreshed (geocode cached) → snow');
  const W2 = G.createWeather({ fetch, storage, now: () => clock }); W2.configure({ on: true, city: 'Chicago' }); await new Promise((r) => setTimeout(r, 5));
  ok(W2.kind === 'snow' && calls.length === 3, 'cache survives a restart (storage)');
  fail = true; clock += 31 * 60000; const k = await W.refresh();
  ok(k === null && W.kind === null && W.state.error === 'offline', 'offline: fails silently → no layer');
  fail = false; await W.refresh(true); ok(W.kind === 'snow', 'back online → layer again');
  W.configure({ on: false }); ok(W.kind === null, 'switched off → no layer');
  const W3 = G.createWeather({ fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }), storage: null, now: () => clock });
  W3.configure({ on: true, city: 'Nowhereville' }); await W3.refresh(true); ok(W3.kind === null && /city not found/.test(W3.state.error), 'unknown city → no layer, reason kept for Settings');
  const W4 = G.createWeather({ fetch, storage: null, now: () => clock, locate: async () => ({ lat: 41.87811, lon: -87.62979 }) });
  calls.length = 0; W4.configure({ on: true, useLocation: true }); await W4.refresh(true);
  ok(W4.kind === 'snow' && calls.length === 1 && /latitude=41\.90&longitude=-87\.60/.test(calls[0]), 'coarse location (rounded to 0.1°) → forecast only: ' + calls[0].slice(40, 90));
  const W5 = G.createWeather({ fetch, storage: null, now: () => clock, locate: async () => { throw new Error('denied'); } });
  W5.configure({ on: true, useLocation: true }); await W5.refresh(true); ok(W5.kind === null, 'location denied → no layer');
  [W, W2, W3, W4, W5].forEach((w) => w.stop());
  // ---------------------------------------------------------------- auto-switch genre text
  ok(G.genreText('Pop Punk', ['emo']) === 'Pop Punk' && G.genreText('', ['alternative r&b', 'neo soul']) === 'alternative r&b / neo soul' && G.genreText('', []) === '', 'tag genre first, else Spotify artist genres');
  // ---------------------------------------------------------------- schema
  const files = new Map(['a.jpg', 'b.jpg', 'c.mp4', 's.webp', 'r.webp'].map((f) => [f, { size: 10 }]));
  const em = (f) => ({ sheet: f, frames: 24, columns: 8, beats: 4 });
  const base = { format: 'luciel-pack/1', id: 'tp', name: 'T', version: '1.0.0', author: 'x', preview: 'a.jpg', scenes: [{ id: 's1', name: 'S', background: { image: 'a.jpg' }, match: { genres: ['rock'], priority: 5 },
    variants: { day: { image: 'b.jpg', video: 'c.mp4' }, night: { image: 'a.jpg' } },
    character: { use: 'custom', idle: 's.webp', emotes: { 'inst-bass': em('s.webp'), happy: em('s.webp') }, events: { start: 'happy' }, instruments: { bass: 'inst-bass' },
      rareOutfits: [{ id: 'rare-one', name: 'Rare', chance: 0.1, unlock: { plays: 10 }, idle: 'r.webp', emotes: { happy: em('r.webp') } }] } }] };
  let v = P.validate(base, files);
  ok(v.ok && !v.warnings.length, 'valid genre-pack scene: no errors / warnings ' + JSON.stringify(v.errors.concat(v.warnings)).slice(0, 200));
  const s0 = v.pack.scenes[0];
  ok(s0.variants.day.video === 'c.mp4' && s0.character.instruments.bass === 'inst-bass' && s0.character.rareOutfits[0].chance === 0.1 && s0.character.rareOutfits[0].unlock.plays === 10 && s0.match.priority === 5, 'normalised: variants, instruments, rareOutfits, priority');
  const sc = P.toScenes(v.pack, (p) => 'u/' + p)[0];
  ok(sc.variants.day.image === 'u/b.jpg' && sc.char.instruments.bass === 'inst-bass' && sc.char.rareOutfits[0].idle === 'u/r.webp' && sc.char.rareOutfits[0].thumb === 'u/r.webp' && sc.priority === 5, 'toScenes resolves variant / rare files');
  const bad = JSON.parse(JSON.stringify(base)); const c = bad.scenes[0];
  c.variants = { day: { video: 'c.mp4' }, dusk: { image: 'a.jpg' } }; c.character.instruments = { bass: 'nope', cowbell: 'happy' }; c.character.rareOutfits = [{ id: 'Bad Id' }, { id: 'ok', chance: 2, unlock: { plays: 0 } }]; c.match.priority = 12;
  v = P.validate(bad, files);
  const E = v.errors.join(' | '), Wn = v.warnings.join(' | ');
  ok(!v.ok && /variants\.day\.image is required/.test(E) && /instruments\.bass must name one of this character's emotes/.test(E) && /rareOutfits\[0\] needs a unique “id”/.test(E) && /rareOutfits\[1\]\.chance/.test(E) && /rareOutfits\[1\]\.unlock/.test(E) && /match\.priority/.test(E), 'bad fields → plain errors: ' + E.slice(0, 260));
  ok(/variants\.dusk: unknown variant ignored/.test(Wn) && /instruments\.cowbell: unknown instrument ignored/.test(Wn), 'unknown variant / instrument → warnings');
  // ---------------------------------------------------------------- the built pack
  const dir = process.env.GENRES_DIR || '/workspace/aero-player-test/packs/lucielle-genres';
  if (fs.existsSync(path.join(dir, 'pack.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); const fm = new Map();
    (function walk(d, pre) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, pre + f + '/'); else fm.set(pre + f, { size: fs.statSync(p).size, head: fs.readFileSync(p).subarray(0, 16) }); } })(dir, '');
    v = P.validate(m, fm);
    ok(v.ok && v.warnings.length === 0, `Lucielle Genres pack.json validates: ${v.errors.length} errors, ${v.warnings.length} warnings ${JSON.stringify(v.errors.concat(v.warnings)).slice(0, 300)}`);
    const ids = v.pack.scenes.map((s) => s.id);
    ok(JSON.stringify(ids) === JSON.stringify(['alt-rock', 'hip-hop', 'rnb', 'indie-rock', 'acoustic']), 'five genre scenes: ' + ids.join(', '));
    for (const s of v.pack.scenes) {
      ok(s.variants && s.variants.day && s.variants.night && s.variants.day.video && s.variants.night.video && s.variants.day.image !== s.variants.night.image, `${s.id}: day + night variants with loops`);
      const r = s.character.rareOutfits || [];
      ok(r.length === 1 && r[0].chance === 0.05 && r[0].unlock.plays >= 1 && Object.keys(r[0].emotes).length >= 10 && Object.keys(r[0].dance).length === 3, `${s.id}: one rare outfit “${r[0] && r[0].name}” (1 in 20, unlock at ${r[0] && r[0].unlock.plays} plays)`);
      const evs = Object.keys(s.character.events || {}); ok(evs.length === 7, `${s.id}: all 7 music events mapped (${Object.values(s.character.events).join('/')})`);
      for (const e of ['happy', 'headbang', 'shocked', 'yawn', 'sad', 'sing']) if (!s.character.emotes[e]) ok(false, `${s.id}: emote ${e} present`);
      ok(s.match.priority === 5 && s.match.genres.length >= 8, `${s.id}: ${s.match.genres.length} genre keys, priority 5`);
    }
    const alt = v.pack.scenes[0].character;
    ok(alt.instruments && ['bass', 'drums', 'vocals', 'guitar'].every((k) => alt.emotes[alt.instruments[k]]) && alt.rareOutfits[0].instruments, 'Alt Rock: guitar / bass / drums / mic loops declared (outfit + rare)');
    const zip = process.env.GENRES_ZIP || '/workspace/luciel-dist/lucielle-genres-pack.zip';
    if (fs.existsSync(zip)) { const z = fs.statSync(zip).size; ok(z < P.LIMITS.zipBytes && [...fm.values()].reduce((a, f) => a + f.size, 0) < P.LIMITS.packBytes && fm.size <= P.LIMITS.files, `zip ${(z / 1048576).toFixed(1)} MB, ${fm.size} files: inside the pack limits`); }
  } else console.log('SKIP built pack (not found)');
  console.log(fails ? `${fails}/${n} FAILED` : `ALL PASS (${n})`); process.exit(fails ? 1 : 0);
})();
