import { describe, it, expect } from 'vitest';
import { splitHours, toHours, parseHoursDays, formatHours, failingFor } from './hoursDays';

describe('hours/days conversion', () => {
  it('shows whole days as days, anything else as hours', () => {
    expect(splitHours(168)).toEqual({ amount: 7, unit: 'days' });
    expect(splitHours('24')).toEqual({ amount: 1, unit: 'days' });
    expect(splitHours(36)).toEqual({ amount: 36, unit: 'hours' });
    expect(splitHours(1)).toEqual({ amount: 1, unit: 'hours' });
  });

  it('converts back to hours', () => {
    expect(toHours(7, 'days')).toBe(168);
    expect(toHours(5, 'hours')).toBe(5);
  });

  it('parses what was typed, refusing empty, fractions of an hour and out-of-range values', () => {
    expect(parseHoursDays('7', 'days', { min: 1, max: 8760 })).toEqual({ ok: true, hours: 168 });
    expect(parseHoursDays('1.5', 'days', { min: 1, max: 8760 })).toEqual({ ok: true, hours: 36 });
    expect(parseHoursDays('', 'hours', { min: 1, max: 8760 }).ok).toBe(false);
    expect(parseHoursDays('0', 'hours', { min: 1, max: 8760 })).toEqual({ ok: false, error: 'Must be at least 1 hour' });
    expect(parseHoursDays('1.5', 'hours', { min: 1, max: 8760 }).ok).toBe(false);
    expect(parseHoursDays('366', 'days', { min: 1, max: 8760 })).toEqual({ ok: false, error: 'Can be at most 365 days' });
  });

  it('words a number of hours', () => {
    expect(formatHours(168)).toBe('7 days');
    expect(formatHours(24)).toBe('1 day');
    expect(formatHours(1)).toBe('1 hour');
    expect(formatHours(30)).toBe('30 hours');
  });

  it('words how long a tile has been failing', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(failingFor('2026-10-17T12:00:00Z', now)).toBe('9 days');
    expect(failingFor('2026-10-26T07:00:00Z', now)).toBe('5 hours');
    expect(failingFor('2026-10-26T11:30:00Z', now)).toBe('less than an hour');
    expect(failingFor('2026-10-25T12:00:00Z', now)).toBe('1 day');
  });
});
