package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// CategoryKeywords maps category IDs to keywords for matching icon names
var CategoryKeywords = map[string][]string{
	"containers":     {"docker", "container", "kubernetes", "k8s", "k3s", "podman", "portainer", "rancher", "nomad", "swarm", "helm", "compose", "lxc", "lxd"},
	"media":          {"plex", "jellyfin", "emby", "kodi", "sonarr", "radarr", "lidarr", "bazarr", "tautulli", "overseerr", "ombi", "audiobookshelf", "navidrome", "music", "video", "stream", "media", "tv", "movie", "photo", "image", "gallery", "immich", "photoprism", "kavita", "stash", "youtube", "spotify", "netflix", "twitch"},
	"downloads":      {"torrent", "qbittorrent", "deluge", "transmission", "nzbget", "sabnzbd", "usenet", "download", "prowlarr", "jackett", "flaresolverr", "autobrr", "readarr", "whisparr", "mylar", "medusa", "sickgear", "rutorrent", "aria"},
	"monitoring":     {"grafana", "prometheus", "monitor", "alert", "metric", "log", "uptime", "kuma", "netdata", "zabbix", "nagios", "datadog", "elastic", "kibana", "splunk", "influx", "telegraf", "glances", "healthcheck", "statping", "gatus"},
	"storage":        {"nextcloud", "owncloud", "seafile", "syncthing", "storage", "backup", "nas", "minio", "s3", "ceph", "gluster", "duplicati", "restic", "borg", "kopia", "rclone", "filebrowser", "paperless", "calibre", "komga", "tandoor", "mealie", "grocy", "homebox"},
	"networking":     {"nginx", "traefik", "caddy", "haproxy", "proxy", "dns", "vpn", "wireguard", "openvpn", "tailscale", "zerotier", "cloudflare", "pihole", "adguard", "network", "firewall", "pfsense", "opnsense", "router", "unifi", "ubiquiti", "mikrotik", "cisco"},
	"databases":      {"postgres", "mysql", "mariadb", "mongo", "redis", "database", "db", "sql", "sqlite", "cassandra", "couchdb", "elasticsearch", "clickhouse", "timescale", "oracle", "mssql"},
	"development":    {"github", "gitlab", "gitea", "git", "code", "dev", "ci", "cd", "jenkins", "drone", "argo", "harbor", "npm", "yarn", "webpack", "vscode", "ide", "docker-registry", "sonar", "nexus", "artifactory"},
	"communication":  {"chat", "message", "mail", "email", "discord", "slack", "telegram", "matrix", "rocket", "mattermost", "teams", "zoom", "gotify", "ntfy", "pushover", "apprise", "smtp", "imap"},
	"automation":     {"homeassistant", "home-assistant", "nodered", "node-red", "n8n", "mqtt", "zigbee", "zwave", "esphome", "tasmota", "homebridge", "openhab", "domoticz", "frigate", "scrypted", "automation", "iot", "smart", "hass"},
	"os":             {"ubuntu", "debian", "fedora", "centos", "redhat", "arch", "linux", "windows", "macos", "freebsd", "alpine", "truenas", "openmediavault", "os", "operating"},
	"security":       {"auth", "vault", "bitwarden", "keepass", "password", "security", "encrypt", "ssl", "tls", "cert", "letsencrypt", "authelia", "keycloak", "crowdsec", "fail2ban", "2fa", "totp"},
	"cloud":          {"aws", "azure", "gcp", "google-cloud", "digitalocean", "linode", "vultr", "hetzner", "ovh", "cloud", "serverless", "lambda", "terraform", "ansible", "pulumi"},
	"hardware":       {"intel", "amd", "nvidia", "raspberry", "pi", "hp", "dell", "lenovo", "asus", "synology", "qnap", "cpu", "gpu", "hardware"},
	"virtualization": {"proxmox", "vmware", "esxi", "virtualbox", "kvm", "qemu", "hyper-v", "xen", "virtual", "vm", "hypervisor", "virt"},
}

