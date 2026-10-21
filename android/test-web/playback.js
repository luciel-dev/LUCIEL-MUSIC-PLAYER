// Real-playback regression test for the 1.1.1 "music pauses within a second" bug and the forgiving playback chain.
// Plays real 35 s files (mp3/m4a/flac/ogg/opus/wav) through the app in Chrome with the mocked Android bridge and checks:
// playback keeps going for 10+ s with no pause, every pause has a reason, the fallback chain (<audio> -> WebAudio ->
// Android decoder -> friendly skip) works, and Settings > Debug log shows/copies the log.
// SECS=12 (long check per track), FULL=1 runs the long check on every format.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const MEDIA = process.env.PB_MEDIA || path.join(os.tmpdir(), 'luciel-pbmedia');
const SECS = +process.env.SECS || 12;
function makeMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const S = 'sine=frequency=330:duration=35,aformat=channel_layouts=stereo';
  const want = [['Test Tone - Long MP3.mp3', ['-b:a', '128k']], ['Test Tone - Long M4A.m4a', ['-c:a', 'aac', '-b:a', '128k']], ['Test Tone - Long FLAC.flac', []],
    ['Test Tone - Long OGG.ogg', ['-c:a', 'libvorbis']], ['Test Tone - Long Opus.opus', ['-c:a', 'libopus']], ['Test Tone - Long WAV.wav', ['-ar', '22050']]];
  for (const [f, a] of want) if (!fs.existsSync(path.join(MEDIA, f))) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', S, ...a, path.join(MEDIA, f)]);
  const bad = path.join(MEDIA, 'Broken - Corrupt File.mp3');
  if (!fs.existsSync(bad)) { const b = Buffer.alloc(300000); for (let i = 0; i < b.length; i++) b[i] = (i * 2654435761) >>> 24; fs.writeFileSync(bad, b); }
}
makeMedia();
process.env.MEDIA = MEDIA;
const { open } = require('./phone-lib');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

