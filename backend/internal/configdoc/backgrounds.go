package configdoc

import (
	"fmt"
	"math"
)

// M4 background form (design §3, §4a call 5). A dashboard, tab or folder
// "background" is absent (inherit), or an object that is either a picture
// ({type: image|slideshow|color, …}) or the inherit form ({inherit: true,
// …stored picture fields}), which keeps a switched-off picture so it is never
// lost. v2 stored instead a dashboard "perTabBackgrounds" switch (and some
// builds a tab "backgroundEnabled" mirror); the v2→v3 converter retires both
// into this form (convert.go).
const (
	legacyPerTabKey  = "perTabBackgrounds"
	legacyEnabledKey = "backgroundEnabled"
	// MaxBackgroundImages bounds a background's slideshow list.
	MaxBackgroundImages = 200
)

// backgroundTypes are the picture kinds a background may carry.
var backgroundTypes = map[string]bool{"image": true, "slideshow": true, "color": true}

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
