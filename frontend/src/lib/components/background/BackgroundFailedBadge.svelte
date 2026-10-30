<script lang="ts">
  // Edit-mode indicator for a level whose background image(s) failed to load
  //. It lists only URLs the level still references,
  // and is never drawn over the level's content: `inline` sits in a header
  // bar; `corner` is a small tab just OUTSIDE the box's top-left edge (the
  // parent must be positioned).
  import type { Background } from '$lib/types';
  import { failedBackgroundUrls, failedFor } from '$lib/stores/backgroundErrors';

  interface Props {
    background?: Background;
    /** Edit mode only; nothing is drawn otherwise. */
    editing: boolean;
    level: 'dashboard' | 'tab' | 'folder';
    placement: 'inline' | 'corner';
    /** Optional suffix, e.g. "(dashboard)". */
    label?: string;
  }
  let { background, editing, level, placement, label }: Props = $props();

  const failed = $derived(editing ? failedFor(background, $failedBackgroundUrls) : []);
</script>

{#if failed.length > 0}
  <span class="bg-failed-badge placement-{placement}" data-bg-failed={level} role="status"
    >Background image couldn't be loaded{label ? ` ${label}` : ''}</span
  >
{/if}

<style>
  .bg-failed-badge {
    padding: 0.1rem 0.45rem;
    border-radius: 0.25rem;
    font-size: 0.72rem;
    line-height: 1.35;
    font-weight: 500;
    background: var(--danger-solid);
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 0 1 auto;
  }
  /* A tab hanging just outside the box's top-left edge: never on the content. */
  .placement-corner {
    position: absolute;
    left: 0.5rem;
    bottom: 100%;
    z-index: 3;
    max-width: calc(100% - 1rem);
    border-radius: 0.25rem 0.25rem 0 0;
    pointer-events: none;
  }
</style>
