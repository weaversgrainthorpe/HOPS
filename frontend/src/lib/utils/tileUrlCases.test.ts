import { describe, it, expect } from 'vitest';
import fixture from '../../../../backend/internal/configdoc/testdata/tile_url_cases.json';
import { isValidUrl } from './url';

// The same cases drive configdoc.ValidTileURL's Go test: the tile dialog must
// refuse exactly what a save would.
describe('isValidUrl agrees with the server (tile_url_cases.json)', () => {
	for (const c of fixture.cases) {
		it(`${JSON.stringify(c.url)} → ${c.valid}`, () => {
			expect(isValidUrl(c.url)).toBe(c.valid);
		});
	}
});
