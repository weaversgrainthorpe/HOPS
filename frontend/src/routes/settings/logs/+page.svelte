<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';
  import { getLogs } from '$lib/utils/api';
  import {
    LEVEL_OPTIONS,
    LIMIT_OPTIONS,
    downloadFilename,
    emptyMessage,
    formatAttrs,
    formatTime,
    formatWhen,
    logNotices,
    logText,
    sinceLine,
    type LineLimit,
    type LogLevel,
    type LogsResponse
  } from '$lib/logs/logView';

  // Settings › Logs: the most recent log lines this HOPS process has recorded (a small in-memory
  // buffer; the full log is in the system journal). Every gap is said in words: lines from before
  // this start, lines dropped when the buffer filled, levels the log level never records, lines
  // the filter or the line count hides. A failed fetch is an error, never an empty list; a failed
  // refresh keeps the earlier lines but says they may be out of date. Lines are text only.

  const AUTO_REFRESH_MS = 5000;

  let limit = $state<LineLimit>(500);
  let level = $state<LogLevel>('debug');
  let data = $state<LogsResponse | null>(null);
  // The controls the shown data was fetched with (the notices describe that, not a pending change).
  let dataLevel = $state<LogLevel>('debug');
  let dataLimit = $state<LineLimit>(500);
  // A load asked for while one is in flight (a Lines/Level change, Refresh, auto-refresh) runs
  // as soon as it ends, with the controls as they are then: never dropped.
  let queued = false;
  let error = $state<string | null>(null);
  let loading = $state(false);
  let autoRefresh = $state(false);
  let visible = $state(typeof document === 'undefined' ? true : !document.hidden);
  let box = $state<HTMLElement | null>(null);

  let notices = $derived(data ? logNotices(data, dataLevel) : []);
  let empty = $derived(data ? emptyMessage(data, dataLevel) : null);
  // The list shown was fetched for other Lines/Level than the controls show: say so until it matches.
  let behindControls = $derived(!!data && (dataLevel !== level || dataLimit !== limit));

  async function load() {
    if (loading) {
      queued = true;
      return;
    }
    loading = true;
    const wanted = { limit, level };
    // Keep following the newest line if the view was already at the bottom (or is new).
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    try {
      const resp = await getLogs(wanted);
      data = resp;
      dataLevel = wanted.level;
      dataLimit = wanted.limit;
      error = null;
      await tick();
      if (atBottom && box) box.scrollTop = box.scrollHeight;
    } catch (e) {
      error = e instanceof Error && e.message ? e.message : 'the request failed';
    } finally {
      loading = false;
      if (queued) {
        queued = false;
        void load();
      }
    }
  }

  onMount(() => {
    void load();
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible && autoRefresh) void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  // Auto-refresh: every 5 s while on and the page is visible; a hidden page stops polling.
  $effect(() => {
    if (!autoRefresh || !visible) return;
    const id = setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  });

  async function copy() {
    if (!data) return;
    const text = logText(data, dataLevel);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Plain http (no secure context): the old way.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('the browser refused');
      }
      toast.success(`Copied ${data.records.length} line${data.records.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Couldn't copy the log lines: ${e instanceof Error && e.message ? e.message : 'the browser refused'}. Use Download instead.`);
    }
  }

  function download() {
    if (!data) return;
    const blob = new Blob([logText(data, dataLevel)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<header class="section-header">
  <h2 class="section-title">Logs</h2>
</header>
<p class="lede">
  The most recent lines this HOPS process has logged, up to the last {data?.capacity ?? 2000}, kept in memory since it
  started. Passwords, tokens, cookies and other secrets are replaced with [REDACTED]. The full log is in the system journal.
</p>

<div class="controls">
  <label class="field">
    <span>Lines</span>
    <select bind:value={limit} onchange={() => void load()}>
      {#each LIMIT_OPTIONS as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span>Level</span>
    <select bind:value={level} onchange={() => void load()}>
      {#each LEVEL_OPTIONS as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
  </label>
  <div class="buttons">
    <Button variant="secondary" size="small" icon="mdi:refresh" onclick={() => void load()} loading={loading}>Refresh</Button>
    <label class="toggle">
      <input type="checkbox" bind:checked={autoRefresh} />
      <span>Auto-refresh (5 s)</span>
    </label>
    <Button variant="secondary" size="small" icon="mdi:content-copy" onclick={copy} disabled={!data}>Copy</Button>
    <Button variant="secondary" size="small" icon="mdi:download" onclick={download} disabled={!data}>Download .txt</Button>
  </div>
</div>

{#if error}
  <div class="alert-error load-error" role="alert">
    Couldn't load the log lines: {error}
    {#if data}
      <br />The lines below were loaded at {formatWhen(data.fetchedAt)} and may be out of date{#if behindControls}; they are for the previous Lines/Level choice{/if}.
    {/if}
  </div>
{/if}

{#if data}
  {#if behindControls && !error}
    <p class="updating" role="status">Updating to match the filter… the lines below are for the previous Lines/Level choice.</p>
  {/if}
  <div class="meta" class:stale={!!error || behindControls}>
    <p class="since">{sinceLine(data)}</p>
    {#each notices as n, i (i)}
      <p class="notice">
        {n.text}{#if n.link}{' '}<a href={n.link.href}>{n.link.label}</a>.{/if}
      </p>
    {/each}
    {#if autoRefresh && !visible}
      <p class="notice">Auto-refresh is paused while this page is hidden.</p>
    {/if}
  </div>

  {#if empty}
    <div class="empty-state" class:stale={!!error || behindControls}><p>{empty}</p></div>
  {:else}
    <div class="log-box" class:stale={!!error || behindControls} bind:this={box}>
      <ol class="log-lines" role="log" aria-live="off" aria-label="Log lines, newest last">
        {#each data.records as r, i (i)}
          <li class="line lvl-{r.level}"><span class="t">{formatTime(r.time)}</span> <span class="lvl">{r.level.toUpperCase().padEnd(5)}</span> <span class="msg">{r.message}</span>{#if r.attrs.length}{' '}<span class="attrs">{formatAttrs(r.attrs)}</span>{/if}</li>
        {/each}
      </ol>
    </div>
  {/if}
{:else if !error}
  <p class="muted">Loading…</p>
{/if}

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem 1.25rem;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .field select {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9rem;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .load-error {
    margin-bottom: 1rem;
  }

  .meta p {
    margin: 0 0 0.35rem;
    font-size: 0.9rem;
  }

  .meta {
    margin-bottom: 0.75rem;
  }

  .since {
    color: var(--text-primary);
  }

  .notice {
    color: var(--text-secondary);
  }

  .notice a {
    color: inherit;
    text-decoration: underline;
  }

  .updating {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .stale {
    opacity: 0.6;
  }

  .muted {
    color: var(--text-secondary);
  }

  .log-box {
    width: 100%;
    max-height: 70vh;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .log-lines {
    list-style: none;
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .line {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-primary);
  }

  .t {
    color: var(--text-secondary);
  }

  .lvl {
    font-weight: 600;
  }

  .attrs {
    color: var(--text-secondary);
  }

  .lvl-error .lvl,
  .lvl-error .msg {
    color: var(--color-error-text);
  }

  .lvl-warn .lvl,
  .lvl-warn .msg {
    color: var(--color-warning-text);
  }

  .lvl-debug .lvl,
  .lvl-debug .msg {
    color: var(--text-secondary);
  }
</style>
