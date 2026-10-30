<script lang="ts">
  // One background surface: a colour, an image, or a slideshow, drawn either
  // behind the whole viewport (scope="viewport") or filling its positioned
  // parent box (scope="box"). Decorative only.
  //
  // Tenet 4: no per-frame JS. Transitions are CSS; an animating layer owns at
  // most ONE setInterval plus the short curtain timeout, and both are cleared
  // when animate turns off, when the background changes and on unmount.
  //
  // No silent failures: every URL that is refused (validation) or fails to
  // load (preload error) is passed to onError, and when nothing can be shown
  // the fallback colour is drawn instead of a blank.
  import type { Background } from '$lib/types';
  import { slideshowInterval, slideshowTransitionDuration } from './backgroundTiming';
  import { untrack } from 'svelte';
  import { isSafeBackgroundUrl, cssUrl } from './backgroundUrl';

  interface Props {
    background?: Background;
    scope?: 'viewport' | 'box';
    /** 0–1 opacity of this whole layer; defaults to background.opacity, then 1. */
    opacity?: number;
    /** false: the current image (first, initially), still — no interval, no transitions. */
    animate?: boolean;
    /** true: load nothing and stop every timer (a fully opaque layer covers this one); resumes where it was. */
    paused?: boolean;
    onError?: (url: string) => void;
    /** An image was shown (loaded); used to clear an earlier failure. */
    onLoad?: (url: string) => void;
    fallbackColor?: string;
    /** Which level this layer draws (data-bg-level), for styling hooks and tests. */
    level?: string;
  }

  let {
    background,
    scope = 'viewport',
    opacity,
    animate = true,
    paused = false,
    onError,
    onLoad,
    fallbackColor = '#1e293b',
    level
  }: Props = $props();

  // Available transitions for random selection (excluding 'random' and 'none').
  const availableTransitions = [
    'crossfade', 'slide', 'slide-up', 'slide-down', 'zoom', 'zoom-out',
    'fade-black', 'blur', 'flip', 'kenburns', 'wipe', 'swirl',
    'dissolve', 'flash', 'glitch', 'curtain', 'circle', 'diamond'
  ];
  const randomTransition = () => availableTransitions[Math.floor(Math.random() * availableTransitions.length)];

  // Dual-layer system for smooth transitions.
  let layer1Visible = $state(true);
  let layer1Image = $state('');
  let layer2Image = $state('');
  let layer1KenBurnsVariant = $state(0);
  let layer2KenBurnsVariant = $state(1);
  let curtainPreviousImage = $state('');
  let curtainAnimating = $state(false);
  let currentRandomTransition = $state(randomTransition());
  /** Every configured image was refused or failed to load. */
  let allFailed = $state(false);

  const kind = $derived(background && !background.inherit ? background.type : undefined);
  const isPicture = $derived(kind === 'image' || kind === 'slideshow');

  /** The configured image URLs, in order (unvalidated). */
  const configured = $derived.by<string[]>(() => {
    if (kind === 'image') return background?.value ? [background.value] : [];
    if (kind === 'slideshow') return background?.images ? [...background.images] : [];
    return [];
  });

  const configuredTransition = $derived(background?.transition || 'crossfade');
  const transitionEffect = $derived(
    !animate || kind !== 'slideshow' ? 'none'
      : configuredTransition === 'random' ? currentRandomTransition : configuredTransition
  );
  // Clamped: stored timing is never rejected, so it is bounded here before it
  // reaches a timer or a style.
  const transitionDuration = $derived(slideshowTransitionDuration(background?.transitionDuration));
  const intervalMs = $derived(slideshowInterval(background?.interval) * 1000);

  const backgroundSize = $derived.by(() => {
    const fit = background?.fit || 'cover';
    if (fit === 'contain') return 'contain';
    if (fit === 'fill') return '100% 100%';
    return 'cover';
  });

  const layerOpacity = $derived.by(() => {
    const o = opacity ?? background?.opacity;
    if (typeof o !== 'number' || !Number.isFinite(o)) return undefined;
    return String(Math.min(1, Math.max(0, o)));
  });

  // ---- timers and preloads (plain variables: never reactive) ----
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let curtainId: ReturnType<typeof setTimeout> | undefined;
  let pending: HTMLImageElement | undefined;
  let generation = 0;

  function stopAll() {
    generation++;
    if (intervalId !== undefined) clearInterval(intervalId);
    if (curtainId !== undefined) clearTimeout(curtainId);
    intervalId = undefined;
    curtainId = undefined;
    if (pending) {
      pending.onload = null;
      pending.onerror = null;
      pending.src = ''; // cancel the in-flight download
      pending = undefined;
    }
    curtainAnimating = false;
  }

  function report(url: string) {
    try {
      onError?.(url);
    } catch (e) {
      console.error('BackgroundLayer onError handler threw', e);
    }
  }

  function loaded(url: string) {
    try {
      onLoad?.(url);
    } catch (e) {
      console.error('BackgroundLayer onLoad handler threw', e);
    }
  }

  /** Load url off-screen; exactly one of ok/fail runs, and neither after a stop. */
  function preload(url: string, ok: () => void, fail: () => void) {
    const gen = generation;
    const img = new Image();
    pending = img;
    img.onload = () => {
      if (gen !== generation) return;
      pending = undefined;
      ok();
    };
    img.onerror = () => {
      if (gen !== generation) return;
      pending = undefined;
      fail();
    };
    img.src = url;
  }

  // (Re)start only when what is shown or its timing actually changes — a new
  // background object with the same content (e.g. a draft edit elsewhere)
  // must not restart the slideshow. `animate` and `paused` are NOT part of
  // it: turning them off and on again resumes at the current image.
  const restartKey = $derived(JSON.stringify([kind, configured, intervalMs]));

  /** The running slideshow's control, re-synced when animate/paused change. */
  let sync: (() => void) | null = null;

  $effect(() => {
    void restartKey;

    untrack(() => {
      const urls = configured;
      const every = intervalMs;
      const slideshow = kind === 'slideshow';
      stopAll();
      allFailed = false;
      sync = null;
      if (urls.length === 0) {
        layer1Image = '';
        layer2Image = '';
        return;
      }
      const usable: string[] = [];
      for (const u of urls) {
        if (isSafeBackgroundUrl(u)) usable.push(u);
        else report(String(u));
      }
      const failed = new Set<number>();
      let current = -1;
      /** The first image's preload is in flight. */
      let firstLoading = false;

      const running = () => animate && !paused;
      const startInterval = () => {
        if (intervalId === undefined && slideshow && usable.length > 1 && current >= 0) {
          intervalId = setInterval(advance, every);
        }
      };

      const giveUp = () => {
        stopAll();
        firstLoading = false;
        layer1Image = '';
        layer2Image = '';
        allFailed = true;
      };

      /** Show the first usable image that loads, from index i on (skipping known failures). */
      const showFirst = (i: number) => {
        while (i < usable.length && failed.has(i)) i++;
        if (i >= usable.length) return giveUp();
        firstLoading = true;
        preload(usable[i], () => {
          firstLoading = false;
          current = i;
          layer1Image = cssUrl(usable[i]);
          layer2Image = '';
          layer1Visible = true;
          loaded(usable[i]);
          if (running()) startInterval();
        }, () => {
          failed.add(i);
          report(usable[i]);
          showFirst(i + 1);
        });
      };

      /** Preload the next good slide after `from`, then swap to it. */
      const tryNext = (from: number) => {
        let next = -1;
        for (let step = 1; step < usable.length; step++) {
          const j = (from + step) % usable.length;
          if (j === current) break;
          if (!failed.has(j)) { next = j; break; }
        }
        if (next < 0) {
          // Only the current slide still loads: keep it, stop rotating.
          if (intervalId !== undefined) clearInterval(intervalId);
          intervalId = undefined;
          return;
        }
        preload(usable[next], () => {
          swapTo(next);
          loaded(usable[next]);
        }, () => {
          failed.add(next);
          report(usable[next]);
          tryNext(next);
        });
      };

      const advance = () => {
        if (pending) return; // the previous preload is still in flight
        tryNext(current);
      };

      const swapTo = (next: number) => {
        if (configuredTransition === 'random') currentRandomTransition = randomTransition();
        const previous = layer1Visible ? layer1Image : layer2Image;
        current = next;
        if (layer1Visible) {
          layer2Image = cssUrl(usable[next]);
          layer2KenBurnsVariant = (layer2KenBurnsVariant + 2) % 4;
        } else {
          layer1Image = cssUrl(usable[next]);
          layer1KenBurnsVariant = (layer1KenBurnsVariant + 2) % 4;
        }
        if (transitionEffect === 'curtain') {
          if (curtainId !== undefined) clearTimeout(curtainId);
          curtainPreviousImage = previous;
          curtainAnimating = true;
          curtainId = setTimeout(() => {
            curtainId = undefined;
            curtainAnimating = false;
          }, transitionDuration * 1000);
        }
        layer1Visible = !layer1Visible;
      };

      if (usable.length === 0) return giveUp();

      // paused: nothing loads and every timer stops (what is shown stays);
      // not running: the current image, still. Resuming continues from the
      // current image, never from the first.
      sync = () => {
        if (allFailed) return;
        if (paused) {
          stopAll();
          firstLoading = false;
          return;
        }
        if (current < 0) {
          if (!firstLoading) showFirst(0);
          return;
        }
        if (running()) {
          startInterval();
        } else {
          stopAll();
        }
      };
      sync();
    });

    return () => {
      sync = null;
      stopAll();
    };
  });

  $effect(() => {
    void animate;
    void paused;
    untrack(() => sync?.());
  });
