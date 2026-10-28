package converters

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"

	"github.com/weaversgrainthorpe/HOPS/internal/assets"
	"github.com/weaversgrainthorpe/HOPS/internal/models"
	"gopkg.in/yaml.v3"
)

// Each ConvertFrom* returns the HOPS v2-shaped config (the import brings it to v3) and notes:
// one line per kind of thing in the file that could not be carried over, naming the tiles or
// sections, so an import never loses anything silently.

// genericIcon is the placeholder for a tile with no usable icon; the import's icon matching
// replaces it with one matched by the tile's name where it can.
const genericIcon = "mdi:application"

// HomerConfig represents Homer dashboard config structure
type HomerConfig struct {
	Title    string         `yaml:"title"`
	Subtitle string         `yaml:"subtitle"`
	Services []HomerService `yaml:"services"`
}

type HomerService struct {
	Name  string      `yaml:"name"`
	Icon  string      `yaml:"icon"`
	Items []HomerItem `yaml:"items"`
}

type HomerItem struct {
	Name     string `yaml:"name"`
	Logo     string `yaml:"logo"`
	Icon     string `yaml:"icon"`
	Subtitle string `yaml:"subtitle"`
	Tag      string `yaml:"tag"`
	URL      string `yaml:"url"`
	Target   string `yaml:"target"`
}

// DashyConfig represents Dashy dashboard config structure
type DashyConfig struct {
	PageInfo PageInfo       `yaml:"pageInfo"`
	Pages    []DashyPage    `yaml:"pages"`
	Sections []DashySection `yaml:"sections"`
}

type DashyPage struct {
	Name string `yaml:"name"`
	Path string `yaml:"path"`
}

type PageInfo struct {
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	NavLinks    []struct {
		Title string `yaml:"title"`
		Path  string `yaml:"path"`
	} `yaml:"navLinks"`
}

type DashySection struct {
	Name        string        `yaml:"name"`
	Icon        string        `yaml:"icon"`
	DisplayData interface{}   `yaml:"displayData"`
	Items       []DashyItem   `yaml:"items"`
	Widgets     []interface{} `yaml:"widgets"`
}

type DashyItem struct {
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Icon        string   `yaml:"icon"`
	URL         string   `yaml:"url"`
	Target      string   `yaml:"target"`
	Tags        []string `yaml:"tags"`
}

// convertIcon turns another dashboard's icon reference into HOPS's (icon, iconURL); usable is
// false when the reference can't be drawn by HOPS (Font Awesome, emoji, "favicon", an image path
// on the old dashboard's own server, an icon set HOPS doesn't ship) and the generic icon stands in.
func convertIcon(ref string) (icon, iconURL string, usable bool) {
	ref = strings.TrimSpace(ref)
	switch {
	case ref == "":
		return genericIcon, "", true
	case strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://"):
		return "", ref, true
	case strings.HasPrefix(ref, "mdi:"), strings.HasPrefix(ref, "simple-icons:"):
		return ref, "", true
	case strings.HasPrefix(ref, "si:"):
		return "simple-icons:" + strings.TrimPrefix(ref, "si:"), "", true
	case strings.HasPrefix(ref, "mdi-"):
		return "mdi:" + strings.TrimPrefix(ref, "mdi-"), "", true
	case strings.HasPrefix(ref, "si-"):
		return "simple-icons:" + strings.TrimPrefix(ref, "si-"), "", true
	case strings.HasPrefix(ref, "hl-"):
		// Dashy's homelab icons are the dashboard-icons set HOPS packages.
		name := strings.ToLower(strings.TrimPrefix(ref, "hl-"))
		if _, err := fs.Stat(assets.DashboardIcons, "dashboard-icons/"+name+".svg"); err == nil {
			return "", "/api/icons/dashboard/" + name + ".svg", true
		}
	}
	return genericIcon, "", false
}

// noteList is "a, b and 3 more" for a note.
func noteList(names []string) string {
	const max = 8
	if len(names) <= max {
		return strings.Join(names, ", ")
	}
	return fmt.Sprintf("%s and %d more", strings.Join(names[:max], ", "), len(names)-max)
}

func iconNote(lost []string) []string {
	if len(lost) == 0 {
		return nil
	}
	return []string{fmt.Sprintf("%d icon(s) couldn't be carried over (Font Awesome, emoji, \"favicon\", or an image stored on the old dashboard's own server); those tiles got an icon matched by name, or the generic one: %s", len(lost), noteList(lost))}
}

