// The legacy (v2-shaped) editor and view are retired. No shipped
// frontend code references them, and the drag library they used is gone.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const BANNED = [
  'TabPanel', 'ToLegacy', 'FromLegacy', 'LegacyCache', 'v3Only', 'V3Only', 'dashboardRevisions',
  'svelte-dnd-action', 'mutateDashboard', 'saveOneDashboard', "kind === 'legacy'", 'View-only (v3)'
];

function shippedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test') continue; // test mocks and setup
      out.push(...shippedFiles(p));
    } else if (/\.(ts|svelte|js)$/.test(name) && !/\.test\.ts$/.test(name) && !/TestKit\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('the legacy editor and view are retired', () => {
  it('no shipped frontend file references the legacy machinery', () => {
    const hits: string[] = [];
    for (const f of shippedFiles(SRC)) {
      const text = readFileSync(f, 'utf8');
      for (const b of BANNED) if (text.includes(b)) hits.push(`${f.slice(SRC.length + 1)}: ${b}`);
    }
    expect(hits).toEqual([]);
  });

  it('the legacy components and stores are deleted', () => {
    for (const f of ['lib/components/TabPanel.svelte', 'lib/components/Group.svelte', 'lib/stores/selection.ts', 'lib/stores/clipboard.ts']) {
      expect(() => statSync(join(SRC, f)), f).toThrow();
    }
  });

  it('svelte-dnd-action is no longer a dependency', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('svelte-dnd-action');
    expect(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8')).not.toContain('node_modules/svelte-dnd-action');
  });
});
