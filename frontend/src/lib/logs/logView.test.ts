import { describe, it, expect } from 'vitest';
import {
	parseLogsResponse,
	formatLine,
	formatValue,
	logNotices,
	emptyMessage,
	sinceLine,
	logText,
	downloadFilename,
	type LogsResponse
} from './logView';

const START = '2026-10-25T09:00:00Z';
function resp(over: Partial<LogsResponse> = {}): LogsResponse {
	return {
		startedAt: START,
		fetchedAt: '2026-10-25T10:00:00Z',
		capacity: 2000,
		dropped: 0,
		buffered: 2,
		matching: 2,
		level: 'debug',
		records: [
			{ time: '2026-10-25T09:00:01Z', level: 'info', message: 'HOPS started', attrs: [{ key: 'port', value: '8080' }] },
			{ time: '2026-10-25T09:00:02Z', level: 'error', message: 'boom', attrs: [{ key: 'error', value: 'disk full now' }] }
		],
		...over
	};
}

describe('parseLogsResponse', () => {
	it('accepts a well-formed answer', () => {
		const r = parseLogsResponse(JSON.parse(JSON.stringify(resp())));
		expect(r.records).toHaveLength(2);
		expect(r.capacity).toBe(2000);
	});
	it.each([
		['null', null],
		['no records', { ...resp(), records: undefined }],
		['records not an array', { ...resp(), records: {} }],
		['no startedAt', { ...resp(), startedAt: undefined }],
		['bad dropped', { ...resp(), dropped: 'x' }],
		['bad record', { ...resp(), records: [{ level: 'info' }] }]
	])('refuses %s (never shown as an empty log)', (_n, raw) => {
		expect(() => parseLogsResponse(raw)).toThrow(/cannot read/);
	});
	it('a record without attrs gets an empty list', () => {
		const r = parseLogsResponse({ ...resp(), records: [{ time: START, level: 'warn', message: 'x' }] });
		expect(r.records[0].attrs).toEqual([]);
	});
});

describe('formatLine / formatValue', () => {
	it('time, padded level, message, then key=value with quoting where needed', () => {
		const line = formatLine(resp().records[1]);
		expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} ERROR boom error="disk full now"$/);
		expect(formatLine(resp().records[0])).toMatch(/ INFO  HOPS started port=8080$/);
	});
	it('quotes empty values, spaces, quotes and equals signs', () => {
		expect(formatValue('')).toBe('""');
		expect(formatValue('a b')).toBe('"a b"');
		expect(formatValue('say "hi"')).toBe('"say \\"hi\\""');
		expect(formatValue('a=b')).toBe('"a=b"');
		expect(formatValue('plain')).toBe('plain');
		expect(formatValue('line1\nline2')).toBe('"line1\\nline2"');
	});
});

describe('honesty notices', () => {
	it('always says when the lines start', () => {
		expect(sinceLine(resp())).toMatch(/^Showing lines since HOPS started at .+\.$/);
	});
	it('nothing extra when nothing is missing', () => {
		expect(logNotices(resp(), 'debug')).toEqual([]);
	});
	it('dropped lines', () => {
		const n = logNotices(resp({ dropped: 37 }), 'debug');
		expect(n.map((x) => x.text)).toContain('37 older lines were dropped to stay within the last 2000.');
		expect(logNotices(resp({ dropped: 1 }), 'debug')[0].text).toBe('1 older line was dropped to stay within the last 2000.');
	});
	it('the configured log level, with a link to change it', () => {
		const warn = logNotices(resp({ level: 'warn' }), 'debug');
		expect(warn).toHaveLength(1);
		expect(warn[0].text).toBe("Log level is Warn, so info/debug lines aren't recorded — change it in");
		expect(warn[0].link).toEqual({ href: '/settings/global#server', label: 'Global settings › Server' });
		expect(logNotices(resp({ level: 'info' }), 'debug')[0].text).toMatch(/^Log level is Info, so debug lines aren't recorded/);
		expect(logNotices(resp({ level: 'error' }), 'debug')[0].text).toMatch(/^Log level is Error, so warn\/info\/debug lines/);
	});
	it('the level filter hides lines', () => {
		const n = logNotices(resp({ buffered: 10, matching: 4 }), 'warn');
		expect(n.map((x) => x.text)).toContain('The level filter (Warn and above) hides 6 lower-level lines.');
	});
	it('the line limit hides older matching lines', () => {
		const n = logNotices(resp({ buffered: 900, matching: 900, records: resp().records }), 'debug');
		expect(n.map((x) => x.text)).toContain('Showing the newest 2 of 900 matching lines.');
	});
});

describe('empty states', () => {
	it('an empty buffer says nothing has been recorded since the start', () => {
		expect(emptyMessage(resp({ buffered: 0, matching: 0, records: [] }), 'debug')).toMatch(/^No log lines recorded yet since .+\.$/);
	});
	it('a filter that matches nothing says so', () => {
		expect(emptyMessage(resp({ buffered: 5, matching: 0, records: [] }), 'error')).toMatch(/^No Error lines since .+ — the level filter hides 5 lines\.$/);
	});
	it('not empty: no message', () => {
		expect(emptyMessage(resp(), 'debug')).toBeNull();
	});
});

describe('logText (Copy / Download)', () => {
	it('starts with a header saying what the lines are and what is missing', () => {
		const t = logText(resp({ dropped: 3, level: 'warn' }), 'debug');
		const lines = t.split('\n');
		expect(lines[0]).toMatch(/^# HOPS log — Showing lines since HOPS started at /);
		expect(t).toContain('# 3 older lines were dropped to stay within the last 2000.');
		expect(t).toContain("# Log level is Warn, so info/debug lines aren't recorded");
		expect(lines.filter((l) => !l.startsWith('#') && l)).toHaveLength(2);
		expect(t.endsWith('\n')).toBe(true);
	});
	it('the filename is dated', () => {
		expect(downloadFilename(new Date(2026, 9, 25, 14, 3, 5))).toBe('hops-log-20261025-140305.txt');
	});
});
