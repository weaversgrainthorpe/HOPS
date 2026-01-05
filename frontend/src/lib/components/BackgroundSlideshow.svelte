<script lang="ts">
  import type { Background } from '$lib/types';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    background?: Background;
  }

  let { background }: Props = $props();

  let currentIndex = $state(0);
  let intervalId: ReturnType<typeof setInterval> | undefined;

  // Dual-layer system for smooth transitions
  let layer1Visible = $state(true);
  let layer1Image = $state('');
  let layer2Image = $state('');

  // Ken Burns animation variation tracking
  let layer1KenBurnsVariant = $state(0);
  let layer2KenBurnsVariant = $state(1);

  // Available transitions for random selection (excluding 'random' and 'none')
  const availableTransitions = [
    'crossfade', 'slide', 'slide-up', 'slide-down', 'zoom', 'zoom-out',
    'fade-black', 'blur', 'flip', 'kenburns', 'wipe', 'swirl',
    'dissolve', 'flash', 'glitch', 'curtain', 'circle', 'diamond'
  ];

  // Current random transition (changes each slide)
  let currentRandomTransition = $state(availableTransitions[Math.floor(Math.random() * availableTransitions.length)]);

  // Get transition settings with defaults
  let configuredTransition = $derived(background?.transition || 'crossfade');
  let transitionEffect = $derived(configuredTransition === 'random' ? currentRandomTransition : configuredTransition);
  let transitionDuration = $derived(background?.transitionDuration || 1.5);

  // Function to pick a new random transition
  function pickRandomTransition() {
    const newTransition = availableTransitions[Math.floor(Math.random() * availableTransitions.length)];
    currentRandomTransition = newTransition;
  }

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
        // Pick a new random transition if configured
        if (configuredTransition === 'random') {
          pickRandomTransition();
        }

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
      }, interval);
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

  /* Curtain transition (vertical wipe from center) */
  .background-layer.transition-curtain {
    transition: opacity 0.01s ease-in-out;
    clip-path: inset(0 50% 0 50%);
  }

  .background-layer.transition-curtain.visible {
    opacity: 1;
    animation: curtain var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes curtain {
    0% { clip-path: inset(0 50% 0 50%); }
    100% { clip-path: inset(0 0 0 0); }
  }

  /* Circle reveal transition */
  .background-layer.transition-circle {
    transition: opacity 0.01s ease-in-out;
    clip-path: circle(0% at 50% 50%);
  }

  .background-layer.transition-circle.visible {
    opacity: 1;
    animation: circle-reveal var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes circle-reveal {
    0% { clip-path: circle(0% at 50% 50%); }
    100% { clip-path: circle(100% at 50% 50%); }
  }

  /* Diamond reveal transition */
  .background-layer.transition-diamond {
    transition: opacity 0.01s ease-in-out;
    clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
  }

  .background-layer.transition-diamond.visible {
    opacity: 1;
    animation: diamond-reveal var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes diamond-reveal {
    0% { clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%); }
    100% { clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); }
  }

  /* Layer 2 sits on top for transitions */
  .layer-2 {
    z-index: -1;
  }

  .layer-1 {
    z-index: -2;
  }
</style>
