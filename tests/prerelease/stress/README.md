# Stress test (manual)

Synthetic data and scripts used to stress HOPS 3.0.0 at its limits
(5000 items per dashboard, folders 12 deep, 200 tabs). Not part of the
Playwright suite; run by hand against a **throwaway** HOPS on its own
empty data directory — never dev or prod.

The scripts expect a throwaway on `http://127.0.0.1:18200` whose admin
password is `stress-test-pw-3000` (`client.py` sets it on first sign-in
from the default `admin`/`admin`). Change `BASE` in `client.py` and the
`baseURL` in the `.cjs` scripts to point elsewhere.

| File | What it does |
|------|--------------|
| `gen.py OUT` | The big set: Stress Test (≈4990 items, 40 tabs), Stress Tabs (200 tabs), Stress Deep (12 levels), as v3 export files |
| `gen_many.py OUT N` | N dashboards of 1000 items each, one export file per dashboard |
| `gen_v2.py OUT` | 20 v2-format dashboards (80,000 entries) for the v2 → v3 upgrade test |
| `client.py` | Small API client (sign-in, CSRF, uploads) used by the Python steps |
| `step3.py` | Save, stale-revision save, export, re-import, reports, backup and restore on the big dashboard |
| `browser.cjs SHOTS` | Opens every tab, the 200-tab and deep dashboards, edit mode, save, and the Settings reports |
| `edit.cjs SHOTS`, `edit2.cjs SHOTS` | Heavy editing: multi-select, delete, undo/redo, 150 duplicates |

Import the generated files through Settings → Import, or
`POST /api/config/import` (multipart field `file`, with a real
Content-Type). Run the `.cjs` scripts from this directory so they find
Playwright in `../node_modules`.

Note: the generators write `"transition": "fade"` on backgrounds, the
same unknown value the Sample shipped in 3.0.0 (see the 3.0.1 notes).
