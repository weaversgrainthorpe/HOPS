import { get } from 'svelte/store';
import { authUnknown, initAuth } from './auth';
import { configError, configLoading, migrationFailure, reloadForPage, showingKept } from './config';
import { pageUnsaved, session } from './editSession';

/**
 * The server answered a probe: pick up what a failed read left behind, without a reload by the
 * user. Runs after every answered probe, so a read that failed while the probe succeeded (a blip,
 * or the seconds before a probe notices an outage) is covered too.
 *
 * Open edits stay as they are: with a session or unsaved page changes nothing is re-read, and the
 * saved-copy banner stays up, until the next probe after they are done.
 */
export function recoverFromOutage(): void {
  if (get(authUnknown)) void initAuth();
  if (get(session) !== null || get(pageUnsaved) || get(migrationFailure) !== null) return;
  if (get(configLoading)) return; // the first load is still running
  if (get(showingKept) || get(configError) !== null) void reloadForPage();
}