// SpecificApps maps specific icon names to categories (overrides keyword matching)
var SpecificApps = map[string]string{
	// Automation (home automation that might otherwise match other categories)
	"home-assistant": "automation",
	"homeassistant":  "automation",
	"node-red":       "automation",
	"nodered":        "automation",
	"n8n":            "automation",
	"frigate":        "automation",
	"scrypted":       "automation",
	"double-take":    "automation",
	"compreface":     "automation",
	"zigbee2mqtt":    "automation",
	"zwave-js-ui":    "automation",
	"esphome":        "automation",
	"tasmota":        "automation",
	"homebridge":     "automation",
	"openhab":        "automation",
	"domoticz":       "automation",
	"hass":           "automation",

	// Media
	"plex":           "media",
	"jellyfin":       "media",
	"emby":           "media",
	"sonarr":         "media",
	"radarr":         "media",
	"lidarr":         "media",
	"bazarr":         "media",
	"tautulli":       "media",
	"overseerr":      "media",
	"ombi":           "media",
	"audiobookshelf": "media",
	"navidrome":      "media",
	"kavita":         "media",
	"stash":          "media",
	"immich":         "media",
	"photoprism":     "media",

	// Downloads
	"qbittorrent":   "downloads",
	"deluge":        "downloads",
	"transmission":  "downloads",
	"prowlarr":      "downloads",
	"jackett":       "downloads",
	"flaresolverr":  "downloads",
	"readarr":       "downloads",
	"whisparr":      "downloads",
	"nzbget":        "downloads",
	"sabnzbd":       "downloads",
	"rutorrent":     "downloads",
	"autobrr":       "downloads",

	// Networking
	"nginx":        "networking",
	"traefik":      "networking",
	"caddy":        "networking",
	"pihole":       "networking",
	"adguard-home": "networking",
	"adguard":      "networking",
	"pfsense":      "networking",
	"opnsense":     "networking",
	"unifi":        "networking",
	"wireguard":    "networking",
	"tailscale":    "networking",
	"zerotier":     "networking",
	"cloudflare":   "networking",
	"cloudflared":  "networking",

	// Containers
	"docker":    "containers",
	"portainer": "containers",
	"rancher":   "containers",
	"kubernetes": "containers",

	// Security
	"vaultwarden": "security",
	"bitwarden":   "security",
	"authelia":    "security",
	"keycloak":    "security",
	"crowdsec":    "security",

	// Virtualization
	"proxmox":    "virtualization",
	"vmware":     "virtualization",
	"virtualbox": "virtualization",

	// Monitoring
	"grafana":    "monitoring",
	"prometheus": "monitoring",
	"uptime-kuma": "monitoring",
	"netdata":    "monitoring",

	// Storage
	"nextcloud":   "storage",
	"paperless":   "storage",
	"paperless-ngx": "storage",
	"filebrowser": "storage",
}

// ImportDashboardIcons imports all SVG icons from the dashboard-icons directory
func ImportDashboardIcons(db *sql.DB, dataDir string) error {
	iconsDir := filepath.Join(dataDir, "icons", "dashboard-icons")

	// Check if directory exists
	if _, err := os.Stat(iconsDir); os.IsNotExist(err) {
		log.Printf("[Icons] Dashboard icons directory not found: %s", iconsDir)
		return nil // Not an error - just skip if not present
	}

	// Check if dashboard icons have already been imported
	var dashboardIconCount int
	err := db.QueryRow("SELECT COUNT(*) FROM icons WHERE image_url LIKE '/api/icons/dashboard/%'").Scan(&dashboardIconCount)
	if err != nil {
		return fmt.Errorf("failed to check dashboard icons: %w", err)
	}

	if dashboardIconCount > 0 {
		log.Printf("[Icons] Dashboard icons already imported (%d icons)", dashboardIconCount)
		return nil
	}

	// Read all SVG files from the directory
	entries, err := os.ReadDir(iconsDir)
	if err != nil {
		return fmt.Errorf("failed to read dashboard icons directory: %w", err)
	}

	log.Printf("[Icons] Found %d files in dashboard-icons directory", len(entries))

	// Begin transaction for import
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	imported := 0
	skipped := 0

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		if !strings.HasSuffix(filename, ".svg") {
			continue
		}

		// Skip dark/light variants (prefer the base version)
		if strings.Contains(filename, "-dark.") || strings.Contains(filename, "-light.") {
			skipped++
			continue
		}

		// Extract base name without extension
		baseName := strings.TrimSuffix(filename, ".svg")

		// Generate icon ID (same as Python script - just the base name, lowercase)
		iconID := strings.ToLower(baseName)

		// Create display name from filename
		displayName := formatDisplayName(baseName)

		// Determine category
		categoryID := categorizeIcon(baseName)

		// Create image URL
		imageURL := "/api/icons/dashboard/" + filename

		// Insert icon
		_, err := tx.Exec(
			`INSERT OR IGNORE INTO icons (id, name, icon, category_id, image_url, is_preset)
			 VALUES (?, ?, ?, ?, ?, 1)`,
			iconID, displayName, "", categoryID, imageURL,
		)
		if err != nil {
			log.Printf("[Icons] Warning: failed to insert icon %s: %v", baseName, err)
			continue
		}

		imported++
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit dashboard icons: %w", err)
	}

	log.Printf("[Icons] Imported %d dashboard icons (%d variants skipped)", imported, skipped)
	return nil
}

// categorizeIcon determines the category for an icon based on its name
func categorizeIcon(iconName string) string {
	nameLower := strings.ToLower(iconName)

	// Check specific app mappings first
	if category, ok := SpecificApps[nameLower]; ok {
		return category
	}

	// Check for partial matches in specific apps
	for appName, category := range SpecificApps {
		if strings.Contains(nameLower, appName) || strings.Contains(appName, nameLower) {
			return category
		}
	}

	// Check category keywords
	for category, keywords := range CategoryKeywords {
		for _, keyword := range keywords {
			if strings.Contains(nameLower, keyword) {
				return category
			}
		}
	}

	// Default to development for unknown icons
	return "development"
}

// formatDisplayName converts a filename to a display name
func formatDisplayName(filename string) string {
	// Replace hyphens and underscores with spaces
	name := strings.ReplaceAll(filename, "-", " ")
	name = strings.ReplaceAll(name, "_", " ")

	// Title case each word
	words := strings.Fields(name)
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(string(word[0])) + strings.ToLower(word[1:])
		}
	}

	return strings.Join(words, " ")
}
