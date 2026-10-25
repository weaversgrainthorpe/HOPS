<script lang="ts">
  import Button from '$lib/components/shared/Button.svelte';
  import { isBackendOffline } from '$lib/stores/backendStatus';
  import { useSettingsShell } from '../settingsShell';

  // Settings → Backups (M5 §9). The dialog itself is the shell's (see settingsShell.ts).
  const shell = useSettingsShell();
</script>

<h2 class="section-title">Backups</h2>
<p class="lede">HOPS backs up the database when it starts, before every save, before a restore or reset, and before an upgrade. Create, restore or delete backups here.</p>
<Button variant="secondary" icon="mdi:backup-restore" onclick={() => shell.openBackups()} disabled={$isBackendOffline}>
  Open Backups
</Button>
