package configdoc

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
)

// M4 background form (design §3, §4a call 5). A dashboard, tab or folder
// "background" is absent (inherit), or an object that is either a picture
// ({type: image|slideshow|color, …}) or the inherit form ({inherit: true,
// …stored picture fields}), which keeps a switched-off picture so it is never
// lost. The M1–M3 build stored instead a dashboard "perTabBackgrounds" switch
// and a tab "backgroundEnabled" mirror; both are retired.
const (
	legacyPerTabKey  = "perTabBackgrounds"
	legacyEnabledKey = "backgroundEnabled"
	// BackgroundsV4Note is the config_archive notes value of the row the
	// one-time background update archives.
	BackgroundsV4Note = "backgrounds-v4"
	// MaxBackgroundImages bounds a background's slideshow list.
	MaxBackgroundImages = 200
)

// backgroundTypes are the picture kinds a background may carry.
var backgroundTypes = map[string]bool{"image": true, "slideshow": true, "color": true}

// hasLegacyBackgroundKeys reports whether dashboard d still carries the
// retired perTabBackgrounds switch or any tab's backgroundEnabled mirror.
func hasLegacyBackgroundKeys(d Obj) bool {
	if _, has := d[legacyPerTabKey]; has {
		return true
	}
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		if tm, ok := t.(Obj); ok {
			if _, has := tm[legacyEnabledKey]; has {
				return true
			}
		}
	}
	return false
}

// tabBackgroundsActive reports whether the legacy dashboard d showed its tabs'
// own backgrounds. The M1–M3 renderer read only the dashboard switch, so that
// is what decides — a stale tab mirror never does (nothing changes visually).
func tabBackgroundsActive(d Obj) bool {
	on, _ := d[legacyPerTabKey].(bool)
	return on
}

// inheritForm returns bg as the inherit form: the same picture fields plus
// inherit: true. It copies; bg is not modified.
func inheritForm(bg any) (Obj, error) {
	m, ok := bg.(Obj)
	if !ok {
		return nil, fmt.Errorf("background is %s, want an object", trunc(show(bg)))
	}
	out := make(Obj, len(m)+1)
	for k, v := range m {
		out[k] = v
	}
	out["inherit"] = true
	return out, nil
}

// retireTabSwitches rewrites one already-copied dashboard in place: when its
// tab backgrounds were not shown, each tab background becomes the inherit
// form (picture kept); the switch and the mirrors are dropped.
func retireTabSwitches(d Obj, active bool) error {
	delete(d, legacyPerTabKey)
	tabs, err := listOf(d, "tabs")
	if err != nil {
		return err
	}
	for i, t := range tabs {
		tm, ok := t.(Obj)
		if !ok {
			return fmt.Errorf("tabs[%d] is %T, want object", i, t)
		}
		delete(tm, legacyEnabledKey)
		bg, has := tm["background"]
		if !has || active {
			continue
		}
		f, err := inheritForm(bg)
		if err != nil {
			return fmt.Errorf("tab %s: %w", show(tm["id"]), err)
		}
		tm["background"] = f
	}
	return nil
}

// UpdateBackgroundsV4 rewrites legacy perTabBackgrounds/backgroundEnabled into the M4 form:
// tab background with backgroundEnabled:false (or dashboard perTabBackgrounds:false) → {"inherit":true, …picture};
// drops backgroundEnabled and perTabBackgrounds. Returns changed=false when nothing to do.
//
// Only dashboards that still carry a legacy key are touched, so a second run
// is a no-op. Whether a tab background was shown is decided by the dashboard
// switch alone (see tabBackgroundsActive). It works on a deep copy and never
// mutates doc.
func UpdateBackgroundsV4(doc Obj) (out Obj, changed bool, err error) {
	cp, err := deepCopy(doc)
	if err != nil {
		return nil, false, fmt.Errorf("configdoc: copy document: %w", err)
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
		if !hasLegacyBackgroundKeys(dm) {
			continue
		}
		if err := retireTabSwitches(dm, tabBackgroundsActive(dm)); err != nil {
			return nil, false, fmt.Errorf("configdoc: dashboard %s: %w", show(dm["id"]), err)
		}
		changed = true
	}
	return cp, changed, nil
}

