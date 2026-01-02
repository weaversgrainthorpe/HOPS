<script lang="ts">
	import { onMount } from 'svelte';
	import { loadConfig } from '$lib/stores/config';
	import { initAuth } from '$lib/stores/auth';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		initAuth();
		loadConfig();
	});
</script>

<svelte:head>
	<title>HOPS - Home Operations Portal System</title>
</svelte:head>

{@render children()}
