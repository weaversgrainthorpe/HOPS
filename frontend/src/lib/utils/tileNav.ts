import { get } from 'svelte/store';
import { overlayStack } from '$lib/stores/folderOverlay';

const CANDIDATE = '.entry, .folder-collapsed-tile';

/**
 * Spatial arrow-key navigation between dashboard tiles and collapsed folders.
 * Of all candidates in the requested half-plane, picks the closest centre,
 * weighting off-axis distance double. While a folder overlay is open the
 * candidates are only those inside the top panel; anything inside [inert] is
 * never a candidate. Returns true if focus moved (caller should preventDefault).
 */
export function navigateTiles(direction: string, root: ParentNode = document): boolean {
	let scope: ParentNode = root;
	if (get(overlayStack).length > 0) {
		const panels = root.querySelectorAll<HTMLElement>('.overlay-panel');
		const top = panels[panels.length - 1];
		if (!top) return false;
		scope = top;
	}

	const tiles = Array.from(scope.querySelectorAll<HTMLElement>(CANDIDATE)).filter((t) => {
		if (t.closest('[inert]')) return false;
		const r = t.getBoundingClientRect();
		return r.width > 0 || r.height > 0;
	});
	if (tiles.length === 0) return false;

	const active = document.activeElement;
	if (!(active instanceof HTMLElement) || !tiles.includes(active)) {
		tiles[0].focus();
		return true;
	}

	const from = active.getBoundingClientRect();
	const fromCx = from.left + from.width / 2;
	const fromCy = from.top + from.height / 2;
	const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';

	let best: HTMLElement | null = null;
	let bestScore = Infinity;
	for (const t of tiles) {
		if (t === active) continue;
		const r = t.getBoundingClientRect();
		const dx = r.left + r.width / 2 - fromCx;
		const dy = r.top + r.height / 2 - fromCy;
		if (direction === 'ArrowRight' && dx <= 1) continue;
		if (direction === 'ArrowLeft' && dx >= -1) continue;
		if (direction === 'ArrowDown' && dy <= 1) continue;
		if (direction === 'ArrowUp' && dy >= -1) continue;
		const score = horizontal ? Math.abs(dx) + Math.abs(dy) * 2 : Math.abs(dy) + Math.abs(dx) * 2;
		if (score < bestScore) {
			bestScore = score;
			best = t;
		}
	}

	if (best) {
		best.focus();
		best.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
		return true;
	}
	return false;
}
