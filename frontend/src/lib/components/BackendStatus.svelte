<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { backendStatus } from '$lib/stores/backendStatus';

  // A small status dot for the page header: green online, red offline (can't reach it),
  // amber degraded (reached, but it answered with an error), grey while checking. The version and
  // round-trip time live in a tooltip that hover, keyboard focus or a tap opens. Colour is never the
  // only signal (ruling 2): a glyph inside the dot (tick / ! / cross) and the button's accessible
  // name say the state. The fills are per-theme tokens, >= 3:1 on the navbar on every preset.
  onMount(() => {
    backendStatus.startPolling(30000);
  });

  onDestroy(() => {
    backendStatus.stopPolling();
  });

  const tipId = `backend-status-tip-${Math.random().toString(36).slice(2, 8)}`;
  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let open = $derived(hovered || focused || pinned);

  const label = $derived(
    $backendStatus.status === 'checking' ? 'Backend checking' :
    $backendStatus.status === 'online' ? 'Backend online' :
    $backendStatus.status === 'offline' ? 'Backend offline' :
    'Backend degraded'
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      hovered = focused = pinned = false;
    }
  }
  // A press elsewhere un-pins a tapped tooltip.
  function onWindowPointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (pinned && !t?.closest?.('.backend-dot-wrap')) pinned = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<span
  class="backend-dot-wrap"
  role="presentation"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
>
  <button
    type="button"
    class="backend-dot-btn"
    data-status={$backendStatus.status}
    aria-label={label}
    aria-describedby={open ? tipId : undefined}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    onclick={() => (pinned = !pinned)}
    onkeydown={onKey}
  >
    <span class="backend-dot" class:pulse={$backendStatus.status === 'checking'} aria-hidden="true">
      {#if $backendStatus.status === 'online'}
        <svg viewBox="0 0 10 10" data-glyph="online"><path d="M2.2 5.3 4.2 7.2 7.8 3" /></svg>
      {:else if $backendStatus.status === 'offline'}
        <svg viewBox="0 0 10 10" data-glyph="offline"><path d="M3 3 7 7M7 3 3 7" /></svg>
      {:else if $backendStatus.status === 'error'}
        <svg viewBox="0 0 10 10" data-glyph="degraded"><path d="M5 2.2V5.6" /><circle cx="5" cy="7.7" r="0.5" /></svg>
      {/if}
    </span>
  </button>

  {#if open}
    <div class="backend-tip" role="tooltip" id={tipId}>
      <strong>{label}</strong>
      {#if $backendStatus.status === 'online'}
        {#if $backendStatus.version}<span>v{$backendStatus.version}</span>{/if}
        {#if $backendStatus.responseTime !== null}<span>{$backendStatus.responseTime} ms</span>{/if}
      {:else if $backendStatus.status === 'offline'}
        <span>Backend unreachable</span>
        <button type="button" class="retry-btn" onclick={() => backendStatus.check()}>Retry</button>
      {:else if $backendStatus.status === 'error'}
        <span>Reached, but it answered with an error</span>
        <button type="button" class="retry-btn" onclick={() => backendStatus.check()}>Retry</button>
      {/if}
    </div>
  {/if}
</span>

<style>
  .backend-dot-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* 24px target around a 12px dot. */
  .backend-dot-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .backend-dot-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* 14px so the glyph inside reads; the fills are >= 3:1 on the navbar on every preset (theme.ts). */
  .backend-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--status-checking);
    color: var(--status-glyph);
  }

  [data-status='online'] .backend-dot { background: var(--status-online); }
  [data-status='offline'] .backend-dot { background: var(--status-offline); }
  [data-status='error'] .backend-dot { background: var(--status-degraded); }

  .backend-dot svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .backend-dot svg circle {
    fill: currentColor;
    stroke: none;
  }

  .pulse {
    animation: backend-pulse 1s ease-in-out infinite;
  }

  @keyframes backend-pulse {
    50% { opacity: 0.4; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
  }

  .backend-tip {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: max-content;
    padding: 0.4rem 0.6rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: 0.8rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .retry-btn {
    align-self: flex-start;
    padding: 0.15rem 0.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
  }
</style>
