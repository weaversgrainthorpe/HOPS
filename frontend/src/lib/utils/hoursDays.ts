// A setting stored in hours but set in hours or days (status.dead_after_hours,
// auth.session_idle_hours, where 0 is "Off"), and the
// "for 9 days" wording of the dead-link report.

export type HourUnit = 'hours' | 'days' | 'off';

/** Stored hours → what the input shows: whole days as days, anything else as hours. */
/** With allowOff, 0 is shown as the "Off" choice. */
export function splitHours(hours: string | number, allowOff = false): { amount: number; unit: HourUnit } {
  const h = Number(hours);
  if (allowOff && h === 0) return { amount: 0, unit: 'off' };
  if (Number.isFinite(h) && h > 0 && h % 24 === 0) return { amount: h / 24, unit: 'days' };
  return { amount: h, unit: 'hours' };
}

export function toHours(amount: number, unit: HourUnit): number {
  if (unit === 'off') return 0;
  return unit === 'days' ? amount * 24 : amount;
}

export type HoursParse = { ok: true; hours: number } | { ok: false; error: string };

/** What the admin typed, in the chosen unit → whole hours, refusing empty or out-of-range values. */
export function parseHoursDays(text: string | number | null | undefined, unit: HourUnit, bounds: { min?: number; max?: number }): HoursParse {
  if (unit === 'off') return { ok: true, hours: 0 };
  const raw = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: 'Enter a number' };
  const hours = toHours(Number(raw), unit);
  if (!Number.isInteger(hours)) return { ok: false, error: 'Must be a whole number of hours' };
  const min = bounds.min ?? 1;
  if (hours < min) return { ok: false, error: `Must be at least ${formatHours(min)}` };
  if (bounds.max && hours > bounds.max) return { ok: false, error: `Can be at most ${formatHours(bounds.max)}` };
  return { ok: true, hours };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 168 → "7 days", 30 → "30 hours", 0 → "Off". */
export function formatHours(hours: number): string {
  if (hours === 0) return 'Off';
  return hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour');
}

/** How long since `since` (ISO time), in whole days, else whole hours. */
export function failingFor(since: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(since).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (!Number.isFinite(hours)) return 'an unknown time';
  if (hours < 1) return 'less than an hour';
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}
