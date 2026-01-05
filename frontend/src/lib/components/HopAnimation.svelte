<script lang="ts">
  import { hopAnimationActive } from '$lib/stores/easterEggs';
  import Icon from '@iconify/svelte';
</script>

{#if $hopAnimationActive}
  <div class="hop-container">
    <!-- Hop plants that get eaten -->
    <div class="hop-plant plant-1">
      <Icon icon="mdi:leaf" width="48" height="48" />
    </div>
    <div class="hop-plant plant-2">
      <Icon icon="mdi:leaf" width="40" height="40" />
    </div>
    <div class="hop-plant plant-3">
      <Icon icon="mdi:leaf" width="52" height="52" />
    </div>
    <div class="hop-plant plant-4">
      <Icon icon="mdi:leaf" width="44" height="44" />
    </div>
    <div class="hop-plant plant-5">
      <Icon icon="mdi:leaf" width="48" height="48" />
    </div>

    <!-- The hopping bunny -->
    <div class="hopper">
      <Icon icon="mdi:rabbit" width="96" height="96" />
    </div>
  </div>
{/if}

<style>
  .hop-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: var(--z-easter);
    overflow: hidden;
  }

  /* Hop plants scattered along the path */
  .hop-plant {
    position: absolute;
    bottom: 18%;
    color: #228b22;
    filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.3));
    transform-origin: bottom center;
  }

  .plant-1 {
    left: 8%;
    animation: plant-eaten 3s ease-in-out forwards;
    animation-delay: 0s;
  }

  .plant-2 {
    left: 23%;
    animation: plant-eaten 3s ease-in-out forwards;
    animation-delay: 0s;
  }

  .plant-3 {
    left: 38%;
    animation: plant-eaten 3s ease-in-out forwards;
    animation-delay: 0s;
  }

  .plant-4 {
    left: 53%;
    animation: plant-eaten 3s ease-in-out forwards;
    animation-delay: 0s;
  }

  .plant-5 {
    left: 68%;
    animation: plant-eaten 3s ease-in-out forwards;
    animation-delay: 0s;
  }

  /* Plants get eaten as bunny passes by */
  @keyframes plant-eaten {
    0% {
      opacity: 1;
      transform: scale(1) rotate(-5deg);
    }
    /* Plant 1 eaten at 15% */
    14% {
      opacity: 1;
      transform: scale(1) rotate(-5deg);
    }
    17% {
      opacity: 0;
      transform: scale(0.3) rotate(20deg);
    }
    100% {
      opacity: 0;
      transform: scale(0) rotate(20deg);
    }
  }

  .plant-2 {
    animation-name: plant-eaten-2;
  }

  @keyframes plant-eaten-2 {
    0% {
      opacity: 1;
      transform: scale(1) rotate(3deg);
    }
    29% {
      opacity: 1;
      transform: scale(1) rotate(3deg);
    }
    32% {
      opacity: 0;
      transform: scale(0.3) rotate(-15deg);
    }
    100% {
      opacity: 0;
      transform: scale(0) rotate(-15deg);
    }
  }

  .plant-3 {
    animation-name: plant-eaten-3;
  }

  @keyframes plant-eaten-3 {
    0% {
      opacity: 1;
      transform: scale(1) rotate(-8deg);
    }
    44% {
      opacity: 1;
      transform: scale(1) rotate(-8deg);
    }
    47% {
      opacity: 0;
      transform: scale(0.3) rotate(25deg);
    }
    100% {
      opacity: 0;
      transform: scale(0) rotate(25deg);
    }
  }

  .plant-4 {
    animation-name: plant-eaten-4;
  }

  @keyframes plant-eaten-4 {
    0% {
      opacity: 1;
      transform: scale(1) rotate(6deg);
    }
    59% {
      opacity: 1;
      transform: scale(1) rotate(6deg);
    }
    62% {
      opacity: 0;
      transform: scale(0.3) rotate(-20deg);
    }
    100% {
      opacity: 0;
      transform: scale(0) rotate(-20deg);
    }
  }

  .plant-5 {
    animation-name: plant-eaten-5;
  }

  @keyframes plant-eaten-5 {
    0% {
      opacity: 1;
      transform: scale(1) rotate(-4deg);
    }
    74% {
      opacity: 1;
      transform: scale(1) rotate(-4deg);
    }
    77% {
      opacity: 0;
      transform: scale(0.3) rotate(18deg);
    }
    100% {
      opacity: 0;
      transform: scale(0) rotate(18deg);
    }
  }

  .hopper {
    position: absolute;
    bottom: 20%;
    left: -120px;
    color: #8b5a2b;
    filter: drop-shadow(3px 3px 6px rgba(0, 0, 0, 0.4));
    animation: hop-across 3s ease-in-out forwards;
  }

  @keyframes hop-across {
    0% {
      left: -120px;
      bottom: 20%;
      transform: scaleX(1);
    }
    10% {
      bottom: 35%;
      transform: scaleX(1) rotate(-10deg);
    }
    15% {
      left: 10%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    25% {
      bottom: 40%;
      transform: scaleX(1) rotate(-15deg);
    }
    30% {
      left: 25%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    40% {
      bottom: 45%;
      transform: scaleX(1) rotate(-10deg);
    }
    45% {
      left: 40%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    55% {
      bottom: 50%;
      transform: scaleX(1) rotate(-20deg);
    }
    60% {
      left: 55%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    70% {
      bottom: 45%;
      transform: scaleX(1) rotate(-15deg);
    }
    75% {
      left: 70%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    85% {
      bottom: 35%;
      transform: scaleX(1) rotate(-10deg);
    }
    90% {
      left: 85%;
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
    100% {
      left: calc(100% + 120px);
      bottom: 20%;
      transform: scaleX(1) rotate(0deg);
    }
  }
</style>
