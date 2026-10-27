<script lang="ts">
  import Modal from '$lib/components/shared/Modal.svelte';
  import ChangePasswordForm from './ChangePasswordForm.svelte';

  // The first-login "set a new password" dialog: undismissable until the change succeeds. The form
  // itself is the one Settings › Password shows (ChangePasswordForm); this only wraps it.
  let { onClose }: { onClose: () => void } = $props();
  let done = $state(false);
</script>

<Modal id="change-password" title="Set a New Password" titleIcon="mdi:key" {onClose} onBeforeClose={() => done} showCloseButton={false} maxWidth="400px">
  <ChangePasswordForm forced onDone={() => { done = true; onClose(); }} />
</Modal>
