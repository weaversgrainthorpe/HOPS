<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ACTIONS, actionClass, type ActionKind } from './actions';

  /** Any other button attribute (form, aria-describedby, data-…) passes straight through. */
  interface Props extends Omit<HTMLButtonAttributes, 'type' | 'class' | 'onclick' | 'disabled' | 'title' | 'children'> {
    /** Which action: sets the icon, the word and the button class. */
    action: ActionKind;
    /** Only where the word alone would be unclear ("Delete anyway"); otherwise the action's word. */
    label?: string;
    /** The action is running: a spinner, the busy word, and the button can't be pressed again. */
    busy?: boolean;
    disabled?: boolean;
    small?: boolean;
    type?: 'button' | 'submit';
    title?: string;
    ariaLabel?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    action, label, busy = false, disabled = false, small = false, type = 'button', title, ariaLabel,
    class: className = '', onclick, ...rest
  }: Props = $props();

  const look = $derived(ACTIONS[action]);
  const text = $derived(busy ? (look.busyLabel ?? label ?? look.label) : (label ?? look.label));
</script>

<button
  {...rest}
  {type}
  class="action-btn {actionClass(action)} {className}"
  class:btn-sm={small}
  disabled={disabled || busy}
  aria-busy={busy || undefined}
  aria-label={ariaLabel}
  {title}
  data-action={action}
  data-icon={look.icon}
  onclick={(e) => { if (!disabled && !busy) onclick?.(e); }}
>
  <Icon icon={busy ? 'mdi:loading' : look.icon} width={small ? 16 : 18} class={busy ? 'spin' : undefined} />
  {text}
</button>

<style>
  .action-btn {
    white-space: nowrap;
  }
  .action-btn :global(svg) {
    flex: none;
  }
</style>
