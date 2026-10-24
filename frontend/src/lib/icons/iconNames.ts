// The full icon names list (every mdi and simple-icons name, as "prefix:name"), for the icon
// editor's type-ahead and to decide whether a typed name is worth fetching for a preview.
//
// The list lives in the generated ./icon-names module, reached only through this dynamic
// import(), so the bundler puts it in its own chunk that loads when the icon editor opens —
// never with the dashboard. A failed load rejects (the editor shows it) and is not cached,
// so the next open tries again.

export interface IconNames {
	/** Every visible icon: what the type-ahead offers. */
	suggest: string[];
	/** Every real name, including aliases and hidden icons: what may be fetched for a preview. */
	known: Set<string>;
}

let pending: Promise<IconNames> | null = null;

type Lists = Record<string, { suggest: string; other: string }>;

export function loadIconNames(): Promise<IconNames> {
	if (!pending) {
		pending = import('./icon-names')
			.then(({ ICON_NAME_LISTS }) => {
				const suggest: string[] = [];
				const known = new Set<string>();
				for (const [prefix, lists] of Object.entries(ICON_NAME_LISTS as Lists)) {
					for (const name of lists.suggest.split('\n')) {
						if (!name) continue;
						suggest.push(`${prefix}:${name}`);
						known.add(`${prefix}:${name}`);
					}
					for (const name of lists.other.split('\n')) if (name) known.add(`${prefix}:${name}`);
				}
				if (suggest.length === 0) throw new Error('the icon names list is empty');
				return { suggest, known };
			})
			.catch((err) => {
				pending = null;
				throw err;
			});
	}
	return pending;
}
