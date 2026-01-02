<script lang="ts">
  import type { Background } from '$lib/types';
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    background?: Background;
  }

  let { background }: Props = $props();

  let currentIndex = $state(0);
  let intervalId: number | undefined;

  // Dual-layer system for smooth crossfade
  let layer1Visible = $state(true);
  let layer1Image = $state('');
  let layer2Image = $state('');

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
        } else {
          layer1Image = nextImage;
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
    <!-- Dual-layer crossfade system -->
    <div
      class="background-layer layer-1"
      class:visible={layer1Visible}
      style:background-image={layer1Image ? `url(${layer1Image})` : 'none'}
      style:background-size={backgroundSize}
    ></div>
    <div
      class="background-layer layer-2"
      class:visible={!layer1Visible}
      style:background-image={layer2Image ? `url(${layer2Image})` : 'none'}
      style:background-size={backgroundSize}
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
    transition: opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .background-layer.visible {
    opacity: 1;
  }

  /* Layer 2 sits on top for the crossfade */
  .layer-2 {
    z-index: -1;
  }

  .layer-1 {
    z-index: -2;
  }
</style>
