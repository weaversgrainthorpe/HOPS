package converters

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
	"github.com/weaversgrainthorpe/HOPS/internal/models"
)

// The sample files in testdata/ are Homer's and Dashy's own published example configs, a
// homelab-style config for each written in the forms their users actually have, and a Heimdall
// export in the shape Heimdall's own API produces.

func convertFixture(t *testing.T, name string, conv func([]byte) ([]byte, []string, error)) (models.Dashboard, []string) {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	out, notes, err := conv(data)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var cfg struct {
		Dashboards []models.Dashboard `json:"dashboards"`
	}
	if err := json.Unmarshal(out, &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Dashboards) != 1 || len(cfg.Dashboards[0].Tabs) != 1 {
		t.Fatalf("%s: want 1 dashboard with 1 tab, got %+v", name, cfg.Dashboards)
	}
	return cfg.Dashboards[0], notes
}

func folderNamed(t *testing.T, d models.Dashboard, name string) models.Group {
	t.Helper()
	for _, g := range d.Tabs[0].Groups {
		if g.Name == name {
			return g
		}
	}
	t.Fatalf("no folder %q in %q", name, d.Name)
	return models.Group{}
}

func tileNamed(t *testing.T, g models.Group, name string) models.Entry {
	t.Helper()
	for _, e := range g.Entries {
		if e.Name == name {
			return e
		}
	}
	t.Fatalf("no tile %q in folder %q", name, g.Name)
	return models.Entry{}
}

func notesContain(t *testing.T, notes []string, want ...string) {
	t.Helper()
	all := strings.Join(notes, "\n")
	for _, w := range want {
		if !strings.Contains(all, w) {
			t.Errorf("notes lack %q:\n%s", w, all)
		}
	}
}

func TestConvertIcon(t *testing.T) {
	cases := []struct {
		in, icon, url string
		usable        bool
	}{
		{"", genericIcon, "", true},
		{"mdi:home", "mdi:home", "", true},
		{"simple-icons:github", "simple-icons:github", "", true},
		{"si:github", "simple-icons:github", "", true},
		{"mdi-home-assistant", "mdi:home-assistant", "", true},
		{"si-github", "simple-icons:github", "", true},
		{"hl-plex", "", "/api/icons/dashboard/plex.svg", true},
		{"hl-no-such-app-xyz", genericIcon, "", false},
		{"https://cdn.example/x.svg", "", "https://cdn.example/x.svg", true},
		{"fas fa-film", genericIcon, "", false},
		{"fa-solid fa-download", genericIcon, "", false},
		{"fab fa-github", genericIcon, "", false},
		{"fa fa-grin", genericIcon, "", false},
		{"favicon", genericIcon, "", false},
		{"🐍", genericIcon, "", false},
		{"assets/tools/sonarr.png", genericIcon, "", false},
		{"fa:film", genericIcon, "", false}, // an Iconify set HOPS doesn't ship
	}
	for _, c := range cases {
		icon, url, usable := convertIcon(c.in)
		if icon != c.icon || url != c.url || usable != c.usable {
			t.Errorf("convertIcon(%q) = %q, %q, %v; want %q, %q, %v", c.in, icon, url, usable, c.icon, c.url, c.usable)
		}
	}
}

func TestHomerUpstreamExample(t *testing.T) {
	d, notes := convertFixture(t, "homer-upstream.yml", ConvertFromHomer)
	if d.Name != "Demo dashboard" {
		t.Errorf("name %q", d.Name)
	}
	g := folderNamed(t, d, "Applications")
	if len(g.Entries) != 5 {
		t.Fatalf("tiles %d", len(g.Entries))
	}
	for _, e := range g.Entries {
		if strings.Contains(e.Icon, "fa-") {
			t.Errorf("%q kept a Font Awesome icon HOPS can't draw: %q", e.Name, e.Icon)
		}
	}
	notesContain(t, notes, "5 icon(s)", "Get started")
}

func TestHomerHomelab(t *testing.T) {
	d, notes := convertFixture(t, "homer-homelab.yml", ConvertFromHomer)
	media := folderNamed(t, d, "Media")
	if e := tileNamed(t, media, "Jellyfin"); e.IconURL != "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png" || e.OpenMode != "newtab" {
		t.Errorf("Jellyfin logo/target: %+v", e)
	}
	if e := tileNamed(t, media, "Sonarr"); e.Icon != genericIcon || e.IconURL != "" {
		t.Errorf("Sonarr's relative logo can't be fetched: want the generic icon, got %+v", e)
	}
	if e := tileNamed(t, media, "Radarr"); e.Icon != genericIcon {
		t.Errorf("Radarr: %q", e.Icon)
	}
	// A group with no name gets one.
	tileNamed(t, folderNamed(t, d, "Services"), "No-group item")
	notesContain(t, notes, "Sonarr", "Radarr", "Pi-hole", "Grafana")
}

