package database

import (
	"database/sql"
	"fmt"
)

// seedIconData seeds the database with icon categories and generic category icons
// App-specific icons are loaded from dashboard-icons directory by ImportDashboardIcons
func seedIconData(db *sql.DB) error {
	// Check if categories already exist
	var categoryCount int
	err := db.QueryRow("SELECT COUNT(*) FROM icon_categories").Scan(&categoryCount)
	if err != nil {
		return fmt.Errorf("failed to check icon categories: %w", err)
	}

	if categoryCount > 0 {
		// Already seeded
		return nil
	}

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
	}

	for _, cat := range categories {
		_, err := tx.Exec(
			"INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 1)",
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
	}

	for _, icon := range icons {
		_, err := tx.Exec(
			"INSERT INTO icons (id, name, icon, category_id, is_preset) VALUES (?, ?, ?, ?, 1)",
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
