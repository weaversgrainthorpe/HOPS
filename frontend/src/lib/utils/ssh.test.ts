import { describe, it, expect } from 'vitest';
import { buildSshUrl, parseSshUrl, validateSsh, isSshUrl } from './ssh';

describe('isSshUrl', () => {
	it('spots ssh:// in any case', () => {
		expect(isSshUrl('ssh://nas')).toBe(true);
		expect(isSshUrl('  SSH://nas')).toBe(true);
		expect(isSshUrl('https://nas')).toBe(false);
		expect(isSshUrl(undefined)).toBe(false);
	});
});

describe('buildSshUrl', () => {
	it('omits :22 and an empty user', () => {
		expect(buildSshUrl({ host: 'nas.lan', port: '22', user: '' })).toBe('ssh://nas.lan');
		expect(buildSshUrl({ host: 'nas.lan', port: '', user: '' })).toBe('ssh://nas.lan');
	});
	it('adds user and a non-default port', () => {
		expect(buildSshUrl({ host: '10.0.0.5', port: '2222', user: 'pi' })).toBe('ssh://pi@10.0.0.5:2222');
	});
	it('keeps IPv6 brackets', () => {
		expect(buildSshUrl({ host: '[fd00::1]', port: '22', user: 'root' })).toBe('ssh://root@[fd00::1]');
		expect(buildSshUrl({ host: '[fd00::1]', port: '2200', user: '' })).toBe('ssh://[fd00::1]:2200');
	});
	it('trims the fields', () => {
		expect(buildSshUrl({ host: ' nas ', port: ' 22 ', user: ' me ' })).toBe('ssh://me@nas');
	});
});

describe('parseSshUrl', () => {
	it('reads host, port and user back', () => {
		expect(parseSshUrl('ssh://pi@10.0.0.5:2222')).toEqual({ host: '10.0.0.5', port: '2222', user: 'pi' });
		expect(parseSshUrl('ssh://nas.lan')).toEqual({ host: 'nas.lan', port: '22', user: '' });
		expect(parseSshUrl('ssh://root@[fd00::1]:2200')).toEqual({ host: '[fd00::1]', port: '2200', user: 'root' });
	});
	it('round-trips with buildSshUrl', () => {
		for (const u of ['ssh://nas', 'ssh://a@b:23', 'ssh://[::1]', 'ssh://x_y@host-1.lan:65535']) {
			expect(buildSshUrl(parseSshUrl(u)!)).toBe(u);
		}
	});
	it('returns null for non-ssh URLs', () => {
		expect(parseSshUrl('https://nas')).toBeNull();
	});
});

describe('validateSsh', () => {
	const ok = { host: 'nas.lan', port: '22', user: '' };
	it('accepts hostnames, IPv4 and bracketed IPv6', () => {
		for (const host of ['nas', 'nas.lan', 'host-1.example.com', '192.168.1.10', '[fd00::1]', '[::1]']) {
			expect(validateSsh({ ...ok, host })).toEqual({});
		}
	});
	it('requires a host and rejects bad characters', () => {
		expect(validateSsh({ ...ok, host: '' }).host).toMatch(/required/i);
		for (const host of ['my host', 'a/b', 'a@b', 'a?b', 'a#b', 'fd00::1', '[nothex]', '-bad', 'a..b', '999.1.1.1']) {
			expect(validateSsh({ ...ok, host }).host, host).toBeTruthy();
		}
	});
	it('port is 1-65535 (blank means 22)', () => {
		expect(validateSsh({ ...ok, port: '' })).toEqual({});
		expect(validateSsh({ ...ok, port: '65535' })).toEqual({});
		for (const port of ['0', '65536', 'abc', '22.5', '-1']) {
			expect(validateSsh({ ...ok, port }).port, port).toBeTruthy();
		}
	});
	it('user is a safe charset', () => {
		expect(validateSsh({ ...ok, user: 'alice.w-1_x' })).toEqual({});
		for (const user of ['a b', 'a@b', 'a:b', 'a/b', 'a;b', '%20']) {
			expect(validateSsh({ ...ok, user }).user, user).toBeTruthy();
		}
	});
});