func TestDashyUpstreamExample(t *testing.T) {
	d, notes := convertFixture(t, "dashy-upstream.yml", ConvertFromDashy)
	if e := tileNamed(t, folderNamed(t, d, "Getting Started"), "GitHub"); e.Icon != "simple-icons:github" {
		t.Errorf("si-github: %q", e.Icon)
	}
	tileNamed(t, folderNamed(t, d, "Support Dashy"), "Sponsor")
	for _, g := range d.Tabs[0].Groups {
		if g.Name == "Latest Updates" {
			t.Error("a widgets-only section became an empty folder")
		}
	}
	notesContain(t, notes, "widget", "Latest Updates", "Support Dashy")
}

func TestDashyHomelab(t *testing.T) {
	d, notes := convertFixture(t, "dashy-homelab.yml", ConvertFromDashy)
	media := folderNamed(t, d, "Media")
	if e := tileNamed(t, media, "Plex"); e.IconURL != "/api/icons/dashboard/plex.svg" {
		t.Errorf("hl-plex: %+v", e)
	}
	if e := tileNamed(t, media, "Radarr"); e.OpenMode != "sametab" || !strings.HasSuffix(e.IconURL, "radarr.svg") {
		t.Errorf("Radarr: %+v", e)
	}
	net := folderNamed(t, d, "Network")
	if e := tileNamed(t, net, "Pi-hole"); e.Icon != "simple-icons:pihole" {
		t.Errorf("si-pihole: %q", e.Icon)
	}
	if e := tileNamed(t, net, "Home Assistant"); e.Icon != "mdi:home-assistant" || e.OpenMode != "newtab" {
		t.Errorf("Home Assistant: %+v", e)
	}
	if e := tileNamed(t, net, "Router"); e.Icon != genericIcon || e.OpenMode != "newtab" {
		t.Errorf("Router: %+v", e)
	}
	notesContain(t, notes, "Sonarr", "Router", "Snake", "Home Assistant (workspace)", "Router (modal)")
}

func TestHeimdallExport(t *testing.T) {
	d, notes := convertFixture(t, "heimdall-export.json", ConvertFromHeimdall)
	media := folderNamed(t, d, "Media")
	if len(media.Entries) != 2 {
		t.Errorf("Media tiles: %d", len(media.Entries))
	}
	if e := tileNamed(t, media, "Sonarr"); e.Color != "#2193b5" || strings.Contains(e.Description, "apikey") {
		t.Errorf("Sonarr colour/description: %+v", e)
	}
	infra := folderNamed(t, d, "Infrastructure")
	tileNamed(t, infra, "Proxmox")
	tileNamed(t, infra, "Pi-hole") // its first tag
	tileNamed(t, folderNamed(t, d, "Services"), "Wiki")
	notesContain(t, notes, "Pi-hole")
}

// Spec Part A: an imported dashboard's tiles inherit (statusCheck.enabled is
// an explicit null), and keep inheriting through the v2->v3 conversion, which
// pins only tiles without that null to Off.
func TestImportedTilesInherit(t *testing.T) {
	cases := map[string]func([]byte) ([]byte, []string, error){
		"homer-upstream.yml":   ConvertFromHomer,
		"homer-homelab.yml":    ConvertFromHomer,
		"dashy-upstream.yml":   ConvertFromDashy,
		"dashy-homelab.yml":    ConvertFromDashy,
		"heimdall-export.json": ConvertFromHeimdall,
	}
	inherits := func(sc any) bool {
		m, ok := sc.(map[string]any)
		v, has := m["enabled"]
		return ok && len(m) == 1 && has && v == nil
	}
	for name, conv := range cases {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile("testdata/" + name)
			if err != nil {
				t.Fatal(err)
			}
			out, _, err := conv(data)
			if err != nil {
				t.Fatal(err)
			}
			var cfg struct {
				Dashboards []configdoc.Obj `json:"dashboards"`
			}
			if err := json.Unmarshal(out, &cfg); err != nil {
				t.Fatal(err)
			}
			tiles := 0
			for _, tb := range cfg.Dashboards[0]["tabs"].([]any) {
				for _, g := range tb.(map[string]any)["groups"].([]any) {
					for _, e := range g.(map[string]any)["entries"].([]any) {
						tiles++
						em := e.(map[string]any)
						if !inherits(em["statusCheck"]) {
							t.Errorf("converted tile %v: statusCheck %v, want {enabled: null}", em["id"], em["statusCheck"])
						}
					}
				}
			}
			if tiles == 0 {
				t.Fatal("sample has no tiles")
			}
			v3, _, err := configdoc.ConvertDashboardV2Full(cfg.Dashboards[0])
			if err != nil {
				t.Fatal(err)
			}
			seen := 0
			configdoc.Walk(configdoc.Obj{"dashboards": []any{v3}}, func(_, _ configdoc.Obj, _ []configdoc.Obj, n configdoc.Obj) bool {
				if n["kind"] == "tile" {
					seen++
					if !inherits(n["statusCheck"]) {
						t.Errorf("v3 tile %v: statusCheck %v, want {enabled: null}", n["id"], n["statusCheck"])
					}
				}
				return true
			})
			if seen != tiles {
				t.Errorf("v3 has %d tiles, want %d", seen, tiles)
			}
		})
	}
}
