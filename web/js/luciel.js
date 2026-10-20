/* Luciel — Lucielle mascot, music-reactive scenes and particles.
 * Data: window.LUCIEL_SCENES (art/scenes.js) and window.LUCIEL_MASCOT (mascot/mascot-data.js), both generated
 * by tools/build_assets.py so new art drops in by re-running the script. */
(function (global) {
  'use strict';
  // scenes come from visual packs: the built-in 'Luciel Core' pack (packs/luciel-core/pack.js) + imported packs (js/packs.js)
  const PK = global.LucielPacks;
  let CORE = [];
  if (global.LUCIEL_CORE_PACK && PK) { const v = PK.validate(global.LUCIEL_CORE_PACK, new Map(), { builtin: true }); if (v.ok) CORE = PK.toScenes(v.pack, (p) => p, { builtin: true }); else console.warn('[luciel] core pack invalid', v.errors); }
  if (!CORE.length) CORE = (global.LUCIEL_SCENES && global.LUCIEL_SCENES.scenes) || [];
  let EXTRA = [], SCN = CORE.slice();
  const ctx = { palette: 'aero', skin: 'aero' };
  /** imported scenes may be limited to some colour themes / skins for auto selection */
  const fits = (s) => (!s.themes || !s.themes.length || s.themes.includes(ctx.palette)) && (!s.skins || !s.skins.length || s.skins.includes(ctx.skin));
  const seedOf = (t) => { let h = 0; const x = String(t || ''); for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0; return Math.abs(h); };
  const MD = global.LUCIEL_MASCOT || { rig: {}, dance: {}, pixel: {}, behavior: {} };
  const TAU = Math.PI * 2;
  const NOREACT = { beatZoom: 1, bassGlow: 1, shake: 1, flash: 1, particles: 1 };
  const rgba = (hex, a) => { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = (x) => x - Math.floor(x);
  const rnd = (a, b) => a + Math.random() * (b - a);

  const imgCache = new Map();
  function img(src) {
    if (!src) return null;
    let i = imgCache.get(src);
    if (!i) { i = new Image(); i.decoding = 'async'; i.src = src; imgCache.set(src, i); }
    return i;
  }
  const ready = (i) => i && i.complete && i.naturalWidth > 0;

  // ------------------------------------------------------------------ particles
  const PDEF = {
    bubbles:  { n: 26, spawn: (W, H) => ({ x: rnd(0, W), y: H + 20, vx: 0, vy: -rnd(18, 45), s: rnd(5, 22), life: 99, ph: rnd(0, TAU) }) },
    sparkles: { n: 22, spawn: (W, H) => ({ x: rnd(0, W), y: rnd(0, H), vx: 0, vy: -rnd(2, 8), s: rnd(3, 9), life: rnd(0.8, 2.2), ph: rnd(0, TAU) }) },
    rain:     { n: 90, spawn: (W, H) => ({ x: rnd(-40, W), y: rnd(-H * 0.3, -5), vx: 60, vy: rnd(420, 620), s: rnd(8, 18), life: 99 }) },
    embers:   { n: 40, spawn: (W, H) => ({ x: rnd(0, W), y: H + 10, vx: rnd(-12, 12), vy: -rnd(30, 90), s: rnd(1.5, 4), life: rnd(2, 5), ph: rnd(0, TAU) }) },
    slime:    { n: 18, spawn: (W, H) => ({ x: rnd(0, W), y: -10, vx: 0, vy: rnd(40, 120), s: rnd(4, 9), life: 99, ph: rnd(0, TAU) }) },
    smoke:    { n: 10, spawn: (W, H) => ({ x: rnd(0, W), y: H + 40, vx: rnd(-6, 6), vy: -rnd(6, 16), s: rnd(50, 120), life: rnd(10, 18), ph: rnd(0, TAU) }) },
    dust:     { n: 40, spawn: (W, H) => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-4, 4), vy: rnd(-4, 4), s: rnd(1, 2.6), life: rnd(4, 9), ph: rnd(0, TAU) }) },
    sparks:   { n: 30, spawn: (W, H) => { const l = Math.random() < 0.5; return { x: l ? rnd(0, W * 0.2) : rnd(W * 0.8, W), y: H, vx: (l ? 1 : -1) * rnd(20, 90), vy: -rnd(160, 320), s: rnd(1.5, 3), life: rnd(0.8, 1.6), g: 260 }; } },
    feathers: { n: 14, spawn: (W, H) => ({ x: rnd(0, W), y: -20, vx: rnd(-10, 10), vy: rnd(18, 40), s: rnd(6, 12), life: 99, ph: rnd(0, TAU), rot: rnd(0, TAU) }) },
    notes:    { n: 10, spawn: (W, H) => ({ x: rnd(0, W), y: H + 10, vx: rnd(-8, 8), vy: -rnd(20, 45), s: rnd(12, 22), life: rnd(5, 9), ph: rnd(0, TAU), ch: Math.random() < 0.5 ? '♪' : '♫' }) },
    confetti: { n: 46, spawn: (W, H) => ({ x: rnd(0, W), y: -10, vx: rnd(-30, 30), vy: rnd(50, 120), s: rnd(3, 7), life: 99, rot: rnd(0, TAU), vr: rnd(-6, 6), hue: Math.floor(rnd(0, 360)) }) },
    hearts:   { n: 14, spawn: (W, H) => ({ x: rnd(0, W), y: H + 10, vx: rnd(-10, 10), vy: -rnd(20, 50), s: rnd(5, 11), life: rnd(4, 8), ph: rnd(0, TAU) }) },
    petals:   { n: 30, spawn: (W, H) => ({ x: rnd(-40, W), y: -10, vx: rnd(10, 40), vy: rnd(25, 60), s: rnd(3, 7), life: 99, rot: rnd(0, TAU), vr: rnd(-3, 3), ph: rnd(0, TAU) }) },
    stars:    { n: 46, keep: true, spawn: (W, H) => ({ x: rnd(0, W), y: rnd(0, H * 0.6), vx: 0, vy: 0, s: rnd(0.8, 2.4), life: 99, ph: rnd(0, TAU), tw: rnd(0.6, 2.4) }) },
    zzz:      { n: 5, spawn: (W, H) => ({ x: rnd(W * 0.3, W * 0.7), y: rnd(H * 0.4, H * 0.8), vx: rnd(4, 12), vy: -rnd(10, 22), s: rnd(10, 18), life: rnd(3, 5), ph: rnd(0, TAU) }) },
    grid:     { n: 0 },
    // autumn leaves tumbling on the wind, rising steam plumes, wordless neon score bursts (rings + stars)
    leaves:   { n: 22, spawn: (W, H) => ({ x: rnd(-60, W * 0.9), y: -14, vx: rnd(14, 48), vy: rnd(26, 58), s: rnd(5, 10), life: 99, rot: rnd(0, TAU), vr: rnd(-3.5, 3.5), ph: rnd(0, TAU), hue: Math.floor(rnd(0, 5)) }) },
    steam:    { n: 9, spawn: (W, H) => ({ x: rnd(W * 0.05, W * 0.95), y: H * rnd(0.82, 1.02), vx: rnd(-3, 9), vy: -rnd(10, 24), s: rnd(40, 95), life: rnd(5, 9), ph: rnd(0, TAU) }) },
    neon:     { n: 7, spawn: (W, H) => ({ x: rnd(W * 0.06, W * 0.94), y: rnd(H * 0.08, H * 0.7), vx: 0, vy: -rnd(4, 12), s: rnd(6, 13), life: rnd(0.7, 1.3), ph: rnd(0, TAU), hue: Math.floor(rnd(0, 3)) }) },
  };
  const LEAF = ['#e2581b', '#c8321e', '#f2a623', '#b5481a', '#f07d2a'], NEON = ['#ff3fd0', '#29f6ff', '#b46bff'];
  function leaf(g, s) {    // simple pointed leaf with a stem, drawn at the origin
    g.beginPath(); g.moveTo(-s, 0); g.quadraticCurveTo(-s * 0.2, -s * 0.75, s, 0); g.quadraticCurveTo(-s * 0.2, s * 0.75, -s, 0); g.fill();
    g.globalAlpha *= 0.6; g.fillRect(-s * 1.35, -0.6, s * 0.5, 1.2);
  }
  function heart(g, x, y, s) {
    g.beginPath(); g.moveTo(x, y + s * 0.35);
    g.bezierCurveTo(x, y, x - s, y - s * 0.1, x - s, y + s * 0.4); g.bezierCurveTo(x - s, y + s * 0.85, x, y + s * 1.05, x, y + s * 1.3);
    g.bezierCurveTo(x, y + s * 1.05, x + s, y + s * 0.85, x + s, y + s * 0.4); g.bezierCurveTo(x + s, y - s * 0.1, x, y, x, y + s * 0.35); g.fill();
  }
  function star4(g, x, y, s) {
    g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill();
  }
  class Particles {
    constructor(pixel) { this.pixel = pixel; this.list = []; this.types = []; this.t = 0; this.gridOff = 0; this.density = 1; }
    setTypes(types) {
      const key = (types || []).join(',');
      if (key === this.key) return;
      this.key = key; this.types = (types || []).filter((t) => PDEF[t]); this.list = []; this.prefill = true;
    }
    burst(type, n, x, y) {
      const d = PDEF[type]; if (!d) return;
      const W = this.W || 300, H = this.H || 300, sc = this.scale || 1;
      for (let i = 0; i < n; i++) {
        const p = d.spawn(W, H); p.type = type; p.burst = true; p.s *= sc;
        if (x == null) { this.list.push(p); continue; }           // no origin: spawn where the type normally appears
        p.x = x + rnd(-20, 20) * sc; p.y = y + rnd(-20, 20) * sc;
        if (type === 'leaves') { p.vx = rnd(40, 140); p.vy = rnd(-50, 20); p.life = rnd(2, 3.5); }   // a gust
        else if (type === 'neon') { p.x = x + rnd(-W * 0.35, W * 0.35); p.y = y + rnd(-H * 0.3, H * 0.15); p.life = rnd(0.6, 1.1); }
        else { p.vy = -rnd(30, 90); p.vx = rnd(-60, 60); p.life = rnd(1, 2); }
        this.list.push(p);
      }
    }
    update(dt, W, H, energy, scale) {
      this.W = W; this.H = H; this.scale = scale; this.t += dt;
      const sp = (0.45 + energy * 2.2);
      const areaK = clamp((W * H) / (scale * scale) / 260000, 0.15, 1.6) * this.density;
      for (const ty of this.types) {
        const d = PDEF[ty]; const target = Math.round(d.n * areaK * (d.keep ? 1 : (0.5 + energy)));
        let c = 0; for (const p of this.list) if (p.type === ty && !p.burst) c++;
        for (let k = 0; c < target && k < (this.prefill ? target : 3); k++, c++) {
          const p = d.spawn(W, H); p.type = ty; p.s *= scale;
          if (this.prefill && !d.keep) { p.y = rnd(0, H); }
          this.list.push(p);
        }
      }
      this.prefill = false;
      this.gridOff = (this.gridOff + dt * (0.25 + energy * 1.6)) % 1;
      const out = [];
      for (const p of this.list) {
        const m = p.type === 'stars' ? 0 : sp;
        p.life -= dt;
        if (p.g) p.vy += p.g * dt;
        p.x += (p.vx + (p.type === 'bubbles' || p.type === 'feathers' || p.type === 'petals' ? Math.sin(this.t * 1.7 + p.ph) * 14 : p.type === 'leaves' ? Math.sin(this.t * 1.3 + p.ph) * 26 : 0)) * dt * m * scale;
        p.y += p.vy * dt * m * scale;
        if (p.rot !== undefined) p.rot += (p.vr || 1) * dt;
        if (p.life > 0 && p.y > -H * 0.4 && p.y < H + 60 && p.x > -80 && p.x < W + 80) out.push(p);
      }
      this.list = out;
    }
    draw(g, W, H, C, beat) {
      const px = this.pixel;
      // the stage draws the floor grid itself, behind Lucielle (gridDone); other users (page backdrop) still get it here
      if (this.types.includes('grid') && !this.gridDone) this.drawGrid(g, W, H, C, beat);
      this.gridDone = false;
      for (const p of this.list) {
        const lifeA = p.life < 1 ? Math.max(0, p.life) : 1;
        const x = px ? Math.round(p.x) : p.x, y = px ? Math.round(p.y) : p.y, s = p.s;
        switch (p.type) {
          case 'bubbles':
            g.globalAlpha = 0.55 * lifeA;
            if (px) { g.fillStyle = C.bubble; g.fillRect(x - 1, y - 1, Math.max(2, s / 4), Math.max(2, s / 4)); break; }
            g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, s, 0, TAU); g.stroke();
            g.fillStyle = C.bubble; g.fill();
            g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x - s * 0.35, y - s * 0.35, s * 0.22, 0, TAU); g.fill(); break;
          case 'sparkles': case 'stars': {
            const tw = p.type === 'stars' ? 0.35 + 0.65 * Math.abs(Math.sin(this.t * p.tw + p.ph)) : Math.sin(Math.PI * clamp(p.life / 2, 0, 1));
            g.globalAlpha = clamp(tw * (0.6 + beat * 0.4), 0, 1); g.fillStyle = p.type === 'stars' ? '#fff' : C.gold;
            if (px) g.fillRect(x, y, s > 2 ? 2 : 1, s > 2 ? 2 : 1); else star4(g, x, y, s * (0.8 + beat * 0.5)); break; }
          case 'rain':
            g.globalAlpha = 0.45; g.strokeStyle = C.rain; g.lineWidth = px ? 1 : 1.2;
            if (px) { g.fillStyle = C.rain; g.fillRect(x, y, 1, Math.max(2, s / 4)); break; }
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.12, y - s); g.stroke(); break;
          case 'embers': case 'sparks': {
            const fl = 0.6 + 0.4 * Math.sin(this.t * 12 + (p.ph || 0));
            g.globalAlpha = clamp(lifeA * fl, 0, 1); g.fillStyle = p.type === 'sparks' ? C.spark : C.ember;
            if (px) { g.fillRect(x, y, 1, 1); break; }
            g.shadowColor = C.ember; g.shadowBlur = 8; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); g.shadowBlur = 0; break; }
          case 'slime':
            g.globalAlpha = 0.85; g.fillStyle = C.slime;
            if (px) { g.fillRect(x, y, 2, 3); g.fillRect(x, y - 3, 1, 3); break; }
            g.shadowColor = C.slime; g.shadowBlur = 10; g.beginPath(); g.ellipse(x, y, s * 0.6, s, 0, 0, TAU); g.fill();
            g.fillRect(x - s * 0.15, y - s * 2.4, s * 0.3, s * 1.6); g.shadowBlur = 0; break;
          case 'smoke': {
            g.globalAlpha = 0.07 * Math.min(1, p.life / 3);
            if (px) { g.fillStyle = C.smoke; g.fillRect(x - s / 6, y - s / 6, s / 3, s / 3); break; }
            const gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, C.smoke); gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); break; }
          case 'dust':
            g.globalAlpha = 0.55 * Math.sin(Math.PI * clamp(p.life / 6, 0, 1)); g.fillStyle = C.dust;
            if (px) g.fillRect(x, y, 1, 1); else { g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); } break;
          case 'feathers':
            g.globalAlpha = 0.85; g.fillStyle = '#fff';
            if (px) { g.fillRect(x, y, 3, 1); break; }
            g.save(); g.translate(x, y); g.rotate(p.rot + Math.sin(this.t * 2 + p.ph) * 0.6); g.beginPath(); g.ellipse(0, 0, s, s * 0.32, 0, 0, TAU); g.fill();
            g.strokeStyle = 'rgba(150,150,170,.6)'; g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke(); g.restore(); break;
          case 'notes': case 'zzz':
            g.globalAlpha = 0.8 * lifeA; g.fillStyle = p.type === 'zzz' ? '#fff' : C.note;
            g.font = `${px ? 8 : Math.round(s)}px ${px ? 'Silkscreen, monospace' : 'Selawik, sans-serif'}`;
            g.fillText(p.type === 'zzz' ? 'z' : p.ch, x, y); break;
          case 'confetti':
            g.globalAlpha = 0.9; g.fillStyle = `hsl(${p.hue},90%,62%)`;
            if (px) { g.fillRect(x, y, 2, 1 + (Math.sin(p.rot) > 0)); break; }
            g.save(); g.translate(x, y); g.rotate(p.rot); g.fillRect(-s / 2, -s / 4, s, s / 2 * Math.abs(Math.cos(p.rot * 1.3)) + 1); g.restore(); break;
          case 'hearts':
            g.globalAlpha = 0.8 * lifeA; g.fillStyle = C.heart;
            if (px) { g.fillRect(x, y, 1, 1); g.fillRect(x + 2, y, 1, 1); g.fillRect(x, y + 1, 3, 1); g.fillRect(x + 1, y + 2, 1, 1); break; }
            heart(g, x, y, s); break;
          case 'petals':
            g.globalAlpha = 0.85; g.fillStyle = C.petal;
            if (px) { g.fillRect(x, y, 2, 1); break; }
            g.save(); g.translate(x, y); g.rotate(p.rot); g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, TAU); g.fill(); g.restore(); break;
          case 'leaves':
            g.globalAlpha = 0.92 * lifeA; g.fillStyle = LEAF[p.hue || 0];
            if (px) { g.fillRect(x, y, 2, 2); if (Math.sin(p.rot) > 0) g.fillRect(x + 2, y + 1, 1, 1); break; }
            g.save(); g.translate(x, y); g.rotate(p.rot); g.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.rot * 0.7 + p.ph))); leaf(g, s); g.restore(); break;
          case 'steam': {
            g.globalAlpha = 0.09 * Math.min(1, p.life / 3) * Math.min(1, (9 - p.life) / 1.5 + 0.2);
            if (px) { g.fillStyle = 'rgba(210,215,230,1)'; g.fillRect(x - s / 8, y - s / 8, s / 4, s / 4); break; }
            const gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(215,220,235,1)'); gr.addColorStop(1, 'rgba(215,220,235,0)');
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); break; }
          case 'neon': {
            const k = clamp(p.life / 1.2, 0, 1), col = NEON[p.hue || 0];
            g.globalAlpha = clamp(k * 1.2, 0, 1); g.fillStyle = col; g.strokeStyle = col;
            if (px) { const r = Math.round((1 - k) * 6) + 1; g.fillRect(x, y, 1, 1); g.fillRect(x - r, y, 1, 1); g.fillRect(x + r, y, 1, 1); g.fillRect(x, y - r, 1, 1); g.fillRect(x, y + r, 1, 1); break; }
            g.shadowColor = col; g.shadowBlur = 12; star4(g, x, y, s * (0.6 + k * 0.6));
            g.lineWidth = 2; g.beginPath(); g.arc(x, y, s * (1 + (1 - k) * 3.2), 0, TAU); g.stroke(); g.shadowBlur = 0; break; }
        }
      }
      g.globalAlpha = 1;
    }
    drawGrid(g, W, H, C, beat) {
      const top = H * 0.62, n = 12;
      g.save(); g.globalAlpha = 0.55 + beat * 0.35; g.strokeStyle = C.grid; g.lineWidth = this.pixel ? 1 : 1.5;
      if (!this.pixel) { g.shadowColor = C.grid; g.shadowBlur = 8; }
      g.beginPath();
      for (let i = 0; i <= n; i++) { const z = Math.pow((i + this.gridOff) / n, 2.2); const y = Math.round(top + (H - top) * z) + 0.5; g.moveTo(0, y); g.lineTo(W, y); }
      for (let i = -10; i <= 10; i++) { g.moveTo(W / 2 + i * W * 0.02, top); g.lineTo(W / 2 + i * W * 0.22, H); }
      g.stroke(); g.restore();
    }
  }

  // ------------------------------------------------------------------ scene choice
  const Scenes = {
    get list() { return SCN; },
    get core() { return CORE; },
    get extra() { return EXTRA; },
    ctx,
    /** replace the imported (non-core) scenes; called by the pack manager after install / enable / delete */
    setExtra(list) { EXTRA = (list || []).filter((s) => s && s.id && !CORE.some((c) => c.id === s.id)); SCN = CORE.concat(EXTRA); },
    byId: (id) => SCN.find((s) => s.id === id),
    matchGenre(genre, title, kinds, withCover) {
      const g = (genre || '').toLowerCase(), t = (title || '').toLowerCase();
      if (!g && !t) return null;
      let best = [], bestLen = 0;
      for (const s of SCN) {
        if (kinds && !kinds.includes(s.kind)) continue;
        if (!fits(s)) continue;
        let sc = 0;
        for (const key of withCover ? (s.genres || []).concat(s.coverGenres || []) : s.genres || []) {
          const hit = g && (g === key || g.includes(key) || (key.length > 3 && key.includes(g)));
          const titleHit = (key === 'love' || key === 'romance') && /\blove\b|\bheart\b/.test(t);
          // exact tag match beats a substring match; among substring matches the longest key wins
          sc = Math.max(sc, g === key ? 1000 : (hit || titleHit) ? key.length : 0);
        }
        if (sc > bestLen) { best = [s]; bestLen = sc; } else if (sc && sc === bestLen) best.push(s);
      }
      // equally good matches (e.g. a pack scene for the same genre): pick one per track so both get seen
      return best.length ? best[seedOf(title) % best.length] : null;
    },
    matchMood(bpm, energy, title) {
      if (!bpm) return null;
      const hits = SCN.filter((s) => s.energy && s.bpm && fits(s) && energy >= s.energy[0] && energy <= s.energy[1] && bpm >= s.bpm[0] && bpm <= s.bpm[1]);
      return hits.length ? hits[seedOf(title) % hits.length] : null;
    },
    paletteDefault(palette, skin) {
      if (skin === 'classic') { const p = SCN.find((s) => s.kind === 'pixel' && s.palette === palette); if (p) return p; }
      return SCN.find((s) => s.kind === 'full' && s.palette === palette) || SCN[0];
    },
    coverFor(meta, palette) {
      const s = Scenes.matchGenre(meta && meta.genre, meta && meta.title, ['full'], true) || SCN.find((x) => x.kind === 'full' && x.palette === palette) || SCN.find((x) => x.kind === 'full');
      return s ? s.image : 'mascot/poses/idle.webp';
    },
  };

  // ------------------------------------------------------------------ dance sources
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  const vpAlpha = !isSafari && !!document.createElement('video').canPlayType('video/webm; codecs="vp9"');
  /** pack loop {sheet|video, frames, columns, loopBpm, beats} -> the built-in dance meta shape */
  const packDanceMeta = (d) => ({ sheet: d.sheet, webm: d.video, frames: d.frames || 1, cols: d.columns || 1, loopBpm: d.loopBpm || 120, duration: (d.beats || 8) * 60 / (d.loopBpm || 120), custom: true });
  class Dance {
    constructor(name, meta) {
      this.name = name; this.meta = meta || MD.dance[name]; this.sheet = this.meta.sheet ? img(this.meta.sheet) : null;
      this.video = null; if (!this.meta.webm) this.videoBroken = true;
    }
    ensureVideo() {
      if ((!vpAlpha && !this.meta.custom) || this.video) return;
      const v = this.video = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = this.meta.webm;
      v.addEventListener('error', () => { this.video = null; this.videoBroken = true; }, { once: true });
    }
    /** pos 0..1 within the loop, rate = playbackRate */
    frame(pos, rate, useVideo) {
      if (useVideo && !this.videoBroken) {
        this.ensureVideo(); const v = this.video;
        if (v) {
          if (v.paused) v.play().catch(() => {});
          const want = pos * this.meta.duration;
          let err = want - v.currentTime; if (err > this.meta.duration / 2) err -= this.meta.duration; if (err < -this.meta.duration / 2) err += this.meta.duration;
          if (Math.abs(err) > 0.35) { try { v.currentTime = want; } catch (e) {} } else v.playbackRate = clamp(rate * (1 + clamp(err * 0.8, -0.12, 0.12)), 0.25, 3);
          if (v.readyState >= 2) return { src: v, sx: 0, sy: 0, sw: v.videoWidth, sh: v.videoHeight };
        }
      }
      if (!ready(this.sheet)) return null;
      const m = this.meta, f = Math.floor(pos * m.frames) % m.frames;
      const fw = m.size || this.sheet.naturalWidth / m.cols, fh = m.size || this.sheet.naturalHeight / Math.ceil(m.frames / m.cols);
      return { src: this.sheet, sx: (f % m.cols) * fw, sy: Math.floor(f / m.cols) * fh, sw: fw, sh: fh };
    }
    pause() { if (this.video && !this.video.paused) this.video.pause(); }
  }

  // ------------------------------------------------------------------ character
  class Character {
    constructor() {
      this.poses = {}; this.layers = []; this.dances = {};
      Object.keys(MD.rig).forEach((k) => {
        const r = MD.rig[k];
        this.poses[k] = { meta: r, full: img(`mascot/poses/${k}.webp`), body: r.layers && img(r.layers.body), wings: r.layers ? r.layers.wings.map((w) => ({ ...w, im: img(w.file) })) : [] };
      });
      ['slow', 'mid', 'fast'].forEach((d) => { if (MD.dance[d]) this.dances[d] = new Dance(d); });
      this.px = MD.pixel && { idle: img(MD.pixel.idle && MD.pixel.idle.file), dance: img(MD.pixel.dance && MD.pixel.dance.file), meta: MD.pixel };
      this.custom = new Map();     // pack character loops, by url
    }
    /** a pack scene's loop for a tempo tier (nearest tier if that one is missing) */
    customDance(scene, tier) {
      const C = scene && scene.char; if (!C || !C.dance) return null;
      const order = { slow: ['slow', 'mid', 'fast'], mid: ['mid', 'slow', 'fast'], fast: ['fast', 'mid', 'slow'] }[tier] || ['mid', 'slow', 'fast'];
      const k = order.find((t) => C.dance[t]); if (!k) return null;
      const d = C.dance[k], key = d.sheet || d.video;
      if (!this.custom.has(key)) this.custom.set(key, new Dance(`${scene.id}|${k}`, packDanceMeta(d)));
      return this.custom.get(key);
    }
    /** a pack's animated emote (tempo-synced sprite-sheet loop, same machinery as the dance loops) */
    customLoop(scene, name, d) {
      const key = d.sheet;
      if (!this.custom.has(key)) this.custom.set(key, new Dance(`${scene.id}|emote-${name}`, packDanceMeta(d)));
      return this.custom.get(key);
    }
    /** layer = {kind:'pose'|'dance'|'pdance'|'pimg', name}; crossfades between consecutive layers */
    show(kind, name, ref, scale) {
      const top = this.layers[this.layers.length - 1];
      if (top && top.kind === kind && top.name === name) return;
      this.layers.forEach((l) => { l.target = 0; });
      this.layers.push({ kind, name, ref, scale: scale || 1, a: this.layers.length ? 0 : 1, target: 1 });
      if (this.layers.length > 3) this.layers.splice(0, this.layers.length - 3);
    }
    fade(dt) {
      // settled layers (a == target) stay put: the old else-branch dipped a fully shown layer to ~0.95 every other frame
      for (const l of this.layers) l.a = l.target > l.a ? Math.min(1, l.a + dt / 0.32) : l.target < l.a ? Math.max(0, l.a - dt / 0.32) : l.a;
      // keep an outgoing layer while it is still visible underneath (see vis()), not just while its own alpha is up
      this.layers = this.layers.filter((l, i) => this.vis(l) > 0.001 || i === this.layers.length - 1);
      Object.values(this.dances).forEach((d) => { if (!this.layers.some((l) => l.kind === 'dance' && l.name === d.name)) d.pause(); });
      this.custom.forEach((d) => { if (!this.layers.some((l) => l.ref === d)) d.pause(); });
    }
    /** drawn opacity of a layer: the incoming (top) one fades in; older ones stay solid until it is half in, then fade */
    vis(l) {
      const top = this.layers[this.layers.length - 1];
      return l === top ? l.a : Math.min(1, 2 * (1 - top.a));
    }
    /** Smooth (Aero) rendering into box {x,y,w,h}; m = motion state */
    draw(g, box, m) {
      // crossfade without a see-through dip: the outgoing figure stays solid underneath until the incoming one is half in,
      // then fades out, so Lucielle's combined coverage never drops below ~0.9 (1 at the start and end)
      for (const l of this.layers) {
        const la = this.vis(l);
        if (la <= 0.001) continue;
        g.save(); g.globalAlpha = la;
        if (l.scale && l.scale !== 1 && (l.kind === 'pose' || l.kind === 'dance')) { const cx = box.x + box.w / 2, by = box.y + box.h; g.translate(cx, by); g.scale(l.scale, l.scale); g.translate(-cx, -by); }
        if (l.kind === 'dance') this.drawDance(g, box, m, l.name);
        else if (l.kind === 'pdance') this.drawCustom(g, box, m, l, l.ref.frame(m.loopPos, m.loopRate, true));
        else if (l.kind === 'pimg') { const im = img(l.name); if (ready(im)) this.drawCustom(g, box, m, l, { src: im, sx: 0, sy: 0, sw: im.naturalWidth, sh: im.naturalHeight }, true); }
        else this.drawPose(g, box, m, l.name);
        g.restore();
      }
    }
    /** pack character frame: bottom-centred, aspect kept, squash on the beat (stills also sway/bob like the rig) */
    drawCustom(g, box, m, l, fr, still) {
      if (!fr) return;
      const s = Math.min(box.w, box.h) * 1.02 * (l.scale || 1), ar = fr.sw / fr.sh;
      const w = ar >= 1 ? s : s * ar, h = ar >= 1 ? s / ar : s;
      g.translate(box.x + box.w / 2 + (still ? m.swayX * s : 0), box.y + box.h + (still ? m.bobY * s : 0));
      if (still) { g.rotate(m.tilt); g.scale(m.sx, m.sy); } else g.scale(1 + m.pulse * 0.015, 1 - m.pulse * 0.025);
      g.drawImage(fr.src, fr.sx, fr.sy, fr.sw, fr.sh, -w / 2, -h, w, h);
    }
    drawDance(g, box, m, name) {
      const d = this.dances[name]; if (!d) return;
      const fr = d.frame(m.loopPos, m.loopRate, m.useVideo);
      if (!fr) return this.drawPose(g, box, m, 'music');
      const s = Math.min(box.w, box.h) * 1.02;
      const sq = 1 - m.pulse * 0.025;
      g.translate(box.x + box.w / 2, box.y + box.h);
      g.scale(1 + m.pulse * 0.015, sq);
      g.drawImage(fr.src, fr.sx, fr.sy, fr.sw, fr.sh, -s / 2, -s, s, s);
      this.drawHaloGlow(g, 0, -s * 0.9, s * 0.17, m);
    }
    drawPose(g, box, m, name) {
      const P = this.poses[name] || this.poses.idle; if (!P) return;
      const meta = P.meta, S = meta.size, bb = meta.bbox;
      const s = Math.min(box.w, box.h) * 1.02, k = s / S;
      const footY = bb[3];
      g.translate(box.x + box.w / 2 + m.swayX * s, box.y + box.h - 2 + m.bobY * s);
      g.rotate(m.tilt);
      g.scale(m.sx, m.sy);
      const X = (v) => (v - S / 2) * k, Y = (v) => (v - footY) * k;
      const rigOk = P.body && ready(P.body) && P.wings.every((w) => ready(w.im));
      if (!rigOk) { if (ready(P.full)) g.drawImage(P.full, X(0), Y(0), S * k, S * k); return; }
      for (const w of P.wings) {
        g.save();
        g.translate(X(w.pivot[0]), Y(w.pivot[1]));
        g.rotate(m.flap * (w.side === 'L' ? 1 : -1));
        g.drawImage(w.im, (w.box[0] - w.pivot[0]) * k, (w.box[1] - w.pivot[1]) * k, (w.box[2] - w.box[0]) * k, (w.box[3] - w.box[1]) * k);
        g.restore();
      }
      // body in horizontal strips; lower strips sway more = hair / robe swing
      const top = bb[1], h = footY - top, strips = 18, y0 = top + h * 0.3;
      g.drawImage(P.body, 0, 0, S, y0, X(0), Y(0), S * k, y0 * k);
      for (let i = 0; i < strips; i++) {
        const a = y0 + (i * (footY + 4 - y0)) / strips, b = y0 + ((i + 1) * (footY + 4 - y0)) / strips;
        const f = Math.pow((a - y0) / (footY - y0), 1.6) * (1 - Math.pow((a - y0) / (footY - y0), 6) * 0.6);
        const off = m.hair * f * s;
        g.drawImage(P.body, 0, a, S, b - a + 1, X(0) + off, Y(a), S * k, (b - a + 1) * k);
      }
      if (meta.halo) this.drawHaloGlow(g, X(meta.halo.x), Y(meta.halo.y), meta.halo.rx * k, m);
    }
    drawHaloGlow(g, x, y, r, m) {
      const I = clamp(0.25 + m.bass * 0.5 + m.flash * 0.9, 0, 1.4);
      g.save(); g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r * (1.6 + m.flash));
      gr.addColorStop(0, `rgba(255,230,150,${0.35 * I})`); gr.addColorStop(0.45, m.glow.replace(/[\d.]+\)$/, `${0.28 * I})`)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * (1.6 + m.flash), r * (0.9 + m.flash * 0.5), 0, 0, TAU); g.fill();
      g.restore();
    }
    /** Crisp pixel rendering (Classic) into a low-res canvas */
    drawPixel(g, box, m) {
      const top = this.layers[this.layers.length - 1]; if (!top) return;
      if (top.kind === 'pdance' || top.kind === 'pimg') {     // pack character: nearest-neighbour downscale = instant pixel art
        let fr = null;
        if (top.kind === 'pdance') fr = top.ref.frame(m.loopPos, m.loopRate, false) || top.ref.frame(m.loopPos, m.loopRate, true);
        else { const im = img(top.name); if (ready(im)) fr = { src: im, sx: 0, sy: 0, sw: im.naturalWidth, sh: im.naturalHeight }; }
        if (!fr) return;
        const h = Math.round((this.px && this.px.meta ? this.px.meta.idle.h : 64) * 1.1 * (top.scale || 1)), w = Math.round(h * fr.sw / fr.sh);
        g.imageSmoothingEnabled = false;
        g.drawImage(fr.src, fr.sx, fr.sy, fr.sw, fr.sh, Math.round(box.x + box.w / 2 - w / 2), Math.round(box.y + box.h - h + m.bobY * 60), w, h);
        return;
      }
      const isDance = top.kind === 'dance';
      const pm = this.px && this.px.meta;
      const useSprite = pm && (isDance || ['idle', 'music'].includes(top.name));
      const fh = pm ? pm.idle.h : 64;
      const bx = Math.round(box.x + box.w / 2), by = Math.round(box.y + box.h);
      const bob = Math.round(m.bobY * 60);
      g.imageSmoothingEnabled = false;
      if (useSprite) {
        const sheet = isDance ? this.px.dance : this.px.idle, meta = isDance ? pm.dance : pm.idle;
        if (!ready(sheet)) return;
        const f = m.pixelFrame % meta.frames;
        g.drawImage(sheet, f * meta.w, 0, meta.w, meta.h, bx - Math.round(meta.w / 2), by - meta.h + bob, meta.w, meta.h);
        if (m.flash > 0.2) { g.fillStyle = '#ffe680'; g.globalAlpha = m.flash; g.fillRect(bx - 9, by - meta.h + bob - 1, 18, 1); g.fillRect(bx - 11, by - meta.h + bob + 1, 2, 2); g.fillRect(bx + 9, by - meta.h + bob + 1, 2, 2); g.globalAlpha = 1; }
      } else {
        const P = this.poses[top.name] || this.poses.idle;
        if (!ready(P.full)) return;
        const s = Math.round(fh * 1.08);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
        g.drawImage(P.full, bx - s / 2, by - s + bob + 2, s, s);
        g.imageSmoothingEnabled = false;
      }
    }
  }

  // ------------------------------------------------------------------ behaviour
  const PRIO = { slow: 1, mid: 2, fast: 3 };
  const GENRE_EMOTE = [
    [/metal|hard ?rock|punk|thrash|hardcore/i, 'angry'], [/rock|grunge/i, 'smug'], [/ambient|new ?age|meditat|chill|downtempo/i, 'cloud'],
    [/love|romance|romantic/i, 'love'], [/sad|blues|emo|ballad/i, 'crying'], [/lo-?fi|study/i, 'sleepy'], [/jazz|swing|bossa/i, 'smug'],
    [/classical|piano|orchestra/i, 'shy'], [/pop|dance|disco/i, 'happy'], [/electro|techno|edm|rave|trance|house/i, 'flying'], [/hip.?hop|rap|trap/i, 'smug'],
  ];
  class Behavior {
    constructor(opts) { this.o = opts; this.reaction = null; this.queue = []; this.lastInput = performance.now(); this.rest = 'idle'; }
    input() { const was = this.sleeping; this.lastInput = performance.now(); this.sleeping = false; if (was) this.emote('surprised', 900, 2); }
    /** emote reaction: shown for ms, then back to resting pose */
    emote(name, ms = 2200, prio = 1) {
      const now = performance.now();
      if (this.reaction && now < this.reaction.until && this.reaction.prio > prio) return false;
      this.reaction = { kind: 'pose', name, until: now + ms, prio }; return true;
    }
    queueEmotes(list) { this.queue = list.slice(); this.next(); }
    next() { const n = this.queue.shift(); if (n) this.emote(n[0], n[1], n[2] || 1); }
    /** manifest event -> dance reaction played exactly once; ignored while one plays unless higher priority */
    packEvent(evt) {
      const map = (MD.behavior && MD.behavior.events) || {};
      const tempo = map[evt]; if (!tempo || !MD.dance[tempo]) return false;
      const now = performance.now();
      if (this.reaction && now < this.reaction.until && this.reaction.kind === 'dance' && this.reaction.prio >= PRIO[tempo]) return false;
      this.reaction = { kind: 'dance', name: tempo, until: now + MD.dance[tempo].duration * 1000, prio: PRIO[tempo] + 2, start: now, once: true };
      return true;
    }
    genreEmote(genre, title) {
      const s = `${genre || ''} ${/\blove\b/i.test(title || '') ? 'love' : ''}`;
      const hit = GENRE_EMOTE.find(([re]) => re.test(s)); return hit ? hit[1] : null;
    }
    current(now) {
      if (this.reaction && now >= this.reaction.until) { this.reaction = null; this.next(); }
      return this.reaction;
    }
  }

  // ------------------------------------------------------------------ public controller
  function create(opts) {
    const st = {
      palette: 'aero', skin: 'aero', enabled: true, size: 'm', strict: false, doze: true, manual: 'auto', sceneOn: true,
      scene: null, bpm: 0, beatPos: 0, energy: 0, energyAvg: 0, bass: 0, playing: false, hasTracks: false, flash: 0, shake: 0,
      tier: 'float', moodScene: null, genreScene: null, lastDrop: -1e9, shortE: 0, longE: 0,
      ditherFx: false, beatHit: false, lastBeat: -1, dropHit: false, pointerX: 0, pointerY: 0, t: 0,
    };
    const ch = new Character();
    const beh = new Behavior();
    const stagePx = new Particles(false), stagePix = new Particles(true), backPx = new Particles(false), backPix = new Particles(true);
    backPx.density = 0.8;
    const el = opts.elements;
    let colors = {};
    let lastT = performance.now();
    // ---- video / dither scene machinery (js/scenefx.js)
    const FX = global.LucielFX;
    const loops = {};                       // scene id -> VideoLoop
    const gl = {};                          // lazily created WebGL dither renderers
    const dith = (k) => { if (!FX) return null; if (!(k in gl)) { try { gl[k] = new FX.Dither(); } catch (e) { gl[k] = null; } } return gl[k] && gl[k].ok ? gl[k] : null; };
    const charFx = { cache: {}, t: 0 }, layers = {};
    let bayerPat = null;
    function bayerPattern() {             // 2D fallback (file://, no WebGL): an 8x8 Bayer overlay tile
      if (bayerPat) return bayerPat;
      const M = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
      const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); const id = g.createImageData(8, 8);
      M.forEach((v, i) => { const q = Math.round(v / 63 * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = q; id.data[i * 4 + 3] = 255; });
      g.putImageData(id, 0, 0); bayerPat = c; return c;
    }
    function ditherFallback(g, W, H, pix, alpha) {
      const pat = g.createPattern(bayerPattern(), 'repeat'); if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(pix));
      g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = alpha; g.globalCompositeOperation = 'overlay'; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
    }
    const DITHER_PAL = { dither: ['#0d0820', '#3b2370', '#a24f9e', '#ffe2c4'], aero: ['#0a2540', '#2a6fb0', '#7cc8f0', '#f2fbff'], blue: ['#0a1030', '#24407a', '#5c8fd0', '#d8e8ff'],
      red: ['#1a0505', '#6a1010', '#d0402a', '#ffd9a0'], slime: ['#04140a', '#1b5a1e', '#5fd02a', '#e8ffc0'] };
    function ditherPal(s, beat) {
      const base = (DITHER_PAL[s && s.id] || DITHER_PAL[st.palette] || DITHER_PAL.dither).map(FX.hex);
      // palette shimmer: the mid tones breathe toward the highlight on each beat
      const k = beat * 0.35;
      return base.map((c, i) => (i === 1 || i === 2 ? c.map((v, j) => v + (base[3][j] - v) * k * (i === 2 ? 0.6 : 0.35)) : c));
    }
    function loopFor(s) {
      if (!FX || !s.video) return null;
      if (!loops[s.id]) loops[s.id] = new FX.VideoLoop(s.video);
      return loops[s.id];
    }
    function layer(key, W, H) { return FX.layer(layers, key, W, H); }

    function readColors() {
      const cs = getComputedStyle(document.body), v = (n, d) => (cs.getPropertyValue(n).trim() || d);
      colors = { gold: '#ffd75a', bubble: v('--bubble-tint', 'rgba(140,200,255,.25)'), rain: 'rgba(190,210,255,.8)', ember: '#ff7a3a', spark: '#ffd36a',
        slime: v('--accent', '#7dff1a'), smoke: 'rgba(230,220,200,1)', dust: '#ffe7a8', note: '#ffe9a8', heart: '#ff7aa8', petal: '#ffb3c9',
        grid: '#ff4fd8', glow: v('--accent-glow', 'rgba(120,200,255,.6)') };
      if (st.palette === 'slime') colors.slime = '#7dff1a';
    }
    function sceneFor() {
      if (st.manual && st.manual !== 'auto') { const s = Scenes.byId(st.manual); if (s) return s; }
      if (st.genreScene) return st.genreScene;
      if (st.moodScene) return st.moodScene;
      return Scenes.paletteDefault(st.palette, st.skin);
    }
    function applyScene(force) {
      const s = sceneFor(); if (!s) return;
      if (s === st.scene && !force) return;
      st.scene = s;
      const pixel = st.skin === 'classic';
      const usePx = pixel ? (s.kind === 'pixel' ? s.px : s.px) : s.image;
      if (el.backArt) { el.backArt.style.backgroundImage = `url("${usePx}")`; el.backArt.dataset.kind = s.kind; }
      if (el.backArtNext) { /* crossfade */ el.backArtNext.style.backgroundImage = el.backArt.style.backgroundImage; }
      Object.keys(loops).forEach((id) => { if (id !== s.id) loops[id].pause(); });
      document.body.dataset.sceneKind = s.kind; document.body.dataset.sceneStyle = s.style || '';
      backPx.setTypes(s.particles); backPix.setTypes(s.particles); stagePx.setTypes(s.particles); stagePix.setTypes(s.particles);
      el.onScene && el.onScene(s);
    }

    // ---- motion from beat clock
    function motion(now, dt) {
      const playing = st.playing, bpm = st.bpm || 0;
      let tier = 'float';
      if (playing && bpm) tier = bpm < 90 ? 'float' : bpm <= 125 ? 'groove' : 'dance';
      st.tier = playing ? tier : 'still';
      const half = bpm > 150; // half-time feel for very fast tracks
      const beat = playing && bpm ? st.beatPos / (half ? 2 : 1) : now / 1000 * 0.45;
      const ph = frac(beat);
      const pulse = playing && bpm ? Math.exp(-ph * 7) : 0;
      const m = { pulse, bass: st.bass, flash: st.flash, glow: colors.glow || 'rgba(255,255,255,.5)', useVideo: st.skin === 'aero' };
      if (!playing || st.tier === 'float') {
        const t = now / 1000;
        const rate = playing && bpm ? bpm / 60 / 2 : 0.35;
        const b = playing && bpm ? st.beatPos / 2 : t * rate;
        m.bobY = -0.018 * (1 - Math.cos(TAU * b)) - 0.01;   // gentle float
        m.swayX = 0.006 * Math.sin(TAU * b * 0.5); m.tilt = 0.015 * Math.sin(TAU * b * 0.5);
        m.sx = 1; m.sy = 1; m.hair = 0.012 * Math.sin(TAU * b - 0.8);
        m.flap = 0.05 + 0.06 * Math.sin(TAU * b) + st.bass * 0.15;
      } else {
        const sw = Math.sin(Math.PI * beat);        // one sway cycle per 2 beats, on-beat at extremes
        const amp = st.tier === 'dance' ? 1.25 : 1;
        m.bobY = -0.03 * amp * Math.pow(Math.sin(Math.PI * ph), 2) * (0.6 + st.energy * 0.8);
        m.swayX = 0.022 * amp * sw; m.tilt = 0.05 * amp * sw;
        m.sx = 1 + pulse * 0.035 * amp; m.sy = 1 - pulse * 0.05 * amp;     // squash on the beat
        m.hair = -0.03 * amp * Math.sin(Math.PI * beat - 0.9);
        m.flap = 0.06 + pulse * (0.25 + st.bass * 0.55);
      }
      m.pixelFrame = playing && bpm ? Math.floor(st.beatPos * 2) : Math.floor(now / 1000 * 2.2);
      if (playing && bpm) m.bobY *= 1; else if (!playing) m.pixelFrame = Math.floor(now / 1000 * 1.6);
      return m;
    }
    function danceLoop(name) {
      const d = typeof name === 'object' ? name : MD.dance[name]; if (!d) return { pos: 0, rate: 1 };
      const bpm = st.bpm || d.loopBpm;
      let mult = 1; while (bpm * mult / d.loopBpm < 0.7) mult *= 2; while (bpm * mult / d.loopBpm > 1.45) mult /= 2;
      const beatsPerLoop = d.loopBpm * d.duration / 60;
      const lb = (st.playing && st.bpm ? st.beatPos : performance.now() / 1000 * d.loopBpm / 60) * mult;
      return { pos: frac(lb / beatsPerLoop), rate: bpm * mult / d.loopBpm };
    }
    // ---- resting pose / dance per tier and behaviour
    function choose(now) {
      const base = chooseBase(now), s = st.scene || {}, C = s.char;
      if (!C || C.use === 'none') return base;
      const tier = (n) => n || (!st.bpm ? 'mid' : st.bpm < 96 ? 'slow' : st.bpm <= 126 ? 'mid' : 'fast');
      const pd = (t) => { const d = ch.customDance(s, t); return d && { kind: 'pdance', name: d.name, ref: d, scale: C.scale }; };
      if (base.kind === 'pose' && C.emotes && C.emotes[base.name]) {
        const e = C.emotes[base.name];
        if (typeof e === 'string') return { kind: 'pimg', name: e, scale: C.scale };
        const d = ch.customLoop(s, base.name, e); return { kind: 'pdance', name: d.name, ref: d, scale: C.scale };
      }
      if (base.kind === 'dance') { const d = pd(base.name); if (d) return d; }
      if (C.use !== 'custom') return C.scale && C.scale !== 1 ? Object.assign({ scale: C.scale }, base) : base;
      // custom character without a matching emote: dance while playing, idle image (or the slow loop) otherwise
      if (st.playing) return pd(tier(s.dance && s.dance !== 'auto' ? s.dance : null)) || base;
      if (C.idle) return { kind: 'pimg', name: C.idle, scale: C.scale };
      return pd('slow') || base;
    }
    function chooseBase(now) {
      const r = beh.current(now);
      if (r) return r;
      if (!st.hasTracks) return { kind: 'pose', name: 'bored' };
      if (!st.playing) {
        const idle = (now - beh.lastInput) / 1000;
        if (st.doze && !st.strict) {
          if (idle > 180) { beh.sleeping = true; return { kind: 'pose', name: 'cloud-sleep' }; }
          if (idle > 75) { beh.sleeping = true; return { kind: 'pose', name: 'sleepy' }; }
        }
        return { kind: 'pose', name: 'idle' };
      }
      const s = st.scene || {};
      const scenePose = s.kind === 'layered' && s.poses && s.poses[0];
      if (!st.strict) {
        if (s.dance === 'auto') return { kind: 'dance', name: !st.bpm ? 'mid' : st.bpm < 96 ? 'slow' : st.bpm <= 126 ? 'mid' : 'fast' };
        if (s.dance && st.bpm) return { kind: 'dance', name: s.dance };
        if (st.tier === 'dance') return { kind: 'dance', name: 'fast' };
        if (st.tier === 'groove' && st.energyAvg > 0.5) return { kind: 'dance', name: 'mid' };
        if (st.tier === 'float' && st.energyAvg > 0.62) return { kind: 'dance', name: 'slow' };
      }
      return { kind: 'pose', name: scenePose || 'music' };
    }

    function drawSceneBg(g, W, H, s, pixel, zoom) {
      // Classic: a full illustration already contains Lucielle, so the pixel stage uses the matching pixel backdrop instead
      if (pixel && s.kind === 'full' && s.hasCharacter) { const alt = Scenes.byId('pixel-' + (s.palette || st.palette)) || Scenes.byId('pixel-' + st.palette); if (alt) s = alt; }
      if (s.kind === 'video' || (s.kind === 'pixel' && s.video)) return drawVideoBg(g, W, H, s, pixel, zoom, 'stage');
      const im = img(pixel ? s.px : s.image);
      if (!ready(im)) { g.fillStyle = '#111'; g.fillRect(0, 0, W, H); return; }
      const r = Math.max(W / im.naturalWidth, H / im.naturalHeight) * zoom;
      const w = im.naturalWidth * r, h = im.naturalHeight * r;
      g.imageSmoothingEnabled = !pixel;
      if (!pixel && s.hasCharacter) {
        // full illustration: soft-focus it so the live cut-out reads as the subject
        g.save(); try { g.filter = 'blur(6px) saturate(1.15)'; } catch (e) {}
        g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); g.restore();
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, W, H);
      } else g.drawImage(im, Math.round((W - w) / 2), Math.round((H - h) / 2), Math.round(w), Math.round(h));
    }

    /** pack light map (neon / lamps painted on black): added on top of the plate, brightness pulsed by the bass and beat */
    function drawGlowMap(g, W, H, s, zoom, R) {
      const im = img(s.glow); if (!ready(im)) return;
      const m = st.motion || { pulse: 0 }, k = R ? R.bassGlow : 1;
      const a = clamp(((st.playing ? 0.18 + st.bass * 1.05 + m.pulse * 0.25 : 0.22 + 0.06 * Math.sin(st.t * 1.3)) + st.flash * 0.5) * k, 0, 1);
      if (a <= 0.01) return;
      const r = Math.max(W / im.naturalWidth, H / im.naturalHeight) * zoom, w = im.naturalWidth * r, h = im.naturalHeight * r;
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); g.restore();
    }
    /** video-loop scenes: a muted looping <video> (rate nudged to the BPM) or, for still plates, a slow pan/zoom with
     *  parallax run through the real-time Bayer dither shader whose threshold and palette shimmer with the beat. */
    function drawVideoBg(g, W, H, s, pixel, zoom, key) {
      const m = st.motion || { pulse: 0 }, t = st.t;
      const cover = (src, sw, sh, z, ox = 0, oy = 0) => {
        const r = Math.max(W / sw, H / sh) * z, w = sw * r, h = sh * r;
        g.drawImage(src, (W - w) / 2 + ox * W, (H - h) / 2 + oy * H, w, h);
      };
      g.imageSmoothingEnabled = !pixel;
      if (!s.still) {
        const L = loopFor(s);
        if (L) L.update(st.playing, s.tempoSync === false ? 0 : st.bpm, s.loopBpm || 120);
        if (L && L.ready) { cover(L.v, L.v.videoWidth, L.v.videoHeight, zoom); return; }
        const im = img(s.image); if (ready(im)) cover(im, im.naturalWidth, im.naturalHeight, zoom); else { g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H); }
        return;
      }
      // still plate: Ken Burns drift + pointer parallax, beat zoom
      const im = img(s.image);
      if (!ready(im)) { g.fillStyle = '#0d0820'; g.fillRect(0, 0, W, H); return; }
      const z = (1.1 + 0.05 * Math.sin(t * 0.07)) * zoom;
      const ox = 0.025 * Math.sin(t * 0.045) + st.pointerX * 0.012, oy = 0.015 * Math.cos(t * 0.06) + st.pointerY * 0.01;
      const beat = st.playing ? m.pulse : 0.25 + 0.25 * Math.sin(t * 1.3);
      const D = dith('bg-' + key);
      const pix = pixel ? 1 : Math.max(2, Math.round(Math.min(W, H) / 220));
      if (D) {
        const iw = im.naturalWidth, ih = im.naturalHeight, r = Math.max(W / iw, H / ih);
        // shader samples the plate in uv space: zoom relative to cover-fit
        const out = D.render(im, W, H, { mode: 0, pix, bayer: st.playing && m.pulse > 0.75 ? 4 : 8, thr: 0.12 * beat + 0.04 * Math.sin(t * 7.0) + st.flash * 0.2,
          zoom: z, ox: -ox, oy: -oy, pal: ditherPal(s, beat), asp: [W / (iw * r), H / (ih * r)] });
        if (out) {
          g.save(); g.imageSmoothingEnabled = false; g.drawImage(out, 0, 0, W, H); g.restore();
          drawParallaxFg(g, W, H, t, beat, pixel);
          return;
        }
      }
      cover(im, im.naturalWidth, im.naturalHeight, z, ox, oy);
      ditherFallback(g, W, H, pix, 0.18 + beat * 0.2);
      drawParallaxFg(g, W, H, t, beat, pixel);
    }
    /** foreground parallax layer for the still plate: drifting dithered mist bands that move faster than the plate */
    function drawParallaxFg(g, W, H, t, beat, pixel) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const y = H * (0.62 + i * 0.1) + st.pointerY * 18 * (i + 1), x = ((t * (6 + i * 5) + st.pointerX * 30 * (i + 1)) % (W * 1.5)) - W * 0.25;
        const gr = g.createRadialGradient(x, y, 0, x, y, W * 0.35);
        gr.addColorStop(0, `rgba(190,140,255,${0.05 + beat * 0.05})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      g.restore();
    }
    /** Lucielle drawn to her own layer, then the scene style is applied (cyber hologram / 1-bit dither / datamosh) */
    function drawStyledChar(g, W, H, box, m, pixel, style) {
      const [c, cg] = layer('char', W, H);
      if (pixel) ch.drawPixel(cg, box, m); else ch.draw(cg, box, m);
      const fxst = { pulse: st.playing ? m.pulse : 0, flash: st.flash, bass: st.bass, beatHit: st.beatHit, drop: st.dropHit };
      charFx.t = st.t; charFx.scale = pixel ? 0.35 : W / 600;
      if (style === 'cyber') return FX.cyber(g, c, charFx, fxst);
      if (style === 'datamosh') return FX.datamosh(g, c, charFx, fxst);
      if (style === 'dither') {
        const D = dith('char');
        const out = D && D.render(c, W, H, { mode: 2, pix: pixel ? 1 : Math.max(2, Math.round(W / 260)), bayer: 4, thr: 0.25 * fxst.pulse + st.flash * 0.3, pal: ditherPal({ id: 'dither' }, fxst.pulse) });
        if (out) { g.save(); g.imageSmoothingEnabled = false; g.drawImage(out, 0, 0); g.restore(); return; }
        g.drawImage(c, 0, 0); return;
      }
      g.drawImage(c, 0, 0);
    }
    /** optional post-effect over any scene: colour-preserving ordered dither */
    function postDither(cv, g, W, H, pixel, key) {
      const D = dith('post-' + key), beat = st.playing && st.motion ? st.motion.pulse : 0;
      const pix = pixel ? 1 : Math.max(2, Math.round(Math.min(W, H) / 240));
      const out = D && D.render(cv, W, H, { mode: 1, pix, bayer: beat > 0.7 ? 4 : 8, levels: pixel ? 3 : 4, thr: 0.15 * beat + st.flash * 0.2 });
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      if (out) { g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H); g.drawImage(out, 0, 0); }
      else ditherFallback(g, W, H, pix, 0.22);
      g.restore();
    }

    function drawStage(cv, pixel, m, dt, P) {
      if (!cv || !cv.offsetParent) return;
      const g = cv.getContext('2d');
      let W, H, scale;
      if (pixel) { W = cv.width; H = cv.height; scale = 0.35; }
      else {
        const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
        W = Math.round(r.width * dpr); H = Math.round(r.height * dpr); scale = dpr;
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      }
      const s = st.scene; if (!s) return;
      const R = s.react || NOREACT;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      const zoom = 1.04 + m.pulse * 0.02 * (st.playing ? 1 : 0) * R.beatZoom + st.flash * 0.03 * R.flash;
      g.save();
      const shake = st.shake * R.shake;
      if (shake > 0) g.translate((Math.random() - 0.5) * shake * (pixel ? 3 : 10), (Math.random() - 0.5) * shake * (pixel ? 3 : 10));
      drawSceneBg(g, W, H, s, pixel, zoom);
      if (s.glow) drawGlowMap(g, W, H, s, zoom, R);
      // bass glow
      const gl = g.createRadialGradient(W / 2, H * 0.7, 0, W / 2, H * 0.7, Math.max(W, H) * 0.7);
      const glowBase = R.glowColor ? rgba(R.glowColor, 0.6) : colors.glow;
      gl.addColorStop(0, glowBase.replace(/[\d.]+\)$/, `${clamp((0.12 + st.bass * 0.35 + st.flash * 0.3 * R.flash) * R.bassGlow, 0, 1).toFixed(3)})`)); gl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl; g.globalCompositeOperation = pixel ? 'source-over' : 'lighter'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      P.update(dt, W, H, (st.playing ? st.energy : 0.05) * R.particles, scale);
      // synthwave floor grid is part of the background: draw it before Lucielle so it never shows over her
      if (P.types.includes('grid')) { P.drawGrid(g, W, H, colors, m.pulse); P.gridDone = true; }
      // floor shadow
      if (st.enabled && !(s.char && s.char.use === 'none')) {
        const charH = pixel ? (MD.pixel.idle ? MD.pixel.idle.h : 64) : H * (st.size === 's' ? 0.66 : st.size === 'l' ? 0.98 : 0.84);
        const box = pixel ? { x: 0, y: 0, w: W, h: H - 6 } : { x: (W - charH) / 2, y: H - charH - H * 0.04, w: charH, h: charH };
        if (!pixel) {
          g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(W / 2, box.y + box.h - 2, charH * 0.2 * (1 + m.bobY * 3), charH * 0.035, 0, 0, TAU); g.fill();
          if (s.style && FX) drawStyledChar(g, W, H, box, m, false, s.style); else ch.draw(g, box, m);
        } else if (s.style && FX) drawStyledChar(g, W, H, box, m, true, s.style); else ch.drawPixel(g, box, m);
      }
      P.draw(g, W, H, colors, m.pulse);
      if (s.style === 'cyber' && !pixel) {     // HUD scanlines over the whole stage
        g.globalAlpha = 0.12; g.fillStyle = '#000'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1); g.globalAlpha = 1;
      }
      g.restore();
      if (s.fx && s.fx.length && FX) packFx(cv, g, W, H, pixel, s.fx, m);
      if (st.ditherFx && s.style !== 'dither') postDither(cv, g, W, H, pixel, pixel ? 'px' : 'aero');
    }
    /** pack effect presets over the finished stage: rgb-split, scanlines, dither, pixel-sort, datamosh (beat / drop driven) */
    const pfx = { sortUntil: 0, moshUntil: 0, seed: 0 };
    function packFx(cv, g, W, H, pixel, list, m) {
      const pulse = st.playing ? m.pulse : 0, k = pixel ? 0.35 : W / 600, key = pixel ? 'px' : 'aero';
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      for (const f of list) {
        const I = clamp(f.intensity == null ? 0.6 : f.intensity, 0, 1); if (!I) continue;
        if (f.type === 'rgb-split') {
          const sp = Math.round((1 + pulse * 5 + st.flash * 9) * I * Math.max(1, k * 1.6)); if (sp < 1) continue;
          const [a, ag] = layer('rgbR', W, H), [b, bg] = layer('rgbGB', W, H);
          ag.drawImage(cv, 0, 0); ag.globalCompositeOperation = 'multiply'; ag.fillStyle = '#f00'; ag.fillRect(0, 0, W, H);
          bg.drawImage(cv, 0, 0); bg.globalCompositeOperation = 'multiply'; bg.fillStyle = '#0ff'; bg.fillRect(0, 0, W, H);
          g.clearRect(0, 0, W, H); g.drawImage(a, -sp, 0); g.globalCompositeOperation = 'lighter'; g.drawImage(b, sp, 0); g.globalCompositeOperation = 'source-over';
        } else if (f.type === 'scanlines') {
          g.globalAlpha = 0.06 + 0.24 * I; g.fillStyle = '#000';
          const step = pixel ? 2 : Math.max(2, Math.round(3 * Math.min(2, k))), off = Math.floor(st.t * 24) % step;
          for (let y = off; y < H; y += step) g.fillRect(0, y, W, Math.max(1, Math.round(step / 3)));
          g.globalAlpha = 1;
        } else if (f.type === 'dither') {
          const D = dith('pfx-' + key), pix = pixel ? 1 : Math.max(2, Math.round(Math.min(W, H) / (320 - 140 * I)));
          const out = D && D.render(cv, W, H, { mode: 1, pix, bayer: pulse > 0.7 ? 4 : 8, levels: Math.max(2, Math.round(7 - 5 * I)), thr: 0.15 * pulse + st.flash * 0.2 });
          if (out) { g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H); g.drawImage(out, 0, 0); } else ditherFallback(g, W, H, pix, 0.1 + 0.25 * I);
        } else if (f.type === 'pixel-sort' || f.type === 'datamosh') {
          const trig = st.dropHit || (st.beatHit && Math.random() < 0.15 + 0.6 * I);
          if (f.type === 'pixel-sort') {
            if (trig) { pfx.sortUntil = st.t + 0.12 + 0.35 * I; pfx.seed = Math.random(); }
            if (st.t < pfx.sortUntil && !pfx.sortBlocked) pixelSort(g, W, H, I);
          } else {
            if (trig) pfx.moshUntil = st.t + 0.15 + 0.3 * I;
            if (st.t < pfx.moshUntil && pfx.prev) {
              g.globalAlpha = 0.6; const n = Math.round(3 + 9 * I);
              for (let i = 0; i < n; i++) { const bw = (24 + Math.random() * 90) * k, bh = (8 + Math.random() * 40) * k, x = Math.random() * (W - bw), y = Math.random() * (H - bh); g.drawImage(pfx.prev, x, y, bw, bh, x + (Math.random() - 0.5) * 40 * k * I, y + (Math.random() - 0.3) * 20 * k * I, bw, bh); }
              g.globalAlpha = 1;
            }
            const [pc, pg] = layer('moshPrev', W, H); pg.drawImage(cv, 0, 0); pfx.prev = pc;
          }
        }
      }
      g.restore();
    }
    /** sort bright runs of a horizontal band by luminance (the classic pixel-sort glitch) */
    function pixelSort(g, W, H, I) {
      const bh = Math.max(2, Math.floor(H * (0.08 + 0.22 * I))), y0 = Math.floor((H - bh) * pfx.seed);
      let id; try { id = g.getImageData(0, y0, W, bh); } catch (e) { pfx.sortBlocked = true; return; }
      const d = id.data, thr = 255 * (0.62 - 0.32 * I), lum = new Float32Array(W), idx = [], tmp = new Uint8ClampedArray(W * 4);
      for (let y = 0; y < bh; y++) {
        const row = y * W * 4;
        for (let x = 0; x < W; x++) { const o = row + x * 4; lum[x] = d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11; }
        let x = 0;
        while (x < W) {
          while (x < W && lum[x] < thr) x++;
          let e = x; while (e < W && lum[e] >= thr) e++;
          if (e - x > 4) {
            idx.length = 0; for (let i = x; i < e; i++) idx.push(i);
            idx.sort((a, b) => lum[a] - lum[b]);
            for (let i = 0; i < idx.length; i++) { const o = row + idx[i] * 4; tmp[i * 4] = d[o]; tmp[i * 4 + 1] = d[o + 1]; tmp[i * 4 + 2] = d[o + 2]; tmp[i * 4 + 3] = d[o + 3]; }
            d.set(tmp.subarray(0, idx.length * 4), row + x * 4);
          }
          x = e;
        }
      }
      g.putImageData(id, 0, y0);
    }
    /** full-page backdrop canvas, used instead of the CSS image for video scenes and when the dither FX is on */
    function drawBackdrop(cv, pixel) {
      const s = st.scene; if (!cv || !s) return;
      const k = pixel ? 1 / 4 : s.still || st.ditherFx ? 1 / 2 : 1 / 2;
      const W = Math.max(2, Math.round(innerWidth * k)), H = Math.max(2, Math.round(innerHeight * k));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
      const m = st.motion || { pulse: 0 };
      const zoom = 1.06 + (st.playing ? m.pulse * 0.012 + st.flash * 0.025 : 0);
      if (s.kind === 'video' || (s.kind === 'pixel' && s.video)) drawVideoBg(g, W, H, s, pixel, zoom, 'back');
      else {
        const im = img(pixel ? s.px : s.image);
        if (ready(im)) { const r = Math.max(W / im.naturalWidth, H / im.naturalHeight) * zoom, w = im.naturalWidth * r, h = im.naturalHeight * r; g.imageSmoothingEnabled = !pixel; g.drawImage(im, (W - w) / 2 + st.pointerX * 10 * k, (H - h) / 2 + st.pointerY * 8 * k, w, h); }
      }
      if (s.glow) drawGlowMap(g, W, H, s, zoom, s.react);
      if (st.ditherFx && !(s.kind === 'video' && s.still)) postDither(cv, g, W, H, pixel, 'back');
      if (s.style === 'cyber' || s.style === 'datamosh') {   // beat-reactive RGB split + scanlines on the page backdrop
        const sp = Math.round((m.pulse * 3 + st.flash * 6) * (pixel ? 0.5 : 1));
        if (sp > 0 && st.playing) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25; g.drawImage(cv, sp, 0); g.drawImage(cv, -sp, 0); g.restore(); }
        if (s.style === 'cyber') { g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1); }
      }
    }

    /** music events from the live spectrum -> pack character emotes (character.events in pack.json).
     *  start (track begins) · drop (bass jump, see above) · hit (sudden loud transient) · quiet (sustained near-silence)
     *  rise (energy building well above the recent level) · sad (slow + soft song) · vocals (strong mid band vs bass/highs) */
    const ev = { quietFor: 0, lastQuiet: 0, lastHit: 0, lastRise: 0, lastSad: 0, lastVox: 0, voxFor: 0, rShort: 0, rLong: 0, vox: 0, prevE: 0, log: [] };
    const EV_PRIO = { drop: 3, hit: 3, start: 2, rise: 2, vocals: 1, quiet: 1, sad: 1 };
    const EV_MS = { drop: 2600, hit: 1300, start: 2400, rise: 2600, vocals: 2800, quiet: 3200, sad: 3600 };
    function evMap() { const C = st.scene && st.scene.char; return (C && C.use !== 'none' && C.events) || null; }
    /** fire a music event; returns true when the current scene's character has a mapped emote for it */
    function fire(evt, now) {
      ev.log.push({ evt, t: Math.round(now), at: +(st.time || 0).toFixed(1) }); if (ev.log.length > 40) ev.log.shift();
      st.lastEvent = evt;
      const map = evMap(), name = map && map[evt]; if (!name) return false;
      const r = beh.reaction; if (r && now < r.until && r.prio >= EV_PRIO[evt]) return true;   // never cut off an emote of equal / higher rank
      beh.emote(name, EV_MS[evt] * (evt === 'drop' || evt === 'rise' ? clamp(120 / (st.bpm || 120), 0.6, 1.4) : 1), EV_PRIO[evt]);
      return true;
    }
    function detectEvents(info, now, dt) {
      const e = info.energy || 0, t = info.time || 0; st.time = t;
      if (!st.playing) { ev.quietFor = 0; ev.voxFor = 0; ev.prevE = e; return; }
      // sudden loud hit: a sharp frame-to-frame jump in overall level that is not part of a drop
      if (e - ev.prevE > 0.26 && e > 0.55 && t > 2 && now - ev.lastHit > 7000 && now - st.lastDrop > 1500) { ev.lastHit = now; fire('hit', now); }
      ev.prevE = lerp(ev.prevE, e, 0.5);
      // quiet passage
      ev.quietFor = st.energy < 0.1 && st.bass < 0.12 ? ev.quietFor + dt : 0;
      if (ev.quietFor > 2.5 && t > 3 && now - ev.lastQuiet > 3000) { ev.lastQuiet = now; fire('quiet', now); }
      // energy rise / chorus lift
      ev.rShort = lerp(ev.rShort, e, dt / 1.5); ev.rLong = lerp(ev.rLong, e, dt / 8);
      if (t > 8 && ev.rShort > 0.42 && ev.rShort > ev.rLong * 1.3 && now - ev.lastRise > 14000 && now - st.lastDrop > 3000) { ev.lastRise = now; fire('rise', now); }
      // sad / slow song
      if (t > 8 && st.bpm > 0 && st.bpm < 92 && st.energyAvg < 0.32 && st.energy > 0.08 && now - ev.lastSad > 20000) { ev.lastSad = now; fire('sad', now); }
      // vocals: the speech band (300 Hz–3.4 kHz) dominates bass + air for a while
      if (info.vocal != null) {
        ev.vox = lerp(ev.vox, (info.vocal || 0) / ((info.bass || 0) * 0.55 + (info.high || 0) + 0.06), dt / 0.4);
        ev.voxFor = info.vocal > 0.33 && ev.vox > 1.35 ? ev.voxFor + dt : 0;
        if (ev.voxFor > 1.2 && t > 4 && now - ev.lastVox > 12000) { ev.lastVox = now; ev.voxFor = 0; fire('vocals', now); }
      }
    }
    function tick(info) {
      const now = performance.now(); const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      st.playing = info.playing; st.bpm = info.bpm; st.beatPos = info.beatPos; st.hasTracks = info.hasTracks;
      st.energy = lerp(st.energy, info.energy || 0, 0.25); st.bass = lerp(st.bass, info.bass || 0, 0.35);
      st.energyAvg = lerp(st.energyAvg, info.energy || 0, dt / 6);
      // drop detection: short-term bass energy jumps well above the long-term level
      st.shortE = lerp(st.shortE, info.bass || 0, dt / 0.25); st.longE = lerp(st.longE, info.bass || 0, dt / 5);
      if (st.playing && st.shortE > 0.42 && st.shortE > st.longE * 1.6 && now - st.lastDrop > 9000 && info.time > 4) {
        st.lastDrop = now; api.drop();
      }
      st.t += dt; st.pointerX = info.pointerX || 0; st.pointerY = info.pointerY || 0;
      const bi = Math.floor(st.beatPos || 0); st.beatHit = st.playing && st.bpm > 0 && bi !== st.lastBeat; st.lastBeat = bi;
      detectEvents(info, now, dt);
      // pack scenes can burst particles on strong beats (leaves gust, neon score bursts...)
      if (st.beatHit && st.scene && st.scene.react && st.scene.react.beatBurst && st.bass > 0.28) {
        const P = st.skin === 'classic' ? stagePix : stagePx, type = st.scene.react.beatBurst;
        const n = Math.round((type === 'neon' ? 2 : 5) * (0.5 + st.bass) * (st.dropHit ? 3 : 1));
        P.burst(type, n, type === 'leaves' ? 0 : P.W ? P.W / 2 : null, type === 'leaves' ? (P.H || 300) * rnd(0.2, 0.6) : P.H ? P.H * 0.45 : null);
        if (st.sceneOn) (st.skin === 'classic' ? backPix : backPx).burst(type, n, type === 'leaves' ? 0 : null, type === 'leaves' ? innerHeight * (st.skin === 'classic' ? 0.25 : 1) * rnd(0.2, 0.6) : null);
      }
      st.dropHit = now - st.lastDrop < 40;
      st.flash = Math.max(0, st.flash - dt * 1.6); st.shake = Math.max(0, st.shake - dt * 2.5);
      ch.fade(dt);
      const c = choose(now);
      ch.show(c.kind, c.name, c.ref, c.scale);
      const m = motion(now, dt);
      const top = ch.layers[ch.layers.length - 1];
      if (top && (top.kind === 'dance' || top.kind === 'pdance')) { const L = danceLoop(top.kind === 'pdance' ? top.ref.meta : top.name); m.loopPos = L.pos; m.loopRate = L.rate; } else { m.loopPos = 0; m.loopRate = 1; }
      st.motion = m;
      const pixel = st.skin === 'classic';
      if (!pixel) drawStage(el.stage, false, m, dt, stagePx); else drawStage(el.pxStage, true, m, dt, stagePix);
      // page backdrop: CSS transform/opacity only (cheap) + particle canvas
      const canvasBack = st.sceneOn && el.sceneCanvas && st.scene && (st.scene.kind === 'video' || (st.scene.kind === 'pixel' && st.scene.video) || st.ditherFx);
      document.body.classList.toggle('canvas-back', !!canvasBack);
      if (canvasBack) drawBackdrop(el.sceneCanvas, pixel);
      if (el.backArt && st.sceneOn) {
        const sc = 1.06 + (st.playing ? m.pulse * 0.012 + st.flash * 0.025 : 0);
        const px = (info.pointerX || 0) * 10, py = (info.pointerY || 0) * 8;
        const sx = st.shake ? (Math.random() - 0.5) * st.shake * 14 : 0, sy = st.shake ? (Math.random() - 0.5) * st.shake * 14 : 0;
        el.backArt.style.transform = `translate3d(${(px + sx).toFixed(1)}px,${(py + sy).toFixed(1)}px,0) scale(${sc.toFixed(4)})`;
        if (el.backGlow) el.backGlow.style.opacity = (0.15 + st.bass * 0.55 + st.flash * 0.4).toFixed(3);
        const fx = el.fx;
        if (fx) {
          const k = pixel ? 1 / 4 : 1;
          const W = Math.round(innerWidth * k), H = Math.round(innerHeight * k);
          if (fx.width !== W || fx.height !== H) { fx.width = W; fx.height = H; }
          const g = fx.getContext('2d'); g.clearRect(0, 0, W, H);
          const P = pixel ? backPix : backPx;
          P.update(dt, W, H, st.playing ? st.energy : 0.05, k);
          P.draw(g, W, H, colors, m.pulse);
        }
      }
    }

    const api = {
      Scenes, st, behavior: beh,
      setTheme(palette, skin) { st.palette = palette; st.skin = skin; ctx.palette = palette; ctx.skin = skin; readColors(); applyScene(true); },
      /** scene list changed (packs installed / toggled): drop a manual pick that no longer exists, re-resolve auto */
      scenesChanged() {
        if (st.manual !== 'auto' && !Scenes.byId(st.manual)) st.manual = 'auto';
        if (st.genreScene && !Scenes.byId(st.genreScene.id)) st.genreScene = null;
        if (st.moodScene && !Scenes.byId(st.moodScene.id)) st.moodScene = null;
        if (st.track) st.genreScene = Scenes.matchGenre(st.track.genre, st.track.title, ['layered', 'full', 'video']) || null;
        applyScene(true);
      },
      setOptions(o) { Object.assign(st, o); applyScene(); },
      setManual(id) { st.manual = id || 'auto'; applyScene(); },
      /** call on track start */
      trackStarted(meta, title) {
        st.track = { genre: meta && meta.genre, title };
        st.genreScene = Scenes.matchGenre(meta && meta.genre, title, st.skin === 'classic' ? ['layered', 'full', 'video', 'pixel'] : ['layered', 'full', 'video']) || null;
        st.moodScene = null; applyScene();
        const ge = beh.genreEmote(meta && meta.genre, title), map = evMap();
        ev.log.push({ evt: 'start', t: Math.round(performance.now()), at: 0 }); st.lastEvent = 'start'; ev.quietFor = 0; ev.voxFor = 0;
        ev.lastSad = performance.now() - (ge === 'crying' && map && map.sad ? 20000 : 0);
        if (map && map.start) beh.queueEmotes([[map.start, EV_MS.start, 2]].concat(ge === 'crying' && map.sad ? [[map.sad, EV_MS.sad, 1]] : []));
        else beh.queueEmotes([['surprised', 800, 1]].concat(ge ? [[ge, 2000, 1]] : []));
      },
      /** re-evaluate mood scene a few seconds into the track */
      moodCheck() {
        if (st.genreScene) return;
        const s = Scenes.matchMood(st.bpm, st.energyAvg, st.track && st.track.title);
        if (s !== st.moodScene) { st.moodScene = s; applyScene(); }
      },
      favorite() { if (!beh.packEvent('message_liked')) beh.emote('love', 2000, 2); stagePx.burst('hearts', 10, (el.stage && el.stage.width / 2) || 100, (el.stage && el.stage.height / 2) || 100); },
      trackFinished() { if (!beh.packEvent('task_finished')) beh.emote('happy', 1800, 1); },
      playlistFinished() { beh.packEvent('big_win'); },
      failed() { beh.emote('confused', 2400, 3); },
      drop() { st.flash = 1; st.shake = 0.6; if (!fire('drop', performance.now())) beh.emote('surprised', 900, 1); },
      /** force a music event (tests / debugging): start drop hit quiet rise sad vocals */
      musicEvent(evt) { if (evt === 'drop') { st.lastDrop = performance.now(); return api.drop(); } return fire(evt, performance.now()); },
      get eventLog() { return ev.log.slice(); },
      clickReact() {
        const pool = ['happy', 'love', 'shy', 'smug', 'surprised', 'confused', 'flying', 'music', 'angry', 'bored'];
        beh.emote(pool[Math.floor(Math.random() * pool.length)], 1800, 2); st.flash = Math.max(st.flash, 0.5);
      },
      input() { beh.input(); },
      tick,
      get scene() { return st.scene; },
      /** what is on stage right now ({kind, name}); used by the tests */
      get layer() { const t = ch.layers[ch.layers.length - 1]; return t ? { kind: t.kind, name: t.name } : null; },
    };
    readColors();
    return api;
  }
  global.Luciel = { create, Scenes, Particles, Character };
})(window);
