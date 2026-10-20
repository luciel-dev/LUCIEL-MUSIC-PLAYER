// Phone-layout tests (tabs, drill-down library, sheets, safe areas, touch targets, back) + the Android audio audit.
// Runs at 360x780 and 412x915; set CHROME=/path for another Chrome (Chromium 113 with PW=/tmp/pw134/...).
const path = require('path');
const { open } = require('./phone-lib');
const SIZES = (process.env.SIZES == null ? '360x780,412x915' : process.env.SIZES).split(',').filter(Boolean).map((s) => s.split('x').map(Number));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const wait = (p, ms) => p.waitForTimeout(ms);

// page helpers (run in the browser)
const H = `
window.__h = {
  vis(el) { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false; let e = el; while (e) { if (getComputedStyle(e).display === 'none') return false; e = e.parentElement; } return true; },
  center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  ptr(el, type, x, y, id = 5) { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })); },
  tap(el) { el.click(); },
  async longPress(el) { const c = this.center(el); this.ptr(el, 'pointerdown', c.x, c.y); await new Promise((r) => setTimeout(r, 620)); this.ptr(el, 'pointerup', c.x, c.y); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y })); },
  async drag(el, x0, y0, x1, y1, steps = 12, id = 7) { this.ptr(el, 'pointerdown', x0, y0, id); for (let i = 1; i <= steps; i++) { await new Promise((r) => setTimeout(r, 16)); this.ptr(el, 'pointermove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, id); } await new Promise((r) => setTimeout(r, 30)); this.ptr(el, 'pointerup', x1, y1, id); },
  top() { return document.querySelector('#mStack .m-view:last-child'); },
  // interactive things on screen: [selector, minW, minH]
  targets(root) {
    const out = [];
    root.querySelectorAll('button, [role="slider"], input, select, .m-row, .m-band').forEach((el) => {
      if (!this.vis(el) || el.closest('[hidden]') || el.type === 'checkbox') return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const sc = el.closest('.m-view, .m-page, .m-sheet-body, .m-qlist, .m-hscroll, .m-presets');
      if (sc) { const s = sc.getBoundingClientRect(); if (r.bottom <= s.top + 1 || r.top >= s.bottom - 1 || r.right <= s.left + 1 || r.left >= s.right - 1) return; }   // scrolled out of its scroller
      out.push({ el, r, name: (el.id || el.className || el.tagName).toString().slice(0, 40) + (el.textContent || '').trim().slice(0, 18) });
    });
    return out;
  },
  small(root, minW = 44, minH = 44) { return this.targets(root).filter((t) => { const isRow = t.el.classList.contains('m-row'); const isBand = t.el.classList.contains('m-band'); return isBand ? t.r.width < 28 || t.r.height < 150 : isRow ? t.r.height < 56 : (t.r.width < minW - 0.5 || t.r.height < minH - 0.5); }).map((t) => t.name + ' ' + Math.round(t.r.width) + 'x' + Math.round(t.r.height)); },
  // nothing interactive under the status bar or the gesture bar; nothing sticks out sideways
  unsafe(root, sat, sab) { return this.targets(root).filter((t) => { const sc = t.el.closest('.m-view, .m-page, .m-sheet-body, .m-qlist'); const cl = sc ? sc.getBoundingClientRect() : null; const top = cl ? Math.max(t.r.top, cl.top) : t.r.top, bot = cl ? Math.min(t.r.bottom, cl.bottom) : t.r.bottom; return top < sat - 0.5 || bot > innerHeight - sab + 0.5; }).map((t) => t.name + '@' + Math.round(t.r.top) + '-' + Math.round(t.r.bottom)); },
  overflow(root) { const W = innerWidth; return [...root.querySelectorAll('*')].filter((e) => { if (!this.vis(e)) return false; if (e.closest('.m-hscroll, .m-presets')) return false; const r = e.getBoundingClientRect(); return r.right > W + 1 || r.left < -1; }).slice(0, 6).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 40) + ':' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)); },
};`;