</script>

{#if kind}
  <div
    class="background-root scope-{scope}"
    data-bg-level={level}
    data-animate={String(animate)}
    data-paused={String(paused)}
    style:opacity={layerOpacity}
    aria-hidden="true"
  >
    {#if kind === 'color'}
      <div class="background-color" style:background-color={background?.value || '#1e293b'}></div>
    {:else if isPicture && allFailed}
      <div class="background-color background-fallback" style:background-color={fallbackColor}></div>
    {:else if isPicture}
      <!-- Dual-layer transition system -->
      <div
        class="background-layer layer-1 transition-{transitionEffect}"
        class:visible={layer1Visible}
        class:kenburns-0={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 0}
        class:kenburns-1={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 1}
        class:kenburns-2={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 2}
        class:kenburns-3={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 3}
        style:background-image={layer1Image || 'none'}
        style:background-size={backgroundSize}
        style:--transition-duration="{transitionDuration}s"
      ></div>
      <div
        class="background-layer layer-2 transition-{transitionEffect}"
        class:visible={!layer1Visible}
        class:kenburns-0={transitionEffect === 'kenburns' && layer2KenBurnsVariant === 0}
        class:kenburns-1={transitionEffect === 'kenburns' && layer2KenBurnsVariant === 1}
        class:kenburns-2={transitionEffect === 'kenburns' && layer2KenBurnsVariant === 2}
        class:kenburns-3={transitionEffect === 'kenburns' && layer2KenBurnsVariant === 3}
        style:background-image={layer2Image || 'none'}
        style:background-size={backgroundSize}
        style:--transition-duration="{transitionDuration}s"
      ></div>
      <!-- Curtain overlay: shows the previous image splitting apart -->
      {#if transitionEffect === 'curtain' && curtainAnimating}
        <div class="curtain-overlay" style:--transition-duration="{transitionDuration}s">
          <div
            class="curtain-half curtain-left"
            style:background-image={curtainPreviousImage || 'none'}
            style:background-size={backgroundSize}
          ></div>
          <div
            class="curtain-half curtain-right"
            style:background-image={curtainPreviousImage || 'none'}
            style:background-size={backgroundSize}
          ></div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* viewport: fixed behind the whole page, so the background stays put as the
     user scrolls through a tall tab (background-attachment: fixed is
     unreliable under transformed/filtered ancestors such as backdrop-filter on
     the tab content wrapper). */
  .background-root.scope-viewport {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -1;
  }

  /* box: fills its positioned parent and is clipped by the parent's radius. */
  .background-root.scope-box {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
  }

  .background-root {
    overflow: hidden;
    pointer-events: none;
  }

  .background-color,
  .background-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
  }

  .background-layer {
    background-position: center;
    background-repeat: no-repeat;
    opacity: 0;
  }

  /* Crossfade transition (default) */
  .background-layer.transition-crossfade {
    transition: opacity var(--transition-duration, 1.5s) cubic-bezier(0.4, 0, 0.2, 1);
  }

  .background-layer.transition-crossfade.visible {
    opacity: 1;
  }

  /* Slide transition */
  .background-layer.transition-slide {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateX(100%);
  }

  .background-layer.transition-slide.visible {
    opacity: 1;
    transform: translateX(0);
  }

  /* Zoom transition */
  .background-layer.transition-zoom {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(1.2);
  }

  .background-layer.transition-zoom.visible {
    opacity: 1;
    transform: scale(1);
  }

  /* Fade to black transition */
  .background-layer.transition-fade-black {
    transition: opacity calc(var(--transition-duration, 1.5s) / 2) ease-in-out;
  }

  .background-layer.transition-fade-black.visible {
    opacity: 1;
    animation: fadeBlack var(--transition-duration, 1.5s) ease-in-out;
  }

  @keyframes fadeBlack {
    0% { opacity: 0; }
    40% { opacity: 0; }
    100% { opacity: 1; }
  }

  /* Blur transition */
  .background-layer.transition-blur {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                filter var(--transition-duration, 1.5s) ease-in-out;
    filter: blur(20px);
  }

  .background-layer.transition-blur.visible {
    opacity: 1;
    filter: blur(0px);
  }

  /* Flip transition */
  .background-layer.transition-flip {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: perspective(1000px) rotateY(90deg);
    backface-visibility: hidden;
  }

  .background-layer.transition-flip.visible {
    opacity: 1;
    transform: perspective(1000px) rotateY(0deg);
  }

  /* Ken Burns transition - slow pan and zoom with different directions */
  /* Use a longer, slower crossfade for Ken Burns to feel more cinematic */
  .background-layer.transition-kenburns {
    transition: opacity 2.5s ease-in-out;
    transform-origin: center center;
  }

  .background-layer.transition-kenburns.visible {
    opacity: 1;
  }

  /* Ken Burns animations run regardless of visibility so outgoing image keeps moving while fading */
  /* Ken Burns variant 0: Zoom in, pan right-down */
  .background-layer.transition-kenburns.kenburns-0 {
    animation: kenburns-0 30s ease-in-out forwards;
  }

  @keyframes kenburns-0 {
    0% {
      transform: scale(1.0) translate(0, 0);
    }
    100% {
      transform: scale(1.15) translate(-3%, -2%);
    }
  }

  /* Ken Burns variant 1: Zoom in, pan left-up */
  .background-layer.transition-kenburns.kenburns-1 {
    animation: kenburns-1 30s ease-in-out forwards;
  }

  @keyframes kenburns-1 {
    0% {
      transform: scale(1.0) translate(0, 0);
    }
    100% {
      transform: scale(1.15) translate(3%, 2%);
    }
  }

  /* Ken Burns variant 2: Start zoomed, zoom out, pan left-down */
  .background-layer.transition-kenburns.kenburns-2 {
    animation: kenburns-2 30s ease-in-out forwards;
  }

  @keyframes kenburns-2 {
    0% {
      transform: scale(1.15) translate(2%, -2%);
    }
    100% {
      transform: scale(1.0) translate(-2%, 2%);
    }
  }

  /* Ken Burns variant 3: Start zoomed, zoom out, pan right-up */
  .background-layer.transition-kenburns.kenburns-3 {
    animation: kenburns-3 30s ease-in-out forwards;
  }

  @keyframes kenburns-3 {
    0% {
      transform: scale(1.15) translate(-2%, 2%);
    }
    100% {
      transform: scale(1.0) translate(2%, -2%);
    }
  }

  /* No transition (instant) */
  .background-layer.transition-none {
    transition: none;
  }

  .background-layer.transition-none.visible {
    opacity: 1;
  }

  /* Wipe transition - horizontal wipe reveal */
  .background-layer.transition-wipe {
    transition: opacity 0.01s ease-in-out;
    clip-path: inset(0 100% 0 0);
  }

  .background-layer.transition-wipe.visible {
    opacity: 1;
    animation: wipe var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes wipe {
    0% { clip-path: inset(0 100% 0 0); }
    100% { clip-path: inset(0 0 0 0); }
  }

  /* Swirl/Rotate transition */
  .background-layer.transition-swirl {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(0.8) rotate(-10deg);
    transform-origin: center center;
  }

  .background-layer.transition-swirl.visible {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  /* Pixelate/Dissolve transition (simulated with blur and scale) */
  .background-layer.transition-dissolve {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                filter var(--transition-duration, 1.5s) ease-in-out;
    filter: grayscale(1) contrast(2) blur(5px);
  }

  .background-layer.transition-dissolve.visible {
    opacity: 1;
    filter: grayscale(0) contrast(1) blur(0px);
  }

  /* Slide up transition */
  .background-layer.transition-slide-up {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateY(100%);
  }

  .background-layer.transition-slide-up.visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* Slide down transition */
  .background-layer.transition-slide-down {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateY(-100%);
  }

  .background-layer.transition-slide-down.visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* Zoom out transition (opposite of zoom) */
  .background-layer.transition-zoom-out {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out,
                transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(0.5);
  }

  .background-layer.transition-zoom-out.visible {
    opacity: 1;
    transform: scale(1);
  }

  /* Flash/Blink transition */
  .background-layer.transition-flash {
    transition: none;
  }

  .background-layer.transition-flash.visible {
    animation: flash var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes flash {
    0% { opacity: 0; filter: brightness(1); }
    30% { opacity: 1; filter: brightness(3); }
    60% { opacity: 1; filter: brightness(2); }
    100% { opacity: 1; filter: brightness(1); }
  }

  /* Glitch transition */
  .background-layer.transition-glitch {
    transition: none;
  }

  .background-layer.transition-glitch.visible {
    animation: glitch var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes glitch {
    0% { opacity: 0; transform: translate(0); filter: hue-rotate(0deg); }
    10% { opacity: 1; transform: translate(-5px, 2px); filter: hue-rotate(90deg); }
    20% { opacity: 1; transform: translate(3px, -3px); filter: hue-rotate(180deg); }
    30% { opacity: 1; transform: translate(-2px, 1px); filter: hue-rotate(270deg); }
    40% { opacity: 1; transform: translate(4px, -1px); filter: hue-rotate(360deg); }
    50% { opacity: 1; transform: translate(-1px, 2px); filter: hue-rotate(0deg); }
    60% { opacity: 1; transform: translate(0); filter: hue-rotate(0deg); }
    100% { opacity: 1; transform: translate(0); filter: hue-rotate(0deg); }
  }

  /* Curtain transition - handled by overlay, layers just show */
  .background-layer.transition-curtain {
    transition: none;
    opacity: 1;
  }

  .background-layer.transition-curtain.visible {
    z-index: -1 !important;
  }

  .background-layer.transition-curtain:not(.visible) {
    z-index: -2 !important;
  }

  /* Curtain overlay - two halves that slide apart */
  .curtain-overlay {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .curtain-half {
    position: absolute;
    top: 0;
    height: 100%;
    background-position: center;
    background-repeat: no-repeat;
  }

  .curtain-left {
    left: 0;
    width: 100%;
    clip-path: inset(0 50% 0 0);
    animation: curtainSlideLeft var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  .curtain-right {
    left: 0;
    width: 100%;
    clip-path: inset(0 0 0 50%);
    animation: curtainSlideRight var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes curtainSlideLeft {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  @keyframes curtainSlideRight {
    0% { transform: translateX(0); }
    100% { transform: translateX(50%); }
  }

  /* Circle reveal transition */
  .background-layer.transition-circle {
    opacity: 1;
    clip-path: circle(0% at 50% 50%);
    transition: clip-path var(--transition-duration, 1.5s) ease-in-out;
  }

  .background-layer.transition-circle.visible {
    clip-path: circle(150% at 50% 50%);
  }

  /* Diamond reveal transition */
  .background-layer.transition-diamond {
    opacity: 1;
    clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
    transition: clip-path var(--transition-duration, 1.5s) ease-in-out;
  }

  .background-layer.transition-diamond.visible {
    /* Extend far beyond viewport to ensure full coverage on any aspect ratio */
    clip-path: polygon(50% -100%, 200% 50%, 50% 200%, -100% 50%);
  }

  /* Layer 2 sits on top for transitions */
  .layer-2 {
    z-index: -1;
  }

  .layer-1 {
    z-index: -2;
  }
</style>
