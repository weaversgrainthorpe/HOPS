import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import MigrationFailed from './MigrationFailed.svelte';
import { migrationFailure, migrationFailureKind } from '$lib/stores/config';

// The page's advice must fit why the migration failed: never claim a backup that wasn't taken.
describe('MigrationFailed advice', () => {
  afterEach(() => {
    cleanup();
    migrationFailure.set(null);
    migrationFailureKind.set('');
  });

  it('a failed conversion: back to 2.2.1 with the pre-v3 backup', () => {
    migrationFailure.set('conversion failed: bad tile');
    migrationFailureKind.set('convert');
    render(MigrationFailed, { signedIn: true });
    expect(screen.getByText(/go back to HOPS 2\.2\.1/)).toBeTruthy();
    expect(screen.getByText(/pre-v3-migration\.db/)).toBeTruthy();
  });

  it('a failed pre-v3 backup: says no copy was saved and nothing was converted', () => {
    migrationFailure.set('pre-migration backup failed: disk full');
    migrationFailureKind.set('backup');
    render(MigrationFailed, { signedIn: true });
    expect(screen.getByText(/could not save a copy of your HOPS 2 data first/)).toBeTruthy();
    expect(screen.queryByText(/pre-v3-migration\.db/)).toBeNull();
    expect(screen.queryByText(/HOPS saved a/)).toBeNull();
  });

  it('pre-release v3 data: no 2.2.1 or backup advice', () => {
    migrationFailure.set('stored config is not in this build\'s layout form');
    migrationFailureKind.set('layout');
    render(MigrationFailed, { signedIn: true });
    expect(screen.getByText(/pre-release build of HOPS 3/)).toBeTruthy();
    expect(screen.queryByText(/go back to HOPS 2\.2\.1/)).toBeNull();
  });

  it('an unreadable stored config: restore a recent backup; no 2.2.1 or pre-v3 advice', () => {
    migrationFailure.set('stored config is not valid JSON: invalid character');
    migrationFailureKind.set('corrupt');
    render(MigrationFailed, { signedIn: true });
    expect(screen.getByText(/The stored configuration can't be read\. Restore a recent backup \(Settings › Backups\)/)).toBeTruthy();
    expect(screen.queryByText(/2\.2\.1/)).toBeNull();
    expect(screen.queryByText(/pre-v3-migration\.db/)).toBeNull();
  });
});
