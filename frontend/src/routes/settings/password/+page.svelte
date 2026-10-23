<script lang="ts">
  import Button from '$lib/components/shared/Button.svelte';
  import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
  import { isBackendOffline } from '$lib/stores/backendStatus';

  // Settings → Password (M5 §9). The shell shows this page only while signed in, so when the
  // session ends (idle expiry, a Log out elsewhere) the page and its dialog go together, and
  // signing back in doesn't reopen it.
  let showChangePassword = $state(false);
</script>

<h2 class="section-title">Password</h2>
<p class="lede">Change the admin password.</p>
<Button variant="secondary" icon="mdi:key" onclick={() => (showChangePassword = true)} disabled={$isBackendOffline}>
  Change Password
</Button>

{#if showChangePassword}
  <ChangePasswordModal onClose={() => (showChangePassword = false)} />
{/if}
