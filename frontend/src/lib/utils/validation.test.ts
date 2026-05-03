import { describe, it, expect } from 'vitest';
import { validatePassword, validateMatch } from './validation';

describe('validatePassword', () => {
	it('rejects empty password', () => {
		const result = validatePassword('');
		expect(result.valid).toBe(false);
		expect(result.message).toMatch(/required/i);
	});

	it('enforces default minimum length of 8', () => {
		expect(validatePassword('short').valid).toBe(false);
		expect(validatePassword('long-enough').valid).toBe(true);
	});

	it('respects custom minLength', () => {
		expect(validatePassword('abc', { minLength: 4 }).valid).toBe(false);
		expect(validatePassword('abcd', { minLength: 4 }).valid).toBe(true);
	});

	it('error message includes the minimum length', () => {
		const result = validatePassword('a', { minLength: 12 });
		expect(result.message).toContain('12');
	});

	it('enforces uppercase requirement when set', () => {
		expect(validatePassword('lowercase', { requireUppercase: true }).valid).toBe(false);
		expect(validatePassword('hasUpper', { requireUppercase: true }).valid).toBe(true);
	});

	it('enforces lowercase requirement when set', () => {
		expect(validatePassword('UPPERCASE', { requireLowercase: true }).valid).toBe(false);
		expect(validatePassword('hasLower', { requireLowercase: true }).valid).toBe(true);
	});

	it('enforces number requirement when set', () => {
		expect(validatePassword('noNumbers', { requireNumber: true }).valid).toBe(false);
		expect(validatePassword('has1number', { requireNumber: true }).valid).toBe(true);
	});

	it('enforces special character requirement when set', () => {
		expect(validatePassword('NoSpecial1', { requireSpecial: true }).valid).toBe(false);
		expect(validatePassword('Special!1', { requireSpecial: true }).valid).toBe(true);
	});

	it('reports the first failing rule', () => {
		// Too short AND missing uppercase — should report length first
		const result = validatePassword('a', { requireUppercase: true });
		expect(result.message).toMatch(/at least/i);
	});

	it('passes when all rules satisfied', () => {
		const result = validatePassword('Strong!Pass1', {
			minLength: 8,
			requireUppercase: true,
			requireLowercase: true,
			requireNumber: true,
			requireSpecial: true
		});
		expect(result.valid).toBe(true);
		expect(result.message).toBeUndefined();
	});
});

describe('validateMatch', () => {
	it('passes when values match', () => {
		expect(validateMatch('foo', 'foo').valid).toBe(true);
	});

	it('fails when values differ', () => {
		const result = validateMatch('foo', 'bar');
		expect(result.valid).toBe(false);
	});

	it('uses custom field name in message', () => {
		const result = validateMatch('foo', 'bar', 'passwords');
		expect(result.message).toContain('passwords');
	});

	it('treats empty strings as matching', () => {
		expect(validateMatch('', '').valid).toBe(true);
	});

	it('is case-sensitive', () => {
		expect(validateMatch('Foo', 'foo').valid).toBe(false);
	});
});
