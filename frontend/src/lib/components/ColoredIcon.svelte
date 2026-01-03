<script lang="ts">
  import Icon from '@iconify/svelte';
  import { getIconColor } from '$lib/utils/iconColors';

  interface Props {
    icon: string;
    width?: number | string;
    height?: number | string;
    color?: string;
  }

  let { icon, width = 24, height = width, color }: Props = $props();

  // Get brand color if available, otherwise use provided color
  const brandColor = $derived(getIconColor(icon));
  const finalColor = $derived(color || brandColor);
</script>

{#if finalColor}
  <Icon {icon} {width} {height} style="color: {finalColor}" />
{:else}
  <Icon {icon} {width} {height} />
{/if}
