# status_checks_cases.json

The layered status-check resolver matrix (design §4b, Ruling 12), shared by the Go test
(`configdoc/statuschecks_test.go`) and the frontend resolver test.

Each case: `{name, global, dashboardOverride, tab, folders, tile, want: {on, source, sourceIdx?}}`.

- `dashboardOverride`, `tab`, each `folders[i]`: `true` / `false`, or `null` = the key is absent (inherit).
- `folders` is outermost first.
- `tile`:
  - `true` / `false` → `statusCheck: {type: "http", enabled: <value>}`;
  - `null` → `statusCheck: {type: "http", enabled: null}` (explicit inherit);
  - `"absent"` → no `statusCheck` key (unset tile: **off**, source `tile`);
  - `"noEnabled"` → `statusCheck: {type: "http"}` (unset tile: **off**, source `tile`).
- Fixed ids of the built objects: dashboard `d`, tab `t`, folders `f0`..`fN` (index = position in `folders`), tile `x`.
- Expected `sourceId`: `""` for `global`, `d` / `t` / `x` for dashboard / tab / tile, and `f<sourceIdx>` for `folder`.
