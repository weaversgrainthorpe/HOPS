// The offline icon bundle must keep icons that stored content uses even when no
// frontend source file mentions them (a regeneration dropped
// mdi:home because the only reference had been a code comment).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bundle = readFileSync(resolve(process.cwd(), 'src/lib/icons/offline-bundle.ts'), 'utf8');
const keep = readFileSync(resolve(process.cwd(), 'scripts/icon-keep.txt'), 'utf8');

function inBundle(name: string): boolean {
	return bundle.includes(`"${name}":{"width"`) || bundle.includes(`"${name}":{"body"`);
}

describe('offline icon bundle', () => {
	it.each(['home', 'chevron-up', 'eye-outline', 'page-layout-header'])(
		'contains mdi:%s',
		(name) => {
			expect(inBundle(name)).toBe(true);
		}
	);

	it('contains every keep-list icon', () => {
		const names = keep
			.split('\n')
			.map((l) => l.replace(/#.*/, '').trim())
			.filter(Boolean);
		expect(names.length).toBeGreaterThan(0);
		for (const ref of names) {
			const [, name] = ref.split(':');
			expect(inBundle(name), ref).toBe(true);
		}
	});
});
