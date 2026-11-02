<script lang="ts" module>
  export type ReorderMove = 'top' | 'up' | 'down' | 'bottom';
</script>

<script lang="ts">
  // The one reorder control: to the top, up, down, to the bottom. Used by Settings › Dashboards and
  // Settings › Tab order, so both look and read the same. The parent does the move and any focus
  // handling; this only draws the four buttons (each has a data-ctl so a parent can refocus one)
  // and disables the moves that don't apply at either end of the list.
  import Icon from '@iconify/svelte';

  let {
    name,
    first,
    last,
    busy = false,
    onMove
  }: {
    /** What is being moved, for the buttons' accessible names. */
    name: string;
    first: boolean;
    last: boolean;
    busy?: boolean;
    onMove: (move: ReorderMove) => void;
  } = $props();
</script>

<span class="reorder">
  <button type="button" class="btn-secondary" data-ctl="top" aria-label="Move {name} to the top" title="To the top" disabled={first || busy} onclick={() => onMove('top')}>
    <Icon icon="mdi:arrow-collapse-up" width="20" />
  </button>
  <button type="button" class="btn-secondary" data-ctl="up" aria-label="Move {name} up" title="Up" disabled={first || busy} onclick={() => onMove('up')}>
    <Icon icon="mdi:arrow-up" width="20" />
  </button>
  <button type="button" class="btn-secondary" data-ctl="down" aria-label="Move {name} down" title="Down" disabled={last || busy} onclick={() => onMove('down')}>
    <Icon icon="mdi:arrow-down" width="20" />
  </button>
  <button type="button" class="btn-secondary" data-ctl="bottom" aria-label="Move {name} to the bottom" title="To the bottom" disabled={last || busy} onclick={() => onMove('bottom')}>
    <Icon icon="mdi:arrow-collapse-down" width="20" />
  </button>
</span>

<style>
  .reorder {
    display: inline-flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  /* 44 px touch targets, whatever the page's own button padding. */
  .reorder button {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
</style>
