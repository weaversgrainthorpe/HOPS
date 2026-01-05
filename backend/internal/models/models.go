package models

import "time"

// Dashboard represents a complete dashboard configuration
type Dashboard struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Path       string       `json:"path"`
	Background *Background  `json:"background,omitempty"`
	Tabs       []Tab        `json:"tabs"`
	Order      int          `json:"order"`
}

// Tab represents a tab within a dashboard
type Tab struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Icon       string      `json:"icon,omitempty"`
	IconURL    string      `json:"iconUrl,omitempty"`
	Background *Background `json:"background,omitempty"`
	Color      string      `json:"color,omitempty"`
	Opacity    float64     `json:"opacity,omitempty"`
	TextColor  string      `json:"textColor,omitempty"`
	Groups     []Group     `json:"groups"`
	Order      int         `json:"order"`
}

// Group represents a collapsible group of entries
type Group struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Icon         string  `json:"icon,omitempty"`
	IconURL      string  `json:"iconUrl,omitempty"`
	Collapsed    bool    `json:"collapsed"`
	Color        string  `json:"color,omitempty"`
	Opacity      float64 `json:"opacity,omitempty"`
	TextColor    string  `json:"textColor,omitempty"`
	DisplayStyle string  `json:"displayStyle,omitempty"`
	Entries      []Entry `json:"entries"`
	Order        int     `json:"order"`
}

// Entry represents a tile/link on the dashboard
type Entry struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	URL         string       `json:"url"`
	Icon        string       `json:"icon"`
	IconURL     string       `json:"iconUrl,omitempty"`
	Description string       `json:"description,omitempty"`
	OpenMode    string       `json:"openMode"` // iframe, newtab, sametab, modal
	StatusCheck *StatusCheck `json:"statusCheck,omitempty"`
	Size        string       `json:"size"` // small, medium, large
	Order       int          `json:"order"`
}

// Background configuration
type Background struct {
	Type     string   `json:"type"` // image, slideshow, color
	Value    string   `json:"value,omitempty"`
	Images   []string `json:"images,omitempty"`
	Interval int      `json:"interval,omitempty"` // seconds for slideshow
}

// StatusCheck configuration
type StatusCheck struct {
	Type     string `json:"type"` // http, icmp
	Enabled  bool   `json:"enabled"`
	Interval int    `json:"interval"` // seconds
}

// StatusResult represents the result of a status check
type StatusResult struct {
	EntryID      string    `json:"entryId"`
	Status       string    `json:"status"` // online, offline, unknown
	ResponseTime int       `json:"responseTime,omitempty"`
	LastChecked  time.Time `json:"lastChecked"`
}

// Config represents the complete application configuration
type Config struct {
	Dashboards []Dashboard `json:"dashboards"`
	Theme      Theme       `json:"theme"`
	Settings   Settings    `json:"settings"`
}

// Theme configuration
type Theme struct {
	Mode      string `json:"mode"` // light, dark, auto
	CustomCSS string `json:"customCss,omitempty"`
}

// Settings for global application settings
type Settings struct {
	SearchHotkey string `json:"searchHotkey"` // default: "/"
	DefaultView  string `json:"defaultView"`  // default dashboard path
}

// User represents an admin user
type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Session represents an authenticated session
type Session struct {
	ID        string    `json:"id"`
	UserID    int       `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

// Widget represents a dashboard widget
type Widget struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"` // weather, calendar, stats, custom, etc.
	Config   map[string]interface{} `json:"config"`
	Position Position               `json:"position"`
}

// Position for widget placement
type Position struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// IconCategory represents a category for organizing icons
type IconCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Icon      string    `json:"icon"`
	OrderNum  int       `json:"order"`
	IsPreset  bool      `json:"isPreset"`
	CreatedAt time.Time `json:"createdAt"`
}

// Icon represents an icon in the library
type Icon struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Icon       string    `json:"icon"`
	CategoryID string    `json:"categoryId"`
	Color      *string   `json:"color,omitempty"`
	IsPreset   bool      `json:"isPreset"`
	CreatedAt  time.Time `json:"createdAt"`
}
