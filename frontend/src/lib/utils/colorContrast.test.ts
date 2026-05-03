import { describe, it, expect } from 'vitest';
import { getAutoTextColor, getTextColorValue } from './colorContrast';

describe('getAutoTextColor', () => {
	it('returns dark text for light backgrounds', () => {
		expect(getAutoTextColor('#ffffff')).toBe('dark');
		expect(getAutoTextColor('#fafafa')).toBe('dark');
		expect(getAutoTextColor('#f1f5f9')).toBe('dark');
	});

	it('returns light text for dark backgrounds', () => {
		expect(getAutoTextColor('#000000')).toBe('light');
		expect(getAutoTextColor('#0f172a')).toBe('light');
		expect(getAutoTextColor('#1e293b')).toBe('light');
	});

	it('handles colors without # prefix', () => {
		expect(getAutoTextColor('ffffff')).toBe('dark');
		expect(getAutoTextColor('000000')).toBe('light');
	});

	it('falls back to light when input is invalid', () => {
		expect(getAutoTextColor('not-a-color')).toBe('light');
		expect(getAutoTextColor('')).toBe('light');
	});

	it('picks light text for primary blue', () => {
		expect(getAutoTextColor('#3b82f6')).toBe('light');
	});

	it('picks light text for #f59e0b (vivid orange-yellow)', () => {
		// Documents a known weakness: with the simple 0.5 luminance threshold,
		// vivid mid-tones like the warning amber land just under 0.5 and get
		// white text — which can have poor contrast. Components that use this
		// color in a badge should set the text color explicitly.
		expect(getAutoTextColor('#f59e0b')).toBe('light');
	});
});

describe('getTextColorValue', () => {
	it('returns white for light mode', () => {
		expect(getTextColorValue('light')).toBe('#ffffff');
	});

	it('returns black for dark mode', () => {
		expect(getTextColorValue('dark')).toBe('#000000');
	});

	it('auto mode requires a background color', () => {
		// Without background, auto mode falls through to dark branch
		expect(getTextColorValue('auto')).toBe('#000000');
	});

	it('auto mode picks white for dark background', () => {
		expect(getTextColorValue('auto', '#000000')).toBe('#ffffff');
		expect(getTextColorValue('auto', '#0f172a')).toBe('#ffffff');
	});

	it('auto mode picks black for light background', () => {
		expect(getTextColorValue('auto', '#ffffff')).toBe('#000000');
		expect(getTextColorValue('auto', '#fafafa')).toBe('#000000');
	});
});
