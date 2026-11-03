package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"gopkg.in/yaml.v3"
)

// What the admin chose for each imported dashboard. A dashboard whose name is
// already used gets Replace, Keep both or Skip; any other gets Add or Skip.
const (
	importAdd     = "add"
	importReplace = "replace"
	importKeep    = "keep"
	importSkip    = "skip"
)

// Export types an import reads: one dashboard, every dashboard ("Export all"),
// and the older full export (its dashboards are what is imported).
var importableExportTypes = map[string]bool{"single-dashboard": true, "dashboards": true, "full": true}

// notADashboardFile names a file that is plainly something else (a backup),
// so the refusal says what it is and what was expected. "" when it is not
// recognised here (format detection then decides).
func notADashboardFile(data []byte) string {
	const expected = " Import reads a dashboard export (one dashboard or Export all) or a Homer, Dashy or Heimdall file."
	switch {
	case bytes.HasPrefix(data, []byte("SQLite format 3\x00")):
		return "This file is a HOPS backup (the whole app), not a dashboard export. Restore it in Settings › Backups." + expected
	case bytes.HasPrefix(data, []byte{0x1f, 0x8b}):
		return "This file is a compressed archive, such as a HOPS backup download, not a dashboard export. Restore a backup in Settings › Backups." + expected
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		return "This file is a zip archive, not a dashboard export." + expected
	}
	return ""
}

// exportTypeProblem refuses a HOPS export (JSON or YAML) that is not of a
// type import reads.
func exportTypeProblem(data []byte) string {
	var env struct {
		ExportType *string `json:"exportType" yaml:"exportType"`
	}
	if json.Unmarshal(data, &env) != nil {
		env.ExportType = nil
		if yaml.Unmarshal(data, &env) != nil {
			return "" // unreadable: decoding the envelope says why
		}
	}
	if env.ExportType == nil {
		return "" // no type: the dashboards list decides
	}
	if importableExportTypes[*env.ExportType] {
		return ""
	}
	return fmt.Sprintf("This HOPS file is a %q export, not a dashboard export. Import reads a single-dashboard export or an Export all file.", *env.ExportType)
}

// nameKey is how dashboard names are compared for a clash: case and outer
// spaces don't count.
func nameKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// importRow is one imported dashboard as the admin sees it before choosing.
type importRow struct {
	Index int            `json:"index"`
	Name  string         `json:"name"`
	Path  string         `json:"path"`
	Tabs  int            `json:"tabs"`
	Clash *importClashTo `json:"clash"`
}

// importClashTo is the stored dashboard with the same name.
type importClashTo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

// importRows lists the imported dashboards, each with the stored dashboard
// whose name it matches (the first one, in display order), if any.
func importRows(stored configdoc.Obj, imported []configdoc.Obj) []importRow {
	byName := map[string]configdoc.Obj{}
	existing, _ := stored["dashboards"].([]any)
	for _, e := range existing {
		if em, ok := e.(configdoc.Obj); ok {
			n, _ := em["name"].(string)
			if _, seen := byName[nameKey(n)]; !seen {
				byName[nameKey(n)] = em
			}
		}
	}
	rows := make([]importRow, len(imported))
	for i, d := range imported {
		name, _ := d["name"].(string)
		path, _ := d["path"].(string)
		tabs, _ := d["tabs"].([]any)
		rows[i] = importRow{Index: i, Name: dashboardLabel(d), Path: path, Tabs: len(tabs)}
		if em, ok := byName[nameKey(name)]; ok && name != "" {
			id, _ := em["id"].(string)
			p, _ := em["path"].(string)
			rows[i].Clash = &importClashTo{ID: id, Name: dashboardLabel(em), Path: p}
		}
	}
	return rows
}

// parseImportTargets reads the targets form field sent with choices: for
// each dashboard, the id of the stored dashboard the preview said it clashes
// with ("" for none), so a Replace or Keep both is of the dashboard the
// admin saw, never whichever has that name by the time of the import.
func parseImportTargets(raw string, n int) ([]string, *apiError) {
	if raw == "" {
		return nil, newAPIError(http.StatusBadRequest, "Import refused — the choices came without the targets (the clashes the file was checked against). Check the file again. Nothing was imported.")
	}
	var ts []string
	if err := json.Unmarshal([]byte(raw), &ts); err != nil {
		return nil, newAPIError(http.StatusBadRequest, "Import refused — the targets could not be read: "+err.Error())
	}
	if len(ts) != n {
		return nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Import refused — the file has %d dashboard(s) but %d target(s) were sent. Nothing was imported.", n, len(ts)))
	}
	return ts, nil
}

