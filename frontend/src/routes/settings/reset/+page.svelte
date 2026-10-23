<script lang="ts">
  import { get } from 'svelte/store';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';
  import { confirm } from '$lib/stores/confirmModal';
  import { isBackendOffline } from '$lib/stores/backendStatus';
  import { resetConfig } from '$lib/utils/api';
  import { loadConfig, configError } from '$lib/stores/config';

  // Settings → Factory reset (M5 §9): on its own page, never next to everyday settings.

  async function handleFactoryReset() {
    const confirmed = await confirm({
      title: 'Factory Reset',
      message: 'This will permanently delete all dashboards, tabs, folders and tiles, resetting everything to defaults. A backup will be created automatically. This action cannot be undone.',
      confirmText: 'Reset Everything',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      await resetConfig();
    } catch (e) {
      toast.error(`Factory reset failed: ${e instanceof Error && e.message ? e.message : 'the request failed'}. Nothing was changed.`);
      return;
    }
    // The reset itself is done; re-reading the dashboards is a separate step that can fail on
    // its own — say exactly that, never "reset failed" and never a success over stale data.
    await loadConfig();
    const reloadError = get(configError);
    if (reloadError) {
      toast.error(`The factory reset was done, but the dashboards couldn't be reloaded: ${reloadError}. Reload the page.`);
      return;
    }
    toast.success('Configuration reset to factory defaults');
  }
</script>

<h2 class="section-title">Factory reset</h2>
<p class="lede">Delete every dashboard and start again. A backup is made first.</p>
<Button variant="danger" icon="mdi:delete-forever" onclick={handleFactoryReset} disabled={$isBackendOffline}>
  Factory Reset
</Button>
