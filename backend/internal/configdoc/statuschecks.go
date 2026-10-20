package configdoc

import (
	"fmt"
	"log/slog"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// CheckSource names the level whose setting decided a tile's status checks.
type CheckSource string

const (
	SourceGlobal    CheckSource = "global"
	SourceDashboard CheckSource = "dashboard"
	SourceTab       CheckSource = "tab"
	SourceFolder    CheckSource = "folder"
	SourceTile      CheckSource = "tile"
)

// triState reads an optional on/off setting: (value, true) when it is set,
// (false, false) when it inherits (absent or null). A wrong-typed value is
// never written (verify rejects it), so meeting one is unexpected: it
// inherits and is logged at WARN, never silently coerced.
func triState(level string, owner Obj, v any) (bool, bool) {
	switch b := v.(type) {
	case nil:
		return false, false
	case bool:
		return b, true
	}
	id, _ := owner["id"].(string)
	slog.Warn("status-check setting has the wrong type; inheriting",
		"component", "configdoc", "level", level, "id", id, "value", fmt.Sprintf("%v", v))
	return false, false
}

// TileStatusCheck is the tile's own status-check setting: (on, true) when
// statusCheck.enabled is true or false, (false, false) when it inherits.
func TileStatusCheck(tile Obj) (bool, bool) {
	sc, ok := tile["statusCheck"].(Obj)
	if !ok {
		if v := tile["statusCheck"]; v != nil {
			return triState("tile", tile, v) // wrong type: warn, inherit
		}
		return false, false
	}
	return triState("tile", tile, sc["enabled"])
}

// EffectiveStatusChecks resolves whether tile is status-checked: the most
// specific level that sets it wins — the tile, then its folders from the
// innermost out (folderChain is outermost first, as Walk's path), then the
// tab, then the dashboard's override, then the global setting. It returns the
// deciding level and that level's id ("" for the global). Any argument may be
// nil (that level inherits).
func EffectiveStatusChecks(svc *settings.Service, dash, tab Obj, folderChain []Obj, tile Obj) (bool, CheckSource, string) {
	idOf := func(o Obj) string { s, _ := o["id"].(string); return s }
	if on, set := TileStatusCheck(tile); set {
		return on, SourceTile, idOf(tile)
	}
	for i := len(folderChain) - 1; i >= 0; i-- {
		f := folderChain[i]
		if on, set := triState("folder", f, f["statusChecksEnabled"]); set {
			return on, SourceFolder, idOf(f)
		}
	}
	if on, set := triState("tab", tab, tab["statusChecksEnabled"]); set {
		return on, SourceTab, idOf(tab)
	}
	if ov, ok := dash["settings"].(Obj); ok {
		if on, set := triState("dashboard", dash, ov["statusChecksEnabled"]); set {
			return on, SourceDashboard, idOf(dash)
		}
	}
	return svc.GetBool(settings.KeyStatusChecksEnabled), SourceGlobal, ""
}