// parseImportChoices reads the choices form field: a JSON list with one
// choice per imported dashboard, in file order. Absent means the API caller
// made no choices (nil, nil).
func parseImportChoices(raw string, n int) ([]string, *apiError) {
	if raw == "" {
		return nil, nil
	}
	var cs []string
	if err := json.Unmarshal([]byte(raw), &cs); err != nil {
		return nil, newAPIError(http.StatusBadRequest, "Import refused — the choices could not be read: "+err.Error())
	}
	if len(cs) != n {
		return nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Import refused — the file has %d dashboard(s) but %d choice(s) were sent. Nothing was imported.", n, len(cs)))
	}
	for i, c := range cs {
		switch c {
		case importAdd, importReplace, importKeep, importSkip:
		default:
			return nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Import refused — %q is not a choice for dashboard %d (use add, replace, keep or skip). Nothing was imported.", c, i+1))
		}
	}
	return cs, nil
}

// checkChoices makes sure each choice fits the dashboards as stored now: a
// name clash needs Replace, Keep both or Skip, anything else Add or Skip, and
// the clash must be with the stored dashboard the preview showed (targets).
// A mismatch means the dashboards changed since the file was checked (409).
func checkChoices(rows []importRow, cs, targets []string) *apiError {
	replacing := map[string]string{}
	for i, row := range rows {
		c := cs[i]
		if row.Clash != nil && c == importAdd {
			return newAPIError(http.StatusConflict, fmt.Sprintf("Import refused — a dashboard called %q already exists. Choose Replace, Keep both or Skip for it. Nothing was imported.", row.Clash.Name))
		}
		if row.Clash == nil && (c == importReplace || c == importKeep) {
			return newAPIError(http.StatusConflict, fmt.Sprintf("Import refused — no dashboard is called %q any more, so it can't be replaced or kept alongside. Check the file again. Nothing was imported.", row.Name))
		}
		now := ""
		if row.Clash != nil {
			now = row.Clash.ID
		}
		if c != importSkip && now != targets[i] {
			return newAPIError(http.StatusConflict, fmt.Sprintf("Import refused — the dashboard %q clashes with is not the one it did when the file was checked (it was changed or replaced since). Please check the file again. Nothing was imported.", row.Name))
		}
		if c == importReplace {
			if other, dup := replacing[row.Clash.ID]; dup {
				return newAPIError(http.StatusBadRequest, fmt.Sprintf("Import refused — %q and %q in the file would both replace %q. Choose Replace for one only. Nothing was imported.", other, row.Name, row.Clash.Name))
			}
			replacing[row.Clash.ID] = row.Name
		}
	}
	return nil
}

// keepBothNames gives each Keep both row its new name: the next free number
// against the stored names and every name the import itself will store (the
// Add and Replace rows, whatever their place in the file), so it never
// depends on file order and never repeats a name.
func keepBothNames(stored configdoc.Obj, imported []configdoc.Obj, cs []string) map[int]string {
	taken := map[string]bool{}
	existing, _ := stored["dashboards"].([]any)
	for _, e := range existing {
		if em, ok := e.(configdoc.Obj); ok {
			n, _ := em["name"].(string)
			taken[nameKey(n)] = true
		}
	}
	for i, d := range imported {
		if cs[i] == importAdd || cs[i] == importReplace {
			taken[nameKey(dashboardLabel(d))] = true
		}
	}
	out := map[int]string{}
	for i, d := range imported {
		if cs[i] == importKeep {
			name := nextFreeName(dashboardLabel(d), taken)
			taken[nameKey(name)] = true
			out[i] = name
		}
	}
	return out
}

// checkImportChoices runs every refusal the choices can bring against the
// stored document: the clashes and targets, and the length of each Keep both
// name. It runs before the pre-import backup (so a refused import takes none)
// and again inside the write, against the document as it is then.
func checkImportChoices(stored configdoc.Obj, imported []configdoc.Obj, cs, targets []string) ([]importRow, map[int]string, *apiError) {
	rows := importRows(stored, imported)
	if ae := checkChoices(rows, cs, targets); ae != nil {
		return nil, nil, ae
	}
	names := keepBothNames(stored, imported, cs)
	for i, name := range names {
		if utf8.RuneCountInString(name) > maxDashboardNameRunes {
			return nil, nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Import refused — Keep both would name the copy of %q %q, which is longer than %d characters. Choose Replace or Skip for it. Nothing was imported.", dashboardLabel(imported[i]), name, maxDashboardNameRunes))
		}
	}
	return rows, names, nil
}

