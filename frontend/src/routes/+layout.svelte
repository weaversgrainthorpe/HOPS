<script lang="ts">
	import { onMount } from 'svelte';
	import { loadConfig } from '$lib/stores/config';
	import { initAuth } from '$lib/stores/auth';
	import Navbar from '$lib/components/Navbar.svelte';
	import { selectedEntry } from '$lib/stores/selection';
	import { copyEntry, cutEntry, clipboard } from '$lib/stores/clipboard';
	import { editMode } from '$lib/stores/editMode';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		initAuth();
		loadConfig();
	});

	function handleKeyDown(e: KeyboardEvent) {
		// Only handle keyboard shortcuts in edit mode
		if (!$editMode) return;

		// Check for Ctrl+C (copy)
		if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey && !e.altKey) {
			const selected = $selectedEntry;
			if (selected && selected.tabId && selected.groupId) {
				// Don't prevent default if text is selected (allow normal copy)
				const selection = window.getSelection();
				if (selection && selection.toString().length > 0) return;

				e.preventDefault();
				copyEntry(selected.entry, selected.tabId, selected.groupId);
				console.log('Copied entry via keyboard shortcut:', selected.entry.name);
			}
		}

		// Check for Ctrl+X (cut)
		if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey && !e.altKey) {
			const selected = $selectedEntry;
			if (selected && selected.tabId && selected.groupId) {
				// Don't prevent default if text is selected (allow normal cut)
				const selection = window.getSelection();
				if (selection && selection.toString().length > 0) return;

				e.preventDefault();
				cutEntry(selected.entry, selected.tabId, selected.groupId);
				console.log('Cut entry via keyboard shortcut:', selected.entry.name);
			}
		}

		// Note: Ctrl+V for paste is handled by the Group component's paste button
		// since we need to know which group to paste into
	}
</script>

<svelte:head>
	<title>HOPS - Home Operations Portal System</title>
</svelte:head>

<svelte:window onkeydown={handleKeyDown} />

<Navbar />

{@render children()}
