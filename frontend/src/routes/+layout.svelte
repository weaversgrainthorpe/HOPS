<script lang="ts">
	// Register the embedded Iconify icons before anything renders, so the UI
	// (and every bundled service icon) draws with no calls to api.iconify.design.
	// See scripts/generate-icon-bundle.mjs and TENETS.md #10.
	import '$lib/icons/offline-bundle';
	import { onMount } from 'svelte';
	import { config, currentRoute, loadConfig, migrationFailure, resolveDashboardRoute, showMigrationFailedPage } from '$lib/stores/config';
	import { beforeNavigate, goto } from '$app/navigation';
	import { cancelDropAnimations } from '$lib/editor/drag/dropAnimation';
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';
	import { guardNavigation, guardUnload } from '$lib/stores/editSession';
	import { revealNavigation } from '$lib/stores/reveal';
	import { page } from '$app/stores';
	import { initAuth, mustChangePassword } from '$lib/stores/auth';
	import { initEditModeIdleWatcher } from '$lib/stores/editModeIdleWatcher';
	import { initNetworkWatcher } from '$lib/stores/network';
	import Navbar from '$lib/components/Navbar.svelte';
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';
	import VersionMismatchBanner from '$lib/components/VersionMismatchBanner.svelte';
	import ConflictBanner from '$lib/components/ConflictBanner.svelte';
	import ParkedDraftBanner from '$lib/components/ParkedDraftBanner.svelte';
	import MigrationFailed from '$lib/components/MigrationFailed.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ChangePasswordModal from '$lib/components/admin/ChangePasswordModal.svelte';
	import { navigateTiles } from '$lib/utils/tileNav';
	import SearchModal from '$lib/components/SearchModal.svelte';
	import { editMode, followRoute } from '$lib/stores/editMode';
	import { initEditPresence } from '$lib/utils/editPresence';
	import '../app.css';

	let { children } = $props();

	let showSearch = $state(false);

	// Unsaved edit-session changes: ask before leaving (leaving anyway discards
	// them). The reveal bookkeeping below only runs for a navigation that goes ahead.
	beforeNavigate((nav) => {
		const { to } = nav;
		const seg = to?.params?.dashboard;
		const cfg = get(config);
		const r = seg && cfg ? resolveDashboardRoute(seg, cfg) : undefined;
		if (guardNavigation(nav, (href) => goto(href), r?.id ?? null)) return;
		cancelDropAnimations(); // §8.1: no drop animation outlives the page it was drawn on
		revealNavigation(r ? r.id : null);
	});

	// In edit mode the session follows the route's dashboard.
	$effect(() => {
		void $currentRoute;
		void $editMode;
		untrack(followRoute);
	});

	onMount(() => {
		// The "Add to HOPS" bookmark clicked on a HOPS page hands its /add address here, so /add opens
		// in place (keeping an edit in progress and the way back) instead of in a new tab.
		const w = window as Window & { hopsAdd?: (u: string) => void };
		w.hopsAdd = (u: string) => {
			try {
				const to = new URL(u);
				if (to.origin === location.origin && to.pathname === '/add') {
					void goto(to.pathname + to.search);
					return;
				}
			} catch {
				/* not an address: open it as the bookmark would have */
			}
			window.open(u, '_blank', 'noopener');
		};
		const stopPresence = initEditPresence();
		initAuth();
		loadConfig();
		initNetworkWatcher();
		initEditModeIdleWatcher();
		return stopPresence;
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

		// Edit-mode shortcuts (undo/redo/save, copy/cut/paste, delete) live in the
		// editor toolbar (EditToolbar), which is mounted only while editing.
	}
</script>

<svelte:head>
	<title>HOPS - Home Operations Portal System</title>
</svelte:head>

<svelte:window onkeydown={handleKeyDown} onbeforeunload={guardUnload} />

<!-- A column at least as tall as the screen: the page area takes what the navbar and the
     banners leave, so a dashboard's tab panel can fill the rest (walkthrough §3). -->
<div class="app-root">
<Navbar onSearch={() => (showSearch = true)} />
<OfflineBanner />
<VersionMismatchBanner />
<ConflictBanner />
<ParkedDraftBanner />

<!-- dashboard-route: the same column layout as :has() below, for browsers without :has()
     (Firefox < 121, older kiosk WebViews), where the panel would otherwise stop short. -->
<div class="app-page" class:dashboard-route={$page.route.id === '/[dashboard]' && !showMigrationFailedPage($page.url.pathname, $migrationFailure)}>
<!-- While the config migration has failed, only "/" (which shows the notice
     itself) and Settings (sign-in + Backups, the remedy) stay reachable;
     everything else shows the notice. -->
{#if showMigrationFailedPage($page.url.pathname, $migrationFailure)}
	<MigrationFailed />
{:else}
	{@render children()}
{/if}
</div>
</div>

{#if $mustChangePassword}
	<ChangePasswordModal forced={true} onClose={() => {}} />
{/if}

{#if showSearch}
	<SearchModal onClose={() => showSearch = false} />
{/if}

<Toast />
<ConfirmModal />

<style>
	.app-root {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
	}
	/* Grows into the space left below the navbar and banners. Other pages lay out as blocks,
	   as before; a dashboard page becomes a column so its panel can fill the rest. */
	.app-page {
		flex: 1 0 auto;
	}
	/* Two rules, not one list: a browser without :has() drops a whole selector list it can't parse. */
	.app-page.dashboard-route {
		display: flex;
		flex-direction: column;
	}
	.app-page:has(> :global(.dashboard)) {
		display: flex;
		flex-direction: column;
	}
</style>
