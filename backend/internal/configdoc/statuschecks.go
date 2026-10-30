package configdoc

import (
	"fmt"
	"log/slog"
	"sync"

	"github.com/weaversgrainthorpe/HOPS/internal/settings"
)

// CheckSource names the level that decided a tile's status checks: the
// outermost Disabled gate when one stops the tile, otherwise the tile itself.
type CheckSource string

const (
	SourceGlobal    CheckSource = "global"
	SourceDashboard CheckSource = "dashboard"
	SourceTab       CheckSource = "tab"
	SourceFolder    CheckSource = "folder"
	SourceTile      CheckSource = "tile"
	// SourceInvalid: a level on the tile's path (the tile, a folder or the
	// tab) holds a wrong-typed value. Verify never writes one, so it is
	// unexpected; the tile is off and the response names that level, so the
	// user can see and fix it instead of a value being silently ignored.
	SourceInvalid CheckSource = "invalid"
)

// tri is a decoded on/off value; triInvalid is a wrong type.
type tri int

const (
	triAbsent tri = iota
	triOn
	triOff
	triInvalid
)

func containerTri(v any) tri {
	switch b := v.(type) {
	case nil:
		return triAbsent
	case bool:
		if b {
			return triOn
		}
		return triOff
	}
	return triInvalid
}

// tileTri is the tile's own setting: statusCheck.enabled true is On; false,
// null or absent (no statusCheck, statusCheck null, no enabled) is Off;
// anything else is invalid.
func tileTri(tile Obj) tri {
	raw, has := tile["statusCheck"]
	if !has || raw == nil {
		return triAbsent
	}
	sc, ok := raw.(Obj)
	if !ok {
		return triInvalid
	}
	v, has := sc["enabled"]
	if !has {
		return triAbsent
	}
	return containerTri(v)
}

// IsCheckableTile reports whether a tile could ever be probed: not a note,
// and with a non-empty URL. The checker skips every other tile whatever its
// setting, so the frontend's isCheckableTile twin (the Blocked status checks
// report) skips them too.
func IsCheckableTile(tile Obj) bool {
	if t, _ := tile["type"].(string); t == "note" {
		return false
	}
	u, _ := tile["url"].(string)
	return u != ""
}

// invalidWarned de-duplicates the invalid-value WARN: once per (tile, level)
// per process, not on every checker pass or status request.
var invalidWarned sync.Map

func warnInvalid(tileID, level, levelID string, v any) {
	if _, seen := invalidWarned.LoadOrStore(tileID+"\x00"+level+"\x00"+levelID, true); seen {
		return
	}
	slog.Warn("status-check setting has the wrong type; the tile is not checked (source \"invalid\")",
		"component", "configdoc", "tile", tileID, "level", level, "id", levelID, "value", fmt.Sprintf("%v", v))
}

// EffectiveStatusChecks resolves whether tile is status-checked: only when
// the tile itself is On and every gate on its path is Enabled — the global
// setting, the dashboard, the tab and the folders (folderChain is outermost
// first, as Walk's path). A gate is Disabled only by an explicit false; null
// or absent is Enabled. A tile is On only by statusCheck.enabled true.
//
// When a gate stops the tile it returns false with the OUTERMOST Disabled gate
// (global, dashboard, tab, then folders outermost first) and that gate's id
// ("" for the global). Otherwise it returns the tile's own state with
// SourceTile and the tile's id. If the tile, a folder or the tab holds a
// wrong-typed value, the tile is off with SourceInvalid and that level's id
// (WARN logged once). dash, tab and folderChain may be nil (an Enabled level);
// a nil tile means "no tile level" (e.g. an id not in the config): only the
// gates are consulted and an open path reports true with SourceGlobal.
func EffectiveStatusChecks(svc *settings.Service, dash, tab Obj, folderChain []Obj, tile Obj) (bool, CheckSource, string) {
	idOf := func(o Obj) string { s, _ := o["id"].(string); return s }
	tileID := idOf(tile)

	// Any invalid value on the path makes the tile off, most specific first.
	if tile != nil && tileTri(tile) == triInvalid {
		warnInvalid(tileID, "tile", tileID, tile["statusCheck"])
		return false, SourceInvalid, tileID
	}
	for i := len(folderChain) - 1; i >= 0; i-- {
		if v := folderChain[i]["statusChecksEnabled"]; containerTri(v) == triInvalid {
			warnInvalid(tileID, "folder", idOf(folderChain[i]), v)
			return false, SourceInvalid, idOf(folderChain[i])
		}
	}
	if v := tab["statusChecksEnabled"]; containerTri(v) == triInvalid {
		warnInvalid(tileID, "tab", idOf(tab), v)
		return false, SourceInvalid, idOf(tab)
	}

	// Gates, outermost first.
	if !svc.GetBool(settings.KeyStatusChecksEnabled) {
		return false, SourceGlobal, ""
	}
	if ov, ok := dash["settings"].(Obj); ok {
		switch ov["statusChecksEnabled"].(type) {
		case bool:
			if !ov["statusChecksEnabled"].(bool) {
				return false, SourceDashboard, idOf(dash)
			}
		case nil:
		default:
			// A wrong type here reads as Enabled, as for every dashboard
			// setting; logged once per dashboard, not on every pass.
			if _, seen := invalidWarned.LoadOrStore("\x00dashboard\x00"+idOf(dash), true); !seen {
				slog.Warn("dashboard status-check gate has the wrong type; read as Enabled",
					"component", "configdoc", "dashboard", idOf(dash), "value", fmt.Sprintf("%v", ov["statusChecksEnabled"]))
			}
		}
	}
	if containerTri(tab["statusChecksEnabled"]) == triOff {
		return false, SourceTab, idOf(tab)
	}
	for _, f := range folderChain {
		if containerTri(f["statusChecksEnabled"]) == triOff {
			return false, SourceFolder, idOf(f)
		}
	}
	if tile == nil {
		return true, SourceGlobal, ""
	}
	return tileTri(tile) == triOn, SourceTile, tileID
}
