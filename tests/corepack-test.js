// Luciel Core pack round trip: packs/luciel-core/pack.json -> LucielPacks.validate -> toScenes must equal art/scenes.json
const P = require('/workspace/aero-player/js/packs.js');
const fs = require('fs');
const core = JSON.parse(fs.readFileSync('/workspace/aero-player/packs/luciel-core/pack.json', 'utf8'));
const orig = JSON.parse(fs.readFileSync('/workspace/aero-player/art/scenes.json', 'utf8')).scenes;
const v = P.validate(core, new Map(), { builtin: true });
let fail = 0; const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
ok(v.ok, 'core pack validates' + (v.ok ? '' : ': ' + v.errors.join(' | ')));
const out = P.toScenes(v.pack, (p) => p, { builtin: true });
let diffs = [];
orig.forEach((o, i) => {
  const n = out[i];
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
    const a = JSON.stringify(o[k] === undefined ? (k === 'poses' ? ['music'] : undefined) : o[k]), b = JSON.stringify(n[k]);
    if (a !== b && !(k === 'px' && !o.px && n.px === n.image)) diffs.push(`${o.id}.${k}: ${a} vs ${b}`);
  }
});
ok(out.length === orig.length && !diffs.length, `core pack reproduces all ${orig.length} built-in scenes field-for-field` + (diffs.length ? ': ' + diffs.slice(0, 8).join(' | ') : ''));
process.exit(fail ? 1 : 0);
