/* Luciel BPM detection.
 * Offline: decode the file, mono 11.025 kHz, spectral-flux onset envelope, autocorrelation comb with a
 * tempo prior (coarse), then a phase-searched pulse-train fit over the whole excerpt (fine, ~0.02 BPM grid).
 * Returns { bpm, t0, period, confidence }. Runs the maths in an inline Blob worker (works from file:// too).
 * Live: LucielBPM.Tracker refines phase from analyser bass onsets (simple PLL) and gives a provisional
 * tempo from inter-onset intervals until the offline result arrives. */
(function (global) {
  'use strict';
  const workerSrc = `
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function onsetEnvelope(x, sr) {
    const N = 1024, hop = 128, nb = N / 2, win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const frames = Math.max(0, Math.floor((x.length - N) / hop));
    const env = new Float32Array(frames);
    let prev = new Float32Array(nb), cur = new Float32Array(nb);
    const re = new Float32Array(N), im = new Float32Array(N);
    const maxBin = Math.min(nb, Math.round(6000 / (sr / N)));
    for (let f = 0; f < frames; f++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let s = 0;
      for (let k = 1; k < maxBin; k++) {
        const m = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        cur[k] = m;
        const d = m - prev[k];
        if (d > 0) s += d * (k < 12 ? 1.6 : 1); // a little extra weight on kick/bass
      }
      env[f] = s;
      const t = prev; prev = cur; cur = t;
    }
    // remove slow trend (moving average ~0.4 s) and half-wave rectify
    const fps = sr / hop, w = Math.round(fps * 0.4), out = new Float32Array(frames);
    let acc = 0;
    for (let i = 0; i < frames; i++) {
      acc += env[i]; if (i >= w) acc -= env[i - w];
      const mean = acc / Math.min(i + 1, w);
      out[i] = Math.max(0, env[i] - mean);
    }
    let mx = 0; for (let i = 0; i < frames; i++) if (out[i] > mx) mx = out[i];
    if (mx > 0) for (let i = 0; i < frames; i++) out[i] /= mx;
    return { env: out, fps, offset: N / 2 / sr };
  }
  const interp = (a, p) => { const i = Math.floor(p), f = p - i; return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : 0; };
  function analyze(x, sr, tagBpm) {
    const { env, fps, offset } = onsetEnvelope(x, sr);
    const n = env.length;
    if (n < fps * 4) return null;
    const minB = 50, maxB = 220;
    const maxLag = Math.ceil(fps * 60 / minB * 4) + 2;
    const acf = new Float32Array(maxLag);
    for (let l = 0; l < maxLag; l++) { let s = 0; for (let i = l; i < n; i++) s += env[i] * env[i - l]; acf[l] = s / (n - l); }
    let best = 0, bestB = 120;
    const coarse = [];
    if (tagBpm) bestB = tagBpm;
    else {
      for (let b = minB; b <= maxB; b += 0.25) {
        const L = fps * 60 / b;
        let s = 0; for (let k = 1; k <= 4; k++) s += interp(acf, k * L) / Math.sqrt(k);
        const pr = Math.exp(-0.5 * Math.pow(Math.log2(b / 115) / 1.1, 2));
        const sc = s * (0.55 + 0.45 * pr);
        coarse.push(sc);
        if (sc > best) { best = sc; bestB = b; }
      }
    }
    // fine: pulse-train fit with phase search
    const fit = (b) => {
      const P = fps * 60 / b; let bs = -1, bp = 0;
      const step = Math.max(0.5, P / 64);
      for (let ph = 0; ph < P; ph += step) {
        let s = 0, c = 0;
        for (let t = ph; t < n - 1; t += P) { s += interp(env, t); c++; }
        s /= c; if (s > bs) { bs = s; bp = ph; }
      }
      return [bs, bp];
    };
    // octave check: among b/2, b, 2b take the fastest whose pulse-train fit is close to the best one
    if (!tagBpm) {
      const cands = [bestB / 2, bestB, bestB * 2].filter((b) => b >= 58 && b <= 190);
      const fits = cands.map((b) => fit(b)[0]);
      const top = Math.max(...fits);
      let pick = bestB;
      cands.forEach((b, i) => { const pr = Math.exp(-0.5 * Math.pow(Math.log2(b / 118) / 0.9, 2)); if (fits[i] * (0.7 + 0.3 * pr) >= top * 0.6) pick = b; });
      bestB = pick;
    }
    let fb = bestB, fs = -1, fp = 0;
    const span = tagBpm ? 0.6 : 2.5, st = tagBpm ? 0.05 : 0.05;
    for (let b = bestB - span; b <= bestB + span; b += st) { const [s, p] = fit(b); if (s > fs) { fs = s; fb = b; fp = p; } }
    let mean = 0; for (let i = 0; i < n; i++) mean += env[i]; mean /= n;
    return { bpm: Math.round(fb * 10) / 10, period: 60 / fb, t0: fp / fps + offset, confidence: Math.min(1, (fs / (mean || 1e-6) - 1) / 3) };
  }
  onmessage = (e) => { const { id, data, sr, tagBpm } = e.data; let r = null; try { r = analyze(data, sr, tagBpm); } catch (err) { r = { error: String(err) }; } postMessage({ id, r }); };
  `;
  let worker = null, seq = 0;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.r); } };
    return worker;
  }
  let dctx = null;
  async function decodeMono(blob, maxSec) {
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!dctx) dctx = new OAC(1, 1, 44100);
    const ab = await blob.arrayBuffer();
    const buf = await new Promise((res, rej) => { const p = dctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const len = Math.min(buf.length, Math.floor(maxSec * sr));
    const D = Math.max(1, Math.round(sr / 11025)), outSr = sr / D;
    const out = new Float32Array(Math.floor(len / D));
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    for (let i = 0, j = 0; j < out.length; j++) {
      let s = 0;
      for (let k = 0; k < D; k++, i++) for (let c = 0; c < ch; c++) s += chans[c][i];
      out[j] = s / (D * ch);
    }
    return { data: out, sr: outSr, duration: buf.duration };
  }
  async function analyzeBlob(blob, { tagBpm = 0, maxSec = 150 } = {}) {
    const { data, sr } = await decodeMono(blob, maxSec);
    const w = getWorker(); const id = ++seq;
    return new Promise((res) => { pending.set(id, res); w.postMessage({ id, data, sr, tagBpm: tagBpm || 0 }, [data.buffer]); });
  }

  /** Live helper: phase-locked beat clock. */
  class Tracker {
    constructor() { this.reset(); }
    reset() { this.bpm = 0; this.period = 0; this.t0 = 0; this.source = ''; this.onsets = []; this.avg = 0; this.lastOnset = -1; this.confidence = 0; }
    setGrid(bpm, t0, source, confidence) { this.bpm = bpm; this.period = 60 / bpm; this.t0 = t0 || 0; this.source = source; this.confidence = confidence || 0; }
    /** beat position (float beats since t0) for media time t */
    beatAt(t) { return this.period ? (t - this.t0) / this.period : 0; }
    /** feed bass energy (0..1) each frame with media time; returns true on detected onset */
    feed(e, t) {
      this.avg = this.avg * 0.96 + e * 0.04;
      const onset = e > this.avg * 1.45 + 0.04 && t - this.lastOnset > 0.18;
      if (!onset) return false;
      this.lastOnset = t;
      if (this.period) {
        // PLL: pull the grid gently towards the observed onset
        const b = this.beatAt(t), err = (b - Math.round(b)) * this.period;
        if (Math.abs(err) < this.period * 0.2) this.t0 += err * 0.08;
      }
      this.onsets.push(t); if (this.onsets.length > 24) this.onsets.shift();
      if (this.source !== 'analysis' && this.source !== 'tag' && this.onsets.length >= 8) {
        const iv = []; for (let i = 1; i < this.onsets.length; i++) iv.push(this.onsets[i] - this.onsets[i - 1]);
        iv.sort((a, b) => a - b); let p = iv[iv.length >> 1];
        while (p < 0.4) p *= 2; while (p > 1.2) p /= 2;
        this.setGrid(Math.round(600 / p) / 10, t, 'live', 0.3);
      }
      return true;
    }
  }
  global.LucielBPM = { analyzeBlob, Tracker };
})(window);
