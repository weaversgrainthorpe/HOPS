<script lang="ts">
  // Settings › Dashboards: the "Add to HOPS" bookmark (bookmarklet). Dragged to the bookmarks bar,
  // clicking it on any tool's page opens HOPS's /add page with that page's address, name and icon
  // filled in. It lives here because it adds tiles to dashboards, next to the dashboard list.
  import { onMount } from 'svelte';
  import { buildBookmarklet } from '$lib/utils/addToHops';
  import { copyText } from '$lib/utils/clipboard';
  import { toast } from '$lib/stores/toast';

  let href = $state('');
  onMount(() => (href = buildBookmarklet(window.location.origin)));

  async function copy() {
    try {
      await copyText(href);
      toast.success('Bookmark code copied');
    } catch (e) {
      toast.error(`Couldn't copy (${e instanceof Error && e.message ? e.message : 'the browser refused'}): select the text below and copy it yourself.`);
    }
  }
</script>

<section class="bookmark" aria-labelledby="add-to-hops-title">
  <h3 id="add-to-hops-title">Add to HOPS bookmark</h3>
  <p>
    Drag this to your bookmarks bar. On any tool's page, click it: HOPS opens with that page's address,
    name and icon filled in, ready to add as a tile. It's the quickest way to add things Discovery can't find.
  </p>
  {#if href}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <a class="bookmarklet" {href} draggable="true" onclick={(e) => { e.preventDefault(); toast.info('Drag this button to your bookmarks bar, then click it there while on a tool’s page.'); }}>Add to HOPS</a>
  {/if}
  <p class="muted">
    For desktop browsers. If your browser won't let you drag it, make a new bookmark and paste this as its address:
  </p>
  <div class="copy-row">
    <input type="text" readonly value={href} aria-label="Add to HOPS bookmark code" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
    <button type="button" class="btn-secondary" onclick={copy}>Copy</button>
  </div>
  <p class="muted">
    Some sites block bookmarks like this one (a strict security policy), and nothing happens when you click it. There, copy
    the page's address and use Add tile on your dashboard instead.
  </p>
</section>

<style>
  .bookmark {
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 0.5rem;
  }
  p {
    margin: 0.4rem 0;
    line-height: 1.45;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .bookmarklet {
    display: inline-block;
    margin: 0.5rem 0;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    background: var(--accent-solid);
    color: var(--on-accent);
    font-weight: 600;
    text-decoration: none;
    cursor: grab;
  }
  .copy-row {
    display: flex;
    gap: 0.5rem;
  }
  .copy-row input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--field-border);
    border-radius: 0.35rem;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: monospace;
    font-size: 0.8rem;
  }
</style>
