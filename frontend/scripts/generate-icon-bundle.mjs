// Generate an OFFLINE Iconify bundle for HOPS.
//
// Why: @iconify/svelte fetches icon data from api.iconify.design at runtime for
// any icon it doesn't already have. HOPS uses Iconify for its own UI chrome
// (mdi:* — cog, search, arrows…) and for the brand logos it suggests for known
// services (simple-icons:*). Left as-is, the UI wouldn't render offline and
// would call an external host — breaking the "fully offline-capable, no
// external CDN" tenet (TENETS.md #10).
//
// This script scans the source for every `mdi:` / `simple-icons:` name actually
// referenced — plus icons referenced only by DATA (see "Data sources" below) —
// extracts just those icons from the full @iconify-json data
// packages (devDependencies — never shipped), and writes a small module that
// registers them via addCollection(). Only the used icons are embedded, so the
// bundle stays tiny (~100 KB) instead of pulling the full 7.6 MB collections.
//
// Arbitrary Iconify names a user types by hand that aren't in this set still
// fall back to the API — the one documented online-only nicety.
//
// Data sources (icons that appear in no frontend source file but that stored
// content uses, so an offline host must still render them):
//   - backend/internal/**/testdata/*.json — fixtures, incl. the v3 Showcase
//     export (TestImport_V3Showcase asserts every icon in it is bundled);
//   - backend/internal/database/*.go     — the DB icon seeds (icon_seeds.go);
//   - backend/internal/database/*.json   — the fresh-install Sample (sample.json);
//   - scripts/icon-keep.txt              — an explicit keep-list, one
//     `prefix:name` per line (`#` starts a comment). Add an icon there when
//     it must stay bundled but nothing above references it (e.g. a very common
//     user-chosen icon such as mdi:home). Never rely on a code comment to keep
//     an icon in the bundle.
//
// Usage:
//   node scripts/generate-icon-bundle.mjs           # (re)write the bundle
//   node scripts/generate-icon-bundle.mjs --check    # fail if stale/unresolved (CI)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getIconData } from '@iconify/utils';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const BACKEND_INTERNAL = join(here, '..', '..', 'backend', 'internal');
const SEEDS_DIR = join(BACKEND_INTERNAL, 'database');
const KEEP_LIST = join(here, 'icon-keep.txt');
const OUT_DIR = join(SRC, 'lib', 'icons');
const OUT = join(OUT_DIR, 'offline-bundle.ts');
// Names only (no SVG bodies) of every icon in the full collections, for the icon editor's
// type-ahead. Loaded lazily by $lib/icons/iconNames.ts, so it never weighs on the dashboard.
const NAMES_OUT = join(OUT_DIR, 'icon-names.ts');

// Collections we embed. A new Iconify prefix used in the app must be added here
// (and its @iconify-json/<prefix> data package installed as a devDependency),
// otherwise its icons fall back to the runtime API.
const PREFIXES = ['mdi', 'simple-icons'];
const ICON_RE = new RegExp(`\\b(${PREFIXES.join('|')}):[a-z0-9]+(?:-[a-z0-9]+)*\\b`, 'g');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    // Source only — skip test files (their mock icon names aren't real) and the
    // generated bundle itself.
    else if (
      /\.(svelte|ts|js)$/.test(entry) &&
      !/\.(test|spec)\.(ts|js)$/.test(entry) &&
      entry !== 'offline-bundle.ts' &&
      entry !== 'icon-names.ts'
    ) {
      acc.push(p);
    }
  }
  return acc;
}

// 1. Collect every referenced "prefix:name" across the source.
const used = new Set();
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(ICON_RE)) used.add(m[0]);
}

