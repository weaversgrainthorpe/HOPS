<script lang="ts">
	import { onMount } from 'svelte';
	import { loadConfig } from '$lib/stores/config';
	import { initAuth, mustChangePassword } from '$lib/stores/auth';
	import { initEditModeIdleWatcher } from '$lib/stores/editModeIdleWatcher';
	import { initNetworkWatcher } from '$lib/stores/network';
	import Navbar from '$lib/components/Navbar.svelte';
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
	import SearchModal from '$lib/components/SearchModal.svelte';
	import { selectedEntry } from '$lib/stores/selection';
	import { copyEntry, cutEntry, clipboard } from '$lib/stores/clipboard';
	import { editMode } from '$lib/stores/editMode';
	import '../app.css';

	let { children } = $props();

	let showSearch = $state(false);

	onMount(() => {
		initAuth();
		loadConfig();
		initNetworkWatcher();
		initEditModeIdleWatcher();
	});

	// True when the user is typing into a real input — search hotkey must
	// not fire there (the "/" they pressed is their actual data).
	function isTextInputTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable) return true;
		const tag = target.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	// Move keyboard focus between dashboard tile buttons in the requested
	// direction. "Spatial" navigation: of all candidate tiles in the
	// requested half-plane, pick the one whose centre is closest, weighting
	// off-axis distance more heavily so up/down picks the column above and
	// left/right picks the row's neighbour.
	//
	// Returns true if focus moved (caller should preventDefault to keep the
	// page from scrolling), false if no candidate tile existed.
	function navigateTiles(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | string): boolean {
		const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('.entry')).filter(
			(t) => t.offsetParent !== null
		);
		if (tiles.length === 0) return false;

		const active = document.activeElement;
		// If no tile is currently focused, focus the first visible one.
		if (!(active instanceof HTMLElement) || !active.classList.contains('entry')) {
			tiles[0].focus();
			return true;
		}

		const from = active.getBoundingClientRect();
		const fromCx = from.left + from.width / 2;
		const fromCy = from.top + from.height / 2;

		let best: HTMLButtonElement | null = null;
		let bestScore = Infinity;

		for (const t of tiles) {
			if (t === active) continue;
			const r = t.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const dx = cx - fromCx;
			const dy = cy - fromCy;

			// Reject candidates not in the requested half-plane.
			if (direction === 'ArrowRight' && dx <= 1) continue;
			if (direction === 'ArrowLeft' && dx >= -1) continue;
			if (direction === 'ArrowDown' && dy <= 1) continue;
			if (direction === 'ArrowUp' && dy >= -1) continue;

			// Score: axis distance + 2× off-axis distance. Lower is better.
			const axis = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? Math.abs(dx) : Math.abs(dy);
			const offAxis = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? Math.abs(dy) : Math.abs(dx);
			const score = axis + offAxis * 2;
			if (score < bestScore) {
				bestScore = score;
				best = t;
			}
		}

		if (best) {
			best.focus();
			// Scroll the tile into view if needed (large dashboards extend
			// past the viewport).
			best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			return true;
		}
		return false;
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Global "/" hotkey opens the search modal. Doesn't fire when typing
		// in an input/textarea/contenteditable, doesn't fire with modifiers,
		// doesn't fire when the modal is already open (let it handle "/").
		if (
			e.key === '/' &&
			!e.ctrlKey && !e.metaKey && !e.altKey &&
			!showSearch &&
			!isTextInputTarget(e.target)
		) {
			e.preventDefault();
			showSearch = true;
			return;
		}

		// Arrow-key navigation between tiles. Browse-mode only — edit mode
		// has its own interactions (drag handles, selection, hover
		// controls). Skipped when search is open or focus is in text input.
		if (
			!$editMode &&
			!showSearch &&
			!e.ctrlKey && !e.metaKey && !e.altKey &&
			!isTextInputTarget(e.target) &&
			(e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
		) {
			if (navigateTiles(e.key)) {
				e.preventDefault();
				return;
			}
		}

		// Only handle the other keyboard shortcuts in edit mode
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
<OfflineBanner />

{@render children()}

{#if $mustChangePassword}
	<ChangePasswordModal forced={true} onClose={() => {}} />
{/if}

{#if showSearch}
	<SearchModal onClose={() => showSearch = false} />
{/if}

<Toast />
<ConfirmModal />
