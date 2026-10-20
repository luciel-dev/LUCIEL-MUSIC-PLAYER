/* Luciel audio engine: <audio> -> preamp -> 10-band EQ -> balance -> analyser -> volume -> out */
(function (global) {
  'use strict';
  const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    'Flat':          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Rock':          [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
    'Pop':           [-1, 1, 3, 4, 4, 2, 0, -1, -1, -1],
    'Jazz':          [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
    'Classical':     [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    'Dance':         [6, 5, 2, 0, 0, -2, -3, -3, 0, 0],
    'Electronic':    [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
    'Hip-Hop':       [6, 5, 2, 3, -1, -1, 1, -1, 2, 3],
    'Acoustic':      [4, 4, 3, 1, 2, 2, 3, 3, 3, 2],
    'Vocal':         [-2, -3, -3, 1, 4, 4, 3, 1, 0, -2],
    'Bass Boost':    [8, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    'Treble Boost':  [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
    'Loudness':      [6, 4, 0, 0, -2, 0, -1, -4, 5, 1],
    'Late Night':    [-3, -2, 0, 2, 3, 3, 2, 1, -1, -3],
    'Club':          [0, 0, 4, 3, 3, 3, 2, 0, 0, 0],
    'Live':          [-3, 0, 2, 3, 3, 3, 2, 1, 1, 1],
  };
  const GENRE_PRESET = [
    [/rock|metal|punk|grunge/i, 'Rock'], [/pop/i, 'Pop'], [/jazz|blues|soul/i, 'Jazz'],
    [/classic|orchestra|baroque|opera/i, 'Classical'], [/dance|disco|house/i, 'Dance'],
    [/electro|techno|trance|edm|synth|ambient/i, 'Electronic'], [/hip.?hop|rap|trap|r&b/i, 'Hip-Hop'],
    [/acoustic|folk|country/i, 'Acoustic'], [/vocal|speech|podcast|audiobook/i, 'Vocal'],
  ];

  class Engine {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.crossOrigin = 'anonymous';
      this.ctx = null;
      this.gains = BANDS.map(() => 0);
      this.preampDb = 0;
      this.eqOn = true;
      this.volume = 0.8;
      this.muted = false;
      this.balance = 0;
    }
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      const ctx = this.ctx = new AC({ latencyHint: 'playback' });
      this.src = ctx.createMediaElementSource(this.audio);
      this.pre = ctx.createGain();
      this.filters = BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.41; b.gain.value = 0;
        return b;
      });
      this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.78;
      this.analyser.minDecibels = -92; this.analyser.maxDecibels = -18;
      this.splitter = ctx.createChannelSplitter(2);
      this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
      this.anL.fftSize = this.anR.fftSize = 1024;
      this.out = ctx.createGain();
      let node = this.src.connect(this.pre);
      this.filters.forEach((f) => { node = node.connect(f); });
      node.connect(this.pan).connect(this.analyser).connect(this.out).connect(ctx.destination);
      this.pan.connect(this.splitter);
      this.splitter.connect(this.anL, 0); this.splitter.connect(this.anR, 1);
      this.audio.volume = 1;
      this.applyAll();
      return ctx;
    }
    applyAll() { this.applyEq(); this.setBalance(this.balance); this.applyVolume(); }
    applyEq() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.filters.forEach((f, i) => f.gain.setTargetAtTime(this.eqOn ? this.gains[i] : 0, t, 0.02));
      this.pre.gain.setTargetAtTime(this.eqOn ? Math.pow(10, this.preampDb / 20) : 1, t, 0.02);
    }
    setBand(i, db) { this.gains[i] = db; this.applyEq(); }
    setGains(arr) { this.gains = arr.slice(); this.applyEq(); }
    setPreamp(db) { this.preampDb = db; this.applyEq(); }
    setEqOn(on) { this.eqOn = on; this.applyEq(); }
    setBalance(v) {
      this.balance = v;
      if (this.pan && this.pan.pan) this.pan.pan.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
    applyVolume() {
      const duck = this.ducked ? 0.3 : 1;   // the system asked us to lower the volume (navigation prompt, notification)
      const v = this.muted ? 0 : this.volume * this.volume * duck; // perceptual curve
      if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
      else this.audio.volume = this.muted ? 0 : this.volume * duck;
    }
    setDucked(on) { this.ducked = !!on; this.applyVolume(); }
    setVolume(v) { this.volume = v; this.applyVolume(); }
    setMuted(m) { this.muted = m; this.applyVolume(); }
    /** Combined magnitude response in dB for an array of frequencies (for the EQ graph). */
    response(freqs) {
      if (!this.probes) {
        const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        const oc = new OAC(1, 128, 44100);
        this.probes = BANDS.map((f, i) => {
          const b = oc.createBiquadFilter();
          b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
          b.frequency.value = f; b.Q.value = 1.41; return b;
        });
      }
      const out = new Float32Array(freqs.length).fill(this.eqOn ? this.preampDb : 0);
      if (!this.eqOn) return out;
      const fa = new Float32Array(freqs), mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
      this.probes.forEach((f, i) => {
        if (this.gains[i] === 0) return;
        f.gain.value = this.gains[i];
        f.getFrequencyResponse(fa, mag, ph);
        for (let k = 0; k < mag.length; k++) out[k] += 20 * Math.log10(mag[k] || 1e-6);
      });
      return out;
    }
  }
  global.AeroAudio = { Engine, BANDS, PRESETS, GENRE_PRESET };
})(window);
