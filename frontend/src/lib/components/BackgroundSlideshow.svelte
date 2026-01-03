<script lang="ts">
  import type { Background } from '$lib/types';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    background?: Background;
  }

  let { background }: Props = $props();

  let currentIndex = $state(0);
  let intervalId: number | undefined;

  // Dual-layer system for smooth transitions
  let layer1Visible = $state(true);
  let layer1Image = $state('');
  let layer2Image = $state('');

  // Ken Burns animation variation tracking
  let layer1KenBurnsVariant = $state(0);
  let layer2KenBurnsVariant = $state(1);

  // Get transition settings with defaults
  let transitionEffect = $derived(background?.transition || 'crossfade');
  let transitionDuration = $derived(background?.transitionDuration || 1.5);

  // Compute current image URL
  let currentImageUrl = $derived(
    !background ? '' :
    background.type === 'image' ? (background.value || '') :
    background.type === 'slideshow' && background.images && background.images.length > 0 ? background.images[currentIndex] :
    ''
  );

  // Compute background size style
  let backgroundSize = $derived.by(() => {
    const fit = background?.fit || 'cover';
    if (fit === 'cover') return 'cover';
    if (fit === 'contain') return 'contain';
    if (fit === 'fill') return '100% 100%';
    return 'cover';
  });

  // Initialize layers when image changes
  $effect(() => {
    if (currentImageUrl) {
      if (layer1Visible) {
        layer1Image = currentImageUrl;
      } else {
        layer2Image = currentImageUrl;
      }
    }
  });

  // Handle slideshow rotation with smooth crossfade
  $effect(() => {
    // Clear any existing interval
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = undefined;
    }

    // Only start rotation if it's a slideshow with multiple images
    if (
      background?.type === 'slideshow' &&
      background.images &&
      background.images.length > 1
    ) {
      const interval = (background.interval || 30) * 1000; // Convert to milliseconds

      // Initialize first image
      layer1Image = background.images[0];
      layer1Visible = true;

      intervalId = setInterval(() => {
        // Move to next image
        currentIndex = (currentIndex + 1) % background.images!.length;
        const nextImage = background.images![currentIndex];

        // Update the hidden layer with the next image
        if (layer1Visible) {
          layer2Image = nextImage;
          // Cycle Ken Burns variant for layer 2
          layer2KenBurnsVariant = (layer2KenBurnsVariant + 2) % 4;
        } else {
          layer1Image = nextImage;
          // Cycle Ken Burns variant for layer 1
          layer1KenBurnsVariant = (layer1KenBurnsVariant + 2) % 4;
        }

        // Swap visibility to trigger crossfade
        layer1Visible = !layer1Visible;
      }, interval) as any;
    }

    // Cleanup on unmount or when background changes
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  });

  // Reset index when background changes
  $effect(() => {
    if (background?.type === 'slideshow') {
      currentIndex = 0;
      layer1Visible = true;
    }
  });
</script>

{#if background}
  {#if background.type === 'color'}
    <div class="background-color" style:background-color={background.value || '#1e293b'}></div>
  {:else if background.type === 'image'}
    {#if currentImageUrl}
      <div
        class="background-image"
        style:background-image="url({currentImageUrl})"
        style:background-size={backgroundSize}
      ></div>
    {/if}
  {:else if background.type === 'slideshow'}
    <!-- Dual-layer transition system -->
    <div
      class="background-layer layer-1 transition-{transitionEffect}"
      class:visible={layer1Visible}
      class:kenburns-0={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 0}
      class:kenburns-1={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 1}
      class:kenburns-2={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 2}
      class:kenburns-3={transitionEffect === 'kenburns' && layer1KenBurnsVariant === 3}
      style:background-image={layer1Image ? `url(${layer1Image})` : 'none'}
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
      style:background-image={layer2Image ? `url(${layer2Image})` : 'none'}
      style:background-size={backgroundSize}
      style:--transition-duration="{transitionDuration}s"
    ></div>
  {/if}
{/if}

<style>
  .background-color,
  .background-image,
  .background-layer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: -1;
  }

  .background-image {
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
  }

  .background-layer {
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
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

  /* Layer 2 sits on top for transitions */
  .layer-2 {
    z-index: -1;
  }

  .layer-1 {
    z-index: -2;
  }
</style>
