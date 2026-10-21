package configdoc

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
)

// The finer grid (spec §9, "grid v5"). A tab's grid went from 12 to 24
// columns: one old grid cell is now 2×2 cells. A document carrying the marker
// "gridUnit": GridUnit is in the new form; a v3 document without it is in the
// old 12-column form. The one-time update (UpdateGridV5) doubles every grid
// placement and every grid container's columns so existing layouts look the
// same; free-mode containers (8 px design units) are untouched.
//
// The marker lives at the top of the document. In an export envelope it
// travels inside "config" (the document, or {dashboards: [one]} for a
// single-dashboard export), so an import reads config.gridUnit: absent means
// the old form and each dashboard is converted (and verified) on import.
const (
	// GridV5Note is the config_archive notes value of the row the one-time
	// grid update archives.
	GridV5Note = "grid-v5"
	// GridKey is the document key of the grid marker.
	GridKey = "gridUnit"
	// GridTitleRows is a grid folder's title row, in grid cells (one old cell).
	GridTitleRows = 2
)

// GridUnitOf reports the document's grid form: 1 when the marker is absent
// (the old 12-column form) or GridUnit when it carries the marker. Any other
// marker value is an error — never guessed.
func GridUnitOf(doc Obj) (int, error) {
	v, has := doc[GridKey]
	if !has {
		return 1, nil
	}
	if f, ok := numberValue(v); ok && f == GridUnit {
		return GridUnit, nil
	}
	return 0, fmt.Errorf("configdoc: unknown grid marker %s=%s (this build knows only %d)", GridKey, trunc(show(v)), GridUnit)
}

// concreteMode returns "grid" or "free" for a concrete layout value, else "".
func concreteMode(v any) string {
	if s, _ := v.(string); s == "grid" || s == "free" {
		return s
	}
	return ""
}

// tabMode resolves a tab root's layout mode: the tab's own, then the
// dashboard default, then grid (the frontend's resolveMode).
func tabMode(dash, tab Obj) string {
	if m := concreteMode(tab["layout"]); m != "" {
		return m
	}
	if m := concreteMode(dash["defaultLayout"]); m != "" {
		return m
	}
	return "grid"
}

// childMode resolves a folder's content mode: its own layout, else its parent's.
func childMode(folder Obj, parent string) string {
	if m := concreteMode(folder["layout"]); m != "" {
		return m
	}
	return parent
}

// effectiveColumns is the column count a container renders with, as the
// frontend's containerColumns resolves it: its own columns (floored) when a
// finite number ≥ 1, else the fallback — the old 12 for a root, or the
// folder's placement width (floored, at least 1).
func effectiveColumns(c Obj, folder Obj) float64 {
	if n, ok := numberValue(c["columns"]); ok && !math.IsNaN(n) && !math.IsInf(n, 0) && math.Floor(n) >= 1 {
		return math.Floor(n)
	}
	if folder == nil {
		return oldRootColumns
	}
	p, _ := folder["placement"].(Obj)
	if w, ok := numberValue(p["w"]); ok && !math.IsNaN(w) && !math.IsInf(w, 0) && math.Floor(w) >= 1 {
		return math.Floor(w)
	}
	return 1
}

// oldRootColumns is the root column count of the old (unmarked) form.
const oldRootColumns = 12

// placementKeys are the placement fields measured in grid cells. z (stacking
// order) is not a length and is never doubled.
var placementKeys = []string{"x", "y", "w", "h"}

