<script lang="ts">
	// Register the embedded Iconify icons before anything renders, so the UI
	// (and every bundled service icon) draws with no calls to api.iconify.design.
	// See scripts/generate-icon-bundle.mjs and TENETS.md #10.
	import '$lib/icons/offline-bundle';
	import { onMount } from 'svelte';
	import { config, currentRoute, loadConfig, migrationFailure, resolveDashboardRoute, showMigrationFailedPage } from '$lib/stores/config';
	import { beforeNavigate, goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';
	import { guardNavigation, guardUnload } from '$lib/stores/editSession';
	import { revealNavigation } from '$lib/stores/folderOverlay';
	import { page } from '$app/stores';
	import { initAuth, mustChangePassword } from '$lib/stores/auth';
	import { initEditModeIdleWatcher } from '$lib/stores/editModeIdleWatcher';
	import { initNetworkWatcher } from '$lib/stores/network';
	import Navbar from '$lib/components/Navbar.svelte';
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';
	import VersionMismatchBanner from '$lib/components/VersionMismatchBanner.svelte';
	import ConflictBanner from '$lib/components/ConflictBanner.svelte';
	import MigrationFailed from '$lib/components/MigrationFailed.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
	import { navigateTiles } from '$lib/utils/tileNav';
	import SearchModal from '$lib/components/SearchModal.svelte';
	import { selectedEntry } from '$lib/stores/selection';
	import { copyEntry, cutEntry, clipboard } from '$lib/stores/clipboard';
	import { editMode, followRoute } from '$lib/stores/editMode';
	import '../app.css';

	let { children } = $props();

	let showSearch = $state(false);

	// Unsaved edit-session changes: ask before leaving (leaving anyway discards
	// them). The reveal bookkeeping below only runs for a navigation that goes ahead.
	beforeNavigate((nav) => {
		if (guardNavigation(nav, (href) => goto(href))) return;
		const { to } = nav;
		const seg = to?.params?.dashboard;
		const cfg = get(config);
		const r = seg && cfg ? resolveDashboardRoute(seg, cfg) : undefined;
		revealNavigation(r && r.kind !== 'missing-layout' ? r.dashboard.id : null);
	});

	// In edit mode the session follows the route's dashboard.
	$effect(() => {
		void $currentRoute;
		void $editMode;
		untrack(followRoute);
	});

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

<svelte:window onkeydown={handleKeyDown} onbeforeunload={guardUnload} />

<Navbar onSearch={() => (showSearch = true)} />
<OfflineBanner />
<VersionMismatchBanner />
<ConflictBanner />

<!-- While the config migration has failed, only the admin page ("/": login +
     Backups, the remedy) stays reachable; everything else shows the notice. -->
{#if showMigrationFailedPage($page.url.pathname, $migrationFailure)}
	<MigrationFailed />
{:else}
	{@render children()}
{/if}

{#if $mustChangePassword}
	<ChangePasswordModal forced={true} onClose={() => {}} />
{/if}

{#if showSearch}
	<SearchModal onClose={() => showSearch = false} />
{/if}

<Toast />
<ConfirmModal />
