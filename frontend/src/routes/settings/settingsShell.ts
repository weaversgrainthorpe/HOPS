import { getContext, setContext } from 'svelte';

/**
 * What the settings shell (+layout.svelte) offers its pages. The backups dialog belongs to the
 * shell, not the Backups page, because the MigrationFailed notice on top of EVERY settings page
 * opens it too (Backups is the remedy for a failed migration).
 */
export interface SettingsShell {
	openBackups(): void;
}

export const SETTINGS_SHELL = Symbol('hops-settings-shell');

export function provideSettingsShell(shell: SettingsShell): void {
	setContext(SETTINGS_SHELL, shell);
}

/** The shell's services. A settings page outside the shell is a wiring bug: say so, loudly. */
export function useSettingsShell(): SettingsShell {
	const shell = getContext<SettingsShell | undefined>(SETTINGS_SHELL);
	if (!shell) throw new Error('A settings page was rendered outside the settings layout');
	return shell;
}
