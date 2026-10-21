// 1.2.0 – Lucielle Genres as a SEPARATE add-on on Android (phone layout, mocked bridge): not bundled; "open a downloaded
// zip" (the VIEW / SEND intent path → LucielAndroidBridge.importPacks) installs it; every genre scene at phone size with
// Lucielle; Visuals page rows (auto-switch, Day/Night, outfit, rare collection, weather); the floater / Spotify card
// visual state carries the genre scene + day/night picture + outfit; Spotify artist genres (MOCKED Web API) pick the
// scene for a Spotify song; coarse location for the weather layer (mocked Open-Meteo). Any other outside request fails.
// GENRES=<zip>  SHOTS=1 → /workspace/luciel-android/screenshots/1.2.0-*.png
const fs = require('fs');
const { open } = require('./phone-lib');
const ZIP = process.env.GENRES || '/workspace/luciel-dist/lucielle-genres-pack.zip';
const SHOTS = process.env.SHOTS ? '/workspace/luciel-android/screenshots' : '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const { browser, ctx, page, errors } = await open({ port: 8986, width: 412, height: 915 });
  const outside = [], wx = [];
  await ctx.route((u) => !/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u.toString()), (r) => {
    const u = r.request().url(); outside.push(u);
    if (/api\.open-meteo\.com/.test(u)) { wx.push(u); return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { weather_code: 63, is_day: 0 } }) }); }
    return r.abort();
  });
  await ctx.route(/\/_dl\/lucielle-genres-pack\.zip/, (r) => r.fulfill({ contentType: 'application/zip', body: fs.readFileSync(ZIP) }));
  const ev = (f, a) => page.evaluate(f, a);
  const last = () => ev(() => window.__visual[window.__visual.length - 1] || null);
  const hideToast = () => ev(() => document.querySelectorAll('.toast').forEach((t) => { t.className = 'toast'; }));
  const shot = async (n) => { if (SHOTS) { await hideToast(); await page.screenshot({ path: `${SHOTS}/1.2.0-${n}.png` }); } };

  // ---- not bundled
  const bundled = await ev(async () => { try { return (await (await fetch('android/packs/index.json')).json()).map((e) => e.id); } catch (e) { return []; } });
  ok(!bundled.includes('lucielle-genres'), 'Genres pack is not bundled in the APK (bundled: ' + bundled.join(', ') + ')');
  await page.waitForFunction(() => (window.Luciel.app.packs.installed || []).some((p) => p.id === 'lucielle-styles'), null, { timeout: 60000 }).catch(() => {});
  const before = await ev(() => window.Luciel.Scenes.list.filter((s) => s.pack === 'lucielle-genres').length);
  ok(before === 0, 'no genre scenes before the add-on is imported');

  // ---- open the downloaded zip (what MainActivity does for a VIEW / SEND intent with a .zip)
  await ev(() => window.LucielAndroidBridge.importPacks([{ url: '/_dl/lucielle-genres-pack.zip', name: 'lucielle-genres-pack.zip' }]));
  await page.waitForFunction(() => window.Luciel.Scenes.list.filter((s) => s.pack === 'lucielle-genres').length === 5, null, { timeout: 180000 }).catch(() => {});
  const ids = await ev(() => window.Luciel.Scenes.list.filter((s) => s.pack === 'lucielle-genres').map((s) => s.id));
  ok(ids.length === 5, 'opening the downloaded zip installs the add-on: ' + ids.join(', '));
  await wait(page, 600);

  // ---- every scene at phone size (Now Playing), Night then Day
  const A = 'window.Luciel.app';
  await ev(() => { const a = window.Luciel.app; a.playTrack(a.tracks[0]); }); await wait(page, 1500);
  for (const dn of ['night', 'day']) for (const id of ids) {
    await ev(([id, dn]) => { const a = window.Luciel.app; a.luciel.setDayMode(dn); a.setScene(id, true); a.luciel.behavior.queue = []; a.luciel.behavior.reaction = null; }, [id, dn]);
    await wait(page, 1800);
    const st = await ev(() => { const s = window.Luciel.app.luciel.scene; return { id: s.id, img: s.image, name: s.char && s.char.name, layer: window.Luciel.app.luciel.layer }; });
    ok(st.id === id + '~' + dn && st.img && st.layer && /^p/.test(st.layer.kind), `${id.split('/')[1]} ${dn}: ${dn} picture, Lucielle (${st.name}) on stage as ${st.layer && st.layer.kind}`);
    await shot(`${id.split('/')[1]}-${dn}`);
  }

  // ---- Visuals page rows
  await ev(() => { window.Luciel.app.luciel.setDayMode('auto'); });
  const rows = await ev(() => { window.LucielMobile.setTab('visuals'); return new Promise((r) => setTimeout(() => r(document.getElementById('mVisuals').textContent), 600)); });
  const low = rows.toLowerCase(); ok(['auto-switch by genre', 'day / night', 'outfit', 'rare outfits', 'weather layer'].every((k) => low.includes(k)), 'Visuals page: auto-switch, day / night, outfit, rare outfits, weather rows');
  await shot('visuals-rows');
  await ev(() => window.LucielMobile.setTab('player')); await wait(page, 300);

  // ---- floater / Spotify card visual state: genre scene + variant picture + outfit as files
  await ev(() => { window.__visual.length = 0; const a = window.Luciel.app; a.luciel.setDayMode('night'); a.setScene('lucielle-genres/hip-hop', true); });
  await page.waitForFunction(() => { const v = window.__visual[window.__visual.length - 1]; return v && /files\/visual\//.test(v.bg || '') && v.char && v.char.dance && Object.values(v.char.dance).every((d) => d.file); }, null, { timeout: 60000 }).catch(() => {});
  let v = await last();
  ok(v && /hip-hop/.test(v.scene) && /files\/visual\//.test(v.bg) && v.char.use === 'custom' && /Block Party/i.test(v.char.name || ''), `floater state: ${v && v.scene} · ${v && v.char && v.char.name} (picture extracted to a file)`);
  const nightBg = v && v.bg;
  await ev(() => { window.__visual.length = 0; window.Luciel.app.luciel.setDayMode('day'); });
  await page.waitForFunction((b) => { const v = window.__visual[window.__visual.length - 1]; return v && v.bg && v.bg !== b && /files\/visual\//.test(v.bg); }, nightBg, { timeout: 30000 }).catch(() => {});
  v = await last();
  ok(v && v.bg !== nightBg && /~day/.test(v.scene), 'Day → the floater gets the day picture (' + (v && v.scene) + ')');
  const vk = await ev(() => window.Luciel.app.luciel.outfits.find((o) => /Velvet/.test(o.name) && !o.rare).key);
  await ev((k) => { window.__visual.length = 0; window.Luciel.app.setOutfit(k, true); }, vk);
  await page.waitForFunction(() => { const v = window.__visual[window.__visual.length - 1]; return v && v.char && /Velvet/i.test(v.char.name || '') && Object.values(v.char.dance || {}).every((d) => d.file); }, null, { timeout: 30000 }).catch(() => {});
  v = await last();
  ok(v && /hip-hop/.test(v.scene) && /Velvet/i.test(v.char.name), `outfit mix reaches the floater: ${v && v.scene} + ${v && v.char.name}`);
  await shot('mix-hiphop-velvet');
  await ev(() => { window.Luciel.app.setOutfit('', true); window.Luciel.app.luciel.setDayMode('auto'); window.Luciel.app.setScene('auto', true); }); await wait(page, 300);

  // ---- Spotify song: artist genres (mocked Web API) pick the scene
  await ev(() => { window.LucielSpotify._api.wakeWait = 60; window.__sp.clientId = '0123456789abcdef0123456789abcdef'; window.__sp.connected = true; window.LucielAndroidBridge.event('spotifyAuth', { result: 'ok', status: JSON.parse(window.LucielAndroid.spotifyStatus()) }); });
  await wait(page, 400);
  const g = await ev(() => window.LucielSpotify.genresFor('Neon Arcade'));
  const calls = await ev(() => window.__spCalls.slice());
  ok(Array.isArray(g) && g.includes('synthwave') && calls.some((c) => /\/search\?type=artist/.test(c)), 'genresFor(artist) → Spotify artist genres via search + /artists/{id} (mocked): ' + g.join(', '));
  await ev(() => { window.LucielSpotify.genresFor = async () => ['trap', 'southern hip hop']; window.Luciel.app.engine.audio.pause(); });
  await ev(() => { const s = { active: true, playing: true, pkg: 'com.spotify.music', app: 'Spotify', title: 'Genre Hint Song', artist: 'Some Rapper', duration: 200, position: 0, key: 'gh1', posWall: Date.now() }; window.__ext = s; window.LucielAndroidBridge.ext(Object.assign({}, s)); });
  await wait(page, 1200);
  const gs = await ev(() => window.Luciel.app.luciel.genreState);
  ok(/hip-hop/.test(gs.base || ''), 'Spotify song with no genre tag → artist genres → Hip-Hop scene (' + gs.base + ')');

  // ---- weather with coarse location (mocked fix + mocked Open-Meteo)
  await ev(() => { window.LucielAndroid.coarseLocation = () => setTimeout(() => window.__lucielLoc && window.__lucielLoc(JSON.stringify({ ok: true, lat: 41.9, lon: -87.6 })), 30); });
  await ev(() => { const S = window.Luciel.app; ['optWeatherLoc', 'optWeather'].forEach((id) => { const e = document.getElementById(id); e.checked = true; e.dispatchEvent(new Event('change')); }); });
  await page.waitForFunction(() => window.Luciel.app.luciel.genreState.weather, null, { timeout: 8000 }).catch(() => {});
  const w = await ev(() => window.Luciel.app.luciel.genreState.weather);
  ok(w === 'rain' && wx.length >= 1 && /latitude=41\.9/.test(wx[0]), 'coarse location → Open-Meteo (mocked) → rain layer: ' + (wx[0] || '').slice(0, 90));
  await ev(() => { const a = window.Luciel.app; a.setScene('lucielle-genres/rnb', true); }); await wait(page, 1500);
  await shot('weather-rain-rnb');
  ok(outside.every((u) => /open-meteo/.test(u)), 'no other outside requests (' + outside.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
