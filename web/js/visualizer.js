/* Luciel visualizer: spectrum analyzer + oscilloscope, in "aero" (smooth glow) or "classic" (pixel) style. */
(function (global) {
  'use strict';
  const MODES = ['spectrum', 'scope', 'both', 'off'];

  class Visualizer {
    constructor(canvas, style) {
      this.c = canvas; this.g = canvas.getContext('2d');
      this.style = style; // 'aero' | 'classic'
      this.mode = 'spectrum';
      this.colors = { v1: '#3af', v2: '#6cf', v3: '#fff', peak: '#fff', glow: '#6cf', scope: '#fff', grid: 'rgba(255,255,255,.08)' };
      this.peaks = []; this.peakVel = []; this.levels = [];
      this.t = 0;
      this.freq = null; this.time = null;
    }
    setAnalyser(an, anL, anR) {
      this.an = an; this.anL = anL; this.anR = anR;
      this.freq = new Uint8Array(an.frequencyBinCount);
      this.time = new Uint8Array(an.fftSize);
      this.timeL = new Float32Array(anL.fftSize); this.timeR = new Float32Array(anR.fftSize);
      this.sampleRate = an.context.sampleRate;
    }
    resize() {
      if (this.style === 'classic') return; // fixed tiny bitmap, CSS scales it with pixelated rendering
      const r = this.c.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
      this.dpr = dpr;
    }
    bars(n, minF, maxF) {
      const out = new Float32Array(n);
      if (!this.an) return out;
      const binHz = this.sampleRate / this.an.fftSize, len = this.freq.length;
      for (let i = 0; i < n; i++) {
        const f0 = minF * Math.pow(maxF / minF, i / n), f1 = minF * Math.pow(maxF / minF, (i + 1) / n);
        let a = Math.floor(f0 / binHz), b = Math.max(a + 1, Math.ceil(f1 / binHz));
        a = Math.min(a, len - 1); b = Math.min(b, len);
        let m = 0; for (let k = a; k < b; k++) if (this.freq[k] > m) m = this.freq[k];
        // slight treble tilt so highs aren't always tiny
        out[i] = Math.min(1, (m / 255) * (0.86 + 0.28 * i / n));
      }
      return out;
    }
    draw(active, dt) {
      const g = this.g, W = this.c.width, H = this.c.height;
      this.t += dt;
      if (this.an && active) { this.an.getByteFrequencyData(this.freq); this.an.getByteTimeDomainData(this.time); }
      else if (this.freq) { this.freq.fill(0); this.time.fill(128); }
      g.clearRect(0, 0, W, H);
      if (this.mode === 'off') { this.drawOff(); return 0; }
      return this.style === 'classic' ? this.drawClassic(W, H, active) : this.drawAero(W, H, active, dt);
    }
    drawOff() {
      const g = this.g, W = this.c.width, H = this.c.height;
      if (this.style === 'classic') return;
      g.fillStyle = this.colors.grid; g.font = `${12 * (this.dpr || 1)}px Selawik, sans-serif`;
      g.textAlign = 'center'; g.fillText('visualizer off — click to enable', W / 2, H / 2);
    }

    // ---------------- CLASSIC (76x16 bitmap, Winamp-like) ----------------
    drawClassic(W, H, active) {
      const g = this.g, C = this.colors;
      // dotted background grid like Winamp
      g.fillStyle = C.grid;
      for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) g.fillRect(x, y, 1, 1);
      let energy = 0;
      if (this.mode === 'spectrum' || this.mode === 'both') {
        const n = 19, bw = 3, gap = 1;
        const v = this.bars(n, 40, 16000);
        const grad = g.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, C.v1); grad.addColorStop(0.55, C.v2); grad.addColorStop(1, C.v3);
        for (let i = 0; i < n; i++) {
          const lv = this.levels[i] = Math.max(v[i], (this.levels[i] || 0) - 0.06);
          energy += lv;
          const h = Math.round(lv * H);
          const x = i * (bw + gap);
          g.fillStyle = grad; g.fillRect(x, H - h, bw, h);
          if (!this.peaks[i] || h >= this.peaks[i]) { this.peaks[i] = h; this.peakVel[i] = 0; }
          else { this.peakVel[i] += 0.035; this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i]); }
          if (this.peaks[i] > 0.5) { g.fillStyle = C.peak; g.fillRect(x, H - Math.round(this.peaks[i]) - 1, bw, 1); }
        }
        energy /= n;
      }
      if (this.mode === 'scope' || this.mode === 'both') {
        g.fillStyle = this.mode === 'both' ? C.peak : C.v2;
        const t = this.time, step = t.length / W;
        let prev = null;
        for (let x = 0; x < W; x++) {
          const s = t[Math.floor(x * step)] / 255;
          const y = Math.max(0, Math.min(H - 1, Math.round(s * (H - 1))));
          if (prev !== null) { const a = Math.min(prev, y), b = Math.max(prev, y); g.fillRect(x, a, 1, Math.max(1, b - a)); }
          else g.fillRect(x, y, 1, 1);
          prev = y;
        }
      }
      return energy;
    }

    // ---------------- AERO (smooth, glowing, reflected) ----------------
    drawAero(W, H, active, dt) {
      const g = this.g, C = this.colors, d = this.dpr || 1;
      const floor = H * 0.78; // baseline; area below is reflection
      // faint grid
      g.strokeStyle = C.grid; g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < 5; i++) { const y = Math.round(floor * i / 5) + 0.5; g.moveTo(0, y); g.lineTo(W, y); }
      g.stroke();
      let energy = 0;
      const idle = !active;
      if (this.mode === 'spectrum' || this.mode === 'both') {
        const n = Math.max(24, Math.min(72, Math.floor(W / (14 * d))));
        const v = this.bars(n, 32, 18000);
        const gap = Math.max(2, Math.round(3 * d)), bw = (W - gap * (n - 1)) / n;
        const grad = g.createLinearGradient(0, floor, 0, 0);
        grad.addColorStop(0, C.v1); grad.addColorStop(0.6, C.v2); grad.addColorStop(1, C.v3);
        const top = [];
        for (let i = 0; i < n; i++) {
          let target = v[i];
          if (idle) target = 0.05 + 0.04 * Math.sin(this.t * 1.6 + i * 0.35) + 0.03 * Math.sin(this.t * 0.7 + i * 0.13);
          const prev = this.levels[i] || 0;
          const lv = this.levels[i] = target > prev ? prev + (target - prev) * 0.6 : Math.max(target, prev - 1.6 * dt);
          energy += i < n / 5 ? lv : 0;
          const h = Math.max(2 * d, lv * floor * 0.96);
          top.push(h);
          if (!this.peaks[i] || h >= this.peaks[i]) { this.peaks[i] = h; this.peakVel[i] = 0; }
          else { this.peakVel[i] += 0.5 * d * dt * 60; this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i] * dt * 6); }
        }
        energy /= Math.ceil(n / 5);
        // bars with glow
        g.save();
        g.shadowColor = C.glow; g.shadowBlur = 14 * d;
        g.fillStyle = grad;
        for (let i = 0; i < n; i++) {
          const x = i * (bw + gap), h = top[i], r = Math.min(bw / 2, 4 * d);
          roundRect(g, x, floor - h, bw, h, r, 0);
          g.fill();
        }
        g.restore();
        // glossy highlight on bars
        g.fillStyle = 'rgba(255,255,255,0.18)';
        for (let i = 0; i < n; i++) {
          const x = i * (bw + gap), h = top[i];
          g.fillRect(x + bw * 0.12, floor - h + 2 * d, bw * 0.28, Math.max(0, h - 4 * d));
        }
        // peaks
        g.fillStyle = C.peak;
        for (let i = 0; i < n; i++) {
          const x = i * (bw + gap), y = floor - this.peaks[i] - 5 * d;
          roundRect(g, x, y, bw, 2.5 * d, 1.2 * d, 1.2 * d); g.fill();
        }
        // reflection
        g.save();
        g.globalAlpha = 0.22;
        const rg = g.createLinearGradient(0, floor, 0, H);
        rg.addColorStop(0, C.v2); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        for (let i = 0; i < n; i++) {
          const x = i * (bw + gap), h = Math.min(top[i] * 0.35, H - floor);
          g.fillRect(x, floor + 2 * d, bw, h);
        }
        g.restore();
      }
      if (this.mode === 'scope' || this.mode === 'both') {
        const mid = this.mode === 'both' ? floor * 0.5 : floor * 0.5;
        const amp = floor * (this.mode === 'both' ? 0.42 : 0.5);
        const drawLine = (arr, color, width, alpha, isFloat) => {
          g.save();
          g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width * d;
          g.shadowColor = C.glow; g.shadowBlur = 10 * d; g.lineJoin = 'round';
          g.beginPath();
          const N = Math.min(arr.length, 1024), step = W / (N - 1);
          for (let k = 0; k < N; k++) {
            let s = isFloat ? arr[k] : (arr[k] - 128) / 128;
            if (idle) s = 0.06 * Math.sin(k / N * Math.PI * 6 + this.t * 2.2) * Math.sin(k / N * Math.PI);
            const y = mid - s * amp;
            k ? g.lineTo(k * step, y) : g.moveTo(0, y);
          }
          g.stroke(); g.restore();
        };
        if (this.anL && active && this.mode === 'scope') {
          this.anL.getFloatTimeDomainData(this.timeL); this.anR.getFloatTimeDomainData(this.timeR);
          drawLine(this.timeR, C.v1, 1.6, 0.65, true);
          drawLine(this.timeL, C.scope, 2, 1, true);
        } else {
          drawLine(this.time || new Uint8Array(1024).fill(128), C.scope, 2, this.mode === 'both' ? 0.9 : 1, false);
        }
        if (this.mode === 'scope' && !energy) {
          for (let k = 0; k < 40; k++) energy += Math.abs((this.time ? this.time[k * 20] : 128) - 128) / 128;
          energy /= 20;
        }
      }
      // horizon line
      const hz = g.createLinearGradient(0, 0, W, 0);
      hz.addColorStop(0, 'rgba(255,255,255,0)'); hz.addColorStop(0.5, C.glow); hz.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hz; g.globalAlpha = 0.5; g.fillRect(0, floor + 0.5 * d, W, 1 * d); g.globalAlpha = 1;
      return energy;
    }
  }
  function roundRect(g, x, y, w, h, rt, rb) {
    g.beginPath();
    g.moveTo(x + rt, y); g.lineTo(x + w - rt, y); g.quadraticCurveTo(x + w, y, x + w, y + rt);
    g.lineTo(x + w, y + h - rb); g.quadraticCurveTo(x + w, y + h, x + w - rb, y + h);
    g.lineTo(x + rb, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rb);
    g.lineTo(x, y + rt); g.quadraticCurveTo(x, y, x + rt, y); g.closePath();
  }
  global.AeroViz = { Visualizer, MODES };
})(window);
