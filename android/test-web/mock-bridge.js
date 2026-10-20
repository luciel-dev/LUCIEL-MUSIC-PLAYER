// Injected before the page loads: a fake window.LucielAndroid that behaves like WebBridge.kt
window.__calls = []; window.__reports = []; window.__writes = []; window.__prefs = {};
window.__perms = { audio: true, notifications: true, mic: true, overlay: true, listener: true };
window.__ext = { active: false };
window.__media = __MEDIA__;
const res = (id, ok, v) => setTimeout(() => window.LucielAndroidBridge._resolve(id, ok, v), 30);
window.LucielAndroid = {
  version: () => '1.0.0',
  info: () => JSON.stringify({ version: '1.0.0', sdk: 37, device: 'Headless Test', perms: window.__perms, prefs: Object.assign({ overlay: true, spotifyOnly: false, visualizer: true, fallbackBpm: 120, autoExtMode: true, bgPlay: true, autoHide: 20, overlayScene: 'auto', autoFloater: false }, window.__prefs) }),
  reportState: (j) => window.__reports.push(JSON.parse(j)),
  scanLibrary: (id) => { window.__calls.push('scan'); res(id, true, window.__media); },
  pickAudio: (id) => { window.__calls.push('pickAudio'); res(id, true, window.__media.slice(0, 2)); },
  pickFolder: (id, a) => { window.__calls.push('pickFolder:' + a); res(id, true, a ? window.__media.slice(2, 4) : []); },
  requestAudioPermission: (id) => res(id, true, true),
  writeFile: (id, uri, b64) => { window.__writes.push({ uri, len: atob(b64).length }); res(id, true, uri); },
  renameFile: (id, uri, name) => { window.__calls.push('rename:' + name); res(id, true, uri); },
  saveAs: (id, name, mime, b64) => { window.__calls.push('saveAs:' + name); res(id, true, { uri: 'content://x/1', name }); },
  extState: () => JSON.stringify(window.__ext),
  extFrame: () => {
    const now = performance.now() / 1000, bpm = window.__tapBpm || 128, beat = now * bpm / 60;
    const ph = beat - Math.floor(beat), kick = Math.exp(-ph * 6);
    const mags = new Uint8Array(512); for (let i = 0; i < 512; i++) mags[i] = Math.min(255, (i < 12 ? 200 * kick + 40 : 160 * Math.exp(-i / 90)) + Math.random() * 20);
    const wave = new Uint8Array(512); for (let i = 0; i < 512; i++) wave[i] = 128 + 60 * kick * Math.sin(i / 7);
    const b = (u) => btoa(String.fromCharCode(...u));
    return [bpm, beat, window.__tapBpm ? 'tap' : 'live', window.__ext.playing ? 1 : 0, 0.6 * kick, 0.6, 0.3, 0.2, 44100, b(mags), b(wave)].join('|');
  },
  extCommand: (c, a) => window.__calls.push('ext:' + c),
  extTap: () => (window.__tapBpm = 124), extSetBpm: () => {}, extUse: (on) => window.__calls.push('extUse:' + on), beatSource: () => 'live',
  setPref: (k, v) => { window.__prefs[k] = v === 'true' ? true : v === 'false' ? false : v; }, open: (w) => window.__calls.push('open:' + w),
  systemBars: (bg, light) => { window.__bars = { bg, light }; }, haptic: () => {}, toast: () => {}, exitApp: () => {},
  floater: (c) => window.__calls.push('floater:' + c), immersive: (on) => window.__calls.push('immersive:' + on),
};
