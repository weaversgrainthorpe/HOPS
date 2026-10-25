/**
 * Settings › Logs: reading GET /api/logs and saying, in words, what the lines are and what is
 * missing from them (lines from before this start, lines dropped when the buffer filled, levels
 * the configured log level never records, lines the filter or the line count hides).
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LineLimit = 100 | 500 | 1000 | 'all';

export const LEVEL_OPTIONS: ReadonlyArray<{ value: LogLevel; label: string }> = [
	{ value: 'debug', label: 'Debug (all)' },
	{ value: 'info', label: 'Info and above' },
	{ value: 'warn', label: 'Warn and above' },
	{ value: 'error', label: 'Error only' }
];
export const LIMIT_OPTIONS: ReadonlyArray<{ value: LineLimit; label: string }> = [
	{ value: 100, label: 'Last 100' },
	{ value: 500, label: 'Last 500' },
	{ value: 1000, label: 'Last 1000' },
	{ value: 'all', label: 'All buffered' }
];

/** Low to high. */
const ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LogAttr {
	key: string;
	value: string;
}
export interface LogRecord {
	time: string;
	level: LogLevel;
	message: string;
	attrs: LogAttr[];
}
export interface LogsResponse {
	startedAt: string;
	fetchedAt: string;
	capacity: number;
	dropped: number;
	buffered: number;
	matching: number;
	level: LogLevel;
	records: LogRecord[];
}

const UNREADABLE = 'The server sent log lines this version of HOPS cannot read.';
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLevel = (v: unknown): v is LogLevel => isStr(v) && (ORDER as string[]).includes(v);

/** Checks the answer's shape; anything unreadable throws (shown as an error, never as no lines). */
export function parseLogsResponse(raw: unknown): LogsResponse {
	const r = raw as Record<string, unknown> | null;
	if (!r || typeof r !== 'object' || !Array.isArray(r.records)) throw new Error(UNREADABLE);
	if (!isStr(r.startedAt) || !isStr(r.fetchedAt) || !isLevel(r.level)) throw new Error(UNREADABLE);
	if (!isNum(r.capacity) || !isNum(r.dropped) || !isNum(r.buffered) || !isNum(r.matching)) throw new Error(UNREADABLE);
	const records = r.records.map((x) => {
		const rec = x as Record<string, unknown> | null;
		if (!rec || !isStr(rec.time) || !isLevel(rec.level) || !isStr(rec.message)) throw new Error(UNREADABLE);
		const attrs = Array.isArray(rec.attrs)
			? rec.attrs.map((a) => {
					const at = a as Record<string, unknown> | null;
					if (!at || !isStr(at.key) || !isStr(at.value)) throw new Error(UNREADABLE);
					return { key: at.key, value: at.value };
				})
			: [];
		return { time: rec.time, level: rec.level, message: rec.message, attrs };
	});
	return {
		startedAt: r.startedAt,
		fetchedAt: r.fetchedAt,
		capacity: r.capacity,
		dropped: r.dropped,
		buffered: r.buffered,
		matching: r.matching,
		level: r.level,
		records
	};
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local date and time, to the millisecond: 2026-10-25 14:03:05.123. */
export function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Local date and time to the second, for sentences. */
export function formatWhen(iso: string): string {
	return formatTime(iso).replace(/\.\d{3}$/, '');
}

/** A value as in the server's text log: quoted when empty or holding spaces, quotes, = or control characters. */
export function formatValue(v: string): string {
	if (v !== '' && !/[\s"=\\]/.test(v)) return v;
	return JSON.stringify(v);
}

export function formatAttrs(attrs: LogAttr[]): string {
	return attrs.map((a) => `${a.key}=${formatValue(a.value)}`).join(' ');
}

export function formatLine(r: LogRecord): string {
	const attrs = formatAttrs(r.attrs);
	return `${formatTime(r.time)} ${r.level.toUpperCase().padEnd(5)} ${r.message}${attrs ? ` ${attrs}` : ''}`;
}

const cap = (l: LogLevel) => l.charAt(0).toUpperCase() + l.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function sinceLine(r: LogsResponse): string {
	return `Showing lines since HOPS started at ${formatWhen(r.startedAt)}.`;
}

export interface LogNotice {
	text: string;
	link?: { href: string; label: string };
}

export const LEVEL_SETTING_LINK = { href: '/settings/global#server', label: 'Global settings › Server' };

/** What is missing from the lines shown, one sentence each. */
export function logNotices(r: LogsResponse, filter: LogLevel): LogNotice[] {
	const out: LogNotice[] = [];
	if (r.dropped > 0) {
		out.push({ text: `${plural(r.dropped, 'older line was', 'older lines were')} dropped to stay within the last ${r.capacity}.` });
	}
	const below = ORDER.slice(0, ORDER.indexOf(r.level)).reverse();
	if (below.length) {
		out.push({
			text: `Log level is ${cap(r.level)}, so ${below.join('/')} lines aren't recorded — change it in`,
			link: LEVEL_SETTING_LINK
		});
	}
	const hiddenByFilter = r.buffered - r.matching;
	if (filter !== 'debug' && hiddenByFilter > 0) {
		const which = filter === 'error' ? 'Error only' : `${cap(filter)} and above`;
		out.push({ text: `The level filter (${which}) hides ${plural(hiddenByFilter, 'lower-level line', 'lower-level lines')}.` });
	}
	if (r.matching > r.records.length && r.records.length > 0) {
		out.push({ text: `Showing the newest ${r.records.length} of ${r.matching} matching lines.` });
	}
	return out;
}

/** Why nothing is listed (null when lines are listed). */
export function emptyMessage(r: LogsResponse, filter: LogLevel): string | null {
	if (r.records.length > 0) return null;
	if (r.buffered === 0) return `No log lines recorded yet since ${formatWhen(r.startedAt)}.`;
	const which = filter === 'error' ? 'Error' : `${cap(filter)} or higher`;
	return `No ${which} lines since ${formatWhen(r.startedAt)} — the level filter hides ${plural(r.buffered, 'line', 'lines')}.`;
}

/** The text for Copy and Download: a header saying what the lines are, then one line per record. */
export function logText(r: LogsResponse, filter: LogLevel): string {
	const notices = logNotices(r, filter).map((n) => `# ${n.text}${n.link ? ` ${n.link.label}` : ''}${n.link ? '.' : ''}`);
	const head = [`# HOPS log — ${sinceLine(r)} Fetched at ${formatWhen(r.fetchedAt)}.`, ...notices];
	const empty = emptyMessage(r, filter);
	const body = empty ? [`# ${empty}`] : r.records.map(formatLine);
	return [...head, ...body].join('\n') + '\n';
}

export function downloadFilename(now: Date = new Date()): string {
	return `hops-log-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;
}
