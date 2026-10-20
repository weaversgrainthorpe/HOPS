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
  // Every picture registers with the shared controller (one
  // IntersectionObserver) and is only loaded once the folder has been on
  // screen. An animated slideshow (mode="animated") also competes for one of
  // the 4 animation slots (reduced motion, the dashboard's setting); a still
  // one (collapsed tile, single image) never takes a slot. The edit-mode
  // failure indicator is placed by the parent (BackgroundFailedBadge), off the
  // content. No backdrop-filter here (Tenet 4): the canvas overlay is the only blur.
  import { readable, type Readable } from 'svelte/store';
  import type { Background } from '$lib/types';
  import BackgroundLayer from './BackgroundLayer.svelte';
  import { registerFolderBackground } from '$lib/stores/backgroundAnimation';
  import { animatedFolderBackgroundsFor } from '$lib/stores/config';
  import { reportBackgroundError, markBackgroundLoaded, backgroundUrlsOf } from '$lib/stores/backgroundErrors';

  interface Props {
    background?: Background;
    /** The colour look (and the picture's fallback). */
    color: string;
    /** Opacity of the colour look, 0–1. */
    colorOpacity?: number;
    /** animated: subject to the shared controller; still: the first image, no slideshow. */
    mode: 'animated' | 'still';
    dashboardId: string;
  }
  let { background, color, colorOpacity = 1, mode, dashboardId }: Props = $props();

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

  // ---- shared controller: lazy loading for every picture; animation slots
  // only for an animated slideshow (stills never take one of the 4 slots).
  let el = $state<HTMLElement | null>(null);
  const NOT_ANIMATED: Readable<boolean> = readable(false);
  // Not loaded until the controller's first report says the folder is on screen.
  const NOT_LOADED: Readable<boolean> = readable(false);
  let animateStore = $state<Readable<boolean>>(NOT_ANIMATED);
  let loadedStore = $state<Readable<boolean>>(NOT_LOADED);
  const animates = $derived(mode === 'animated' && own?.type === 'slideshow');

  $effect(() => {
    const anim = animates;
    if (!el || !isPicture) {
      animateStore = NOT_ANIMATED;
      loadedStore = NOT_LOADED;
      return;
    }
    const reg = anim
      ? registerFolderBackground(el, { animatedSetting: animatedFolderBackgroundsFor(dashboardId) })
      : registerFolderBackground(el, { countsTowardCap: false });
    animateStore = reg.animate;
    loadedStore = reg.loaded;
    return () => {
      reg.unregister();
      animateStore = NOT_ANIMATED;
      loadedStore = NOT_LOADED;
    };
  });

  const animate = $derived(animates && $animateStore);
  // A colour background needs no loading; a picture waits for the controller.
  const drawLayer = $derived(!!own && (!isPicture || $loadedStore));
</script>

<div class="folder-surface" aria-hidden="true" bind:this={el}>
  {#if showColour}
    <div class="folder-surface-color" style:background-color={color} style:opacity={colourOpacity}></div>
  {/if}
  {#if drawLayer}
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
</style>
