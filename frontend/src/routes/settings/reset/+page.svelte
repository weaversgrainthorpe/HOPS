<script lang="ts">
  import { get } from 'svelte/store';
  import { toast } from '$lib/stores/toast';
  import { confirm } from '$lib/stores/confirmModal';
  import { isBackendOffline } from '$lib/stores/backendStatus';
  import { resetConfig } from '$lib/utils/api';
  import { loadConfig, configError, refreshServerNotices } from '$lib/stores/config';

  // Settings → Factory reset: on its own page, never next to everyday settings.
  // The button is an emergency stop — a round red mushroom cap on a yellow housing, drawn
  // with CSS and inline SVG only. The look never makes a reset easier: pressing it only opens the
  // same confirmation as before.

  // Shown pressed in while a key holds it (the mouse uses :active).
  let pressing = $state(false);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') pressing = true;
  }
  const release = () => (pressing = false);

  async function handleFactoryReset() {
    const confirmed = await confirm({
      title: 'Factory Reset',
      message: 'This will permanently delete all dashboards, tabs, folders and tiles, resetting everything to defaults. A safety backup is taken first; if that fails, nothing is reset. This action cannot be undone.',
      confirmText: 'Reset Everything',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      await resetConfig();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : 'the request failed';
      // The server's sentence may already say nothing was changed ("…so nothing was reset: …").
      toast.error(/nothing was (reset|changed)/i.test(msg) ? msg : `Factory reset failed: ${msg}. Nothing was changed.`, 0);
      // A failed safety backup is also a Settings notice until a backup works.
      void refreshServerNotices();
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
<button
  type="button"
  class="estop"
  class:pressing
  onclick={handleFactoryReset}
  onkeydown={onKeyDown}
  onkeyup={release}
  onblur={release}
  disabled={$isBackendOffline}
>
  <span class="estop-housing" aria-hidden="true">
    <span class="estop-collar"></span>
    <span class="estop-cap">
      <svg class="estop-symbol" viewBox="0 0 24 24" focusable="false">
        <path d="M12 3v8" />
        <path d="M7.05 6.05a7.5 7.5 0 1 0 9.9 0" />
      </svg>
    </span>
  </span>
  <span class="estop-label">Factory reset</span>
</button>

<style>
  /* The emergency stop. Colours (WCAG AA, non-text ≥ 3:1):
       red cap #dc2626 on yellow housing #facc15 ≈ 3.2:1
       yellow housing on the dark page, and its #1f2937 rim on a light page, ≫ 3:1
       white symbol on the red cap ≈ 4.8:1 */
  .estop {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    border: none;
    border-radius: 1.25rem;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .estop:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 4px;
  }

  .estop-housing {
    position: relative;
    display: grid;
    place-items: center;
    width: 152px;
    height: 152px;
    border-radius: 1.5rem;
    border: 2px solid #1f2937;
    background-color: #facc15;
    background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, 0.12));
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35), inset 0 -4px 0 rgba(0, 0, 0, 0.15);
  }

  /* The dark ring the mushroom sits in. */
  .estop-collar {
    position: absolute;
    width: 122px;
    height: 122px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, #4b5563, #111827 70%);
    box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.6);
  }

  .estop-cap {
    position: relative;
    display: grid;
    place-items: center;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background-color: #dc2626;
    background-image: radial-gradient(circle at 36% 30%, #f87171 0, #dc2626 42%, #991b1b 100%);
    box-shadow: 0 8px 0 #7f1d1d, 0 12px 16px rgba(0, 0, 0, 0.45), inset 0 -3px 6px rgba(0, 0, 0, 0.25);
    transform: translateY(-5px);
    transition: transform 80ms ease-out, box-shadow 80ms ease-out;
  }

  .estop-symbol {
    width: 44px;
    height: 44px;
    fill: none;
    stroke: #ffffff;
    stroke-width: 2.6;
    stroke-linecap: round;
  }

  /* Pressed: the mushroom sinks into its collar (mouse :active, or a held key). */
  .estop:not(:disabled):active .estop-cap,
  .estop.pressing:not(:disabled) .estop-cap {
    transform: translateY(3px) scale(0.97);
    box-shadow: 0 1px 0 #7f1d1d, 0 2px 4px rgba(0, 0, 0, 0.4), inset 0 3px 8px rgba(0, 0, 0, 0.35);
  }

  .estop:not(:disabled):hover .estop-cap {
    filter: brightness(1.08);
  }

  .estop-label {
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.02em;
  }

  .estop:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (prefers-reduced-motion: reduce) {
    .estop-cap {
      transition: none;
    }
  }
</style>