// VerifyBackgroundsV4(before, after) proves no picture field was lost or altered.
//
// Precisely: after is a well-formed v3 document (VerifyIDs, including the
// background shape rules); every document, dashboard and tab key of before
// is in after unchanged and after adds none, except that the retired
// perTabBackgrounds/backgroundEnabled keys are gone and, on a dashboard that
// carried them, each tab background equals before's — plus inherit:true
// exactly when that dashboard did not show its tab backgrounds. Dashboards
// and tabs match by id, in order. It returns a *VerifyError.
func VerifyBackgroundsV4(before, after Obj) error {
	v := &verifier{}
	if !IsV3(after) {
		v.add("document: schemaVersion is %s, want %d", show(after["schemaVersion"]), SchemaVersion)
	}
	v.checkIDs(after)
	v.sameKeys("document", before, after, "dashboards")
	bd, _ := asList(before["dashboards"])
	ad, ok := asList(after["dashboards"])
	if !ok {
		v.add("document: dashboards is %T, want array", after["dashboards"])
		return v.result()
	}
	v.pairByID("document", "dashboard", bd, ad, func(a, b Obj, id string) {
		if _, has := b[legacyPerTabKey]; has {
			v.add("dashboard %q: key %q is still present", id, legacyPerTabKey)
		}
		v.sameKeys("dashboard "+id, a, b, "tabs", legacyPerTabKey)
		legacy := hasLegacyBackgroundKeys(a)
		active := tabBackgroundsActive(a)
		bt, _ := asList(a["tabs"])
		at, ok := asList(b["tabs"])
		if !ok {
			return // reported by checkIDs
		}
		v.pairByID("dashboard "+id, "tab", bt, at, func(ta, tb Obj, tid string) {
			what := "tab " + tid
			if _, has := tb[legacyEnabledKey]; has {
				v.add("%s: key %q is still present", what, legacyEnabledKey)
			}
			if !legacy {
				v.sameKeys(what, ta, tb, legacyEnabledKey)
				return
			}
			v.sameKeys(what, ta, tb, legacyEnabledKey, "background")
			v.checkBackgroundKept(what, ta, tb, !active)
		})
	})
	return v.result()
}

func (v *verifier) result() error {
	if len(v.problems) == 0 {
		return nil
	}
	return &VerifyError{Problems: v.problems}
}

// sameKeys requires a and b to hold the same keys (minus skip) with equal values.
func (v *verifier) sameKeys(what string, a, b Obj, skip ...string) {
	v.compareKeys(what, a, b, skip...)
next:
	for k := range b {
		for _, s := range skip {
			if k == s {
				continue next
			}
		}
		if _, has := a[k]; !has {
			v.add("%s: key %q was added", what, k)
		}
	}
}

// pairByID matches before and after items by id and in order, reporting
// missing, unexpected and reordered items, and calls each for matched pairs.
func (v *verifier) pairByID(parent, level string, before, after []any, each func(a, b Obj, id string)) {
	byID := map[string]Obj{}
	for _, x := range after {
		if o, ok := x.(Obj); ok {
			if id, ok := o["id"].(string); ok {
				byID[id] = o
			}
		}
	}
	seen := map[string]bool{}
	var order []string
	for i, x := range before {
		a, _ := x.(Obj)
		id, ok := a["id"].(string)
		if !ok {
			v.add("%s: %s[%d] has no string id", parent, level, i)
			continue
		}
		seen[id] = true
		order = append(order, id)
		b, found := byID[id]
		if !found {
			v.add("%s: %s %q is missing", parent, level, id)
			continue
		}
		each(a, b, id)
	}
	var got []string
	for _, x := range after {
		o, _ := x.(Obj)
		id, _ := o["id"].(string)
		if !seen[id] {
			v.add("%s: unexpected %s %s", parent, level, show(o["id"]))
			continue
		}
		got = append(got, id)
	}
	if len(got) == len(order) {
		for i := range order {
			if got[i] != order[i] {
				v.add("%s: %s order differs at position %d", parent, level, i)
				break
			}
		}
	}
}

// checkBackgroundKept requires after's tab background to be before's, picture
// field for picture field, plus inherit:true when inactive. A tab without a
// background must not gain one.
func (v *verifier) checkBackgroundKept(what string, before, after Obj, inactive bool) {
	bb, had := before["background"]
	ab, has := after["background"]
	switch {
	case !had && !has:
		return
	case !had:
		v.add("%s: key \"background\" was added", what)
		return
	case !has:
		v.add("%s: key \"background\" was dropped", what)
		return
	}
	want := bb
	if inactive {
		f, err := inheritForm(bb)
		if err != nil {
			v.add("%s: inactive %v", what, err)
			return
		}
		want = f
	}
	wm, wok := want.(Obj)
	am, aok := ab.(Obj)
	if !wok || !aok {
		if show(want) != show(ab) {
			v.add("%s: key \"background\" changed (want %s, got %s)", what, trunc(show(want)), trunc(show(ab)))
		}
		return
	}
	v.sameKeys(what+" background", wm, am)
}

