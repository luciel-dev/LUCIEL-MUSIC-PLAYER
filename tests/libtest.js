// End-to-end: library views, playlists (CRUD, ctx menu, drag, reorder), M3U export/import, smart lists, play counts,
// tag editor (single + batch, cover, rename, in-file writes), persistence, Classic media library + screenshots.
const { chromium } = require('/workspace/pwtest/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const LIB = path.resolve(__dirname, 'library');
const SHOTS = process.env.SHOTS || '/workspace/aero-player/screenshots';
let pass = 0, fail = 0; const ok = (c, msg) => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + msg); };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message/.test(m.text())) errors.push(m.type() + ' ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  // force the download fallback (a native Save dialog can't be driven headless)
  await page.addInitScript(() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('luciel'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'networkidle' });
  const A = (fn, arg) => page.evaluate(fn, arg);
  await page.setInputFiles('#folderInput', LIB);
  await page.waitForFunction(() => window.AeroAmp.lib.size === 19 && [...window.AeroAmp.lib.values()].every(t => t.meta), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const g = await A(() => { const G = window.AeroAmp.library.groups(); return { artists: [...G.artists.values()].map(a => `${a.name}(${a.tracks.size}t/${a.albums.size}a${a.appears && a.appears.size ? '+' + a.appears.size + 'feat' : ''})`), albums: [...G.albums.values()].map(a => `${a.name}|${a.artist}${a.compilation ? '|COMP' : ''}|${a.tracks.length}`) }; });
  console.log('artists:', g.artists.join(', ')); console.log('albums:', g.albums.join(' ; '));
  ok(g.albums.some(a => /^Neon Nights Vol\. 1\|Various Artists\|COMP\|4$/.test(a)), 'compilation grouped under Various Artists');
  ok(g.albums.some(a => /^Halo Sessions\|Lucielle\|4$/.test(a)), 'album artist used (Halo Sessions → Lucielle, 2 discs)');
  ok(g.artists.some(a => /^Lucielle\(.*feat/.test(a)), 'feat. artist gets an "appears on" entry');
  ok(await A(() => window.AeroAmp.tracks.length) === 19, 'folder add also queued the songs');

  // ---------- library views + screenshots
  await page.keyboard.press('g'); await page.waitForSelector('#winLib:not([hidden])');
  await page.click('[data-nav="artists"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/library-artists.png` });
  await page.click('#libMain [data-artist]:has-text("Lucielle")'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/library-artist-detail.png` });
  await page.click('[data-nav="albums"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/library-albums.png` });
  await page.click('#libMain [data-album]:has-text("Halo Sessions")'); await page.waitForTimeout(500);
  const discs = await page.$$eval('#libMain .lt-disc, #libMain [class*="disc"]', e => e.map(x => x.textContent.trim()).filter(Boolean));
  console.log('halo discs meta:', await A(() => [...window.AeroAmp.lib.values()].filter(t => /Halo Sessions/.test(t.meta.album || '')).map(t => t.name + ':' + t.meta.disc).join(', ')));
  ok(discs.length >= 2, 'album detail shows disc headers: ' + discs.join(' / '));
  await page.screenshot({ path: `${SHOTS}/library-album-detail.png` });
  await page.click('[data-nav="songs"]'); await page.waitForTimeout(300);
  const rows = await page.$$eval('#libMain .lt-row[data-id]', e => e.length); ok(rows === 19, 'songs table lists 19 songs');
  await page.click('#libMain .lt-head [data-sort="bpm"]'); await page.waitForTimeout(200);
  const bpmCol = await A(() => window.AeroAmp.settings.libSort); ok(bpmCol.key === 'bpm', 'sortable by BPM column');
  await page.fill('#libSearch', 'neon'); await page.waitForTimeout(300);
  const sr = await page.textContent('#libMain'); ok(/Neon Freeway/.test(sr) && /Neon Nights/.test(sr), 'search finds songs + albums');
  await page.fill('#libSearch', ''); await page.click('[data-nav="songs"]'); await page.waitForTimeout(300);

  // ---------- playlists: create via UI, context menu add, drag add, rename, duplicate, delete, reorder
  await page.click('#libNav [data-act="new-pl"]'); await page.fill('#askOverlay input', 'Road Trip'); await page.click('#askOverlay .ask-ok'); await page.waitForTimeout(300);
  const pid = await A(() => window.AeroAmp.library.playlists.find(p => p.name === 'Road Trip').id); ok(!!pid, 'playlist created');
  await page.click('[data-nav="songs"]'); await page.waitForTimeout(300);
  const r = [0, 1, 2, 3, 4, 5].map((i) => page.locator('#libMain .lt-row[data-id]').nth(i));
  await r[0].click(); await r[1].click({ modifiers: ['Control'] }); await r[2].click({ modifiers: ['Control'] });
  await r[2].click({ button: 'right' }); await page.waitForSelector('#ctxMenu:not([hidden])');
  await page.click(`#ctxMenu [data-c="pl"][data-pl="${pid}"]`); await page.waitForTimeout(200);
  ok(await A((pid) => window.AeroAmp.library.playlists.find(p => p.id === pid).ids.length, pid) === 3, 'context menu → add 3 selected songs');
  await r[5].click(); await page.dragAndDrop('#libMain .lt-row[data-id] >> nth=5', `#libNav [data-drop="${pid}"]`); await page.waitForTimeout(300);
  const n4 = await A((pid) => window.AeroAmp.library.playlists.find(p => p.id === pid).ids.length, pid); ok(n4 === 4, 'drag a row onto the sidebar playlist (' + n4 + ')');
  await page.click(`#libNav [data-nav="${pid}"]`); await page.waitForTimeout(300);
  const before = await A((pid) => window.AeroAmp.library.playlists.find(p => p.id === pid).ids.slice(), pid);
  await page.click('#libMain .lt-row[data-id] >> nth=0');
  await page.dragAndDrop('#libMain .lt-row[data-id] >> nth=0', '#libMain .lt-row[data-id] >> nth=3', { targetPosition: { x: 40, y: 20 } }); await page.waitForTimeout(300);
  const after = await A((pid) => window.AeroAmp.library.playlists.find(p => p.id === pid).ids.slice(), pid);
  ok(after[after.length - 1] === before[0] && after.length === before.length, 'drag-reorder inside the playlist');
  await page.click('#libMain [data-act="rename"]'); await page.fill('#askOverlay input', 'Road Trip 2026'); await page.click('#askOverlay .ask-ok'); await page.waitForTimeout(200);
  ok(await A((pid) => window.AeroAmp.library.playlists.find(p => p.id === pid).name, pid) === 'Road Trip 2026', 'rename playlist');
  await page.click('#libMain [data-act="duplicate"]'); await page.waitForTimeout(200);
  ok(await A(() => window.AeroAmp.library.playlists.length) === 2, 'duplicate playlist');
  await page.click('#libMain [data-act="delete-pl"]'); await page.click('#askOverlay .ask-ok'); await page.waitForTimeout(200);
  ok(await A(() => window.AeroAmp.library.playlists.length) === 1, 'delete playlist (songs stay in the library)');
  ok(await A(() => window.AeroAmp.lib.size) === 19, 'library untouched by playlist delete');
  // ---------- M3U export → import round trip
  await page.click(`#libNav [data-nav="${pid}"]`); await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#libMain [data-act="export"]')]);
  const m3u = '/tmp/luc/Road Trip 2026.m3u8'; await dl.saveAs(m3u);
  const m3uText = fs.readFileSync(m3u, 'utf8'); console.log(m3uText.split('\n').slice(0, 5).join(' | '));
  ok(/^#EXTM3U/.test(m3uText) && (m3uText.match(/#EXTINF/g) || []).length === 4, 'M3U8 export (4 entries, #EXTINF)');
  const imp = '/tmp/luc/Imported Mix.m3u8'; fs.writeFileSync(imp, m3uText + '\n#EXTINF:100,Ghost - Not Here\nmissing/Not Here.mp3\n');
  await page.setInputFiles('#m3uInput', imp); await page.waitForTimeout(500);
  const ip = await A(() => { const p = window.AeroAmp.library.playlists.find(p => p.name === 'Imported Mix'); return p && p.ids.length; });
  ok(ip === 4, 'M3U8 import matched 4 songs (1 missing reported)');
  // queue vs playlists
  await page.click('#libNav [data-nav="queue"]'); await page.waitForTimeout(200);
  ok(/separate from saved playlists/.test(await page.textContent('#libMain')), 'queue view is separate from playlists');

  // ---------- play counts + smart playlists
  await A(async () => { const a = window.AeroAmp; const t = [...a.lib.values()].find(x => /Neon Freeway/.test(x.name)); a.playTrack(t); await new Promise(r => setTimeout(r, 700)); a.engine.audio.currentTime = a.engine.audio.duration * 0.6; });
  await page.waitForTimeout(2500);
  await A(() => { const a = window.AeroAmp; const t = [...a.lib.values()].find(x => /Neon Freeway/.test(x.name)); if (!a.settings.favorites.includes(t.id)) a.settings.favorites.push(t.id); });
  await A(() => { window.AeroAmp.library.open(); });
  await page.click('#libNav [data-nav="smart:most"]'); await page.waitForTimeout(300);
  const most = await page.textContent('#libMain'); ok(/Neon Freeway/.test(most), 'play counted → Most played');
  await page.click('#libNav [data-nav="smart:fav"]'); await page.waitForTimeout(300);
  ok(/Neon Freeway/.test(await page.textContent('#libMain')), 'Favorites smart list');
  await page.click('#libNav [data-nav="smart:recent"]'); await page.waitForTimeout(300);
  ok(await page.$$eval('#libMain .lt-row[data-id]', e => e.length) === 19, 'Recently added');
  await page.click(`#libNav [data-nav="${pid}"]`); await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/library-playlists.png` });

  // ---------- tag editor: single MP3 with scene-art cover + rename pattern
  await page.click('[data-nav="songs"]'); await page.fill('#libSearch', 'Smoke Rings'); await page.waitForTimeout(300);
  await page.click('#libMain .lt-row[data-id] >> nth=0'); await page.keyboard.press('F2');
  await page.waitForSelector('#editOverlay:not([hidden]) input[data-k="title"]');
  await page.fill('#editOverlay input[data-k="title"]', 'Smoke Rings (Luciel Edit)');
  await page.fill('#editOverlay input[data-k="year"]', '2026');
  await page.fill('#editOverlay input[data-k="bpm"]', '93');
  await page.click('#editOverlay [data-x="cscene"]'); await page.click('#editOverlay [data-scene-art] >> nth=2'); await page.waitForTimeout(800);
  await page.click('#editOverlay [data-x="pattern"]'); await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/edit-dialog.png` });
  const newName = await page.inputValue('#edName'); ok(newName === 'Midnight Brass Trio - Smoke Rings (Luciel Edit).mp3' || /Smoke Rings \(Luciel Edit\)\.mp3$/.test(newName), 'rename pattern → ' + newName);
  await page.click('#editOverlay [data-x="save"]'); await page.waitForSelector('#editOverlay', { state: 'hidden' });
  const ed1 = await A(async () => { const t = [...window.AeroAmp.lib.values()].find(x => /Luciel Edit/.test(x.meta.title || '')); if (!t) return null; const u8 = new Uint8Array(await t.file.arrayBuffer()); let b = ''; for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return { name: t.name, src: t.metaSource, year: t.meta.year, bpm: t.meta.bpm, pic: !!t.meta.picture, b64: btoa(b) }; });
  ok(ed1 && ed1.src === 'file' && ed1.pic && String(ed1.year) === '2026', `MP3 rewritten in-file (metaSource=${ed1 && ed1.src}, cover=${ed1 && ed1.pic}, name=${ed1 && ed1.name})`);
  if (ed1) { fs.writeFileSync('/tmp/luc/edited.mp3', Buffer.from(ed1.b64, 'base64'));
    const pr = JSON.parse(cp.execSync('ffprobe -v error -show_entries format_tags:stream=codec_type,codec_name -of json /tmp/luc/edited.mp3').toString());
    console.log('ffprobe edited.mp3:', JSON.stringify(pr.format.tags), pr.streams.map(s => s.codec_type + ':' + s.codec_name).join(','));
    ok(pr.format.tags.title === 'Smoke Rings (Luciel Edit)' && pr.streams.some(s => s.codec_name === 'mjpeg' || s.codec_name === 'png'), 'ffprobe sees new title + APIC cover'); }
  // ---------- Classic media library
  await A(() => { window.AeroAmp.applyTheme('blue', 'classic'); window.AeroAmp.library.open({ type: 'albums' }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/classic-media-library.png` });
  await A(() => window.AeroAmp.library.go({ type: 'artists' })); await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/classic-media-library-artists.png` });
  await A(() => { window.AeroAmp.library.close(); window.AeroAmp.applyTheme('aero', 'aero'); });
  // ---------- batch edit: MP3 + FLAC + M4A + OGG
  await A(() => { window.AeroAmp.library.open(); window.AeroAmp.library.go({ type: 'songs' }); }); await page.fill('#libSearch', '');
  const ids = await A(() => { const all = [...window.AeroAmp.lib.values()]; return ['Ironclad', 'Holo Rain', 'Save Point', 'Paper Hearts'].map(n => all.find(t => t.name.includes(n)).id); });
  await A((ids) => window.AeroAmp.editTracks(ids.map(id => window.AeroAmp.lib.get(id))), ids);
  await page.waitForSelector('#editOverlay:not([hidden]) input[data-k="genre"]');
  const note = await page.textContent('#editOverlay'); ok(/OGG|Vorbis|override/i.test(note), 'batch dialog flags the OGG as library-override only');
  await page.fill('#editOverlay input[data-k="genre"]', 'Cyberpunk'); await page.fill('#editOverlay input[data-k="year"]', '2026');
  await page.screenshot({ path: `${SHOTS}/edit-dialog-batch.png` });
  await page.click('#editOverlay [data-x="save"]'); await page.waitForSelector('#editOverlay', { state: 'hidden' });
  const b = await A((ids) => ids.map(id => { const t = window.AeroAmp.lib.get(id); return `${t.name.split('.').pop()}:${t.metaSource}:${t.meta.genre}:${t.meta.year}`; }), ids);
  console.log('batch:', b.join(' | '));
  ok(b.filter(x => /:file:Cyberpunk:2026$/.test(x)).length === 3 && /^ogg:library:Cyberpunk/.test(b[3]), 'batch: MP3/FLAC/M4A written in-file, OGG kept as override');

  await A(() => window.AeroAmp.library.open());
  await page.click('#libNav [data-nav="smart:bpm"]'); await page.waitForTimeout(300);
  await page.fill('#bpmMin', '90'); await page.fill('#bpmMax', '96'); await page.press('#bpmMax', 'Tab'); await page.waitForTimeout(300);
  const nb = await page.$$eval('#libMain .lt-row[data-id]', e => e.length); ok(nb > 0, `BPM range 90–96 (edited song has BPM 93) → ${nb} songs`);
  // ---------- persistence after reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.AeroAmp.lib.size === 19, null, { timeout: 30000 }); await page.waitForTimeout(1000);
  const per = await A(() => { const a = window.AeroAmp, all = [...a.lib.values()]; const t = all.find(x => /Neon Freeway/.test(x.name)); const e = all.find(x => /Luciel Edit/.test(x.meta.title || '')); const o = all.find(x => /Paper Hearts/.test(x.name)); return { pls: a.library.playlists.map(p => p.name + ':' + p.ids.length), plays: t.plays, edited: !!e, ogg: o.meta.genre, queue: a.tracks.length }; });
  console.log('after reload:', JSON.stringify(per));
  ok(per.pls.length === 2 && per.plays >= 1 && per.edited && per.ogg === 'Cyberpunk', 'library, playlists, play counts, edits and overrides persist (IndexedDB)');
  // auto scene for the batch-edited genre
  await A(() => { const a = window.AeroAmp; const t = [...a.lib.values()].find(x => /Holo Rain/.test(x.name)); a.playTrack(t); });
  await page.waitForTimeout(1200);
  ok(await A(() => window.AeroAmp.luciel.scene.id) === 'cyber', 'auto mode: Cyberpunk → Cyber Void video scene');

  console.log(`\n${pass} passed, ${fail} failed`); console.log('console errors/warnings:', errors.length ? errors : 'none');
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
