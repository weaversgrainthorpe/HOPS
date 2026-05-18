package database

import (
	"database/sql"
	"fmt"
)

// seedIconData seeds the database with icon categories and generic category icons.
// App-specific icons are loaded from dashboard-icons directory by ImportDashboardIcons.
//
// This is idempotent: each row is INSERT OR IGNORE'd by primary key (id), so re-running
// on an existing install will pick up newly-added bundled icons without touching the
// user's existing entries or duplicating anything. This is what lets us ship new
// bundled icons in patch releases without a migration step.
func seedIconData(db *sql.DB) error {
	// Begin transaction for seeding
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Seed categories
	categories := []struct {
		ID    string
		Name  string
		Icon  string
		Order int
	}{
		{"containers", "Containers", "mdi:docker", 0},
		{"media", "Media & Streaming", "mdi:play-circle", 1},
		{"downloads", "Downloads", "mdi:download", 2},
		{"monitoring", "Monitoring", "mdi:chart-line", 3},
		{"storage", "Storage & Cloud", "mdi:cloud", 4},
		{"networking", "Networking", "mdi:network", 5},
		{"databases", "Databases", "mdi:database", 6},
		{"development", "Development", "mdi:code-tags", 7},
		{"communication", "Communication", "mdi:forum", 8},
		{"automation", "Automation", "mdi:home-automation", 9},
		{"os", "Operating Systems", "mdi:desktop-tower", 10},
		{"security", "Security", "mdi:shield-lock", 11},
		{"cloud", "Cloud Providers", "mdi:cloud-outline", 12},
		{"hardware", "Hardware", "mdi:chip", 13},
		{"virtualization", "Virtualization", "mdi:server", 14},
		{"audio", "Audio", "mdi:waveform", 15},
		{"cameras", "Cameras & Surveillance", "mdi:cctv", 16},
		{"sensors", "Smart Home & Sensors", "mdi:home-thermometer", 17},
	}

	for _, cat := range categories {
		_, err := tx.Exec(
			"INSERT OR IGNORE INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 1)",
			cat.ID, cat.Name, cat.Icon, cat.Order,
		)
		if err != nil {
			return fmt.Errorf("failed to insert category %s: %w", cat.ID, err)
		}
	}

	// Seed ONLY generic category icons (fallback icons for each category)
	// App-specific icons come from dashboard-icons directory
	icons := []struct {
		ID       string
		Name     string
		Icon     string
		Category string
	}{
		// Generic category icons - these serve as fallbacks and category representatives
		{"containers-generic", "Container", "mdi:package-variant-closed", "containers"},
		{"media-generic", "Media", "mdi:filmstrip", "media"},
		{"media-play", "Media Player", "mdi:play-circle", "media"},
		{"media-library", "Media Library", "mdi:movie-open", "media"},
		{"downloads-generic", "Downloads", "mdi:download", "downloads"},
		{"downloads-arrow", "Download Arrow", "mdi:arrow-down-bold-circle", "downloads"},
		{"monitoring-generic", "Monitoring", "mdi:chart-line", "monitoring"},
		{"monitoring-pulse", "Pulse", "mdi:pulse", "monitoring"},
		{"monitoring-gauge", "Gauge", "mdi:gauge", "monitoring"},
		{"monitoring-eye", "Eye Monitor", "mdi:eye", "monitoring"},
		{"storage-generic", "Storage", "mdi:nas", "storage"},
		{"storage-hdd", "Hard Drive", "mdi:harddisk", "storage"},
		{"storage-folder", "Folder Network", "mdi:folder-network", "storage"},
		{"storage-database", "Database Storage", "mdi:database", "storage"},
		{"networking-generic", "Network", "mdi:network", "networking"},
		{"networking-lan", "LAN", "mdi:lan", "networking"},
		{"networking-router", "Router", "mdi:router", "networking"},
		{"networking-ethernet", "Ethernet", "mdi:ethernet", "networking"},
		{"networking-wifi", "WiFi", "mdi:wifi", "networking"},
		{"networking-firewall", "Firewall", "mdi:wall-fire", "networking"},
		{"networking-switch", "Network Switch", "mdi:switch", "networking"},
		{"networking-vpn", "VPN", "mdi:vpn", "networking"},
		{"databases-generic", "Database", "mdi:database", "databases"},
		{"databases-server", "Database Server", "mdi:database-cog", "databases"},
		{"databases-sql", "SQL", "mdi:database-search", "databases"},
		{"databases-nosql", "NoSQL", "mdi:database-marker", "databases"},
		{"development-generic", "Development", "mdi:code-tags", "development"},
		{"development-code", "Code", "mdi:code-braces", "development"},
		{"development-terminal", "Terminal", "mdi:console", "development"},
		{"development-git", "Git", "mdi:git", "development"},
		{"development-api", "API", "mdi:api", "development"},
		{"communication-generic", "Communication", "mdi:forum", "communication"},
		{"communication-chat", "Chat", "mdi:chat", "communication"},
		{"communication-message", "Message", "mdi:message", "communication"},
		{"communication-email", "Email", "mdi:email", "communication"},
		{"communication-video", "Video Call", "mdi:video", "communication"},
		{"automation-generic", "Automation", "mdi:home-automation", "automation"},
		{"automation-robot", "Robot", "mdi:robot", "automation"},
		{"automation-workflow", "Workflow", "mdi:workflow", "automation"},
		{"automation-script", "Script", "mdi:script-text", "automation"},
		{"os-generic", "Operating System", "mdi:desktop-tower", "os"},
		{"os-linux", "Linux", "mdi:linux", "os"},
		{"os-windows", "Windows", "mdi:microsoft-windows", "os"},
		{"os-apple", "Apple", "mdi:apple", "os"},
		{"os-server", "Server OS", "mdi:server", "os"},
		{"security-generic", "Security", "mdi:shield-lock", "security"},
		{"security-key", "Key", "mdi:key", "security"},
		{"security-password", "Password", "mdi:form-textbox-password", "security"},
		{"security-lock", "Lock", "mdi:lock", "security"},
		{"security-auth", "Authentication", "mdi:account-key", "security"},
		{"cloud-generic", "Cloud", "mdi:cloud", "cloud"},
		{"cloud-server", "Cloud Server", "mdi:cloud-outline", "cloud"},
		{"cloud-upload", "Cloud Upload", "mdi:cloud-upload", "cloud"},
		{"cloud-download", "Cloud Download", "mdi:cloud-download", "cloud"},
		{"cloud-sync", "Cloud Sync", "mdi:cloud-sync", "cloud"},
		{"hardware-generic", "Hardware", "mdi:chip", "hardware"},
		{"hardware-cpu", "CPU", "mdi:cpu-64-bit", "hardware"},
		{"hardware-memory", "Memory", "mdi:memory", "hardware"},
		{"hardware-ssd", "SSD", "mdi:harddisk", "hardware"},
		{"hardware-gpu", "GPU", "mdi:expansion-card", "hardware"},
		{"hardware-server", "Server Hardware", "mdi:server", "hardware"},
		{"virtualization-generic", "Virtualization", "mdi:server-network", "virtualization"},
		{"virtualization-vm", "Virtual Machine", "mdi:virtual-server", "virtualization"},
		{"virtualization-hypervisor", "Hypervisor", "mdi:layers", "virtualization"},
		{"virtualization-cluster", "Cluster", "mdi:server-network-outline", "virtualization"},

		// Audio - speakers, microphones, music, soundwaves
		{"audio-waveform", "Soundwave", "mdi:waveform", "audio"},
		{"audio-sine-wave", "Sine Wave", "mdi:sine-wave", "audio"},
		{"audio-ear", "Ear", "mdi:ear-hearing", "audio"},
		{"audio-music", "Music", "mdi:music", "audio"},
		{"audio-music-note", "Music Note", "mdi:music-note", "audio"},
		{"audio-music-circle", "Music Circle", "mdi:music-circle", "audio"},
		{"audio-music-clef-treble", "Treble Clef", "mdi:music-clef-treble", "audio"},
		{"audio-album", "Album", "mdi:album", "audio"},
		{"audio-playlist", "Playlist", "mdi:playlist-music", "audio"},
		{"audio-podcast", "Podcast", "mdi:podcast", "audio"},
		{"audio-radio", "Radio", "mdi:radio", "audio"},
		{"audio-radio-tower", "Radio Tower", "mdi:radio-tower", "audio"},
		{"audio-speaker", "Speaker", "mdi:speaker", "audio"},
		{"audio-speaker-wireless", "Wireless Speaker", "mdi:speaker-wireless", "audio"},
		{"audio-speaker-multiple", "Multi-Room Speakers", "mdi:speaker-multiple", "audio"},
		{"audio-microphone", "Microphone", "mdi:microphone", "audio"},
		{"audio-microphone-variant", "Microphone Variant", "mdi:microphone-variant", "audio"},
		{"audio-headphones", "Headphones", "mdi:headphones", "audio"},
		{"audio-headset", "Headset", "mdi:headset", "audio"},
		{"audio-volume-high", "Volume High", "mdi:volume-high", "audio"},
		{"audio-volume-medium", "Volume Medium", "mdi:volume-medium", "audio"},
		{"audio-volume-low", "Volume Low", "mdi:volume-low", "audio"},
		{"audio-volume-mute", "Volume Mute", "mdi:volume-mute", "audio"},
		{"audio-equalizer", "Equalizer", "mdi:equalizer", "audio"},
		{"audio-surround-sound", "Surround Sound", "mdi:surround-sound", "audio"},
		{"audio-bluetooth", "Bluetooth Audio", "mdi:bluetooth-audio", "audio"},
		{"audio-cast", "Cast Audio", "mdi:cast-audio", "audio"},
		{"audio-cassette", "Cassette", "mdi:cassette", "audio"},
		{"audio-metronome", "Metronome", "mdi:metronome", "audio"},
		{"audio-record-player", "Record Player", "mdi:record-player", "audio"},

		// Cameras & Surveillance - CCTV, NVR, security cameras, motion
		{"cameras-cctv", "CCTV Camera", "mdi:cctv", "cameras"},
		{"cameras-cctv-off", "CCTV Off", "mdi:cctv-off", "cameras"},
		{"cameras-video", "Video", "mdi:video", "cameras"},
		{"cameras-video-outline", "Video Outline", "mdi:video-outline", "cameras"},
		{"cameras-video-wireless", "Wireless Camera", "mdi:video-wireless", "cameras"},
		{"cameras-camera", "Camera", "mdi:camera", "cameras"},
		{"cameras-camera-outline", "Camera Outline", "mdi:camera-outline", "cameras"},
		{"cameras-camera-iris", "Camera Iris", "mdi:camera-iris", "cameras"},
		{"cameras-camera-front", "Front Camera", "mdi:camera-front", "cameras"},
		{"cameras-camera-rear", "Rear Camera", "mdi:camera-rear", "cameras"},
		{"cameras-doorbell", "Doorbell", "mdi:doorbell", "cameras"},
		{"cameras-doorbell-video", "Video Doorbell", "mdi:doorbell-video", "cameras"},
		{"cameras-webcam", "Webcam", "mdi:webcam", "cameras"},
		{"cameras-motion-sensor", "Motion Sensor", "mdi:motion-sensor", "cameras"},
		{"cameras-eye", "Eye / Watching", "mdi:eye", "cameras"},
		{"cameras-eye-outline", "Eye Outline", "mdi:eye-outline", "cameras"},
		{"cameras-eye-circle", "Eye Circle", "mdi:eye-circle", "cameras"},
		{"cameras-monitor", "Monitor", "mdi:monitor", "cameras"},
		{"cameras-monitor-multiple", "Multi-Monitor", "mdi:monitor-multiple", "cameras"},
		{"cameras-monitor-eye", "Monitor Eye", "mdi:monitor-eye", "cameras"},
		{"cameras-account-eye", "Watching Account", "mdi:account-eye", "cameras"},
		{"cameras-shield-account", "Shielded Account", "mdi:shield-account", "cameras"},
		{"cameras-shield-search", "Security Search", "mdi:shield-search", "cameras"},
		{"cameras-record-rec", "Recording", "mdi:record-rec", "cameras"},
		{"cameras-video-vintage", "Vintage Video", "mdi:video-vintage", "cameras"},
		{"cameras-image", "Image", "mdi:image", "cameras"},
		{"cameras-image-multiple", "Multiple Images", "mdi:image-multiple", "cameras"},
		{"cameras-alarm-light", "Alarm Light", "mdi:alarm-light", "cameras"},
		{"cameras-radar", "Radar", "mdi:radar", "cameras"},
		{"cameras-magnify-scan", "Scan", "mdi:magnify-scan", "cameras"},

		// Smart Home & Sensors - lights, switches, thermostats, doors, windows, env sensors
		{"sensors-thermometer", "Thermometer", "mdi:thermometer", "sensors"},
		{"sensors-thermostat", "Thermostat", "mdi:thermostat", "sensors"},
		{"sensors-thermostat-box", "Thermostat Box", "mdi:thermostat-box", "sensors"},
		{"sensors-home-thermometer", "Home Thermometer", "mdi:home-thermometer", "sensors"},
		{"sensors-lightbulb", "Lightbulb", "mdi:lightbulb", "sensors"},
		{"sensors-lightbulb-on", "Light On", "mdi:lightbulb-on", "sensors"},
		{"sensors-lightbulb-off", "Light Off", "mdi:lightbulb-off", "sensors"},
		{"sensors-light-switch", "Light Switch", "mdi:light-switch", "sensors"},
		{"sensors-toggle-switch", "Toggle Switch", "mdi:toggle-switch", "sensors"},
		{"sensors-ceiling-light", "Ceiling Light", "mdi:ceiling-light", "sensors"},
		{"sensors-lamp", "Lamp", "mdi:lamp", "sensors"},
		{"sensors-motion-sensor", "Motion Sensor", "mdi:motion-sensor", "sensors"},
		{"sensors-door", "Door (closed)", "mdi:door", "sensors"},
		{"sensors-door-open", "Door (open)", "mdi:door-open", "sensors"},
		{"sensors-window-closed", "Window (closed)", "mdi:window-closed", "sensors"},
		{"sensors-window-open", "Window (open)", "mdi:window-open", "sensors"},
		{"sensors-garage", "Garage", "mdi:garage", "sensors"},
		{"sensors-water", "Water", "mdi:water", "sensors"},
		{"sensors-water-percent", "Humidity / Water %", "mdi:water-percent", "sensors"},
		{"sensors-water-pump", "Water Pump", "mdi:water-pump", "sensors"},
		{"sensors-fire", "Fire", "mdi:fire", "sensors"},
		{"sensors-smoke-detector", "Smoke Detector", "mdi:smoke-detector", "sensors"},
		{"sensors-gas-cylinder", "Gas", "mdi:gas-cylinder", "sensors"},
		{"sensors-fan", "Fan", "mdi:fan", "sensors"},
		{"sensors-air-conditioner", "Air Conditioner", "mdi:air-conditioner", "sensors"},
		{"sensors-radiator", "Radiator", "mdi:radiator", "sensors"},
		{"sensors-blinds", "Blinds", "mdi:blinds", "sensors"},
		{"sensors-power-plug", "Power Plug", "mdi:power-plug", "sensors"},
		{"sensors-leaf", "Leaf / Eco", "mdi:leaf", "sensors"},
		{"sensors-weather-sunny", "Sunny", "mdi:weather-sunny", "sensors"},
	}

	for _, icon := range icons {
		_, err := tx.Exec(
			"INSERT OR IGNORE INTO icons (id, name, icon, category_id, is_preset) VALUES (?, ?, ?, ?, 1)",
			icon.ID, icon.Name, icon.Icon, icon.Category,
		)
		if err != nil {
			return fmt.Errorf("failed to insert icon %s: %w", icon.ID, err)
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit icon seed data: %w", err)
	}

	return nil
}