async function phone([W, Hh]) {
  const tag = `${W}x${Hh}`;
  const { browser, page, errors } = await open({ port: 8970 + W % 10, width: W, height: Hh, insets: [32, 0, 24, 0] });
  await page.evaluate(H);
  const SAT = 32, SAB = 24;
  const ev = (f, ...a) => page.evaluate(f, ...a);
  ok(await ev(() => document.body.classList.contains('m-ui') && window.LucielMobile.tab === 'player'), `[${tag}] phone layout on, opens on Now Playing`);
  ok(await ev(() => getComputedStyle(document.getElementById('app')).display === 'none' && getComputedStyle(document.getElementById('winLib')).display === 'none'), `[${tag}] the desktop windows (player, library panel) are not shown`);
  // ---- player
  await ev(() => { const A = window.Luciel.app; A.playTrack(A.tracks[0]); }); await wait(page, 1500);
  const pl = await ev(([sat, sab]) => { const s = document.getElementById('mShell'); return { small: __h.small(s), unsafe: __h.unsafe(s, sat, sab), over: __h.overflow(document.getElementById('mShell')), sw: document.documentElement.scrollWidth, stage: document.getElementById('mStage').getBoundingClientRect().height, sb: document.getElementById('stage').getBoundingClientRect().height, title: document.getElementById('mTitle').textContent }; }, [SAT, SAB]);
  ok(!pl.small.length, `[${tag}] player: every control is a big touch target` + (pl.small.length ? ' ' + pl.small.join(', ') : ''));
  ok(!pl.unsafe.length, `[${tag}] player: nothing under the status bar or gesture bar` + (pl.unsafe.length ? ' ' + pl.unsafe.join(', ') : ''));
  ok(!pl.over.length && pl.sw <= W, `[${tag}] player: no horizontal overflow (scrollWidth ${pl.sw})` + (pl.over.length ? ' ' + pl.over.join(', ') : ''));
  ok(pl.stage > 180 && pl.sb > 100, `[${tag}] the Lucielle stage is on top and sized (${Math.round(pl.stage)}px, canvas ${Math.round(pl.sb)}px)`);
  ok(pl.title && pl.title !== 'Nothing playing', `[${tag}] title shown (${pl.title})`);
  const clipped = await ev(() => [...document.querySelectorAll('#mTabs button span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  ok(!clipped.length, `[${tag}] tab labels fit (no "Now Playi…")` + (clipped.length ? ' clipped: ' + clipped.join(', ') : ''));
  // seek with the big seek bar
  const sk = await ev(async () => { const a = window.Luciel.app.engine.audio, el = document.getElementById('mSeek'), r = el.getBoundingClientRect(); __h.ptr(el, 'pointerdown', r.left + r.width / 2, r.top + r.height / 2); __h.ptr(el, 'pointerup', r.left + r.width / 2, r.top + r.height / 2); await new Promise((x) => setTimeout(x, 400)); return { t: a.currentTime, d: a.duration, h: r.height }; });
  ok(Math.abs(sk.t - sk.d / 2) < 1.5 && sk.h >= 44, `[${tag}] tapping the middle of the seek bar seeks to the middle (${sk.t.toFixed(1)}/${sk.d.toFixed(1)}s, hit area ${sk.h}px)`);
  ok(await ev(async () => { document.getElementById('mPlay').click(); await new Promise((r) => setTimeout(r, 300)); const p1 = window.Luciel.app.engine.audio.paused; document.getElementById('mPlay').click(); await new Promise((r) => setTimeout(r, 500)); return p1 && !window.Luciel.app.engine.audio.paused; }), `[${tag}] big play button pauses and resumes`);
  ok(await ev(async () => { const A = window.Luciel.app, c = A.current; document.getElementById('mNext').click(); await new Promise((r) => setTimeout(r, 600)); const n = A.current; document.getElementById('mPrev').click(); await new Promise((r) => setTimeout(r, 600)); return n !== c && A.current === c; }), `[${tag}] next / previous`);
  ok(await ev(() => { const S = window.Luciel.app.settings, s0 = S.shuffle; document.getElementById('mShuffle').click(); const s1 = S.shuffle; document.getElementById('mRepeat').click(); const r = S.repeat; document.getElementById('mShuffle').click(); return s1 !== s0 && r !== 'off' && document.getElementById('mRepeat').classList.contains('on'); }), `[${tag}] shuffle / repeat in the secondary row`);
  // stage: swipe = visualizer mode, tap = immersive
  const sw = await ev(async () => { const st = document.getElementById('mStage'), r = st.getBoundingClientRect(), y = r.top + r.height * 0.5, m0 = window.Luciel.app.settings.vizMode; await __h.drag(st, r.left + r.width * 0.8, y, r.left + r.width * 0.2, y); return [m0, window.Luciel.app.settings.vizMode]; });
  ok(sw[0] !== sw[1], `[${tag}] swiping the stage switches the visualizer (${sw[0]} -> ${sw[1]})`);
  const im = await ev(async () => { const st = document.getElementById('mStage'), c = __h.center(st); __h.ptr(st, 'pointerdown', c.x, c.y); __h.ptr(st, 'pointerup', c.x, c.y); await new Promise((r) => setTimeout(r, 400)); const r = st.getBoundingClientRect(); return { on: window.LucielMobile.immersive, cls: document.body.classList.contains('m-immersive'), w: r.width, h: r.height, tabs: __h.vis(document.getElementById('mTabs')), call: window.__calls.includes('immersive:true') }; });
  ok(im.on && im.cls && im.w === W && im.h === Hh && !im.tabs && im.call, `[${tag}] tapping the stage goes immersive full screen (system bars hidden natively)`);
  ok(await ev(() => window.LucielAndroidBridge.back() === true && !window.LucielMobile.immersive && window.__calls.includes('immersive:false')), `[${tag}] back leaves immersive mode`);
  // ---- tabs + mini player
  await ev(() => document.querySelector('#mTabs [data-tab="library"]').click()); await wait(page, 500);
  const mini = await ev(() => { const m = document.getElementById('mMini'), t = document.getElementById('mTabs'); return { vis: __h.vis(m), above: m.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 0.5, title: document.getElementById('mMiniTitle').textContent }; });
  ok(mini.vis && mini.above && mini.title, `[${tag}] mini "now playing" bar sits above the tabs on the Library tab (${mini.title})`);
  ok(await ev(async () => { document.getElementById('mMiniPlay').click(); await new Promise((r) => setTimeout(r, 300)); const p = window.Luciel.app.engine.audio.paused; document.getElementById('mMiniPlay').click(); await new Promise((r) => setTimeout(r, 400)); return p && !window.Luciel.app.engine.audio.paused && window.LucielMobile.tab === 'library'; }), `[${tag}] mini bar play/pause works without leaving the Library`);
  // ---- library drill-down
  const home = await ev(([sat, sab]) => { const v = __h.top(); return { t: v.dataset.type, rows: [...v.querySelectorAll('[data-go]')].map((b) => b.dataset.go), small: __h.small(document.getElementById('mShell')), unsafe: __h.unsafe(document.getElementById('mShell'), sat, sab), over: __h.overflow(document.getElementById('mShell')), search: getComputedStyle(v.querySelector('.m-search')).position }; }, [SAT, SAB]);
  ok(home.t === 'home' && ['songs', 'artists', 'albums', 'genres', 'playlists', 'smart:recent', 'smart:most', 'smart:played', 'smart:fav', 'smart:bpm'].every((x) => home.rows.includes(x)), `[${tag}] Library home lists Songs, Artists, Albums, Genres, Playlists + smart lists`);
  ok(home.search === 'sticky', `[${tag}] search field is sticky`);
  ok(!home.small.length && !home.unsafe.length && !home.over.length, `[${tag}] Library home: touch targets, safe areas, no overflow` + [home.small, home.unsafe, home.over].map((x) => x.join(',')).join(' '));
  const art = await ev(async () => { __h.top().querySelector('[data-go="artists"]').click(); await new Promise((r) => setTimeout(r, 450)); const v = __h.top(); const rows = v.querySelectorAll('.m-artist'); const first = rows[0]; const name = first.querySelector('b').textContent; first.click(); await new Promise((r) => setTimeout(r, 450)); const a = __h.top(); return { n: rows.length, name, type: a.dataset.type, title: a.querySelector('h2').textContent, albums: a.querySelectorAll('.m-card').length, songs: a.querySelectorAll('.m-track').length, back: !!a.querySelector('.m-back'), depth: window.LucielMobile.depth }; });
  ok(art.n >= 5 && art.type === 'artist' && art.title === art.name && art.albums >= 1 && art.songs >= 3 && art.back && art.depth === 3, `[${tag}] Artists -> ${art.name}: ${art.albums} albums, ${art.songs} songs, header with back chevron`);
  const alb = await ev(async () => { const c = __h.top().querySelector('.m-card'); const n = c.querySelector('b').textContent; c.click(); await new Promise((r) => setTimeout(r, 450)); const v = __h.top(); return { type: v.dataset.type, title: v.querySelector('h2').textContent, n, tracks: [...v.querySelectorAll('.m-track .m-no')].map((x) => x.textContent) }; });
  ok(alb.type === 'album' && alb.title === alb.n && alb.tracks.length >= 3 && alb.tracks[0] === '1', `[${tag}] artist -> album "${alb.n}" with numbered tracks (${alb.tracks.join(',')})`);
  ok(await ev(async () => { const v = __h.top(), r = v.querySelectorAll('.m-track')[1]; const id = r.dataset.id; r.click(); await new Promise((x) => setTimeout(x, 700)); const A = window.Luciel.app; return A.current && A.current.id === id && !A.engine.audio.paused && A.tracks.length === v.querySelectorAll('.m-track').length; }), `[${tag}] tapping a song plays the album from that song`);
  ok(await ev(async () => { const r = window.LucielAndroidBridge.back(); await new Promise((x) => setTimeout(x, 400)); return r === true && __h.top().dataset.type === 'artist'; }), `[${tag}] system back pops album -> artist`);
  // swipe back from the left edge
  const swb = await ev(async () => { const v = __h.top(), y = innerHeight / 2; await __h.drag(v, 6, y, innerWidth * 0.7, y, 10, 9); await new Promise((x) => setTimeout(x, 400)); return __h.top().dataset.type; });
  ok(swb === 'artists', `[${tag}] swipe from the left edge pops artist -> artists (${swb})`);
  // remembered scroll position
  const scr = await ev(async () => { window.LucielMobile.back(); await new Promise((x) => setTimeout(x, 350)); __h.top().querySelector('[data-go="songs"]').click(); await new Promise((x) => setTimeout(x, 400)); const v = __h.top(); v.scrollTop = 420; await new Promise((x) => setTimeout(x, 50)); const y0 = v.scrollTop; v.querySelectorAll('.m-track')[8].querySelector('[data-more]').click(); await new Promise((x) => setTimeout(x, 300)); const sheet = window.LucielMobile.sheet; const btn = [...document.querySelectorAll('#mSheetHost [data-a]')].find((b) => b.dataset.a === 'album'); btn.click(); await new Promise((x) => setTimeout(x, 450)); const depthIn = window.LucielMobile.depth; return { y0, sheet, depthIn }; });
  ok(scr.sheet === 'menu', `[${tag}] the row "⋯" opens the song sheet`);
  // "Go to album" jumps to Library > Albums > album; now test remembered scroll on a plain push/pop
  const scr2 = await ev(async () => { window.LucielMobile.goLib([{ type: 'songs' }]); await new Promise((x) => setTimeout(x, 400)); const v = __h.top(); v.scrollTop = 420; await new Promise((x) => setTimeout(x, 30)); const y0 = v.scrollTop; window.LucielMobile.push({ type: 'albums' }); await new Promise((x) => setTimeout(x, 400)); window.LucielMobile.back(); await new Promise((x) => setTimeout(x, 400)); return [y0, __h.top().scrollTop, __h.top().dataset.type]; });
  ok(scr2[0] > 100 && Math.abs(scr2[0] - scr2[1]) < 2 && scr2[2] === 'songs', `[${tag}] scroll position is remembered when you come back (${scr2[0]} -> ${scr2[1]})`);
  // albums grid
  const grid = await ev(async () => { window.LucielMobile.goLib([{ type: 'albums' }]); await new Promise((x) => setTimeout(x, 400)); const cards = [...__h.top().querySelectorAll('.m-card')]; const r = cards.slice(0, 2).map((c) => c.getBoundingClientRect()); return { n: cards.length, cols: r.length === 2 && Math.abs(r[0].top - r[1].top) < 1, w: r[0] && r[0].width }; });
  ok(grid.n >= 5 && grid.cols && grid.w > 140, `[${tag}] Albums is a 2-column cover grid (${grid.n} albums, ${Math.round(grid.w)}px covers)`);
  // search
  const sr = await ev(async () => { window.LucielMobile.goLib([]); await new Promise((x) => setTimeout(x, 300)); const i = __h.top().querySelector('.m-search input'); i.focus(); i.value = 'ember'; i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 400)); const v = __h.top(); const res = { artists: v.querySelectorAll('.m-artist').length, songs: v.querySelectorAll('.m-track').length, focus: document.activeElement === v.querySelector('.m-search input') }; v.querySelector('[data-act="clear"]').click(); await new Promise((x) => setTimeout(x, 200)); return res; });
  ok(sr.artists >= 1 && sr.songs >= 1 && sr.focus, `[${tag}] library search finds artists + songs and keeps the keyboard up (${sr.artists} artists, ${sr.songs} songs)`);
  // header ⋯ menu holds Add / Dir / New playlist / Import / Edit
  const menu = await ev(async ([sat, sab]) => { __h.top().querySelector('[data-act="menu"]').click(); await new Promise((x) => setTimeout(x, 350)); const items = [...document.querySelectorAll('#mSheetHost [data-a]')].map((b) => b.dataset.a); const sh = document.querySelector('#mSheetHost .m-sheet').getBoundingClientRect(); const last = [...document.querySelectorAll('#mSheetHost [data-a]')].pop().getBoundingClientRect(); const r = { items, bottomGap: innerHeight - last.bottom, sheetBottom: sh.bottom, small: __h.small(document.getElementById('mSheetHost')) }; return r; }, [SAT, SAB]);
  ok(['files', 'folder', 'newpl', 'm3u', 'scan'].every((x) => menu.items.includes(x)), `[${tag}] Add files / Add folder / New playlist / Import M3U / Scan live in the header ⋯ menu`);
  ok(menu.bottomGap >= SAB && !menu.small.length, `[${tag}] the menu sheet stays above the gesture bar (${Math.round(menu.bottomGap)}px gap) with big rows`);
  ok(await ev(async () => { const r = window.LucielAndroidBridge.back(); await new Promise((x) => setTimeout(x, 300)); return r && !window.LucielMobile.sheet; }), `[${tag}] back closes the sheet first`);
  // long-press -> context sheet -> Add to playlist -> New playlist
  const lp = await ev(async () => { window.LucielMobile.goLib([{ type: 'songs' }]); await new Promise((x) => setTimeout(x, 400)); const row = __h.top().querySelectorAll('.m-track')[2]; const id = row.dataset.id; const n0 = window.Luciel.app.current && window.Luciel.app.current.id; await __h.longPress(row); await new Promise((x) => setTimeout(x, 300)); const items = [...document.querySelectorAll('#mSheetHost [data-a]')].map((b) => b.dataset.a); const playedByClick = (window.Luciel.app.current && window.Luciel.app.current.id) !== n0; return { id, items, playedByClick }; });
  ok(['next', 'queue', 'pl', 'edit', 'fav'].every((x) => lp.items.includes(x)) && !lp.playedByClick, `[${tag}] long-press opens Play next / Add to queue / Add to playlist / Edit tags / Favorite (and doesn't also play)`);
  const np = await ev(async (id) => { document.querySelector('#mSheetHost [data-a="pl"]').click(); await new Promise((x) => setTimeout(x, 300)); document.querySelector('#mSheetHost [data-a="__new"]').click(); await new Promise((x) => setTimeout(x, 300)); const i = document.querySelector('#mSheetHost .m-ask input'); i.value = 'Road Trip'; document.querySelector('#mSheetHost .m-ask').requestSubmit(); await new Promise((x) => setTimeout(x, 500)); const p = window.Luciel.app.library.playlists.find((x) => x.name === 'Road Trip'); return p && p.ids.includes(id); }, lp.id);
  ok(np, `[${tag}] "Add to playlist" -> "New playlist…" creates the playlist with the song`);
  const plv = await ev(async () => { window.LucielMobile.goLib([{ type: 'playlists' }]); await new Promise((x) => setTimeout(x, 400)); const r = __h.top().querySelector('.m-pl'); const name = r && r.querySelector('b').textContent; r.click(); await new Promise((x) => setTimeout(x, 400)); return { name, type: __h.top().dataset.type, n: __h.top().querySelectorAll('.m-track').length }; });
  ok(plv.name === 'Road Trip' && plv.type === 'playlist' && plv.n === 1, `[${tag}] Playlists -> playlist tracks`);
  ok(await ev(async () => { const row = __h.top().querySelector('.m-track'); await __h.longPress(row); await new Promise((x) => setTimeout(x, 300)); const b = document.querySelector('#mSheetHost [data-a="unpl"]'); if (!b) return false; b.click(); await new Promise((x) => setTimeout(x, 500)); return window.Luciel.app.library.playlists.find((x) => x.name === 'Road Trip').ids.length === 0 && __h.top().querySelectorAll('.m-track').length === 0; }), `[${tag}] "Remove from this playlist" updates the open playlist`);
  // smart lists
  ok(await ev(async () => { window.LucielMobile.goLib([{ type: 'smart', key: 'smart:recent' }]); await new Promise((x) => setTimeout(x, 400)); const v = __h.top(); return v.querySelector('h2').textContent === 'Recently added' && v.querySelectorAll('.m-track').length >= 10; }), `[${tag}] smart list Recently added`);
  // ---- EQ sheet
  await ev(() => window.LucielMobile.setTab('player')); await wait(page, 300);
  const eq = await ev(async ([sat, sab]) => { document.getElementById('mEq').click(); await new Promise((x) => setTimeout(x, 400)); const host = document.getElementById('mSheetHost'); const bands = [...host.querySelectorAll('.m-band')]; const b1 = bands[1], vs = b1.querySelector('.m-vs'), r = vs.getBoundingClientRect(); __h.ptr(b1, 'pointerdown', r.left + r.width / 2, r.top + 2); __h.ptr(b1, 'pointermove', r.left + r.width / 2, r.top + 1); __h.ptr(b1, 'pointerup', r.left + r.width / 2, r.top + 1); await new Promise((x) => setTimeout(x, 200)); const A = window.Luciel.app; const g = A.engine.filters ? A.engine.filters[0].gain.value : null; const res = { n: bands.length, s: A.settings.eq[0], eng: A.engine.gains[0], g, desk: +document.querySelectorAll('#eqSliders .eq-band input')[1].value, preset: A.settings.preset, h: r.height, small: __h.small(host), unsafe: __h.unsafe(host, sat, sab), over: __h.overflow(host) };
    host.querySelector('[data-preset="Rock"]').click(); await new Promise((x) => setTimeout(x, 200)); res.rock = A.settings.preset; res.rockEq = A.settings.eq.join(','); return res; }, [SAT, SAB]);
  ok(eq.n === 11 && eq.h >= 150, `[${tag}] EQ sheet: preamp + 10 vertical sliders, ${Math.round(eq.h)}px tall`);
  ok(eq.s === 12 && eq.eng === 12 && eq.desk === 12 && eq.preset === 'Custom', `[${tag}] dragging the 31 Hz slider to the top sets +12 dB in the app EQ + engine (${eq.s}, engine ${eq.eng}, filter gain ${eq.g && eq.g.toFixed(1)})`);
  ok(eq.rock === 'Rock' && eq.rockEq !== '12,0,0,0,0,0,0,0,0,0', `[${tag}] preset chips apply presets (${eq.rockEq})`);
  ok(!eq.small.length && !eq.unsafe.length && !eq.over.length, `[${tag}] EQ sheet: touch targets, above the gesture bar, no overflow ` + [eq.small, eq.unsafe, eq.over].map((x) => x.join(',')).join(' '));
  await ev(() => { window.Luciel.app.applyPreset('Flat'); window.LucielMobile.closeSheet(true); });
  // ---- queue sheet: drag to reorder, tap to play, remove
  await ev(async () => { const A = window.Luciel.app; A.api.playList(A.api.all(), 0); await new Promise((x) => setTimeout(x, 600)); });
  const q = await ev(async ([sat, sab]) => { document.getElementById('mQueue').click(); await new Promise((x) => setTimeout(x, 400)); const host = document.getElementById('mSheetHost'); const A = window.Luciel.app; const ids0 = A.tracks.map((t) => t.id); const h = host.querySelector('.m-qrow[data-i="0"] .m-handle'), row = h.closest('.m-qrow'), rr = row.getBoundingClientRect(), c = __h.center(h); host.querySelector('#mQList').scrollTop = 0; await __h.drag(h, c.x, c.y, c.x, c.y + rr.height * 2 + 4, 14, 11); await new Promise((x) => setTimeout(x, 300)); const ids1 = A.tracks.map((t) => t.id); const res = { moved: ids1[2] === ids0[0] && ids1[0] === ids0[1] && ids1[1] === ids0[2], n: ids1.length, small: __h.small(host), unsafe: __h.unsafe(host, sat, sab) };
    const r3 = host.querySelector('.m-qrow[data-i="3"]'); const id3 = r3.dataset.id; r3.click(); await new Promise((x) => setTimeout(x, 600)); res.tapPlay = A.current.id === id3;
    host.querySelector('.m-qrow[data-i="5"] [data-del]').click(); await new Promise((x) => setTimeout(x, 300)); res.removed = A.tracks.length === res.n - 1 && host.querySelectorAll('.m-qrow').length === res.n - 1; return res; }, [SAT, SAB]);
  ok(q.moved, `[${tag}] queue sheet: dragging the handle reorders the queue`);
  ok(q.tapPlay && q.removed, `[${tag}] queue sheet: tap plays, × removes (list updates live)`);
  ok(!q.small.length && !q.unsafe.length, `[${tag}] queue sheet: touch targets + gesture bar ` + [q.small, q.unsafe].map((x) => x.join(',')).join(' '));
  // drag-down on the grabber closes a sheet
  ok(await ev(async () => { const g = document.querySelector('#mSheetHost .m-grab'), c = __h.center(g); await __h.drag(g, c.x, c.y, c.x, c.y + 200, 8, 13); await new Promise((x) => setTimeout(x, 350)); return !window.LucielMobile.sheet; }), `[${tag}] dragging a sheet down closes it`);
  // ---- visuals + settings tabs
  const vs = await ev(async ([sat, sab]) => { document.querySelector('#mTabs [data-tab="visuals"]').click(); await new Promise((x) => setTimeout(x, 300)); const p = document.getElementById('mVisuals'); const sc = p.querySelectorAll('[data-scene]'); sc[3].click(); await new Promise((x) => setTimeout(x, 200)); const picked = window.Luciel.app.settings.scene === sc[3].dataset.scene || window.Luciel.app.settings.scene === document.querySelectorAll('#mVisuals [data-scene]')[3].dataset.scene; return { n: sc.length, picked, small: __h.small(document.getElementById('mShell')), unsafe: __h.unsafe(document.getElementById('mShell'), sat, sab), over: __h.overflow(document.getElementById('mShell')) }; }, [SAT, SAB]);
  ok(vs.n >= 10 && vs.picked && !vs.small.length && !vs.unsafe.length && !vs.over.length, `[${tag}] Visuals tab: scene grid works; targets/safe areas/overflow ok ` + [vs.small, vs.unsafe, vs.over].map((x) => x.join(',')).join(' '));
  await ev(() => window.Luciel.app.setScene('auto', true));
  const st = await ev(async ([sat, sab]) => { document.querySelector('#mTabs [data-tab="settings"]').click(); await new Promise((x) => setTimeout(x, 300)); const p = document.getElementById('mSettings'); p.querySelector('[data-theme="red|classic"]').click(); await new Promise((x) => setTimeout(x, 400)); const th = document.body.dataset.palette + '|' + document.body.dataset.skin; const af = p.querySelector('[data-opt="__autoFloater"]'); af.click(); await new Promise((x) => setTimeout(x, 100)); const res = { th, af: window.__prefs.autoFloater, small: __h.small(document.getElementById('mShell')), unsafe: __h.unsafe(document.getElementById('mShell'), sat, sab), over: __h.overflow(document.getElementById('mShell')) }; p.querySelector('[data-theme="aero|aero"]').click(); return res; }, [SAT, SAB]);
  ok(st.th === 'red|classic', `[${tag}] Settings: theme cards switch palette + skin (${st.th})`);
  ok(st.af === true, `[${tag}] Settings: "Pop out when leaving the app" saved natively`);
  ok(!st.small.length && !st.unsafe.length && !st.over.length, `[${tag}] Settings tab: targets/safe areas/overflow ` + [st.small, st.unsafe, st.over].map((x) => x.join(',')).join(' '));
  // pop out
  ok(await ev(async () => { window.LucielMobile.setTab('player'); await new Promise((x) => setTimeout(x, 200)); const b = document.getElementById('mPopOut'); const v = __h.vis(b); b.click(); return v && window.__calls.includes('floater:show'); }), `[${tag}] "Pop out" button on the player opens the native floater`);
  // back order: tab -> player -> Android
  ok(await ev(() => { window.LucielMobile.setTab('visuals'); const a = window.LucielAndroidBridge.back(); const t = window.LucielMobile.tab; const b = window.LucielAndroidBridge.back(); return a === true && t === 'player' && b === false; }), `[${tag}] back: other tab -> Now Playing -> leaves to Android`);
  // classic on a phone keeps the same touch layout
  const cl = await ev(async ([sat, sab]) => { window.Luciel.app.applyTheme('blue', 'classic'); await new Promise((x) => setTimeout(x, 500)); const s = document.getElementById('mShell'); const px = document.getElementById('pxStage').getBoundingClientRect(); return { small: __h.small(s), unsafe: __h.unsafe(s, sat, sab), over: __h.overflow(document.getElementById('mShell')), px: px.height, lcd: __h.vis(document.getElementById('lcd')), font: getComputedStyle(document.getElementById('mTitle')).fontFamily }; }, [SAT, SAB]);
  ok(cl.px > 150 && cl.lcd && /Silkscreen/.test(cl.font) && !cl.small.length && !cl.unsafe.length && !cl.over.length, `[${tag}] Classic on a phone: pixel stage (${Math.round(cl.px)}px) + LCD + pixel font, same touch layout ` + [cl.small, cl.unsafe, cl.over].map((x) => x.join(',')).join(' '));
  await ev(() => window.Luciel.app.applyTheme('aero', 'aero'));
  ok(errors.length === 0, `[${tag}] no page errors` + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
}

async function audioAudit() {
  const { browser, page, errors } = await open({ port: 8979, width: 412, height: 915 });
  const ev = (f, ...a) => page.evaluate(f, ...a);
  // play from idle: a headset / notification "play" with nothing loaded starts the queue, never the file picker
  await ev(() => { window.__players = new Set(); const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__players.add(this); return play.apply(this, arguments); }; });
  const idle = await ev(async () => { window.__calls.length = 0; window.LucielAndroidBridge.cmd('play', 0); await new Promise((r) => setTimeout(r, 1200)); const A = window.Luciel.app; return { cur: !!A.current, playing: !A.engine.audio.paused, picker: window.__calls.filter((c) => /pick/.test(c)) }; });
  ok(idle.cur && idle.playing && !idle.picker.length, `[audio] "play" from the notification with nothing loaded plays the queue (no file picker)`);
  // exactly one audio element, one playback
  
  // toggle twice quickly, then next: still a single playing element and a consistent state
  const dbl = await ev(async () => { const B = window.LucielAndroidBridge, A = window.Luciel.app; B.cmd('toggle'); B.cmd('toggle'); B.cmd('next'); B.cmd('play'); await new Promise((r) => setTimeout(r, 1200)); const r = window.__reports[window.__reports.length - 1]; return { playing: !A.engine.audio.paused, rep: r.playing, id: r.id === A.current.id }; });
  ok(await ev(() => (() => { const aud = [...window.__players].filter((m) => !m.muted); return aud.length === 1 && aud[0] === window.Luciel.app.engine.audio; })()), `[audio] only the engine's one audio element ever plays sound (scene/dance videos are muted visuals) — no double playback`);
  ok(dbl.playing && dbl.rep && dbl.id, `[audio] rapid toggle/next/play from the session ends playing the right song, state reported`);
  // EQ really changes the signal (the analyser sits after the EQ, right before the output)
  const eqE = await ev(async () => {
    const A = window.Luciel.app, an = A.engine.analyser, buf = new Uint8Array(an.frequencyBinCount);
    const sr = A.engine.ctx.sampleRate, bin = (f) => Math.round(f / (sr / an.fftSize));
    const meas = async () => { let s = 0, n = 0; for (let k = 0; k < 20; k++) { await new Promise((r) => setTimeout(r, 50)); an.getByteFrequencyData(buf); for (let i = bin(40); i <= bin(70); i++) { s += buf[i]; n++; } } return s / n; };
    const set = (v) => { const ins = [...document.querySelectorAll('#eqSliders .eq-band input')].filter((i) => i.id !== 'preamp'); [0, 1].forEach((i) => { ins[i].value = v; ins[i].dispatchEvent(new Event('input', { bubbles: true })); }); };
    set(-12); await new Promise((r) => setTimeout(r, 300)); const lo = await meas();
    set(12); await new Promise((r) => setTimeout(r, 300)); const hi = await meas();
    A.applyPreset('Flat'); return { lo, hi };
  });
  ok(eqE.hi - eqE.lo > 25, `[audio] EQ affects the output: 55 Hz energy ${eqE.lo.toFixed(0)} at -12 dB vs ${eqE.hi.toFixed(0)} at +12 dB`);
  // near-gapless track change + no "stopped" report between songs (keeps the media session / foreground service alive)
  const gap = await ev(async () => {
    const A = window.Luciel.app, a = A.engine.audio; A.settings.repeat = 'off';
    a.currentTime = Math.max(0, a.duration - 1.2);
    const r0 = window.__reports.length;
    const t = await new Promise((res) => { let te = 0; const onEnd = () => { te = performance.now(); }; const onPlay = () => { if (te) { a.removeEventListener('ended', onEnd); a.removeEventListener('playing', onPlay); res(performance.now() - te); } }; a.addEventListener('ended', onEnd); a.addEventListener('playing', onPlay); setTimeout(() => res(-1), 8000); });
    await new Promise((r) => setTimeout(r, 300));
    const reps = window.__reports.slice(r0);
    return { gap: t, stops: reps.filter((r) => !r.playing).length, n: reps.length, last: reps[reps.length - 1] };
  });
  ok(gap.gap >= 0 && gap.gap < 500, `[audio] auto-advance gap ${gap.gap.toFixed(0)} ms (ended -> next song playing)`);
  ok(gap.stops === 0 && gap.last && gap.last.playing, `[audio] no "paused" state reported to Android between songs (${gap.n} reports)`);
  // BPM / beat sync is reported for the floater and matches the tracker after a seek
  const bpm = await ev(async () => { const A = window.Luciel.app, a = A.engine.audio; await new Promise((r) => { const f = () => (A.tracker.bpm > 0 ? r() : setTimeout(f, 200)); f(); setTimeout(r, 15000); }); a.currentTime = 5; await new Promise((r) => setTimeout(r, 600)); const r = window.__reports[window.__reports.length - 1]; return { bpm: r.bpm, tr: A.tracker.bpm, beat: r.beatPos, want: A.tracker.beatAt(r.position), pos: r.position, skin: r.skin, accent: r.accent }; });
  ok(bpm.bpm > 40 && Math.abs(bpm.bpm - bpm.tr) < 0.5 && Math.abs(bpm.beat - bpm.want) < 0.05 && bpm.accent && bpm.skin, `[audio] tempo + beat phase reported with the position (bpm ${bpm.bpm}, beat ${bpm.beat} @ ${bpm.pos.toFixed(2)}s) and the theme (${bpm.skin}, ${bpm.accent})`);
  // pause from the notification while a song change is pending is respected
  ok(await ev(async () => { const B = window.LucielAndroidBridge; B.cmd('pause'); await new Promise((r) => setTimeout(r, 400)); const r = window.__reports[window.__reports.length - 1]; return window.Luciel.app.engine.audio.paused && r.playing === false; }), `[audio] notification pause -> paused state reported right away`);
  // resume after background: visibility change re-reports the state (WebView rAF stops while hidden)
  ok(await ev(async () => { const n = window.__reports.length; Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 300)); return window.__reports.length > n; }), `[audio] coming back to the app re-syncs the media session`);
  // Spotify mode doesn't fight local playback
  const sp = await ev(async () => { const A = window.Luciel.app, B = window.LucielAndroidBridge; B.cmd('play'); await new Promise((r) => setTimeout(r, 600)); window.__ext = { active: true, app: 'Spotify', title: 'X', artist: 'Y', playing: true, key: 'z', duration: 100, position: 1 }; B.ext(window.__ext); await new Promise((r) => setTimeout(r, 400)); const autoOn = window.LucielExt.on; B.extMode(true); await new Promise((r) => setTimeout(r, 300)); const localPausedOnEnter = A.engine.audio.paused; A.togglePlay(); await new Promise((r) => setTimeout(r, 500)); return { autoOn, localPausedOnEnter, extOffWhenLocal: !window.LucielExt.on, playing: !A.engine.audio.paused }; });
  ok(!sp.autoOn && sp.localPausedOnEnter && sp.extOffWhenLocal && sp.playing, `[audio] Spotify mode never auto-starts over local playback; entering it pauses Luciel; playing locally leaves it`);
  ok(errors.length === 0, '[audio] no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
}

