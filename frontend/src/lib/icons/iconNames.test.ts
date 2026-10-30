// Suggestions cover every icon name in the full mdi and simple-icons
// sets. The generator writes a names-only list (no SVG bodies) into its own lazily loaded
// module; these tests read it as the icon editor does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadIconNames } from './iconNames';
import { bundledSuggestions, rankIconSuggestions } from '$lib/utils/iconSuggest';

describe('full icon names list', () => {
	it('lists every mdi and simple-icons name as prefix:name', async () => {
		const { suggest: names, known } = await loadIconNames();
		expect(known.size).toBeGreaterThan(names.length); // aliases and hidden icons are known too
		const mdi = names.filter((n) => n.startsWith('mdi:'));
		const si = names.filter((n) => n.startsWith('simple-icons:'));
		expect(mdi.length).toBeGreaterThan(7000);
		expect(si.length).toBeGreaterThan(3000);
		for (const n of ['mdi:server', 'mdi:server-minus', 'mdi:account-cowboy-hat', 'simple-icons:proxmox']) {
			expect(names).toContain(n);
		}
	});

	it('mdi:ser gives 5 suggestions including mdi:server; mdi:server-m narrows to minus', async () => {
		const pool = bundledSuggestions((await loadIconNames()).suggest);
		const ser = rankIconSuggestions(pool, 'mdi:ser').map((s) => s.label);
		expect(ser).toHaveLength(5);
		expect(ser[0]).toBe('mdi:server');
		const m = rankIconSuggestions(pool, 'mdi:server-m').map((s) => s.label);
		expect(m[0]).toBe('mdi:server-minus');
		expect(m.every((l) => l.startsWith('mdi:server-m'))).toBe(true);
	});

	it('is a separate module the dashboard never imports (lazy chunk)', () => {
		const layout = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');
		const bundle = readFileSync(resolve(process.cwd(), 'src/lib/icons/offline-bundle.ts'), 'utf8');
		expect(layout).not.toMatch(/icon-names/);
		expect(bundle).not.toMatch(/icon-names/);
		const editor = readFileSync(resolve(process.cwd(), 'src/lib/components/admin/IconEditModal.svelte'), 'utf8');
		expect(editor).not.toMatch(/^\s*import[^;]*icon-names/m);
	});
});
