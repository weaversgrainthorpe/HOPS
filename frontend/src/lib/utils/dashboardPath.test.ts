import { describe, it, expect } from 'vitest';
import { slugify, suggestDashboardPath } from './dashboardPath';

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Media Room')).toBe('media-room');
		expect(slugify('  Home -- Lab!! ')).toBe('home-lab');
	});
	it('folds accents and drops symbols', () => {
		expect(slugify('Café Été')).toBe('cafe-ete');
		expect(slugify('🎬')).toBe('');
	});
});

describe('suggestDashboardPath', () => {
	it('uses the name', () => {
		expect(suggestDashboardPath('Media Room', [])).toBe('/media-room');
	});
	it('adds -2, -3 when the path is taken (case-insensitively)', () => {
		expect(suggestDashboardPath('Home', ['/home'])).toBe('/home-2');
		expect(suggestDashboardPath('Home', ['/Home', '/home-2'])).toBe('/home-3');
	});
	it('never suggests a reserved path', () => {
		expect(suggestDashboardPath('Settings', [])).toBe('/settings-2');
		expect(suggestDashboardPath('API', [])).toBe('/api-2');
	});
	it('falls back to a timestamped path when the name has no letters or digits', () => {
		expect(suggestDashboardPath('🎬', [], 123)).toBe('/dashboard-123');
	});
});