// UpdateGridV5 brings an old-form (unmarked) v3 document to the finer grid:
// in every container that resolves to grid mode (through the folder → tab →
// dashboard inherit chain) each child's placement x, y, w and h are doubled
// and the container's columns become twice its effective columns (written
// explicitly). Free containers keep their placements and columns; a grid
// folder inside a free container has its content doubled but not its own
// placement (that is in free units). The marker gridUnit: GridUnit is set.
//
// A document already carrying the marker is returned unchanged with
// changed=false, so the update is idempotent. An unknown marker is an error.
// It works on a deep copy and never mutates doc. Placement fields that are
// not numbers are left as they are (VerifyGridV5 reports them).
func UpdateGridV5(doc Obj) (out Obj, changed bool, err error) {
	unit, err := GridUnitOf(doc)
	if err != nil {
		return nil, false, err
	}
	cp, err := deepCopy(doc)
	if err != nil {
		return nil, false, fmt.Errorf("configdoc: copy document: %w", err)
	}
	if unit == GridUnit {
		return cp, false, nil
	}
	dashes, err := listOf(cp, "dashboards")
	if err != nil {
		return nil, false, fmt.Errorf("configdoc: %w", err)
	}
	for i, d := range dashes {
		dm, ok := d.(Obj)
		if !ok {
			return nil, false, fmt.Errorf("configdoc: dashboards[%d] is %T, want object", i, d)
		}
		tabs, err := listOf(dm, "tabs")
		if err != nil {
			return nil, false, fmt.Errorf("configdoc: dashboard %s: %w", show(dm["id"]), err)
		}
		for j, t := range tabs {
			tm, ok := t.(Obj)
			if !ok {
				return nil, false, fmt.Errorf("configdoc: dashboard %s: tabs[%d] is %T, want object", show(dm["id"]), j, t)
			}
			root, ok := tm["root"].(Obj)
			if !ok {
				return nil, false, fmt.Errorf("configdoc: tab %s: root is %T, want object", show(tm["id"]), tm["root"])
			}
			if err := doubleContainer(root, nil, tabMode(dm, tm)); err != nil {
				return nil, false, fmt.Errorf("configdoc: tab %s: %w", show(tm["id"]), err)
			}
		}
	}
	cp[GridKey] = GridUnit
	return cp, true, nil
}

// doubleContainer converts container c (owned by folder, nil for a root) in
// mode, then each folder child's content in its own mode.
func doubleContainer(c, folder Obj, mode string) error {
	kids, err := listOf(c, "children")
	if err != nil {
		return err
	}
	if mode == "grid" {
		// The caller converts a folder's content before the folder's own
		// placement, so a fallback to the folder's width reads the old width.
		c["columns"] = GridUnit * effectiveColumns(c, folder)
	}
	for i, k := range kids {
		km, ok := k.(Obj)
		if !ok {
			return fmt.Errorf("children[%d] is %T, want object", i, k)
		}
		if km["kind"] != "folder" {
			if mode == "grid" {
				doublePlacement(km)
			}
			continue
		}
		// The folder's content falls back to the folder's ORIGINAL width, so
		// convert the content before the folder's own placement.
		content, ok := km["content"].(Obj)
		if !ok {
			return fmt.Errorf("folder %s: content is %T, want object", show(km["id"]), km["content"])
		}
		if err := doubleContainer(content, km, childMode(km, mode)); err != nil {
			return fmt.Errorf("folder %s: %w", show(km["id"]), err)
		}
		if mode == "grid" {
			doublePlacement(km)
		}
	}
	return nil
}

func doublePlacement(n Obj) {
	p, ok := n["placement"].(Obj)
	if !ok {
		return
	}
	for _, k := range placementKeys {
		if f, ok := numberValue(p[k]); ok {
			p[k] = GridUnit * f
		}
	}
}