async function desktopUnaffected() {
  const { browser, page, errors } = await open({ port: 8978, width: 1280, height: 800, android: false });
  const r = await page.evaluate(() => ({ m: document.body.classList.contains('m-ui'), app: getComputedStyle(document.getElementById('app')).display, shell: getComputedStyle(document.getElementById('mShell') || document.body).display }));
  ok(!r.m && r.app !== 'none', `[web 1280] wide window keeps the desktop layout (no phone UI)`);
  await page.setViewportSize({ width: 412, height: 900 }); await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => ({ m: document.body.classList.contains('m-ui'), inStage: document.getElementById('stageWrap').parentElement.id }));
  ok(r2.m && r2.inStage === 'mStage', `[web 412] a phone-width browser window gets the phone layout`);
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);
  const r3 = await page.evaluate(() => ({ m: document.body.classList.contains('m-ui'), parent: document.getElementById('stageWrap').parentElement.className, lcd: document.getElementById('lcd').previousElementSibling.id }));
  ok(!r3.m && r3.parent === 'main-body' && r3.lcd === 'stageWrap', `[web] widening again restores the desktop DOM exactly (${r3.parent})`);
  ok(errors.length === 0, '[web] no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
}

(async () => {
  for (const s of SIZES) await phone(s);
  if (!process.env.NO_AUDIO) await audioAudit();
  if (!process.env.NO_DESK) await desktopUnaffected();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
