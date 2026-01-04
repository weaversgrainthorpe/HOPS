<script lang="ts">
  /**
   * Skeleton loading component for placeholder content
   * Displays animated pulse effect while content is loading
   */

  interface Props {
    /** Width of the skeleton (CSS value) */
    width?: string;
    /** Height of the skeleton (CSS value) */
    height?: string;
    /** Border radius (CSS value) */
    radius?: string;
    /** Display multiple lines */
    lines?: number;
    /** Variant: 'text' | 'rect' | 'circle' | 'tile' */
    variant?: 'text' | 'rect' | 'circle' | 'tile';
  }

  let {
    width = '100%',
    height = '1rem',
    radius = '0.25rem',
    lines = 1,
    variant = 'rect'
  }: Props = $props();

  const variantStyles = {
    text: { height: '1em', radius: '0.25rem' },
    rect: { height, radius },
    circle: { height, radius: '50%' },
    tile: { height: '150px', radius: '0.5rem' }
  };

  const style = variantStyles[variant];
</script>

{#if lines > 1}
  <div class="skeleton-lines">
    {#each Array(lines) as _, i}
      <div
        class="skeleton"
        style:width={i === lines - 1 ? '70%' : width}
        style:height={style.height}
        style:border-radius={style.radius}
      ></div>
    {/each}
  </div>
{:else}
  <div
    class="skeleton"
    style:width={width}
    style:height={variant === 'tile' ? '150px' : height}
    style:border-radius={variant === 'circle' ? '50%' : radius}
  ></div>
{/if}

<style>
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--bg-tertiary) 0%,
      var(--bg-secondary) 50%,
      var(--bg-tertiary) 100%
    );
    background-size: 200% 100%;
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  @keyframes skeleton-pulse {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
