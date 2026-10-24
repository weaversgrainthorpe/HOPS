<script lang="ts">
  /**
   * The one dashboard dialog (walkthrough §4C): Header, Background and Settings, with one Save and
   * one Cancel. Save runs the settings save first (server; only when a setting changed): if it
   * fails, the dialog stays open with the error and the draft is not touched. Then the header and
   * background go to the draft as ONE undo step. Cancel (or Escape) discards everything.
   */
  import Icon from '@iconify/svelte';
  import { tick } from 'svelte';
  import type { Background, HeaderConfig } from '$lib/types';
  import Modal from '../shared/Modal.svelte';
  import HeaderSection from '../admin/HeaderSection.svelte';
  import BackgroundSection from '../admin/BackgroundSection.svelte';
  import DashboardSettingsSection from '../admin/DashboardSettingsSection.svelte';
  import { setLook } from '$lib/editor/editorActions';
  import { reducedMotion } from '$lib/stores/backgroundAnimation';

  interface Props {
    dashboardId: string;
    /** The draft's header and background, as the dialog opens. */
    header?: HeaderConfig;
    background?: Background;
    onClose: () => void;
    /** The section shown on open (default Header). */
    initialSection?: SectionId;
    /** A setting (DashboardSettingsSection key) to bring into view and mark once the settings load. */
    focusSetting?: string;
    /** Opened from a background picker (M6 §8.2): shown above it, below confirm dialogs. */
    raised?: boolean;
  }

  let { dashboardId, header, background, onClose, initialSection = 'header', focusSetting, raised = false }: Props = $props();

  type SectionId = 'header' | 'background' | 'settings';
  const SECTIONS: { id: SectionId; label: string }[] = [
    { id: 'header', label: 'Header' },
    { id: 'background', label: 'Background' },
    { id: 'settings', label: 'Settings' }
  ];
  // svelte-ignore state_referenced_locally
  let active = $state<SectionId>(initialSection);
  // The background picker (and its gallery request) is made on first view, then kept.
  let backgroundShown = $state(false);
  $effect(() => {
    if (active === 'background') backgroundShown = true;
  });

  // The asked-for setting (opened from a folder picker's note): shown and marked once it loads.
  let settingsPanel = $state<HTMLElement>();
  $effect(() => {
    const panel = settingsPanel;
    if (!panel || !focusSetting) return;
    const reveal = () => {
      const row = panel.querySelector(`[id="lbl-${focusSetting}"]`)?.closest('.row');
      if (!row) return false;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('asked-for');
      return true;
    };
    if (reveal()) return;
    const mo = new MutationObserver(() => {
      if (reveal()) mo.disconnect();
    });
    mo.observe(panel, { childList: true, subtree: true });
    return () => mo.disconnect();
  });

  let headerSection = $state<HeaderSection>();
  let backgroundSection = $state<BackgroundSection>();
  let settingsSection = $state<DashboardSettingsSection>();
  let settingsInvalid = $state(false);
  let settingsLoadFailed = $state(false);
  let saving = $state(false);
  /** A refused Save (a background that can't be stored, or the draft refusing the change). */
  let problem = $state('');

  async function show(id: SectionId) {
    active = id;
    await tick();
  }

  async function handleSave() {
    if (saving || !headerSection || !settingsSection) return;
    problem = '';
    // Everything is checked before anything is written.
    const bg = backgroundSection ? backgroundSection.build() : ({ ok: true, value: background } as const);
    if (!bg.ok) {
      problem = bg.problem;
      await show('background');
      return;
    }
    const nextHeader = headerSection.value();
    saving = true;
    let settingsSaved: boolean;
    try {
      settingsSaved = await settingsSection.save();
    } finally {
      saving = false;
    }
    if (!settingsSaved) {
      // The section shows why; bring it into view. The draft is not touched.
      await show('settings');
      return;
    }
    if (!setLook(nextHeader, bg.value)) {
      // apply() has already said why (a toast); say it here too, where the user is looking.
      problem = "The header and background couldn't be applied to the draft (see the message). Settings changes, if any, are saved.";
      return;
    }
    onClose();
  }

  /**
   * Keyboard save, as in the other edit dialogs: Enter in a header text field (the old Header
   * dialog was a form), Ctrl+Enter anywhere (as the background picker).
   */
  function onBodyKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.altKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    const headerText = t instanceof HTMLInputElement && t.type === 'text' && !!t.closest('#dash-edit-panel-header');
    if (!e.ctrlKey && !e.metaKey && !headerText) return;
    e.preventDefault();
    void handleSave();
  }

  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = SECTIONS[(i + (e.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length];
    void show(next.id).then(() => document.getElementById(`dash-edit-tab-${next.id}`)?.focus());
  }
</script>

<!-- While settings are saving it can't be closed (Cancel, X, backdrop, Escape): a Cancel that
     didn't discard would be a lie, since the save then goes on to apply the draft. -->
<Modal
  id="dashboard-edit"
  title="Edit Dashboard"
  titleIcon="mdi:view-dashboard-edit-outline"
  {onClose}
  onBeforeClose={() => !saving}
  maxWidth="1000px"
  zIndex={raised ? 'calc(var(--z-modal-overlay) + 50)' : undefined}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" onkeydown={onBodyKey}>
  <div class="tabs" role="tablist" aria-label="Dashboard sections">
    {#each SECTIONS as s, i (s.id)}
      <button
        type="button"
        role="tab"
        id="dash-edit-tab-{s.id}"
        aria-selected={active === s.id}
        aria-controls="dash-edit-panel-{s.id}"
        aria-describedby={s.id === 'settings' && settingsLoadFailed ? 'dash-edit-settings-failed' : undefined}
        tabindex={active === s.id ? 0 : -1}
        class:active={active === s.id}
        onclick={() => show(s.id)}
        onkeydown={(e) => onTabKey(e, i)}
      >
        {s.label}
        {#if s.id === 'settings' && settingsLoadFailed}
          <Icon icon="mdi:alert-circle" width="16" class="tab-alert" />
        {/if}
      </button>
    {/each}
  </div>
  {#if settingsLoadFailed}
    <span id="dash-edit-settings-failed" class="visually-hidden">Couldn't load this dashboard's settings</span>
  {/if}

  <div role="tabpanel" id="dash-edit-panel-header" aria-labelledby="dash-edit-tab-header" hidden={active !== 'header'}>
    <HeaderSection bind:this={headerSection} {header} />
  </div>
  <div role="tabpanel" id="dash-edit-panel-background" aria-labelledby="dash-edit-tab-background" hidden={active !== 'background'}>
    {#if backgroundShown}
      <BackgroundSection
        bind:this={backgroundSection}
        {background}
        level="dashboard"
        runtime={{ reducedMotion: $reducedMotion }}
      />
    {/if}
  </div>
  <div role="tabpanel" id="dash-edit-panel-settings" aria-labelledby="dash-edit-tab-settings" hidden={active !== 'settings'} bind:this={settingsPanel}>
    <DashboardSettingsSection
      bind:this={settingsSection}
      bind:invalid={settingsInvalid}
      bind:loadFailed={settingsLoadFailed}
      {dashboardId}
    />
  </div>
  </div>

  {#snippet footer()}
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {/if}
    <button type="button" class="btn-secondary" onclick={() => !saving && onClose()} disabled={saving}>Cancel</button>
    <button type="button" class="btn-primary" onclick={handleSave} disabled={saving || settingsInvalid}>
      <Icon icon={saving ? 'mdi:loading' : 'mdi:content-save'} width="20" class={saving ? 'spin' : undefined} />
      {saving ? 'Saving…' : 'Save'}
    </button>
  {/snippet}
</Modal>

<style>
  /* The setting a folder picker's note pointed to. */
  [role='tabpanel'] :global(.row.asked-for) {
    outline: 2px solid var(--accent);
    outline-offset: 0.25rem;
    border-radius: 0.375rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border);
    margin: -0.5rem 0 1.25rem;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 0.6rem 1rem;
    color: var(--text-secondary);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--text-primary);
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tabs :global(.tab-alert) {
    color: var(--color-error, #dc2626);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .problem {
    margin: 0 auto 0 0;
    color: var(--color-error, #dc2626);
    font-size: 0.85rem;
  }
  .btn-primary,
  .btn-secondary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
  }
</style>