// checkBackground enforces the background shape rules on o's "background"
// (dashboard, tab or folder): absent, or an object whose type is image,
// slideshow or color — or which is the inherit form (inherit: true, type then
// optional but valid if present); opacity a finite number in 0..1; images an
// array of at most MaxBackgroundImages strings.
//
// A slideshow's interval and transitionDuration are deliberately NOT checked
// (Ruling 14): the renderer and the picker clamp them where they are used, and
// rejecting an odd timing value here would block an import or prod's v2→v3
// migration over a cosmetic number. They are kept exactly as stored.
func (v *verifier) checkBackground(where string, o Obj) {
	raw, has := o["background"]
	if !has {
		return
	}
	bg, ok := raw.(Obj)
	if !ok {
		v.add("%s: background is %s, want an object", where, trunc(show(raw)))
		return
	}
	inherit := false
	if iv, has := bg["inherit"]; has {
		b, ok := iv.(bool)
		if !ok {
			v.add("%s: background.inherit is %s, want true or false", where, trunc(show(iv)))
		}
		inherit = b
	}
	tv, hasType := bg["type"]
	if hasType || !inherit {
		if s, _ := tv.(string); !backgroundTypes[s] {
			v.add("%s: background.type is %s, want \"image\", \"slideshow\" or \"color\" (or inherit: true)", where, trunc(show(tv)))
		}
	}
	if ov, has := bg["opacity"]; has {
		f, ok := numberValue(ov)
		if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 1 {
			v.add("%s: background.opacity is %s, want a number from 0 to 1", where, trunc(show(ov)))
		}
	}
	if iv, has := bg["images"]; has {
		imgs, ok := iv.([]any)
		switch {
		case !ok:
			v.add("%s: background.images is %s, want an array of strings", where, trunc(show(iv)))
		case len(imgs) > MaxBackgroundImages:
			v.add("%s: background has %d images (the limit is %d)", where, len(imgs), MaxBackgroundImages)
		default:
			for i, im := range imgs {
				if _, ok := im.(string); !ok {
					v.add("%s: background.images[%d] is %s, want a string", where, i, trunc(show(im)))
				}
			}
		}
	}
}

// numberValue returns x as a float64 if it is a JSON number (or a Go int).
func numberValue(x any) (float64, bool) {
	switch n := x.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// updateBackgroundsOnStartup runs the one-time M4 background update on the
// stored v3 document: if UpdateBackgroundsV4 changes anything it archives the
// raw row (schema 3, notes BackgroundsV4Note), verifies and saves, all in one
// transaction. A document problem is a Failed result with nothing written;
// only DB-level errors are returned as Go errors.
func updateBackgroundsOnStartup(db *sql.DB) (MigrationResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: begin background update: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after Commit

	var raw string
	if err := tx.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&raw); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: read config row: %w", err)
	}
	var doc Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return bgFailed(fmt.Sprintf("stored config is not valid JSON: %v", err)), nil
	}
	if !IsV3(doc) {
		return bgFailed("stored config is not schemaVersion 3"), nil
	}
	out, changed, err := UpdateBackgroundsV4(doc)
	if err != nil {
		return bgFailed(fmt.Sprintf("conversion failed: %v", err)), nil
	}
	if !changed {
		return MigrationResult{}, nil
	}
	if err := VerifyBackgroundsV4(doc, out); err != nil {
		return bgFailed(fmt.Sprintf("verification failed: %v", err)), nil
	}
	if _, err := tx.Exec("INSERT INTO config_archive (schema, data, notes) VALUES (3, ?, ?)", raw, BackgroundsV4Note); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: archive config before background update: %w", err)
	}
	if err := Save(tx, out); err != nil {
		return MigrationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: commit background update: %w", err)
	}
	slog.Info("config backgrounds updated to the M4 form (per-tab switches retired); original archived",
		"component", "configdoc", "notes", BackgroundsV4Note)
	return MigrationResult{BackgroundsUpdated: true}, nil
}

func bgFailed(detail string) MigrationResult {
	detail = "background update failed: " + detail
	slog.Error("config background update FAILED; stored config left untouched", "component", "configdoc", "detail", detail)
	return MigrationResult{Failed: true, Detail: detail}
}
