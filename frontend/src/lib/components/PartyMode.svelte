<script lang="ts">
  import { partyModeActive } from '$lib/stores/easterEggs';
  import { onMount } from 'svelte';

  interface Confetti {
    id: number;
    x: number;
    color: string;
    delay: number;
    duration: number;
    size: number;
  }

  let confetti = $state<Confetti[]>([]);

  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe'];

  $effect(() => {
    if ($partyModeActive) {
      // Generate confetti particles
      confetti = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 2,
        size: 8 + Math.random() * 8
      }));
    } else {
      confetti = [];
    }
  });
</script>

{#if $partyModeActive}
  <div class="party-overlay">
    <div class="confetti-container">
      {#each confetti as piece (piece.id)}
        <div
          class="confetti"
          style="
            left: {piece.x}%;
            background-color: {piece.color};
            animation-delay: {piece.delay}s;
            animation-duration: {piece.duration}s;
            width: {piece.size}px;
            height: {piece.size}px;
          "
        ></div>
      {/each}
    </div>
    <div class="party-message">
      🎉 PARTY MODE! 🎉
    </div>
  </div>
{/if}

<style>
  .party-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: var(--z-easter);
    overflow: hidden;
  }

  .confetti-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .confetti {
    position: absolute;
    top: -20px;
    border-radius: 2px;
    animation: confetti-fall linear forwards;
    transform-origin: center;
  }

  @keyframes confetti-fall {
    0% {
      transform: translateY(0) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(100vh) rotate(720deg);
      opacity: 0;
    }
  }

  .party-message {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 3rem;
    font-weight: bold;
    color: white;
    text-shadow:
      0 0 10px rgba(255, 107, 107, 0.8),
      0 0 20px rgba(255, 107, 107, 0.6),
      0 0 30px rgba(255, 107, 107, 0.4),
      2px 2px 0 #ff6b6b,
      -2px -2px 0 #4ecdc4;
    animation: party-text 0.5s ease-in-out infinite alternate;
    pointer-events: none;
  }

  @keyframes party-text {
    0% {
      transform: translate(-50%, -50%) scale(1) rotate(-2deg);
    }
    100% {
      transform: translate(-50%, -50%) scale(1.1) rotate(2deg);
    }
  }
</style>