// VerifyGridV5 proves after is before on the finer grid and nothing else changed:
//   - after is a well-formed v3 document (VerifyIDs) carrying gridUnit: GridUnit;
//   - when before already carried the marker, after equals before exactly;
//   - otherwise every document, dashboard, tab, container and node key is
//     unchanged (and none added) except: in a grid container each child's
//     placement x, y, w, h is exactly twice before's (other placement keys
//     such as z unchanged) and the container's columns are twice before's
//     effective columns (so an old 12-column grid root is 24); in a free
//     container placements and columns are unchanged;
//   - dashboards, tabs and every container's children match by id, in
//     order, with none missing or added (node counts and ids unchanged).
//
// Modes are resolved on before (and the layout keys must be unchanged). It
// returns a *VerifyError.
func VerifyGridV5(before, after Obj) error {
	v := &verifier{}
	if !IsV3(after) {
		v.add("document: schemaVersion is %s, want %d", show(after["schemaVersion"]), SchemaVersion)
	}
	if u, err := GridUnitOf(after); err != nil || u != GridUnit {
		v.add("document: %s is %s, want %d", GridKey, trunc(show(after[GridKey])), GridUnit)
	}
	v.checkIDs(after)
	if u, err := GridUnitOf(before); err == nil && u == GridUnit {
		if show(before) != show(after) {
			v.add("document: already carried %s %d but was changed", GridKey, GridUnit)
		}
		return v.result()
	}
	v.sameKeys("document", before, after, "dashboards", GridKey)
	bd, _ := asList(before["dashboards"])
	ad, ok := asList(after["dashboards"])
	if !ok {
		v.add("document: dashboards is %T, want array", after["dashboards"])
		return v.result()
	}
	v.pairByID("document", "dashboard", bd, ad, func(da, db Obj, id string) {
		v.sameKeys("dashboard "+id, da, db, "tabs")
		bt, _ := asList(da["tabs"])
		at, ok := asList(db["tabs"])
		if !ok {
			return // reported by checkIDs
		}
		v.pairByID("dashboard "+id, "tab", bt, at, func(ta, tb Obj, tid string) {
			v.sameKeys("tab "+tid, ta, tb, "root")
			ra, _ := ta["root"].(Obj)
			rb, ok := tb["root"].(Obj)
			if !ok {
				return // reported by checkIDs
			}
			v.compareGrid("tab "+tid+" root", ra, rb, nil, tabMode(da, ta))
		})
	})
	return v.result()
}

// compareGrid checks one container pair (a before, b after) in mode, then
// recurses into each folder's content in the folder's own mode.
func (v *verifier) compareGrid(what string, a, b, folder Obj, mode string) {
	v.sameKeys(what, a, b, "columns", "children")
	if mode == "grid" {
		want := GridUnit * effectiveColumns(a, folder)
		if got, ok := numberValue(b["columns"]); !ok || got != want {
			v.add("%s: columns is %s, want %v (twice %v)", what, trunc(show(b["columns"])), want, want/GridUnit)
		}
	} else {
		ca, hadA := a["columns"]
		cb, hasB := b["columns"]
		if hadA != hasB || show(ca) != show(cb) {
			v.add("%s: free columns changed (before %s, after %s)", what, trunc(show(ca)), trunc(show(cb)))
		}
	}
	ka, _ := asList(a["children"])
	kb, ok := asList(b["children"])
	if !ok {
		return // reported by checkIDs
	}
	v.pairByID(what, "node", ka, kb, func(na, nb Obj, id string) {
		where := fmt.Sprintf("node %q", id)
		v.sameKeys(where, na, nb, "placement", "content")
		v.comparePlacement(where, na["placement"], nb["placement"], mode == "grid")
		if na["kind"] == "folder" {
			ca, _ := na["content"].(Obj)
			cb, ok := nb["content"].(Obj)
			if !ok {
				return // reported by checkIDs
			}
			v.compareGrid(where+" content", ca, cb, na, childMode(na, mode))
		}
	})
}