// 1b. Data-only references: backend testdata fixtures, DB icon seeds and the
//     keep-list. A missing source is a hard failure, not a silently smaller
//     bundle.
function walkTestdata(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    if (entry === 'testdata') {
      for (const f of readdirSync(p)) if (f.endsWith('.json')) acc.push(join(p, f));
    } else {
      walkTestdata(p, acc);
    }
  }
  return acc;
}
for (const required of [BACKEND_INTERNAL, SEEDS_DIR, KEEP_LIST]) {
  if (!existsSync(required)) {
    console.error(`✗ icon data source missing: ${required}`);
    process.exit(1);
  }
}
const dataFiles = [
  ...walkTestdata(BACKEND_INTERNAL),
  ...readdirSync(SEEDS_DIR)
    .filter((f) => (f.endsWith('.go') && !f.endsWith('_test.go')) || f.endsWith('.json'))
    .map((f) => join(SEEDS_DIR, f)),
];
for (const file of dataFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(ICON_RE)) used.add(m[0]);
}
for (const raw of readFileSync(KEEP_LIST, 'utf8').split('\n')) {
  const line = raw.replace(/#.*/, '').trim();
  if (!line) continue;
  const m = line.match(ICON_RE);
  if (!m || m[0] !== line) {
    console.error(`✗ icon-keep.txt: not a "prefix:name" icon (${PREFIXES.join('/')}): ${line}`);
    process.exit(1);
  }
  used.add(line);
}

// 2. Resolve each against the full collection data, extracting just what's used.
const collections = {};
for (const prefix of PREFIXES) {
  collections[prefix] = require(`@iconify-json/${prefix}/icons.json`);
}

const bundles = {}; // prefix -> IconifyJSON { prefix, icons }
const missing = [];
for (const ref of [...used].sort()) {
  const [prefix, name] = ref.split(':');
  const data = getIconData(collections[prefix], name);
  if (!data) {
    missing.push(ref);
    continue;
  }
  (bundles[prefix] ??= { prefix, icons: {} }).icons[name] = data;
}

const ordered = PREFIXES.filter((p) => bundles[p]).map((p) => bundles[p]);
const total = ordered.reduce((n, b) => n + Object.keys(b.icons).length, 0);

// 3. Emit the registration module. @ts-nocheck keeps the big generated literal
//    out of svelte-check.
const out = `// @ts-nocheck
// AUTO-GENERATED by scripts/generate-icon-bundle.mjs — DO NOT EDIT.
// Offline Iconify data for every icon the app references, registered so the UI
// renders with no calls to api.iconify.design. Regenerate: npm run icons:bundle
import { addCollection } from '@iconify/svelte';

const collections = ${JSON.stringify(ordered)};

for (const collection of collections) {
\taddCollection(collection);
}
`;

// 3b. The names-only list, per prefix, as newline-joined strings (far smaller than a JSON
//     array of "prefix:name"):
//       suggest — every visible icon: what the type-ahead offers;
//       other   — aliases and hidden (deprecated) icons: not offered, but still real names the
//                 Iconify API serves, so a typed or stored one is "known" and may be previewed.
const nameLists = {};
let nameTotal = 0;
for (const prefix of PREFIXES) {
  const c = collections[prefix];
  const suggest = [];
  const other = [];
  for (const [name, data] of Object.entries(c.icons || {})) (data.hidden ? other : suggest).push(name);
  for (const name of Object.keys(c.aliases || {})) other.push(name);
  if (suggest.length === 0) {
    console.error(`✗ @iconify-json/${prefix} has no icon names — refusing to write an empty names list`);
    process.exit(1);
  }
  nameLists[prefix] = { suggest: suggest.sort().join('\n'), other: other.sort().join('\n') };
  nameTotal += suggest.length + other.length;
}
const namesOut = `// @ts-nocheck
// AUTO-GENERATED by scripts/generate-icon-bundle.mjs — DO NOT EDIT.
// The name of every icon in the full ${PREFIXES.join(' and ')} collections (names only, no
// SVG data), newline-joined per prefix: \`suggest\` (visible icons) and \`other\` (aliases,
// hidden icons). Imported only by $lib/icons/iconNames.ts with a
// dynamic import(), so it is its own chunk, loaded when the icon editor opens.
export const ICON_NAME_LISTS = ${JSON.stringify(nameLists)};
`;

const isCheck = process.argv.includes('--check');

if (isCheck) {
  // Fail only on staleness — a developer added/removed an icon without
  // regenerating. `missing` (icons upstream removed from the data packages, so
  // unbundleable) is a warning, not a failure: it can't be fixed by
  // regenerating and would otherwise wedge CI on pre-existing dead refs.
  const stale = !existsSync(OUT) || readFileSync(OUT, 'utf8') !== out;
  const namesStale = !existsSync(NAMES_OUT) || readFileSync(NAMES_OUT, 'utf8') !== namesOut;
  if (namesStale) {
    console.error('✗ icon-names.ts is out of date — run: npm run icons:bundle');
    process.exit(1);
  }
  if (missing.length) {
    console.warn(`⚠ ${missing.length} referenced icon(s) absent from the data packages (fall back to runtime API): ${missing.join(', ')}`);
  }
  if (stale) {
    console.error('✗ offline-bundle.ts is out of date — run: npm run icons:bundle');
    process.exit(1);
  }
  console.log(`✓ offline icon bundle up to date (${total} icons)`);
} else {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, out);
  writeFileSync(NAMES_OUT, namesOut);
  console.log(`✓ wrote ${NAMES_OUT} (${nameTotal} names)`);
  console.log(`✓ wrote ${OUT} (${total} icons across ${ordered.length} collections)`);
  if (missing.length) console.warn(`⚠ ${missing.length} unresolved, left to runtime API: ${missing.join(', ')}`);
}
