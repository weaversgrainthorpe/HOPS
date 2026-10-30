# status_checks_cases.json

The status-check gate matrix, shared by the Go test
(`configdoc/statuschecks_test.go`) and the frontend resolver test.

A tile is checked only when the tile is On and every gate on its path is
Enabled (global, dashboard, tab, folders outermost first).

Each case: `{name, global, dashboardOverride, tab, folders, tile, want: {on, source, sourceIdx?, sourceId?}}`.

- `global`: `true` = Enabled, `false` = Disabled.
- `dashboardOverride`, `tab`, each `folders[i]`: `false` = Disabled; `true` or `null` (the key is absent) = Enabled.
- `tab`, `folders[i]` may also be `"invalid"` → `statusChecksEnabled: "yes"` (a wrong type).
- `folders` is outermost first.
- `tile`:
  - `true` → `statusCheck: {type: "http", enabled: true}` (On);
  - `false` → `statusCheck: {type: "http", enabled: false}` (Off);
  - `null` → `statusCheck: {type: "http", enabled: null}` (Off);
  - `"absent"` → no `statusCheck` key (Off);
  - `"noEnabled"` → `statusCheck: {type: "http"}` (Off);
  - `"invalid"` → `statusCheck: {type: "http", enabled: "yes"}` (a wrong type).
- `want.source` is the level that decided: the OUTERMOST Disabled gate (`global`, `dashboard`, `tab`, `folder`) when one blocks the tile, otherwise `tile` (On or Off by its own setting).
- A wrong-typed value on the tile, a folder or the tab makes the tile **off** with source `invalid`, even under a Disabled gate; the most specific invalid level is named. Those cases carry `want.sourceId` explicitly.
- Fixed ids of the built objects: dashboard `d`, tab `t`, folders `f0`..`fN` (index = position in `folders`), tile `x`.
- Expected `sourceId` (unless `want.sourceId` is given): `""` for `global`, `d` / `t` / `x` for dashboard / tab / tile, and `f<sourceIdx>` for `folder`.
