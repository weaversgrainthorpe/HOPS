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

// triState reads a tab's, folder's or dashboard's optional on/off setting:
// (value, true) when it is set, (false, false) when it inherits (absent or
// null). A wrong-typed value is never written (verify rejects it), so
// meeting one is unexpected: it inherits and is logged at WARN, never
// silently coerced.
func triState(level string, owner Obj, v any) (bool, bool) {
	switch b := v.(type) {
	case nil:
		return false, false
	case bool:
		return b, true
	}
	warnWrongType(level, owner, v, "inherit")
	return false, false
}

// TileStatusCheck is the tile's own status-check setting (Ruling 12, keeping
// v2.2.1's "status checks only go where you asked them to"):
//   - statusCheck.enabled true or false: (that value, true);
//   - statusCheck.enabled explicitly null: (false, false), i.e. inherit;
//   - no statusCheck, statusCheck null, or enabled absent: (false, true),
//     i.e. off, so a tile nobody asked to check is never checked.
//
// A wrong-typed value is never written (verify rejects it); meeting one is
// unexpected, so it is off (never probe what wasn't asked for) and logged at
// WARN.
func TileStatusCheck(tile Obj) (bool, bool) {
	raw, has := tile["statusCheck"]
	if !has || raw == nil {
		return false, true
	}
	sc, ok := raw.(Obj)
	if !ok {
		warnWrongType("tile", tile, raw, "off")
		return false, true
	}
	v, has := sc["enabled"]
	if !has {
		return false, true
	}
	switch b := v.(type) {
	case nil:
		return false, false
	case bool:
		return b, true
	}
	warnWrongType("tile", tile, v, "off")
	return false, true
}

func warnWrongType(level string, owner Obj, v any, using string) {
	id, _ := owner["id"].(string)
	slog.Warn("status-check setting has the wrong type; using "+using,
		"component", "configdoc", "level", level, "id", id, "value", fmt.Sprintf("%v", v))
}

// EffectiveStatusChecks resolves whether tile is status-checked: the most
// specific level that sets it wins — the tile, then its folders from the
// innermost out (folderChain is outermost first, as Walk's path), then the
// tab, then the dashboard's override, then the global setting. A tile only
// inherits when its statusCheck.enabled is explicitly null (TileStatusCheck);
// an unset tile is off. It returns the deciding level and that level's id
// ("" for the global). dash, tab and folderChain may be nil (that level
// inherits); a nil tile means "no tile level" (e.g. an id not in the config).
func EffectiveStatusChecks(svc *settings.Service, dash, tab Obj, folderChain []Obj, tile Obj) (bool, CheckSource, string) {
	idOf := func(o Obj) string { s, _ := o["id"].(string); return s }
	if tile != nil {
		if on, set := TileStatusCheck(tile); set {
			return on, SourceTile, idOf(tile)
		}
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
