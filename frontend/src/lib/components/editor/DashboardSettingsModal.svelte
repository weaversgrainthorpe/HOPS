<script lang="ts">
  /**
   * The dashboard's Settings on their own (M6 §8.2), opened from the folder background dialog's
   * "Open Dashboard settings" link, above it. The same section as the dashboard dialog's Settings
   * tab, saved the same way (server, only what changed); the folder dialog underneath stays open
   * and follows the saved setting live.
   */
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import DashboardSettingsSection from '../admin/DashboardSettingsSection.svelte';

  interface Props {
    dashboardId: string;
    onClose: () => void;
    /** The setting this was opened for: brought into view once the settings have loaded. */
    focusKey?: string;
  }
  let { dashboardId, onClose, focusKey }: Props = $props();

  let bodyEl = $state<HTMLElement>();
  // The section loads its settings itself; show the asked-for row as soon as it is there.
  $effect(() => {
    if (!bodyEl || !focusKey) return;
    const id = `lbl-${focusKey}`;
    const reveal = () => {
      const row = bodyEl?.querySelector(`[id="${id}"]`)?.closest('.row');
      if (!row) return false;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('asked-for');
      return true;
    };
    if (reveal()) return;
    const mo = new MutationObserver(() => {
      if (reveal()) mo.disconnect();
    });
    mo.observe(bodyEl, { childList: true, subtree: true });
    return () => mo.disconnect();
  });

  let section = $state<DashboardSettingsSection>();
  let invalid = $state(false);
  let loadFailed = $state(false);
  let saving = $state(false);

  async function handleSave() {
    if (saving || !section) return;
    saving = true;
    let ok: boolean;
    try {
      ok = await section.save();
    } finally {
      saving = false;
    }
    // A failure is shown by the section itself; the dialog stays open.
    if (ok) onClose();
  }
</script>

<!-- Above the background picker (--z-modal-overlay) that opens it; below confirm dialogs. -->
<Modal
  id="dashboard-settings"
  title="Dashboard settings"
  titleIcon="mdi:cog-outline"
  {onClose}
  onBeforeClose={() => !saving}
  maxWidth="720px"
  zIndex="calc(var(--z-modal-overlay) + 50)"
>
  <div bind:this={bodyEl}>
    <DashboardSettingsSection bind:this={section} bind:invalid bind:loadFailed {dashboardId} />
  </div>

  {#snippet footer()}
    <button type="button" class="btn-secondary" onclick={() => !saving && onClose()} disabled={saving}>Cancel</button>
    <button type="button" class="btn-primary" onclick={handleSave} disabled={saving || invalid || loadFailed}>
      <Icon icon={saving ? 'mdi:loading' : 'mdi:content-save'} width="20" />
      {saving ? 'Saving…' : 'Save settings'}
    </button>
  {/snippet}
</Modal>

<style>
  /* The row the note pointed to. */
  div :global(.row.asked-for) {
    outline: 2px solid var(--accent);
    outline-offset: 0.25rem;
    border-radius: 0.375rem;
  }
</style>