// comparePlacement requires b to be a doubled (grid) or an identical (free).
func (v *verifier) comparePlacement(where string, a, b any, grid bool) {
	pa, aok := a.(Obj)
	pb, bok := b.(Obj)
	if !aok || !bok {
		if show(a) != show(b) {
			v.add("%s: placement changed (before %s, after %s)", where, trunc(show(a)), trunc(show(b)))
		}
		return
	}
	if !grid {
		v.sameKeys(where+" free placement", pa, pb)
		return
	}
	v.sameKeys(where+" placement", pa, pb, placementKeys...)
	for _, k := range placementKeys {
		fa, okA := numberValue(pa[k])
		fb, okB := numberValue(pb[k])
		if !okA || !okB || fb != GridUnit*fa {
			v.add("%s: placement.%s is %s, want twice %s", where, k, trunc(show(pb[k])), trunc(show(pa[k])))
		}
	}
}

// updateGridOnStartup runs the one-time finer-grid update on the stored v3
// document. When the document is unmarked it, in one transaction, archives
// the raw row first (schema 3, notes GridV5Note), then converts, verifies and
// saves. A document problem is a Failed result with nothing written (the
// archive row is rolled back with the rest); only DB-level errors are
// returned as Go errors. A marked document is left alone.
func updateGridOnStartup(db *sql.DB) (MigrationResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: begin grid update: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after Commit

	var raw string
	if err := tx.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&raw); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: read config row: %w", err)
	}
	var doc Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return gridFailed(fmt.Sprintf("stored config is not valid JSON: %v", err)), nil
	}
	if !IsV3(doc) {
		return gridFailed("stored config is not schemaVersion 3"), nil
	}
	unit, err := GridUnitOf(doc)
	if err != nil {
		return gridFailed(err.Error()), nil
	}
	if unit == GridUnit {
		return MigrationResult{}, nil
	}
	// Stale-data rule: the original is archived before it is converted.
	if _, err := tx.Exec("INSERT INTO config_archive (schema, data, notes) VALUES (3, ?, ?)", raw, GridV5Note); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: archive config before grid update: %w", err)
	}
	out, changed, err := UpdateGridV5(doc)
	if err != nil {
		return gridFailed(fmt.Sprintf("conversion failed: %v", err)), nil
	}
	if !changed {
		return gridFailed("conversion reported nothing to do for an unmarked document"), nil
	}
	if err := VerifyGridV5(doc, out); err != nil {
		return gridFailed(fmt.Sprintf("verification failed: %v", err)), nil
	}
	if err := Save(tx, out); err != nil {
		return MigrationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: commit grid update: %w", err)
	}
	warnOddGridRoots(out)
	slog.Info("config grid updated to the finer grid (24 columns, grid placements doubled); original archived",
		"component", "configdoc", "notes", GridV5Note)
	return MigrationResult{GridUpdated: true}, nil
}

func gridFailed(detail string) MigrationResult {
	detail = "grid update failed: " + detail
	slog.Error("config grid update FAILED; stored config left untouched", "component", "configdoc", "detail", detail)
	return MigrationResult{Failed: true, Detail: detail}
}

// warnOddGridRoots logs a WARN for every grid tab root whose columns are not
// RootColumns after the update. The verifier deliberately accepts twice the
// old effective columns rather than forcing 24 (spec §9 deviation: forcing it
// would change how such a root renders); no known path writes a grid root
// other than 12, so one is an anomaly worth seeing.
func warnOddGridRoots(doc Obj) {
	dashes, _ := doc["dashboards"].([]any)
	for _, d := range dashes {
		dm, _ := d.(Obj)
		tabs, _ := dm["tabs"].([]any)
		for _, t := range tabs {
			tm, _ := t.(Obj)
			root, _ := tm["root"].(Obj)
			if tm == nil || root == nil || tabMode(dm, tm) != "grid" {
				continue
			}
			if n, ok := numberValue(root["columns"]); !ok || n != RootColumns {
				slog.Warn("grid tab root is not 24 columns after the finer-grid update (kept at twice its old width, so it looks the same)",
					"component", "configdoc", "dashboard", dm["id"], "tab", tm["id"], "columns", root["columns"])
			}
		}
	}
}
