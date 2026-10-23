<script lang="ts">
  import Button from '$lib/components/shared/Button.svelte';
  import { isBackendOffline } from '$lib/stores/backendStatus';
  import { useSettingsShell } from '../settingsShell';

  // Settings → Backups (M5 §9). The dialog itself is the shell's (see settingsShell.ts).
  const shell = useSettingsShell();
</script>

<h2 class="section-title">Backups</h2>
<p class="lede">HOPS backs up the database on startup and before config changes. Restore or delete them here.</p>
<Button variant="secondary" icon="mdi:backup-restore" onclick={() => shell.openBackups()} disabled={$isBackendOffline}>
  Open Backups
</Button>
