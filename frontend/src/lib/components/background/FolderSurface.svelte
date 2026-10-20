<script lang="ts">
  // A folder's SURFACE (Milestone 4, Task 4): the colour look and, when the
  // folder has a background of its own, that background drawn in the folder's
  // box. It sits behind the folder's content (z-index -1 inside the folder's
  // stacking context), so the folder's colour/opacity and the picture's
  // opacity never fade the tiles inside.
  //
  // - No background of its own (missing or inherit form): the colour look.
  // - A picture: the colour stands in while it loads and after it fails
  //   (a failure also shows the edit-mode indicator); once an image is shown,
  //   the picture is the surface.
  // - A colour background is itself the surface.
  //
  // Animation (mode="animated"): registered with the shared controller (one
  // IntersectionObserver, cap of 4, reduced motion, the dashboard's setting);
  // the picture is only loaded once the folder has been on screen. No
  // backdrop-filter here (Tenet 4): the canvas-level overlay is the only blur.
  import { readable, type Readable } from 'svelte/store';
  import type { Background } from '$lib/types';
  import BackgroundLayer from './BackgroundLayer.svelte';
  import { registerFolderBackground } from '$lib/stores/backgroundAnimation';
  import { animatedFolderBackgroundsFor } from '$lib/stores/config';
  import {
    failedBackgroundUrls, reportBackgroundError, markBackgroundLoaded, backgroundUrlsOf, failedFor
  } from '$lib/stores/backgroundErrors';

  interface Props {
    background?: Background;
    /** The colour look (and the picture's fallback). */
    color: string;
    /** Opacity of the colour look, 0–1. */
    colorOpacity?: number;
    /** animated: subject to the shared controller; still: the first image, no slideshow. */
    mode: 'animated' | 'still';
    dashboardId: string;
    /** Edit mode: a failed image shows the indicator. */
    editing?: boolean;
  }
  let { background, color, colorOpacity = 1, mode, dashboardId, editing = false }: Props = $props();

  const own = $derived(background && !background.inherit && background.type ? background : undefined);
  const isPicture = $derived(own?.type === 'image' || own?.type === 'slideshow');
  const ownUrls = $derived(backgroundUrlsOf(own));

  const clamp01 = (n: unknown, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
  const colourOpacity = $derived(String(clamp01(colorOpacity, 1)));

  // The URL last shown by the layer; the colour hides once one of THIS
  // background's images is on screen (a changed background starts over).
  let shownUrl = $state<string | null>(null);
  const pictureShown = $derived(shownUrl !== null && ownUrls.includes(shownUrl));
  const showColour = $derived(!own || (isPicture && !pictureShown));

  function onLoad(url: string) {
    shownUrl = url;
    markBackgroundLoaded(url);
  }

  // ---- animation controller (animated slideshows only) ----
  let el = $state<HTMLElement | null>(null);
  const NOT_ANIMATED: Readable<boolean> = readable(false);
  const LOADED: Readable<boolean> = readable(true);
  let animateStore = $state<Readable<boolean>>(NOT_ANIMATED);
  let loadedStore = $state<Readable<boolean>>(LOADED);
  const wantsController = $derived(mode === 'animated' && own?.type === 'slideshow');

  $effect(() => {
    if (!el || !wantsController) {
      animateStore = NOT_ANIMATED;
      loadedStore = LOADED;
      return;
    }
    const reg = registerFolderBackground(el, { animatedSetting: animatedFolderBackgroundsFor(dashboardId) });
    animateStore = reg.animate;
    loadedStore = reg.loaded;
    return () => reg.unregister();
  });

  const animate = $derived(mode === 'animated' && $animateStore);
  const failed = $derived(editing ? failedFor(own, $failedBackgroundUrls) : []);
</script>

<div class="folder-surface" aria-hidden="true" bind:this={el}>
  {#if showColour}
    <div class="folder-surface-color" style:background-color={color} style:opacity={colourOpacity}></div>
  {/if}
  {#if own && $loadedStore}
    <BackgroundLayer
      background={own}
      scope="box"
      level="folder"
      {animate}
      onError={reportBackgroundError}
      {onLoad}
      fallbackColor="transparent"
    />
  {/if}
</div>
{#if failed.length > 0}
  <span
    class="bg-failed-badge"
    data-bg-failed="folder"
    role="status"
  >Background image couldn't be loaded</span>
{/if}

<style>
  .folder-surface {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    overflow: hidden;
    pointer-events: none;
  }
  .folder-surface-color {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .bg-failed-badge {
    position: absolute;
    left: 0.25rem;
    bottom: 0.25rem;
    z-index: 3;
    max-width: calc(100% - 0.5rem);
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    line-height: 1.3;
    background: var(--color-error, #dc2626);
    color: #fff;
    pointer-events: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