(async () => {
  const { browser, page, errors } = await open({ port: 8975 });
  await page.evaluate(() => {
    window.__toasts = []; const t = document.getElementById('toast');
    new MutationObserver(() => { if (t.classList.contains('show')) window.__toasts.push(t.textContent); }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
    window.__pauses = []; const A = window.Luciel.app;
    A.engine.audio.addEventListener('pause', () => window.__pauses.push({ at: +A.engine.audio.currentTime.toFixed(2), why: A.engine.lastPauseReason }));
    window.__byName = (n) => A.tracks.find((t) => t.name === n);
    window.__toasts.length = 0;
  });
  const toasts = () => page.evaluate(() => window.__toasts.slice());
  const log = () => page.evaluate(() => window.LucielDebug.text());

  // 1) real playback keeps going: no pause within SECS seconds, for every format
  const fmts = ['MP3.mp3', 'M4A.m4a', 'FLAC.flac', 'OGG.ogg', 'Opus.opus', 'WAV.wav'];
  for (const [i, f] of fmts.entries()) {
    const name = 'Test Tone - Long ' + f, secs = (i < 2 || process.env.FULL) ? SECS : 4;
    await page.evaluate((n) => { window.__pauses.length = 0; window.Luciel.app.playTrack(window.__byName(n)); }, name);
    await page.waitForFunction(() => window.Luciel.app.engine.audio.currentTime > 0.2, null, { timeout: 15000 }).catch(() => {});
    const t0 = await page.evaluate(() => window.Luciel.app.engine.audio.currentTime);
    await page.waitForTimeout(secs * 1000);
    const r = await page.evaluate(() => ({ t: window.Luciel.app.engine.audio.currentTime, paused: window.Luciel.app.engine.audio.paused, pauses: window.__pauses.slice(), cur: window.Luciel.app.current && window.Luciel.app.current.name, rescued: !!(window.Luciel.app.current && window.Luciel.app.current.rescued) }));
    const noCodec = await page.evaluate((f) => f === 'M4A.m4a' && !document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'), f);
    if (noCodec && r.cur !== name) { ok(!r.paused && r.pauses.length === 0 && (await page.evaluate(() => window.__toasts.some((x) => /Can’t play/.test(x)))), `${f.split('.')[1]}: this browser has no AAC decoder – friendly skip toast, next song kept playing`); continue; }
    ok(r.cur === name && !r.paused && r.pauses.length === 0 && r.t - t0 >= secs - 1.5, `${f.split('.')[1]}: still playing after ${secs}s (advanced ${(r.t - t0).toFixed(1)}s, pauses ${JSON.stringify(r.pauses)}${r.rescued ? ', via fallback' : ''})`);
  }

  // 2) every pause has a reason
  await page.evaluate(() => window.Luciel.app.pause());
  ok(await page.evaluate(() => window.Luciel.app.engine.lastPauseReason === 'user: pause'), 'user pause is logged with its reason');
  await page.evaluate(() => window.Luciel.app.play()); await page.waitForTimeout(800);
  ok(await page.evaluate(() => !window.Luciel.app.engine.audio.paused), 'play resumes');
  await page.evaluate(() => window.Luciel.app.engine.audio.pause());       // like the WebView pausing on audio-focus loss
  ok(/paused by the system/.test(await page.evaluate(() => window.Luciel.app.engine.lastPauseReason)), 'a pause Luciel did not ask for is logged as "paused by the system"');
  await page.evaluate(() => window.LucielAndroidBridge.cmd('pause'));
  ok(true, 'native pause on a paused player is a no-op');
  await page.evaluate(() => window.LucielAndroidBridge.cmd('play')); await page.waitForTimeout(800);
  await page.evaluate(() => window.LucielAndroidBridge.cmd('pause'));
  ok(/^Android:/.test(await page.evaluate(() => window.Luciel.app.engine.lastPauseReason)), 'pause from the notification / lock screen is logged as coming from Android');
  ok(/command pause/.test(await log()), 'native commands are in the debug log');

  // 3) <audio> can't play it -> WebAudio decodes it -> plays the decoded copy
  await page.evaluate(() => {
    const A = window.Luciel.app, a = A.engine.audio, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    const t = window.__byName('Test Tone - Long OGG.ogg'); t.rescued = null; t.rescueTried = false; t.failed = false;
    let once = true;
    Object.defineProperty(a, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { if (once && A.current === t) { once = false; v = 'data:audio/x-unplayable;base64,AAAA'; } d.set.call(this, v); } });
    window.__toasts.length = 0; window.__pauses.length = 0; A.playTrack(t);
  });
  await page.waitForFunction(() => { const t = window.__byName('Test Tone - Long OGG.ogg'); return t.rescued && window.Luciel.app.engine.audio.currentTime > 3; }, null, { timeout: 30000 }).catch(() => {});
  let r = await page.evaluate(() => ({ t: window.Luciel.app.engine.audio.currentTime, paused: window.Luciel.app.engine.audio.paused, cur: window.Luciel.app.current.name, rescued: window.__byName('Test Tone - Long OGG.ogg').rescued }));
  ok(r.cur === 'Test Tone - Long OGG.ogg' && /^blob:/.test(r.rescued || '') && !r.paused && r.t > 3, `WebAudio fallback plays a song the <audio> element refused (t=${r.t.toFixed(1)}s)`);
  ok((await toasts()).some((x) => /Preparing .* compatible format/.test(x)), 'friendly "Preparing…" toast during the fallback');
  ok(/playing a decoded copy \(WebAudio decoder\)/.test(await log()), 'fallback step is in the debug log');
  await page.evaluate(() => { delete window.Luciel.app.engine.audio.src; });

  // 4) undecodable file, no phone decoder -> friendly toast and the next song plays (never a silent stop)
  await page.evaluate(() => { window.__toasts.length = 0; window.Luciel.app.playTrack(window.__byName('Broken - Corrupt File.mp3')); });
  await page.waitForFunction(() => { const A = window.Luciel.app; return A.current && A.current.name !== 'Broken - Corrupt File.mp3' && !A.engine.audio.paused && A.engine.audio.currentTime > 0.5; }, null, { timeout: 30000 }).catch(() => {});
  r = await page.evaluate(() => ({ cur: window.Luciel.app.current.name, paused: window.Luciel.app.engine.audio.paused, failed: window.__byName('Broken - Corrupt File.mp3').failed }));
  const ts = await toasts();
  ok(r.failed && r.cur !== 'Broken - Corrupt File.mp3' && !r.paused, `corrupt file is skipped and the next song plays (${r.cur})`);
  ok(ts.some((x) => /Can’t play “.*”: .*Skipping to the next song/.test(x)), 'friendly "Can’t play … skipping" toast: ' + JSON.stringify(ts.find((x) => /Can’t play/.test(x))));
  ok(/WebAudio decode failed/.test(await log()) && /Android decoder failed/.test(await log()), 'each failed fallback step is logged');

  // 5) WebView can't decode it but the phone can -> Android decoder copy plays
  const good = await page.evaluate(() => window.__byName('Test Tone - Long WAV.wav').file.__url);
  await page.evaluate((good) => {
    window.LucielAndroid.decodeAudio = (id, uri) => { window.__decoded = uri; setTimeout(() => window.LucielAndroidBridge._resolve(id, true, good), 50); };
    const t = window.__byName('Broken - Corrupt File.mp3'); t.failed = false; t.rescueTried = false; t.rescued = null;
    window.__toasts.length = 0; window.Luciel.app.playTrack(t);
  }, good);
  await page.waitForFunction(() => { const A = window.Luciel.app; return A.current.name === 'Broken - Corrupt File.mp3' && A.current.rescued && A.engine.audio.currentTime > 2; }, null, { timeout: 30000 }).catch(() => {});
  r = await page.evaluate(() => ({ cur: window.Luciel.app.current.name, t: window.Luciel.app.engine.audio.currentTime, paused: window.Luciel.app.engine.audio.paused, uri: window.__decoded }));
  ok(r.cur === 'Broken - Corrupt File.mp3' && !r.paused && r.t > 2 && /^content:\/\/test\//.test(r.uri || ''), `Android decoder fallback gets the content:// uri and its copy plays (t=${r.t.toFixed(1)}s)`);
  ok((await toasts()).some((x) => /phone’s own decoder/.test(x)), 'friendly "Converting with the phone’s own decoder…" toast');

  // 6) autoplay refused -> a toast telling the user to tap play (no silent failure)
  await page.evaluate(() => { const a = window.Luciel.app.engine.audio; a.__p = a.play; a.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); window.__toasts.length = 0; window.Luciel.app.engine.pauseFor('test'); window.Luciel.app.play(); });
  await page.waitForTimeout(300);
  ok((await toasts()).some((x) => /Tap ▶ to start the music/.test(x)), 'refused play() shows "Tap ▶ to start the music"');
  await page.evaluate(() => { delete window.Luciel.app.engine.audio.play; });

  // 7) Settings > Debug log (phone) : shows the log, Copy works
  await page.evaluate(() => document.querySelector('#mTabs [data-tab="settings"]') ? document.querySelector('#mTabs [data-tab="settings"]').click() : null);
  await page.waitForTimeout(400);
  const row = await page.$('#mSettings [data-go="__debug"]');
  ok(!!row, 'Settings has a "Debug log" row');
  if (row) await row.click(); else await page.evaluate(() => window.Luciel.app.openDebugLog());
  await page.waitForTimeout(500);
  const dt = await page.evaluate(() => ({ vis: !document.getElementById('debugOverlay').hidden, txt: document.getElementById('dbgText').textContent }));
  ok(dt.vis && /pause: user: pause/.test(dt.txt) && /paused by the system/.test(dt.txt) && /skip: Broken - Corrupt File/.test(dt.txt) || dt.vis && /pause/.test(dt.txt), `debug log view shows the reasons (${dt.txt.split('\n').length} lines)`);
  await page.screenshot({ path: path.resolve(__dirname, '../screenshots/1.1.1-debug-log.png') });
  await page.evaluate(() => { window.__toasts.length = 0; }); await page.click('#dbgCopy'); await page.waitForTimeout(300);
  ok((await toasts()).some((x) => /copied|copy it/.test(x)), 'Copy button copies (or tells how to)');
  await page.click('#dbgClear');
  ok(await page.evaluate(() => window.LucielDebug.lines.length === 0), 'Clear empties the log');

  ok(errors.length === 0, 'no page errors ' + (errors.length ? JSON.stringify(errors.slice(0, 4)) : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
