import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	textSize,
	increaseTextSize,
	decreaseTextSize,
	canIncrease,
	canDecrease,
	textSizeConfigs,
	type TextSize
} from './textSize';

describe('textSize store', () => {
	beforeEach(() => {
		textSize.set('medium');
	});

	it('exposes config for all four sizes', () => {
		expect(textSizeConfigs.small).toBeDefined();
		expect(textSizeConfigs.medium).toBeDefined();
		expect(textSizeConfigs.large).toBeDefined();
		expect(textSizeConfigs.xlarge).toBeDefined();
	});

	it('config defines a label, fontSize, and scale', () => {
		const cfg = textSizeConfigs.medium;
		expect(cfg.label).toBe('Medium');
		expect(cfg.fontSize).toBe('16px');
		expect(cfg.scale).toBe(1);
	});

	it('starts at medium', () => {
		expect(get(textSize)).toBe('medium');
	});

	describe('increaseTextSize', () => {
		it('moves up one step', () => {
			textSize.set('small');
			increaseTextSize();
			expect(get(textSize)).toBe('medium');

			increaseTextSize();
			expect(get(textSize)).toBe('large');

			increaseTextSize();
			expect(get(textSize)).toBe('xlarge');
		});

		it('does not exceed xlarge', () => {
			textSize.set('xlarge');
			increaseTextSize();
			expect(get(textSize)).toBe('xlarge');
		});
	});

	describe('decreaseTextSize', () => {
		it('moves down one step', () => {
			textSize.set('xlarge');
			decreaseTextSize();
			expect(get(textSize)).toBe('large');

			decreaseTextSize();
			expect(get(textSize)).toBe('medium');

			decreaseTextSize();
			expect(get(textSize)).toBe('small');
		});

		it('does not go below small', () => {
			textSize.set('small');
			decreaseTextSize();
			expect(get(textSize)).toBe('small');
		});
	});

	describe('canIncrease / canDecrease', () => {
		it('canIncrease is false at xlarge', () => {
			expect(canIncrease('xlarge')).toBe(false);
		});

		it('canIncrease is true everywhere else', () => {
			expect(canIncrease('small')).toBe(true);
			expect(canIncrease('medium')).toBe(true);
			expect(canIncrease('large')).toBe(true);
		});

		it('canDecrease is false at small', () => {
			expect(canDecrease('small')).toBe(false);
		});

		it('canDecrease is true everywhere else', () => {
			expect(canDecrease('medium')).toBe(true);
			expect(canDecrease('large')).toBe(true);
			expect(canDecrease('xlarge')).toBe(true);
		});
	});

	it('persists size to localStorage on change', () => {
		textSize.set('large');
		expect(localStorage.getItem('hops_text_size')).toBe('large');
	});

	it('updates --text-size-base CSS variable on document root', () => {
		textSize.set('xlarge');
		expect(document.documentElement.style.getPropertyValue('--text-size-base')).toBe('20px');
	});
});
