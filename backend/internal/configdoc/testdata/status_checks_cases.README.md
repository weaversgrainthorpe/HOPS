# status_checks_cases.json

The layered status-check resolver matrix, shared by the Go test
(`configdoc/statuschecks_test.go`) and the frontend resolver test.

Each case: `{name, global, dashboardOverride, tab, folders, tile, want: {on, source, sourceIdx?}}`.

- `dashboardOverride`, `tab`, each `folders[i]`: `true` / `false`, or `null` = the key is absent (inherit).
- `tab`, `folders[i]` may also be `"invalid"` → `statusChecksEnabled: "yes"` (a wrong type).
- `folders` is outermost first.
- `tile`:
  - `true` / `false` → `statusCheck: {type: "http", enabled: <value>}`;
  - `null` → `statusCheck: {type: "http", enabled: null}` (explicit inherit);
  - `"absent"` → no `statusCheck` key (absent setting: **inherits**);
  - `"noEnabled"` → `statusCheck: {type: "http"}` (absent setting: **inherits**);
  - `"invalid"` → `statusCheck: {type: "http", enabled: "yes"}` (a wrong type).
- A wrong-typed value on the tile, a folder or the tab makes the tile **off** with source `invalid`; the most specific invalid level is named. Those cases carry `want.sourceId` explicitly.
- Fixed ids of the built objects: dashboard `d`, tab `t`, folders `f0`..`fN` (index = position in `folders`), tile `x`.
- Expected `sourceId` (unless `want.sourceId` is given): `""` for `global`, `d` / `t` / `x` for dashboard / tab / tile, and `f<sourceIdx>` for `folder`.