// assetsOnlyFor returns importedConfig with its embedded pictures (and the
// list of pictures the export could not read) narrowed to those the given
// dashboards use, so a skipped dashboard's pictures are not restored.
func assetsOnlyFor(importedConfig configdoc.Obj, dashboards []configdoc.Obj) configdoc.Obj {
	list := make([]any, len(dashboards))
	for i, d := range dashboards {
		list[i] = d
	}
	used := map[string]bool{}
	for _, ref := range collectLocalAssetRefs(configdoc.Obj{"dashboards": list}) {
		used[ref] = true
	}
	out := configdoc.Obj{}
	for k, v := range importedConfig {
		out[k] = v
	}
	if assets, ok := importedConfig["assets"].(map[string]interface{}); ok {
		kept := map[string]interface{}{}
		for k, v := range assets {
			if used[k] {
				kept[k] = v
			}
		}
		out["assets"] = kept
	}
	if missing, ok := importedConfig[missingAssetsKey].([]interface{}); ok {
		kept := []interface{}{}
		for _, m := range missing {
			mm, _ := m.(map[string]interface{})
			if p, _ := mm["path"].(string); p == "" || used[p] {
				kept = append(kept, m) // a malformed entry is still reported
			}
		}
		out[missingAssetsKey] = kept
	}
	return out
}

// nextFreeName is name with the next free number, "Home (2)", "Home (3)", …
func nextFreeName(name string, taken map[string]bool) string {
	for n := 2; ; n++ {
		cand := fmt.Sprintf("%s (%d)", name, n)
		if !taken[nameKey(cand)] {
			return cand
		}
	}
}

// freshIDs gives the dashboard, its tabs and every folder and tile a new
// random id, for a Keep both copy that shares nothing with the original.
func freshIDs(d configdoc.Obj) *apiError {
	set := func(o configdoc.Obj, kind string) *apiError {
		id, ae := newNodeID(kind)
		if ae != nil {
			return ae
		}
		o["id"] = id
		return nil
	}
	if ae := set(d, "dashboard"); ae != nil {
		return ae
	}
	tabs, _ := d["tabs"].([]any)
	for _, t := range tabs {
		if tm, ok := t.(configdoc.Obj); ok {
			if ae := set(tm, "tab"); ae != nil {
				return ae
			}
		}
	}
	var failed *apiError
	configdoc.Walk(configdoc.Obj{"dashboards": []any{d}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
		kind, _ := n["kind"].(string)
		if kind == "" {
			kind = "node"
		}
		if ae := set(n, kind); ae != nil {
			failed = ae
			return false
		}
		return true
	})
	return failed
}

// importSummary is what an import did, for the result the admin sees.
type importSummary struct {
	Added    []string        `json:"added"`
	Replaced []string        `json:"replaced"`
	Renamed  []importRenamed `json:"renamed"`
	Skipped  []string        `json:"skipped"`
}

type importRenamed struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func newImportSummary() importSummary {
	return importSummary{Added: []string{}, Replaced: []string{}, Renamed: []importRenamed{}, Skipped: []string{}}
}

// line is the summary in one sentence.
func (s importSummary) line() string {
	var parts []string
	if len(s.Added) > 0 {
		parts = append(parts, fmt.Sprintf("added %s", strings.Join(quoted(s.Added), ", ")))
	}
	if len(s.Replaced) > 0 {
		parts = append(parts, fmt.Sprintf("replaced %s", strings.Join(quoted(s.Replaced), ", ")))
	}
	for _, r := range s.Renamed {
		parts = append(parts, fmt.Sprintf("kept both, the new one is %q", r.To))
	}
	if len(s.Skipped) > 0 {
		parts = append(parts, fmt.Sprintf("skipped %s", strings.Join(quoted(s.Skipped), ", ")))
	}
	if len(parts) == 0 {
		return "Nothing was imported"
	}
	line := strings.Join(parts, "; ")
	return strings.ToUpper(line[:1]) + line[1:]
}

func quoted(ss []string) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = fmt.Sprintf("%q", s)
	}
	return out
}
