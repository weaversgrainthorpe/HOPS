/**
 * Global settings quick-jump links. The Global settings page tells the settings sidebar
 * (and its own phone chip row) which groups it is showing; the links move the page to a group.
 *
 * - The group in view is highlighted as you scroll: one IntersectionObserver over the group
 *   sections, so nothing runs per scroll event (Pi Zero tenet).
 * - A link moves to its group (a glide when the "Animations" setting allows motion here, else a
 *   jump), focuses its heading and puts its id in the address (#look-motion), so a deep link works.
 *   The clicked group stays highlighted until you scroll yourself: the last groups may never reach
 *   the top of the window, and the link you chose should not then point somewhere else.
 */
import { get, writable } from 'svelte/store';
import { replaceState } from '$app/navigation';
import { jumpBehaviour } from './globalGroups';

export interface GroupLink {
	id: string;
	label: string;
}

export interface GlobalNavState {
	/** The groups on the page, in order; empty when not on Global settings (or nothing loaded). */
	groups: GroupLink[];
	/** The group in view. */
	active: string | null;
	/** The saved "Animations" choice (on / off / always), for how a link moves the page. */
	animations?: string;
}

export const globalNav = writable<GlobalNavState>({ groups: [], active: null });

// Set by a link, cleared when you scroll yourself: a wheel, a touch drag, a key, or any scroll
// after the link's own scroll has ended (a scrollbar drag).
let pinned = false;
let jumpScrollEnded = false;

export function resetGlobalNavForTests(): void {
	pinned = false;
	globalNav.set({ groups: [], active: null });
}

function reducedMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return true; // can't tell: no motion
	}
}

/** Move to a group's section. False when it isn't on the page. */
export function jumpToGroup(id: string, opts: { updateHash?: boolean; behaviour?: ScrollBehavior } = {}): boolean {
	const section = typeof document === 'undefined' ? null : document.getElementById(id);
	if (!section) return false;
	const behavior = opts.behaviour ?? jumpBehaviour(get(globalNav).animations, reducedMotion());
	pinned = true;
	jumpScrollEnded = false;
	globalNav.update((s) => (s.active === id ? s : { ...s, active: id }));
	section.scrollIntoView?.({ behavior, block: 'start' });
	const heading = section.querySelector<HTMLElement>('[data-group-heading]') ?? section;
	heading.focus({ preventScroll: true });
	if (opts.updateHash !== false && location.hash !== `#${id}`) replaceState(`#${id}`, {});
	return true;
}

/** A group link's click: a plain click moves in place; a new-tab click keeps the link's address. */
export function onGroupLinkClick(e: MouseEvent, id: string): void {
	if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
	if (jumpToGroup(id)) e.preventDefault();
}

/**
 * Highlight the group in view while the page scrolls. `sections` are the group sections in page
 * order; `topPx` is how much of the window's top is covered (the sticky navbar, phones' chip row).
 * Returns the stop.
 */
export function watchGroups(sections: HTMLElement[], topPx: number): () => void {
	if (typeof IntersectionObserver === 'undefined' || sections.length === 0) return () => {};
	const order = sections.map((s) => s.id);
	// Two bands, both from just under the covered top: a heading in the upper 40% of the window
	// makes its group current (the first such); with no heading there, the group filling the top
	// half is current.
	const headingsIn = new Set<string>();
	const sectionsIn = new Set<string>();
	const bottomNow = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
	let atBottom = false;
	const recompute = () => {
		if (pinned) return;
		// Scrolled to the very bottom: the last group, which may be too short to reach the bands.
		let next = atBottom
			? order[order.length - 1]
			: (order.find((id) => headingsIn.has(id)) ?? order.find((id) => sectionsIn.has(id)));
		// Nothing in either band (above the first group): the first.
		if (!next && window.scrollY < 8) next = order[0];
		if (next) globalNav.update((s) => (s.active === next ? s : { ...s, active: next }));
	};
	const track = (into: Set<string>, idOf: (el: Element) => string) => (entries: IntersectionObserverEntry[]) => {
		for (const e of entries) {
			if (e.isIntersecting) into.add(idOf(e.target));
			else into.delete(idOf(e.target));
		}
		recompute();
	};
	const top = `-${Math.round(topPx)}px`;
	const sectionIO = new IntersectionObserver(track(sectionsIn, (el) => el.id), { rootMargin: `${top} 0px -50% 0px` });
	const headingIO = new IntersectionObserver(
		track(headingsIn, (el) => (el.closest('section') as HTMLElement).id),
		{ rootMargin: `${top} 0px -60% 0px` }
	);
	for (const s of sections) {
		sectionIO.observe(s);
		const h = s.querySelector('[data-group-heading]');
		if (h) headingIO.observe(h);
	}
	const io = { disconnect: () => (sectionIO.disconnect(), headingIO.disconnect()) };
	const unpin = () => {
		if (!pinned) return;
		pinned = false;
		recompute();
	};
	const onScrollEnd = () => {
		if (pinned) jumpScrollEnded = true;
	};
	// One comparison per scroll event; recompute only when "at the bottom" flips.
	const onScroll = () => {
		if (pinned && jumpScrollEnded) unpin();
		const b = bottomNow();
		if (b !== atBottom) {
			atBottom = b;
			recompute();
		}
	};
	const opts = { passive: true } as const;
	window.addEventListener('wheel', unpin, opts);
	window.addEventListener('touchmove', unpin, opts);
	window.addEventListener('keydown', unpin, opts);
	window.addEventListener('scrollend', onScrollEnd, opts);
	window.addEventListener('scroll', onScroll, opts);
	return () => {
		io.disconnect();
		window.removeEventListener('wheel', unpin);
		window.removeEventListener('touchmove', unpin);
		window.removeEventListener('keydown', unpin);
		window.removeEventListener('scrollend', onScrollEnd);
		window.removeEventListener('scroll', onScroll);
		pinned = false;
	};
}
