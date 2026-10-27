<script lang="ts">
  import ChangePasswordForm from '$lib/components/admin/ChangePasswordForm.svelte';

  // Settings → Password: the change-password form itself (no popup). The shell shows this page
  // only while signed in.
</script>

<h2 class="section-title">Password</h2>
<p class="lede">Change the admin password. Changing it signs out every other session.</p>
<ChangePasswordForm />
