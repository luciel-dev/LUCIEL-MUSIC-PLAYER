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

  /** Playback debug log: every play / pause / stop / error with its reason. Shown in Settings > Debug log (copyable),
   *  printed to the console as "[luciel:audio] ..." and, on Android, mirrored to logcat (tag LucielAudio). */
  const DBG = global.LucielDebug = global.LucielDebug || (() => {
    const lines = [];
    const pad = (n, k = 2) => String(n).padStart(k, '0');
    const add = (src, msg) => {
      const d = new Date();
      const line = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${src}: ${msg}`;
      lines.push(line); if (lines.length > 500) lines.shift();
      try { console.info('[luciel:audio] ' + src + ': ' + msg); } catch (e) {}
      try { if (global.LucielAndroid && global.LucielAndroid.log) global.LucielAndroid.log(src + ': ' + msg); } catch (e) {}
    };
    return { add, lines, text: () => lines.join('\n'), clear: () => { lines.length = 0; } };
  })();

  class Engine {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.crossOrigin = 'anonymous';
      this.pauseReason = ''; this.lastPauseReason = '';
      this.onPlayError = null;           // app hook: friendly message when play() is refused
      const a = this.audio;
      const where = () => `${a.currentTime.toFixed(1)}s` + (this.label ? ' – ' + this.label : '');
      a.addEventListener('pause', () => {
        // anything that didn't go through pauseFor() was done by the browser / OS (audio focus, call, unplugged output)
        const why = this.pauseReason || (a.ended ? 'track ended' : a.error ? 'media error' : 'paused by the system (not by Luciel: audio focus taken by a call or another app, or the output went away)');
        this.lastPauseReason = why; this.pauseReason = '';
        DBG.add('pause', `${why} at ${where()}`);
      });
      a.addEventListener('playing', () => DBG.add('play', `playing at ${where()}`));
      a.addEventListener('error', () => DBG.add('error', `media error ${a.error ? a.error.code + ' ' + (a.error.message || '') : '?'} at ${where()}`));
      a.addEventListener('stalled', () => DBG.add('net', `stalled (no data) at ${where()}`));
      this.ctx = null;
      this.gains = BANDS.map(() => 0);
      this.preampDb = 0;
      this.eqOn = true;
      this.volume = 0.8;
      this.muted = false;
      this.balance = 0;
    }
    /** pause with a reason for the debug log */
    pauseFor(reason) { if (this.audio.paused) return; this.pauseReason = reason || 'unspecified'; this.audio.pause(); }
    /** play() that never fails silently: refusals are logged and reported to the app */
    play(reason) {
      DBG.add('play', `requested (${reason || 'unspecified'})` + (this.label ? ' – ' + this.label : ''));
      const p = this.audio.play();
      if (!p || !p.catch) return Promise.resolve();
      return p.catch((e) => {
        if (e && e.name === 'AbortError') { DBG.add('play', 'interrupted by a new song (normal)'); return; }
        DBG.add('play', `refused: ${e && e.name} ${e && e.message}`);
        if (this.onPlayError) this.onPlayError(e);
      });
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
    setDucked(on) { this.ducked = !!on; DBG.add('duck', on ? 'lower volume (system asked)' : 'volume restored'); this.applyVolume(); }
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