// ConvertFromHomer converts Homer config to HOPS format
func ConvertFromHomer(yamlData []byte) ([]byte, []string, error) {
	if err := CheckImportLimits(yamlData); err != nil {
		return nil, nil, err
	}
	var homer HomerConfig
	if err := yaml.Unmarshal(yamlData, &homer); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Homer config: %w", err)
	}

	name := strings.TrimSpace(homer.Title)
	if name == "" {
		name = "Homer Import"
	}
	dashboard := models.Dashboard{ID: "home", Name: name, Path: "/home", Tabs: make([]models.Tab, 0)}
	tab := models.Tab{ID: "main", Name: "Main", Groups: make([]models.Group, 0)}

	var lostIcons []string
	for i, service := range homer.Services {
		gname := strings.TrimSpace(service.Name)
		if gname == "" {
			gname = "Services" // Homer allows a group with only items
		}
		group := models.Group{ID: fmt.Sprintf("group-%d", i), Name: gname, Order: i, Entries: make([]models.Entry, 0)}
		for j, item := range service.Items {
			// Homer shows the logo when there is one, else the icon.
			icon, iconURL, usable := "", "", false
			if item.Logo != "" {
				icon, iconURL, usable = convertIcon(item.Logo)
			}
			if !usable && item.Icon != "" {
				icon, iconURL, usable = convertIcon(item.Icon)
			}
			if !usable && item.Logo == "" && item.Icon == "" {
				icon, usable = genericIcon, true
			}
			if !usable {
				lostIcons = append(lostIcons, item.Name)
			}
			openMode := "newtab"
			if item.Target == "_self" {
				openMode = "sametab"
			}
			group.Entries = append(group.Entries, models.Entry{
				ID: fmt.Sprintf("entry-%d-%d", i, j), Name: item.Name, Description: item.Subtitle,
				URL: item.URL, Icon: icon, IconURL: iconURL, OpenMode: openMode, Size: "medium", Order: j,
			})
		}
		tab.Groups = append(tab.Groups, group)
	}
	dashboard.Tabs = append(dashboard.Tabs, tab)
	out, err := json.Marshal(map[string]interface{}{"dashboards": []models.Dashboard{dashboard}})
	return out, iconNote(lostIcons), err
}

// ConvertFromDashy converts Dashy config to HOPS format
func ConvertFromDashy(yamlData []byte) ([]byte, []string, error) {
	if err := CheckImportLimits(yamlData); err != nil {
		return nil, nil, err
	}
	var dashy DashyConfig
	if err := yaml.Unmarshal(yamlData, &dashy); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Dashy config: %w", err)
	}

	name := strings.TrimSpace(dashy.PageInfo.Title)
	if name == "" {
		name = "Dashy Import"
	}
	dashboard := models.Dashboard{ID: "home", Name: name, Path: "/home", Tabs: make([]models.Tab, 0)}
	tab := models.Tab{ID: "main", Name: "Main", Groups: make([]models.Group, 0)}

	var lostIcons, otherTargets, widgetSections []string
	for i, section := range dashy.Sections {
		if len(section.Widgets) > 0 {
			widgetSections = append(widgetSections, section.Name)
		}
		if len(section.Items) == 0 {
			continue // a widgets-only section: nothing HOPS can show
		}
		group := models.Group{ID: fmt.Sprintf("group-%d", i), Name: section.Name, Order: i, Entries: make([]models.Entry, 0)}
		for j, item := range section.Items {
			icon, iconURL, usable := convertIcon(item.Icon)
			if !usable {
				lostIcons = append(lostIcons, item.Title)
			}
			openMode := "newtab"
			switch item.Target {
			case "", "newtab":
			case "sametab":
				openMode = "sametab"
			default: // modal, workspace, clipboard, top, parent
				otherTargets = append(otherTargets, fmt.Sprintf("%s (%s)", item.Title, item.Target))
			}
			group.Entries = append(group.Entries, models.Entry{
				ID: fmt.Sprintf("entry-%d-%d", i, j), Name: item.Title, Description: item.Description,
				URL: item.URL, Icon: icon, IconURL: iconURL, OpenMode: openMode, Size: "medium", Order: j,
			})
		}
		tab.Groups = append(tab.Groups, group)
	}
	dashboard.Tabs = append(dashboard.Tabs, tab)

	notes := iconNote(lostIcons)
	if len(widgetSections) > 0 {
		notes = append(notes, fmt.Sprintf("Dashy widgets aren't supported, so the widgets in these sections were left out (a section with only widgets is not imported): %s", noteList(widgetSections)))
	}
	if len(otherTargets) > 0 {
		notes = append(notes, fmt.Sprintf("These items opened another way in Dashy and now open in a new tab: %s", noteList(otherTargets)))
	}
	if len(dashy.Pages) > 0 {
		var pages []string
		for _, p := range dashy.Pages {
			pages = append(pages, p.Name)
		}
		notes = append(notes, fmt.Sprintf("This config links %d other Dashy page(s), which live in their own files; import each of those to bring them in: %s", len(pages), noteList(pages)))
	}
	out, err := json.Marshal(map[string]interface{}{"dashboards": []models.Dashboard{dashboard}})
	return out, notes, err
}

// HeimdallItem is one app in a Heimdall export (Heimdall's /api/item list).
type HeimdallItem struct {
	Title          string   `json:"title"`
	Colour         string   `json:"colour"`
	URL            string   `json:"url"`
	Description    *string  `json:"description"`
	AppID          string   `json:"appid"`
	AppDescription *string  `json:"appdescription"`
	Tags           []string `json:"tags"`
}

