<script lang="ts">
  interface Props {
    id: string;
    reason: string;
    style?: string;
  }
  let { id, reason, style = '' }: Props = $props();

  $effect(() => {
    console.error(`HOPS layout: can't display node "${id}": ${reason}`);
  });
</script>

<div class="node-placeholder" role="alert" data-node-id={id} {style}>
  <strong>Can't display this item</strong>
  <span>{id}</span>
  <span class="reason">{reason}</span>
</div>

<style>
  .node-placeholder {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem;
    overflow: hidden;
    border: 2px dashed var(--color-error, #dc2626);
    border-radius: 0.5rem;
    color: var(--color-error, #dc2626);
    font-size: 0.8rem;
    word-break: break-all;
  }
  .reason { opacity: 0.8; }
</style>
