<script lang="ts">
  /**
   * Where an item drag is: Tab › Folder › … (the tab the drag started on comes first when the
   * drag has moved to another tab). Holding the pointer over a crumb for OPEN_DWELL_MS returns to
   * that level — the controller hit-tests `data-drag-crumb` and runs crumbAction — so a drag can
   * always get back out of folders it opened and back to the tab it came from. Portalled above the
   * folder overlays; it must take pointer hits (elementFromPoint skips pointer-events: none).
   */
  import { drag, crumbAction } from './dragController';
  import { overlayStack } from '$lib/stores/folderOverlay';
  import { session } from '$lib/stores/editSession';
  import { portal } from '$lib/utils/overlayActions';
  import { findIn } from '../editorActions';

  interface Crumb {
    key: string;
    label: string;
    aria: string;
    current: boolean;
  }

  const s = $derived($drag);
  const crumbs = $derived.by((): Crumb[] => {
    if (!s || s.tab !== undefined || !s.tabId) return [];
    const d = $session?.draft;
    const tabName = (id: string) => d?.tabs.find((t) => t.id === id)?.name || 'Tab';
    const out: Crumb[] = [];
    if (s.origin && s.origin !== s.tabId) {
      const n = tabName(s.origin);
      out.push({ key: `tab:${s.origin}`, label: n, aria: `${n} tab, where the drag started — hold here to go back`, current: false });
    }
    const n = tabName(s.tabId);
    out.push({ key: `tab:${s.tabId}`, label: n, aria: `${n} tab — hold here to return to the tab`, current: false });
    $overlayStack.forEach((id, i) => {
      const name = (d && findIn(d, id)?.name) || 'Folder';
      out.push({ key: `folder:${i + 1}`, label: name, aria: `${name} folder — hold here to return to it`, current: false });
    });
    out[out.length - 1].current = true;
    return out;
  });
</script>

{#if crumbs.length > 0}
  <nav class="drag-crumbs" aria-label="Drag path" use:portal>
    {#each crumbs as c, i (c.key)}
      {#if i > 0}<span class="sep" aria-hidden="true">›</span>{/if}
      <button
        type="button"
        tabindex="-1"
        class="crumb"
        class:origin={i === 0 && s?.origin !== s?.tabId}
        class:holding={s?.dwell?.key === `crumb:${c.key}`}
        data-drag-crumb={c.key}
        aria-label={c.aria}
        aria-current={c.current ? 'location' : undefined}
        onclick={() => crumbAction(c.key)?.()}
      >
        {c.label}
      </button>
    {/each}
  </nav>
{/if}

<style>
  .drag-crumbs {
    position: fixed;
    left: 50%;
    bottom: 4rem;
    transform: translateX(-50%);
    z-index: calc(var(--z-toast) - 11);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    max-width: calc(100vw - 2rem);
    padding: 0.35rem 0.5rem;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    overflow-x: auto;
  }
  .crumb {
    background: none;
    border: 2px solid transparent;
    border-radius: 999px;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.875rem;
    padding: 0.35rem 0.75rem;
    white-space: nowrap;
    cursor: inherit;
  }
  .crumb.origin {
    border-color: var(--border);
  }
  .crumb[aria-current] {
    color: var(--text-primary);
    font-weight: 600;
  }
  .crumb.holding {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sep {
    color: var(--text-secondary);
  }
</style>
