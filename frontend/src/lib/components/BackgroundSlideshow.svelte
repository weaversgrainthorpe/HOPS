<script lang="ts">
  import type { Background } from '$lib/types';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    background?: Background;
  }

  let { background }: Props = $props();

  let currentIndex = $state(0);
  let intervalId: number | undefined;
  let isTransitioning = $state(false);

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

  // Handle slideshow rotation
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

      intervalId = setInterval(() => {
        isTransitioning = true;

        // Wait for fade out
        setTimeout(() => {
          currentIndex = (currentIndex + 1) % background.images!.length;

          // Wait a bit then fade back in
          setTimeout(() => {
            isTransitioning = false;
          }, 50);
        }, 300);
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
    }
  });
</script>

{#if background}
  {#if background.type === 'color'}
    <div class="background-color" style:background-color={background.value || '#1e293b'}></div>
  {:else if background.type === 'image' || background.type === 'slideshow'}
    {#if currentImageUrl}
      <div
        class="background-image"
        class:transitioning={isTransitioning}
        style:background-image="url({currentImageUrl})"
        style:background-size={backgroundSize}
      ></div>
    {/if}
  {/if}
{/if}

<style>
  .background-color,
  .background-image {
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
    transition: opacity 0.6s ease-in-out;
  }

  .background-image.transitioning {
    opacity: 0.7;
  }
</style>
