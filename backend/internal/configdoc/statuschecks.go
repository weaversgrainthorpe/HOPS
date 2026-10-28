package configdoc

import (
	"fmt"
	"log/slog"
	"sync"

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
	// SourceInvalid: a level on the tile's path (the tile, a folder or the
	// tab) holds a wrong-typed value. Verify never writes one, so it is
	// unexpected; the tile is off and the response names that level, so the
	// user can see and fix it instead of a value being silently ignored.
	SourceInvalid CheckSource = "invalid"
)

// tri is a decoded layered on/off setting.
type tri int

const (
	triInherit tri = iota
	triOn
	triOff
	triInvalid
)

func containerTri(v any) tri {
	switch b := v.(type) {
	case nil:
		return triInherit
	case bool:
		if b {
			return triOn
		}
		return triOff
	}
	return triInvalid
}

// tileTri is the tile's own setting: statusCheck.enabled true/false is
// on/off; absent or null inherits (no statusCheck, statusCheck null, no
// enabled, or enabled null: the tile follows its folders, tab and dashboard);
// anything else is invalid.
func tileTri(tile Obj) tri {
	raw, has := tile["statusCheck"]
	if !has || raw == nil {
		return triInherit
	}
	sc, ok := raw.(Obj)
	if !ok {
		return triInvalid
	}
	v, has := sc["enabled"]
	if !has {
		return triInherit
	}
	return containerTri(v)
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

// EffectiveStatusChecks resolves whether tile is status-checked: the most
// specific level that sets it wins — the tile, then its folders from the
// innermost out (folderChain is outermost first, as Walk's path), then the
// tab, then the dashboard's override, then the global setting. A tile with
// no setting (absent or null) inherits from the levels above it. If the tile, a folder or the tab holds a wrong-typed value, the tile is
// off with SourceInvalid and that level's id (WARN logged once). It returns
// the deciding level and that level's id ("" for the global). dash, tab and
// folderChain may be nil (that level inherits); a nil tile means "no tile
// level" (e.g. an id not in the config).
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

	if tile != nil {
		switch tileTri(tile) {
		case triOn:
			return true, SourceTile, tileID
		case triOff:
			return false, SourceTile, tileID
		}
	}
	for i := len(folderChain) - 1; i >= 0; i-- {
		switch containerTri(folderChain[i]["statusChecksEnabled"]) {
		case triOn:
			return true, SourceFolder, idOf(folderChain[i])
		case triOff:
			return false, SourceFolder, idOf(folderChain[i])
		}
	}
	switch containerTri(tab["statusChecksEnabled"]) {
	case triOn:
		return true, SourceTab, idOf(tab)
	case triOff:
		return false, SourceTab, idOf(tab)
	}
	// The dashboard override keeps Resolve's handling (a wrong type there
	// falls back to the global with a WARN, as for every dashboard setting).
	if ov, ok := dash["settings"].(Obj); ok {
		switch ov["statusChecksEnabled"].(type) {
		case bool:
			return ov["statusChecksEnabled"].(bool), SourceDashboard, idOf(dash)
		case nil:
		default:
			return Resolve(svc, dash).StatusChecksEnabled, SourceGlobal, ""
		}
	}
	return svc.GetBool(settings.KeyStatusChecksEnabled), SourceGlobal, ""
}
