<script lang="ts">
	import { onMount } from 'svelte';
	import { loadConfig } from '$lib/stores/config';
	import { initAuth } from '$lib/stores/auth';
	import Navbar from '$lib/components/Navbar.svelte';
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

<Navbar />

{@render children()}
