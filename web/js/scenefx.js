/* Luciel scene effects: real-time ordered dither (WebGL, Bayer 4x4 / 8x8), video-loop playback nudged toward the BPM,
 * and character post-effects (cyber hologram + RGB split + scanlines, 1-bit dither, datamosh smears + pixel sorting). */
(function (global) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------ WebGL ordered dither
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `precision mediump float;
uniform sampler2D tex; uniform vec2 res, asp; uniform vec3 xf; uniform float thr, pix, bsize, mode, levels, time;
uniform vec3 pal0, pal1, pal2, pal3;
float B2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float B4(vec2 a){ return B2(.5 * a) * .25 + B2(a); }
float B8(vec2 a){ return B4(.5 * a) * .25 + B2(a); }
void main(){
  vec2 fc = floor(gl_FragCoord.xy / pix);
  vec2 q = (fc + .5) * pix / res - .5; q.y = -q.y;
  vec2 uv = q * asp / xf.x + .5 + xf.yz;
  vec4 c = texture2D(tex, clamp(uv, 0., 1.));
  float b = bsize > 6. ? B8(fc) : B4(fc);
  float l = dot(c.rgb, vec3(.299, .587, .114));
  if (mode < .5) {            // palette ramp (4 colours), threshold shimmers with the beat
    float i = clamp(floor(l * 3.2 + b + thr - .1), 0., 3.);
    vec3 col = i < .5 ? pal0 : i < 1.5 ? pal1 : i < 2.5 ? pal2 : pal3;
    gl_FragColor = vec4(col, 1.);
  } else if (mode < 1.5) {    // colour-preserving posterize dither (post-effect over any scene)
    vec3 q = floor(c.rgb * levels + b + thr * .6) / levels;
    gl_FragColor = vec4(clamp(q, 0., 1.), 1.);
  } else {                    // 1-bit: two inks, hard alpha (straight alpha in, premultiplied out)
    float a = step(b * .9 + .05, c.a);
    vec2 px = pix / res; px.y = -px.y;
    float lx = dot(texture2D(tex, clamp(uv + vec2(px.x * asp.x / xf.x, 0.), 0., 1.)).rgb, vec3(.299, .587, .114));
    float ly = dot(texture2D(tex, clamp(uv + vec2(0., px.y * asp.y / xf.x), 0., 1.)).rgb, vec3(.299, .587, .114));
    float edge = step(.1, abs(lx - l) + abs(ly - l));           // ink outlines keep the face / hair readable
    float u = clamp((l - .62) * 2.6 + .5, 0., 1.) * (1. - edge);
    vec3 col = u + thr * .25 > b ? pal3 : pal0;
    gl_FragColor = vec4(col * a, a);
  }
}`;
  class Dither {
    constructor() {
      this.cv = document.createElement('canvas');
      const gl = this.gl = this.cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
      if (!gl) { this.ok = false; return; }
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = this.pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.u = {}; ['res', 'asp', 'xf', 'thr', 'pix', 'bsize', 'mode', 'levels', 'time', 'pal0', 'pal1', 'pal2', 'pal3'].forEach((n) => { this.u[n] = gl.getUniformLocation(pr, n); });
      this.ok = true;
    }
    /** render source (image/video/canvas) into this.cv at W x H. p: {mode 0|1|2, pix, bayer 4|8, thr, levels, zoom, ox, oy, pal:[[r,g,b]x4] 0..1} */
    render(src, W, H, p) {
      if (!this.ok || this.blocked) return null;
      const gl = this.gl;
      if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
      gl.viewport(0, 0, W, H);
      try {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } catch (e) { this.blocked = true; return null; }   // e.g. file:// pages: local images count as cross-origin for WebGL
      const u = this.u, pal = p.pal || [[0, 0, 0], [0.33, 0.33, 0.33], [0.66, 0.66, 0.66], [1, 1, 1]];
      gl.uniform2f(u.res, W, H); gl.uniform2f(u.asp, (p.asp || [1, 1])[0], (p.asp || [1, 1])[1]); gl.uniform3f(u.xf, p.zoom || 1, p.ox || 0, p.oy || 0);
      gl.uniform1f(u.thr, p.thr || 0); gl.uniform1f(u.pix, p.pix || 1); gl.uniform1f(u.bsize, p.bayer || 8);
      gl.uniform1f(u.mode, p.mode || 0); gl.uniform1f(u.levels, p.levels || 4); gl.uniform1f(u.time, p.time || 0);
      gl.uniform3fv(u.pal0, pal[0]); gl.uniform3fv(u.pal1, pal[1]); gl.uniform3fv(u.pal2, pal[2]); gl.uniform3fv(u.pal3, pal[3]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.cv;
    }
  }
  const hex = (h) => { h = String(h || '#000').trim(); if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g).map(Number); return [m[0] / 255, m[1] / 255, m[2] / 255]; } h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  // ------------------------------------------------------------------ looping background videos
  class VideoLoop {
    constructor(src) {
      const v = this.v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; if (/^https?:$/.test(location.protocol)) v.crossOrigin = 'anonymous'; v.src = src;   // file:// can't do CORS
      v.setAttribute('aria-hidden', 'true');
      this.rate = 1;
      v.addEventListener('error', () => { this.broken = true; }, { once: true });
    }
    get ready() { return !this.broken && this.v.readyState >= 2; }
    /** keep it playing; nudge playbackRate toward bpm (octave-folded) relative to the loop's nominal tempo */
    update(playing, bpm, loopBpm = 120) {
      const v = this.v; if (this.broken) return;
      if (v.paused) v.play().catch(() => {});
      let target = 0.55;
      if (playing && bpm) { let m = 1; while (bpm * m / loopBpm < 0.75) m *= 2; while (bpm * m / loopBpm > 1.35) m /= 2; target = clamp(bpm * m / loopBpm, 0.75, 1.35); }
      else if (playing) target = 1;
      this.rate += (target - this.rate) * 0.04;
      if (Math.abs(v.playbackRate - this.rate) > 0.01) v.playbackRate = this.rate;
    }
    pause() { if (!this.v.paused) this.v.pause(); }
  }

  // ------------------------------------------------------------------ character post-effects (2D canvas)
  function layer(cache, key, W, H) {
    let c = cache[key];
    if (!c) { c = cache[key] = document.createElement('canvas'); }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d', { willReadFrequently: key === 'sort' });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H);
    return [c, g];
  }
  function tint(cache, key, src, color, amount) {
    const [c, g] = layer(cache, key, src.width, src.height);
    g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = amount; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  /** cyber: cyan hologram tint, chromatic RGB split, scanlines, flicker + slice jitter on beats */
  function cyber(g, src, fx, st) {
    const W = src.width, H = src.height, k = fx.scale || 1;
    const holo = tint(fx.cache, 'holo', src, '#29f6ff', 0.55);
    const [, hg] = [holo, holo.getContext('2d')];
    hg.globalCompositeOperation = 'destination-out'; hg.globalAlpha = 0.38; hg.fillStyle = '#000';
    const step = Math.max(2, Math.round(3 * k)), off = Math.floor((fx.t * 40) % step);
    for (let y = off; y < H; y += step) hg.fillRect(0, y, W, Math.max(1, Math.round(k)));
    hg.globalAlpha = 1; hg.globalCompositeOperation = 'source-over';
    const split = (2 + st.pulse * 7 + st.flash * 10) * k;
    const red = tint(fx.cache, 'red', src, '#ff2a6d', 0.85), blue = tint(fx.cache, 'blue', src, '#2a6dff', 0.85);
    g.save();
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 + st.pulse * 0.2;
    g.drawImage(red, -split, 0); g.drawImage(blue, split, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = (0.82 + Math.random() * 0.1) * (st.pulse > 0.7 && Math.random() < 0.3 ? 0.6 : 1);
    if (st.pulse > 0.6 || st.flash > 0.3) {     // slice jitter on the beat
      const n = 5; for (let i = 0; i < n; i++) { const y0 = (H / n) * i, dx = (Math.random() - 0.5) * 14 * k * (st.pulse + st.flash); g.drawImage(holo, 0, y0, W, H / n, dx, y0, W, H / n); }
    } else g.drawImage(holo, 0, 0);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25 + st.bass * 0.3; g.filter = `blur(${6 * k}px)`; g.drawImage(holo, 0, 0); g.filter = 'none';
    g.restore();
  }
  /** datamosh: smears and pixel sorting on beats / drops, plus block bleed from the previous frame */
  function datamosh(g, src, fx, st) {
    const W = src.width, H = src.height, k = fx.scale || 1;
    if (st.drop || (st.beatHit && Math.random() < 0.45)) fx.mosh = { until: fx.t + (st.drop ? 0.6 : 0.22), seed: Math.random(), sort: st.drop || Math.random() < 0.5 };
    const on = fx.mosh && fx.t < fx.mosh.until;
    if (!on) { g.drawImage(src, 0, 0); remember(fx, src); return; }
    let base = src;
    if (fx.mosh.sort && !fx.sortBlocked) {          // pixel-sort bright runs in a few bands (luminance order)
      const [c, cg] = layer(fx.cache, 'sort', W, H); cg.drawImage(src, 0, 0);
      try {
        const y0 = Math.floor(H * (0.15 + fx.mosh.seed * 0.5)), bh = Math.floor(H * 0.22);
        const id = cg.getImageData(0, y0, W, bh), d = id.data;
        for (let y = 0; y < bh; y++) {
          let x = 0;
          while (x < W) {
            while (x < W && d[(y * W + x) * 4 + 3] < 128) x++;
            let e = x; while (e < W && d[(y * W + e) * 4 + 3] >= 128) e++;
            if (e - x > 6) {
              const px = []; for (let i = x; i < e; i++) { const o = (y * W + i) * 4; px.push([d[o], d[o + 1], d[o + 2], d[o + 3]]); }
              px.sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
              for (let i = x; i < e; i++) { const o = (y * W + i) * 4, q = px[i - x]; d[o] = q[0]; d[o + 1] = q[1]; d[o + 2] = q[2]; d[o + 3] = q[3]; }
            }
            x = e;
          }
        }
        cg.putImageData(id, 0, y0); base = c;
      } catch (e) { fx.sortBlocked = true; }       // tainted canvas (file://): smears only
    }
    // block bleed from the previous frame (the classic P-frame "mosh")
    if (fx.prev) { g.save(); g.globalAlpha = 0.55; for (let i = 0; i < 6; i++) { const bw = (24 + Math.random() * 60) * k, bh = (10 + Math.random() * 40) * k, x = Math.random() * (W - bw), y = Math.random() * (H - bh); g.drawImage(fx.prev, x, y, bw, bh, x + (Math.random() - 0.5) * 30 * k, y + (Math.random() - 0.3) * 18 * k, bw, bh); } g.restore(); }
    // horizontal smears: repeated, fading copies of random slices
    g.drawImage(base, 0, 0);
    for (let i = 0; i < 5; i++) {
      const sh = (4 + Math.random() * 26) * k, y = Math.random() * (H - sh), dx = (Math.random() - 0.5) * 60 * k;
      for (let r = 1; r <= 3; r++) { g.globalAlpha = 0.5 / r; g.drawImage(base, 0, y, W, sh, dx * r, y, W, sh); }
    }
    g.globalAlpha = 1;
    remember(fx, base);
  }
  function remember(fx, src) { const [c, cg] = layer(fx.cache, 'prev', src.width, src.height); cg.drawImage(src, 0, 0); fx.prev = c; }

  global.LucielFX = { Dither, VideoLoop, layer, cyber, datamosh, hex };
})(window);
