// Lucielle Genres add-on pack in the web app (Chrome; PW=/CHROME= for Chromium 115): the app without the pack
// (features stay quiet), real import through #packZipInput, five scenes with day / night variants, auto-switch by genre
// (tag -> Spotify artist genres -> audio features; only at track boundaries; toggle; manual pick wins until cleared),
// Day / Night setting, rare outfits (forced roll, first-time sparkle, play-milestone unlock, collection + wear), the
// outfit mix, Alt Rock instrument loops (pinned + following real audio), weather layer with MOCKED Open-Meteo (no real
// network: every non-local request is recorded and must be a mocked one), the floater, no page errors.
// GENRES=<zip> SHOTS=<dir>
const { chromium } = require(process.env.PW || '/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const MEDIA = path.resolve(__dirname, 'media'), SHOTS = process.env.SHOTS || '/tmp/luc/genres-shots';
const ZIP = process.env.GENRES || '/workspace/luciel-dist/lucielle-genres-pack.zip';
const TAG = process.env.CHROME ? 'c115' : 'chrome';
let fails = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const outside = []; let wx = { code: 63, fail: false }; const wxCalls = [];
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    const u = route.request().url(); outside.push(u);
    if (/geocoding-api\.open-meteo\.com/.test(u)) { wxCalls.push(u); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Chicago', latitude: 41.85, longitude: -87.65, country_code: 'US' }] }) }); }
    if (/api\.open-meteo\.com/.test(u)) { wxCalls.push(u); if (wx.fail) return route.abort(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { time: '2026-10-21T12:00', weather_code: wx.code, is_day: 1, temperature_2m: 11 } }) }); }
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  const ev = (f, a) => page.evaluate(f, a);
  const gs = () => ev(() => window.AeroAmp.luciel.genreState);
  await page.setInputFiles('#fileInput', fs.readdirSync(MEDIA).sort().map((f) => path.join(MEDIA, f)));
  await page.waitForFunction(() => window.AeroAmp.tracks.length === 8 && window.AeroAmp.tracks.every(t => t.meta), null, { timeout: 60000 }); await sleep(800);
  const play = (i, genre, title) => ev(([i, g, ti]) => { const A = window.AeroAmp, t = A.tracks[i]; t.meta.genre = g; if (ti) t.meta.title = ti; A.playTrack(t); }, [i, genre, title]);

  // ---- without the pack: nothing breaks, nothing shows
  await play(0, 'punk rock'); await sleep(1500);
  let s = await gs();
  ok(!/lucielle-genres/.test(s.base || '') && !s.rare, 'no pack: core scene, no rare roll (' + s.base + ')');
  const noPack = await ev(() => ({ outfits: document.querySelectorAll('#optOutfit option').length, rare: window.AeroAmp.luciel.rareCollection.length, html: window.AeroAmp.rareCollectionHTML() }));
  ok(noPack.outfits <= 2 && noPack.rare === 0, `no pack: outfit list has only “each scene’s own” + Classic (${noPack.outfits}), empty rare collection`);
  ok(/pack/i.test(noPack.html), 'no pack: collection says a genre pack adds rare outfits: ' + noPack.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 90));
  await ev(() => { document.getElementById('optDayNight').value = 'day'; document.getElementById('optDayNight').dispatchEvent(new Event('change')); }); await sleep(300);
  ok((await gs()).part === 'day' && errors.length === 0, 'no pack: Day / Night setting is harmless');
  await ev(() => { window.AeroAmp.engine.audio.pause(); });

  // ---- import
  await page.setInputFiles('#packZipInput', ZIP);
  await page.waitForFunction(() => !/Reading/.test(document.getElementById('pkMsg').innerText), null, { timeout: 180000 }); await sleep(500);
  const msg = await ev(() => document.getElementById('pkMsg').textContent.replace(/\s+/g, ' '));
  console.log('import:', msg.slice(0, 200));
  ok(/Lucielle Genres/.test(msg) && !/Couldn|warning/i.test(msg), 'add-on pack imports through the normal pack import, no errors / warnings');
  const info = await ev(() => window.Luciel.Scenes.list.filter(s => s.pack === 'lucielle-genres').map(s => ({ id: s.id, name: s.name, v: s.variants && { d: s.variants.day && s.variants.day.image, n: s.variants.night && s.variants.night.image, dv: !!(s.variants.day && s.variants.day.video) }, rare: (s.char.rareOutfits || []).map(r => r.name), inst: s.char.instruments })));
  ok(info.length === 5, 'five genre scenes: ' + info.map(i => i.name).join(', '));
  for (const i of info) ok(i.v && i.v.d && i.v.n && i.v.d !== i.v.n && i.v.dv && i.rare.length === 1, `${i.name}: day + night pictures and loops, rare outfit “${i.rare[0]}”`);
  ok(info[0].inst && info[0].inst.bass && info[0].inst.drums && info[0].inst.vocals && info[0].inst.guitar, 'Alt Rock declares instrument loops ' + JSON.stringify(info[0].inst));

  // ---- auto-switch by genre (tag genre)
  await ev(() => window.AeroAmp.luciel.setRng(() => 0.99));
  const want = [['punk rock', 'alt-rock'], ['trap', 'hip-hop'], ['neo soul', 'rnb'], ['indie rock', 'indie-rock'], ['folk', 'acoustic']];
  for (let k = 0; k < want.length; k++) { await play([0, 1, 2, 3, 6][k], want[k][0]); await sleep(900); s = await gs(); ok(s.base === 'lucielle-genres/' + want[k][1], `genre tag “${want[k][0]}” → ${s.base}`); }
  // mid-track genre change does not switch (only at track boundaries)
  await ev(() => { const A = window.AeroAmp; A.current.meta.genre = 'trap'; window.AeroAmp.luciel.moodCheck(); }); await sleep(600);
  ok((await gs()).base === 'lucielle-genres/acoustic', 'mid-song: stays put (switches only at the next track)');
  // Spotify artist genres (no tag): hint within the first seconds
  await play(5, '', 'Untagged Song'); await sleep(400);
  const hint = await ev(() => window.AeroAmp.luciel.genreHint(window.AeroAmp.current.meta.title || window.AeroAmp.current.name, ['alternative r&b', 'neo soul']));
  await sleep(300); s = await gs();
  ok(hint === true && s.base === 'lucielle-genres/rnb', 'no tag: Spotify artist genres pick R&B (' + s.base + ')');
  const late = await ev(() => window.AeroAmp.luciel.genreHint('some other song', ['trap']));
  ok(late === false && (await gs()).base === 'lucielle-genres/rnb', 'hint for another song is ignored');
  // manual pick wins until cleared
  await ev(() => window.AeroAmp.setScene('lucielle-genres/indie-rock', true)); await play(1, 'trap'); await sleep(800);
  ok((await gs()).base === 'lucielle-genres/indie-rock', 'a scene you pick wins over the genre');
  await ev(() => window.AeroAmp.setScene('auto', true)); await play(2, 'trap'); await sleep(800);
  ok((await gs()).base === 'lucielle-genres/hip-hop', 'cleared (Auto) → genre again');
  // toggle off
  await ev(() => document.getElementById('optGenreAuto').click()); await play(3, 'punk'); await sleep(800);
  s = await gs(); ok(!s.auto && s.base === 'lucielle-genres/hip-hop', 'Auto-switch by genre off → the scene stays (' + s.base + ')');
  await ev(() => document.getElementById('optGenreAuto').click()); await play(3, 'punk'); await sleep(800);
  ok((await gs()).base === 'lucielle-genres/alt-rock', 'back on → follows the genre');

  // ---- day / night
  const pic = () => ev(() => { const s = window.AeroAmp.luciel.scene; return { id: s.id, image: s.image, video: s.video }; });
  const setDN = (v) => ev((v) => { const e = document.getElementById('optDayNight'); e.value = v; e.dispatchEvent(new Event('change')); }, v);
  await setDN('day'); await sleep(700); const pd = await pic();
  await setDN('night'); await sleep(700); const pn = await pic();
  ok(pd.image !== pn.image && pd.image === info[0].v.d && pn.image === info[0].v.n && pd.video && pn.video && pd.video !== pn.video && /~day$/.test(pd.id) && /~night$/.test(pn.id), `Day / Night switch the picture + loop (${pd.id} ↔ ${pn.id})`);
  await page.screenshot({ path: `${SHOTS}/${TAG}-alt-rock-night.png` });
  await setDN('auto'); await sleep(500);
  const h = new Date().getHours(), partNow = h >= 7 && h < 19 ? 'day' : 'night';
  ok((await gs()).part === partNow, `Auto follows the clock (${partNow} at ${h}:00)`);

  // ---- rare outfit: forced roll, sparkle the first time, then only the outfit
  await ev(() => window.AeroAmp.luciel.setRng(() => 0.01)); await play(1, 'punk'); await sleep(400);
  s = await gs(); const toast1 = await ev(() => document.getElementById('toast').textContent);
  const rch = await ev(() => window.AeroAmp.luciel.scene.char.name);
  ok(s.rare === 'lucielle-genres/alt-rock#leather-jacket' && s.rareFx > 0 && /rare!/.test(toast1) && /Leather/i.test(rch), `1-in-20 hit → rare outfit worn (${rch}), “${toast1.slice(0, 40)}…”, sparkle`);
  await sleep(700); await page.screenshot({ path: `${SHOTS}/${TAG}-rare-leather-jacket.png` });
  await sleep(3200); await ev(() => window.AeroAmp.luciel.setRng(() => 0.01)); await play(5, 'punk'); await sleep(400);
  s = await gs(); ok(s.rare && s.rareFx === 0, 'seen before → outfit again, no sparkle');
  await ev(() => window.AeroAmp.luciel.setRng(() => 0.99)); await play(6, 'trap'); await sleep(600);
  s = await gs(); ok(!s.rare && !/rare/i.test(await ev(() => window.AeroAmp.luciel.scene.char.name || '')), 'miss → the regular outfit');
  // unlock by play milestones (Hip-Hop puffer: 25 counted plays)
  const unl = await ev(() => { const L = window.AeroAmp.luciel; let got = []; for (let i = 0; i < 25; i++) got = got.concat(L.trackCounted()); return { got: got.map(r => r.id), t: document.getElementById('toast').textContent }; });
  ok(unl.got.length === 1 && /Unlocked/.test(unl.t), `25 counted plays → unlocked ${unl.got} (“${unl.t.slice(0, 50)}…”)`);
  await ev(() => window.AeroAmp.openRare()); await sleep(400);
  const col = await ev(() => [...document.querySelectorAll('#rareList [data-wear]')].map(b => b.dataset.wear));
  const rows = await ev(() => document.querySelectorAll('#rareList .rd-item').length);
  ok(rows === 5 && col.length === 2, `Settings › Rare outfits: 5 entries, 2 wearable (${col.join(', ')})`);
  await page.screenshot({ path: `${SHOTS}/${TAG}-rare-collection.png` });
  await ev(() => document.querySelector('#rareList [data-wear*="puffer"]').click()); await sleep(400);
  s = await gs(); ok(/puffer/.test(s.outfit), 'wear from the collection → outfit ' + s.outfit);
  await ev(() => document.getElementById('rareClose').click());

  // ---- outfit mix: any background with any outfit
  const outs = await ev(() => window.AeroAmp.luciel.outfits);
  ok(outs.filter(o => !o.rare).length >= 6, 'outfit list: ' + outs.map(o => o.name + (o.rare ? (o.available ? ' (rare ✓)' : ' (rare 🔒)') : '')).join(', '));
  const velvet = outs.find(o => /velvet/i.test(o.name) && !o.rare);
  await ev(() => window.AeroAmp.setScene('lucielle-genres/alt-rock', true));
  await ev((k) => { const e = document.getElementById('optOutfit'); e.value = k; e.dispatchEvent(new Event('change')); }, velvet.key); await sleep(800);
  const mix = await ev(() => { const s = window.AeroAmp.luciel.scene; return { img: s.image, name: s.char.name, inst: !!s.char.instruments }; });
  ok(mix.img === info[0].v[(await gs()).part === 'day' ? 'd' : 'n'] && (await gs()).base === 'lucielle-genres/alt-rock' && /velvet|r&b/i.test(mix.name), `Alt Rock stage + Velvet Hour outfit (${mix.name})`);
  await page.screenshot({ path: `${SHOTS}/${TAG}-mix-altrock-velvet.png` });
  const locked = outs.find(o => o.rare && !o.available);
  ok(!!locked && !(await ev((k) => [...document.querySelectorAll('#optOutfit option')].find(o => o.value === k && !o.disabled), locked.key)), 'locked rare outfits cannot be picked yet (' + (locked && locked.name) + ')');
  await ev(() => { const e = document.getElementById('optOutfit'); e.value = ''; e.dispatchEvent(new Event('change')); }); await sleep(400);

  // ---- Alt Rock instruments
  await ev(() => { window.AeroAmp.setScene('lucielle-genres/alt-rock', true); const L = window.AeroAmp.luciel; L.behavior.queue = []; L.behavior.reaction = null; });
  await play(0, 'punk'); await sleep(3500);
  for (const k of ['guitar', 'bass', 'drums', 'vocals']) {
    let r; for (let t = 0; t < 6; t++) { r = await ev(async (k) => { const L = window.AeroAmp.luciel; L.behavior.queue = []; L.behavior.reaction = null; L.forceInstrument(k); await new Promise(r => setTimeout(r, 300)); return L.layer; }, k); if (r && r.name.includes('inst-')) break; }
    const want = { guitar: 'inst-guitar', bass: 'inst-bass', drums: 'inst-drums', vocals: 'inst-mic' }[k];
    ok(r && r.kind === 'pdance' && r.name.includes(want), `${k} → ${want} loop on stage (${r && r.name})`);
    await page.screenshot({ path: `${SHOTS}/${TAG}-alt-rock-${k}.png` });
  }
  await ev(() => window.AeroAmp.luciel.forceInstrument(null));
  await sleep(9000);
  const il = await ev(() => ({ log: window.AeroAmp.luciel.instrumentLog, now: window.AeroAmp.luciel.instrument }));
  console.log('instrument log while playing:', JSON.stringify(il.log));
  ok(il.now && il.log.length >= 1 && il.log.length <= 5, `following real audio: ${il.log.map(x => x.to).join(' → ')} (now ${il.now})`);

  // ---- weather layer (mocked Open-Meteo)
  ok(wxCalls.length === 0, 'weather off by default: no Open-Meteo requests so far');
  await ev(() => { const c = document.getElementById('optWeatherCity'); c.value = 'Chicago'; c.dispatchEvent(new Event('change')); document.getElementById('optWeather').click(); });
  await page.waitForFunction(() => window.AeroAmp.luciel.genreState.weather, null, { timeout: 5000 }).catch(() => {});
  s = await gs(); const sum = await ev(() => document.getElementById('weatherSum').textContent);
  ok(s.weather === 'rain' && wxCalls.some(u => /geocoding.*Chicago/.test(u)) && wxCalls.some(u => /latitude=41\.85/.test(u)) && /rain/.test(sum), `city → geocode + forecast (mocked) → rain layer; Settings shows “${sum}”`);
  await sleep(600); await page.screenshot({ path: `${SHOTS}/${TAG}-weather-rain.png` });
  for (const [code, kind] of [[73, 'snow'], [45, 'fog'], [95, 'storm']]) {
    wx.code = code; await ev(() => window.AeroAmp.weather.refresh(true)); await sleep(700);
    ok((await gs()).weather === kind, `WMO ${code} → ${kind} layer`);
    await page.screenshot({ path: `${SHOTS}/${TAG}-weather-${kind}.png` });
  }
  const before = wxCalls.length; await ev(() => window.AeroAmp.weather.refresh()); ok(wxCalls.length === before, 'cached: no new request inside 30 min');
  wx.fail = true; await ev(() => window.AeroAmp.weather.refresh(true)); await sleep(400);
  ok((await gs()).weather === null && errors.length === 0, 'Open-Meteo unreachable → no layer, silently');
  wx.fail = false; wx.code = 61; await ev(() => window.AeroAmp.weather.refresh(true)); await sleep(300);
  await ev(() => document.getElementById('optWeather').click()); await sleep(200);
  ok((await gs()).weather === null, 'switched off → layer gone');
  ok(outside.every(u => /open-meteo\.com/.test(u)), `no other outside requests (${outside.length} mocked Open-Meteo calls)`);

  // ---- every scene (night + day) on screen, and the floater with a genre scene
  for (const i of info) for (const dn of ['night', 'day']) {
    await setDN(dn); await ev((id) => window.AeroAmp.setScene(id, true), i.id); await sleep(1300);
    const p = await pic(); ok(p.image === (dn === 'day' ? i.v.d : i.v.n), `${i.name} ${dn}: right picture on stage`);
    await page.screenshot({ path: `${SHOTS}/${TAG}-${i.id.split('/')[1]}-${dn}.png` });
  }
  await setDN('night'); await ev(() => window.AeroAmp.setScene('lucielle-genres/hip-hop', true)); await sleep(500);
  const mini = await ev(async () => { window.AeroAmp.mini.open(); await new Promise(r => setTimeout(r, 1200)); const r = document.querySelector('#miniHost .lm'); return r ? r.innerHTML.length : 0; });
  ok(mini > 0, 'floater (mini player) opens on a genre scene');
  await page.screenshot({ path: `${SHOTS}/${TAG}-floater-hip-hop.png` });
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails}/${n} FAILED` : `ALL PASS (${n})`); process.exit(fails ? 1 : 0);
})();
