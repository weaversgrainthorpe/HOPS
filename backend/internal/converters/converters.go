package converters

import (
	"encoding/json"
	"fmt"

	"github.com/jmagar/hops/internal/models"
	"gopkg.in/yaml.v3"
)

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
	Sections []DashySection `yaml:"sections"`
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
	Name        string      `yaml:"name"`
	Icon        string      `yaml:"icon"`
	DisplayData interface{} `yaml:"displayData"`
	Items       []DashyItem `yaml:"items"`
}

type DashyItem struct {
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Icon        string `yaml:"icon"`
	URL         string `yaml:"url"`
	Target      string `yaml:"target"`
	Tags        []string `yaml:"tags"`
}

// ConvertFromHomer converts Homer config to HOPS format
func ConvertFromHomer(yamlData []byte) ([]byte, error) {
	var homer HomerConfig
	if err := yaml.Unmarshal(yamlData, &homer); err != nil {
		return nil, fmt.Errorf("failed to parse Homer config: %w", err)
	}

	// Create HOPS dashboard structure
	dashboard := models.Dashboard{
		ID:    "home",
		Name:  homer.Title,
		Path:  "/home",
		Order: 0,
		Tabs:  make([]models.Tab, 0),
	}

	// Create a single tab with all services as groups
	tab := models.Tab{
		ID:     "main",
		Name:   "Main",
		Order:  0,
		Groups: make([]models.Group, 0),
	}

	// Convert each Homer service to a HOPS group
	for i, service := range homer.Services {
		group := models.Group{
			ID:        fmt.Sprintf("group-%d", i),
			Name:      service.Name,
			Collapsed: false,
			Order:     i,
			Entries:   make([]models.Entry, 0),
		}

		// Convert each item to an entry
		for j, item := range service.Items {
			icon := item.Icon
			if icon == "" && item.Logo != "" {
				// Try to extract icon from logo URL
				icon = "mdi:application"
			}

			entry := models.Entry{
				ID:          fmt.Sprintf("entry-%d-%d", i, j),
				Name:        item.Name,
				Description: item.Subtitle,
				URL:         item.URL,
				Icon:        icon,
				OpenMode:    "newtab",
				Size:        "medium",
				Order:       j,
			}

			group.Entries = append(group.Entries, entry)
		}

		tab.Groups = append(tab.Groups, group)
	}

	dashboard.Tabs = append(dashboard.Tabs, tab)

	// Create final config
	config := map[string]interface{}{
		"dashboards": []models.Dashboard{dashboard},
	}

	return json.Marshal(config)
}

// ConvertFromDashy converts Dashy config to HOPS format
func ConvertFromDashy(yamlData []byte) ([]byte, error) {
	var dashy DashyConfig
	if err := yaml.Unmarshal(yamlData, &dashy); err != nil {
		return nil, fmt.Errorf("failed to parse Dashy config: %w", err)
	}

	// Create HOPS dashboard structure
	dashboard := models.Dashboard{
		ID:    "home",
		Name:  dashy.PageInfo.Title,
		Path:  "/home",
		Order: 0,
		Tabs:  make([]models.Tab, 0),
	}

	// Create a single tab with all sections as groups
	tab := models.Tab{
		ID:     "main",
		Name:   "Main",
		Order:  0,
		Groups: make([]models.Group, 0),
	}

	// Convert each Dashy section to a HOPS group
	for i, section := range dashy.Sections {
		group := models.Group{
			ID:        fmt.Sprintf("group-%d", i),
			Name:      section.Name,
			Collapsed: false,
			Order:     i,
			Entries:   make([]models.Entry, 0),
		}

		// Convert each item to an entry
		for j, item := range section.Items {
			entry := models.Entry{
				ID:          fmt.Sprintf("entry-%d-%d", i, j),
				Name:        item.Title,
				Description: item.Description,
				URL:         item.URL,
				Icon:        convertDashyIcon(item.Icon),
				OpenMode:    "newtab",
				Size:        "medium",
				Order:       j,
			}

			group.Entries = append(group.Entries, entry)
		}

		tab.Groups = append(tab.Groups, group)
	}

	dashboard.Tabs = append(dashboard.Tabs, tab)

	// Create final config
	config := map[string]interface{}{
		"dashboards": []models.Dashboard{dashboard},
	}

	return json.Marshal(config)
}

// convertDashyIcon converts Dashy icon format to Iconify format
func convertDashyIcon(icon string) string {
	if icon == "" {
		return "mdi:application"
	}

	// Dashy uses various icon formats:
	// - "fas fa-rocket" -> Font Awesome
	// - "hl-plex" -> Homer/Dashy custom
	// - URL to image

	// For now, default to mdi icons
	// TODO: Implement more sophisticated icon mapping
	return "mdi:application"
}

// HeimdallItem represents a Heimdall dashboard item
type HeimdallItem struct {
	Title          string  `json:"title"`
	Colour         string  `json:"colour"`
	URL            string  `json:"url"`
	Description    *string `json:"description"`
	AppID          string  `json:"appid"`
	AppDescription *string `json:"appdescription"`
}

// ConvertFromHeimdall converts Heimdall JSON export to HOPS format
func ConvertFromHeimdall(jsonData []byte) ([]byte, error) {
	var items []HeimdallItem
	if err := json.Unmarshal(jsonData, &items); err != nil {
		return nil, fmt.Errorf("failed to parse Heimdall config: %w", err)
	}

	// Create HOPS dashboard structure
	dashboard := models.Dashboard{
		ID:    "heimdall",
		Name:  "Heimdall Import",
		Path:  "/heimdall",
		Order: 0,
		Tabs:  make([]models.Tab, 0),
	}

	// Create a single tab with a single group containing all items
	tab := models.Tab{
		ID:     "main",
		Name:   "Main",
		Order:  0,
		Groups: make([]models.Group, 0),
	}

	group := models.Group{
		ID:        "services",
		Name:      "Services",
		Collapsed: false,
		Order:     0,
		Entries:   make([]models.Entry, 0),
	}

	// Convert each Heimdall item to a HOPS entry
	for i, item := range items {
		// Try to get description from appdescription or description field
		description := ""
		if item.AppDescription != nil && *item.AppDescription != "" {
			description = *item.AppDescription
		} else if item.Description != nil {
			// Heimdall stores config in description field as JSON, skip that
			if len(*item.Description) > 0 && (*item.Description)[0] != '{' {
				description = *item.Description
			}
		}

		entry := models.Entry{
			ID:          fmt.Sprintf("entry-%d", i),
			Name:        item.Title,
			Description: description,
			URL:         item.URL,
			Icon:        "mdi:application",
			OpenMode:    "newtab",
			Size:        "medium",
			Order:       i,
		}

		group.Entries = append(group.Entries, entry)
	}

	tab.Groups = append(tab.Groups, group)
	dashboard.Tabs = append(dashboard.Tabs, tab)

	// Create final config
	config := map[string]interface{}{
		"dashboards": []models.Dashboard{dashboard},
	}

	return json.Marshal(config)
}

// DetectFormat attempts to detect the dashboard format
func DetectFormat(data []byte) (string, error) {
	// Try to parse as YAML first
	var yamlMap map[string]interface{}
	if err := yaml.Unmarshal(data, &yamlMap); err == nil {
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
