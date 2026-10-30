// Pictures for the icon-name field's type-ahead suggestions.
//
// Most suggestions come from the full mdi / simple-icons NAME list, whose pictures are not in
// memory. Rather than show an empty box, the visible suggestions are fetched — but only once
// typing has paused (the list has been stable for `pauseMs`), only whole names from the list
// (never the half-typed text) and in ONE batched call (Iconify's loadIcons batches per prefix).
// A name that fails to load is remembered for the session and never asked for again; offline
// nothing is requested. Every state has something to draw: the icon, a loading mark, or an
// "unavailable" glyph — never a blank.
//
// The loader is framework-free (its Iconify and browser dependencies are injected) so it is
// unit-tested without a browser; the component re-renders on `onChange`.

/** What a suggestion's picture slot shows. */
export type SuggestionPreviewState = 'ready' | 'loading' | 'unavailable' | 'offline';

/** A batched loader with Iconify's loadIcons callback shape, reduced to names. */
export type BatchLoad = (
	names: string[],
	done: (loaded: string[], missing: string[], pending: string[]) => void
) => () => void;

export interface SuggestionPreviewDeps {
	load: BatchLoad;
	isLoaded: (name: string) => boolean;
	isOnline: () => boolean;
	/** Called whenever a state may have changed (the component bumps a reactive tick). */
	onChange: () => void;
	pauseMs?: number;
	/** A batch still unanswered after this long counts as failed. */
	timeoutMs?: number;
}

export const SUGGESTION_PREVIEW_PAUSE_MS = 300;
export const SUGGESTION_PREVIEW_TIMEOUT_MS = 8000;

/** The names worth fetching: whole Iconify names not in memory, not failed, not already asked. */
export function namesToFetch(
	names: readonly string[],
	isLoaded: (name: string) => boolean,
	failed: ReadonlySet<string>,
	inFlight: ReadonlySet<string>
): string[] {
	const out: string[] = [];
	for (const n of names) {
		if (!n || !n.includes(':') || out.includes(n)) continue;
		if (isLoaded(n) || failed.has(n) || inFlight.has(n)) continue;
		out.push(n);
	}
	return out;
}

export class SuggestionPreviewLoader {
	private readonly failed = new Set<string>();
	private readonly inFlight = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly aborts = new Set<() => void>();
	private readonly pauseMs: number;
	private readonly timeoutMs: number;

	constructor(private readonly deps: SuggestionPreviewDeps) {
		this.pauseMs = deps.pauseMs ?? SUGGESTION_PREVIEW_PAUSE_MS;
		this.timeoutMs = deps.timeoutMs ?? SUGGESTION_PREVIEW_TIMEOUT_MS;
	}

	/** What the picture slot for `name` shows right now. */
	state(name: string): SuggestionPreviewState {
		if (this.deps.isLoaded(name)) return 'ready';
		if (this.failed.has(name)) return 'unavailable';
		if (!this.deps.isOnline()) return 'offline';
		return 'loading';
	}

	/** The visible suggestions changed: (re)start the pause; nothing is requested before it ends. */
	schedule(names: readonly string[]): void {
		clearTimeout(this.timer);
		const list = [...names];
		this.timer = setTimeout(() => this.fetch(list), this.pauseMs);
	}

	private fetch(names: string[]): void {
		if (!this.deps.isOnline()) {
			this.deps.onChange();
			return;
		}
		const wanted = namesToFetch(names, this.deps.isLoaded, this.failed, this.inFlight);
		if (wanted.length === 0) return;
		for (const n of wanted) this.inFlight.add(n);
		let settled = false;
		const finish = (loaded: string[], missing: string[]) => {
			for (const n of loaded) this.inFlight.delete(n);
			for (const n of missing) {
				this.inFlight.delete(n);
				this.failed.add(n);
			}
			this.deps.onChange();
		};
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			abort();
			this.aborts.delete(abort);
			finish([], wanted.filter((n) => this.inFlight.has(n) && !this.deps.isLoaded(n)));
		}, this.timeoutMs);
		const abort = this.deps.load(wanted, (loaded, missing, pending) => {
			if (settled) return;
			finish(loaded, missing);
			if (pending.length === 0) {
				settled = true;
				clearTimeout(timeout);
				this.aborts.delete(abort);
			}
		});
		this.aborts.add(abort);
		this.deps.onChange();
	}

	dispose(): void {
		clearTimeout(this.timer);
		for (const a of this.aborts) a();
		this.aborts.clear();
	}
}