// ConvertFromHeimdall converts a Heimdall export to HOPS format: each tag (Heimdall's
// grouping) becomes a folder, untagged apps go in "Services", and each app keeps its colour.
func ConvertFromHeimdall(jsonData []byte) ([]byte, []string, error) {
	if err := CheckImportLimits(jsonData); err != nil {
		return nil, nil, err
	}
	var items []HeimdallItem
	if err := json.Unmarshal(jsonData, &items); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Heimdall config: %w", err)
	}

	dashboard := models.Dashboard{ID: "heimdall", Name: "Heimdall Import", Path: "/heimdall", Tabs: make([]models.Tab, 0)}
	tab := models.Tab{ID: "main", Name: "Main", Groups: make([]models.Group, 0)}
	groupIdx := map[string]int{}
	var multiTag []string

	for i, item := range items {
		// The description holds an enhanced app's settings (JSON, with API keys): never imported.
		description := ""
		if item.AppDescription != nil && *item.AppDescription != "" {
			description = *item.AppDescription
		} else if item.Description != nil && len(*item.Description) > 0 && (*item.Description)[0] != '{' {
			description = *item.Description
		}
		folder := "Services"
		for _, tg := range item.Tags {
			if strings.TrimSpace(tg) != "" {
				folder = strings.TrimSpace(tg)
				break
			}
		}
		if len(item.Tags) > 1 {
			multiTag = append(multiTag, fmt.Sprintf("%s (in %s)", item.Title, folder))
		}
		gi, ok := groupIdx[folder]
		if !ok {
			gi = len(tab.Groups)
			groupIdx[folder] = gi
			tab.Groups = append(tab.Groups, models.Group{ID: fmt.Sprintf("group-%d", gi), Name: folder, Order: gi, Entries: make([]models.Entry, 0)})
		}
		g := &tab.Groups[gi]
		color := ""
		if strings.HasPrefix(item.Colour, "#") {
			color = item.Colour
		}
		g.Entries = append(g.Entries, models.Entry{
			ID: fmt.Sprintf("entry-%d", i), Name: item.Title, Description: description, URL: item.URL,
			Icon: genericIcon, Color: color, OpenMode: "newtab", Size: "medium", Order: len(g.Entries),
		})
	}
	dashboard.Tabs = append(dashboard.Tabs, tab)

	var notes []string
	if len(multiTag) > 0 {
		notes = append(notes, fmt.Sprintf("Apps with several tags are placed in their first tag's folder only: %s", noteList(multiTag)))
	}
	out, err := json.Marshal(map[string]interface{}{"dashboards": []models.Dashboard{dashboard}})
	return out, notes, err
}

// DetectFormat attempts to detect the dashboard format
func DetectFormat(data []byte) (string, error) {
	// Size and depth caps (and YAML alias bombs) are refused before any
	// decode into Go values.
	if err := CheckImportLimits(data); err != nil {
		return "", err
	}
	// A v3 export envelope as JSON (checked first: YAML rejects tab indentation).
	var envMap map[string]interface{}
	if err := json.Unmarshal(data, &envMap); err == nil &&
		envMap["format"] == "hops-export" && isVersion3(envMap["schemaVersion"]) {
		return "hops-v3", nil
	}

	// Try to parse as YAML first (JSON is a subset, so this covers both
	// encodings of a v3 export envelope).
	var yamlMap map[string]interface{}
	if err := yaml.Unmarshal(data, &yamlMap); err == nil {
		// v3 export envelope: {format: hops-export, schemaVersion: 3, config}.
		if yamlMap["format"] == "hops-export" && isVersion3(yamlMap["schemaVersion"]) {
			return "hops-v3", nil
		}
		// Check for Homer-specific fields
		if _, hasServices := yamlMap["services"]; hasServices {
			return "homer", nil
		}

		// Check for Dashy-specific fields
		if _, hasSections := yamlMap["sections"]; hasSections {
			return "dashy", nil
		}
	}

	// Try to parse as JSON object (HOPS format)
	var jsonMap map[string]interface{}
	if err := json.Unmarshal(data, &jsonMap); err == nil {
		// Check for HOPS format
		if _, hasDashboards := jsonMap["dashboards"]; hasDashboards {
			return "hops", nil
		}
	}

	// Try to parse as JSON array (Heimdall format)
	var jsonArray []map[string]interface{}
	if err := json.Unmarshal(data, &jsonArray); err == nil {
		// Check if it looks like Heimdall (has title, url, colour fields)
		if len(jsonArray) > 0 {
			first := jsonArray[0]
			if _, hasTitle := first["title"]; hasTitle {
				if _, hasURL := first["url"]; hasURL {
					return "heimdall", nil
				}
			}
		}
	}

	return "", fmt.Errorf("unknown dashboard format")
}

// isVersion3 reports whether a decoded schemaVersion value is 3 (YAML decodes
// it as int, JSON as float64).
func isVersion3(v interface{}) bool {
	switch n := v.(type) {
	case int:
		return n == 3
	case float64:
		return n == 3
	}
	return false
}
