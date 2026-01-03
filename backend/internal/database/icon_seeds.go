package database

import (
	"database/sql"
	"fmt"
)

// seedIconData seeds the database with icon categories and preset icons
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
		{"os", "Operating Systems", "mdi:desktop-tower", 9},
		{"security", "Security", "mdi:shield-lock", 10},
		{"cloud", "Cloud Providers", "mdi:cloud-outline", 11},
		{"hardware", "Hardware", "mdi:chip", 12},
		{"virtualization", "Virtualization", "mdi:server", 13},
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

	// Seed preset icons
	icons := []struct {
		ID       string
		Name     string
		Icon     string
		Category string
		Color    string
	}{
		// Containers
		{"docker", "Docker", "simple-icons:docker", "containers", "#2496ED"},
		{"kubernetes", "Kubernetes", "simple-icons:kubernetes", "containers", "#326CE5"},
		{"portainer", "Portainer", "simple-icons:portainer", "containers", "#13BEF9"},
		{"podman", "Podman", "simple-icons:podman", "containers", "#892CA0"},
		{"rancher", "Rancher", "simple-icons:rancher", "containers", "#0075A8"},

		// Media & Streaming
		{"spotify", "Spotify", "simple-icons:spotify", "media", "#1DB954"},
		{"plex", "Plex", "simple-icons:plex", "media", "#E5A00D"},
		{"jellyfin", "Jellyfin", "simple-icons:jellyfin", "media", "#00A4DC"},
		{"emby", "Emby", "simple-icons:emby", "media", "#52B54B"},
		{"youtube", "YouTube", "simple-icons:youtube", "media", "#FF0000"},
		{"twitch", "Twitch", "simple-icons:twitch", "media", "#9146FF"},
		{"subsonic", "Subsonic", "simple-icons:subsonic", "media", "#3793FF"},
		{"kodi", "Kodi", "simple-icons:kodi", "media", "#17B2E7"},

		// Downloads
		{"qbittorrent", "qBittorrent", "simple-icons:qbittorrent", "downloads", "#2f67ba"},
		{"deluge", "Deluge", "simple-icons:deluge", "downloads", "#3f4652"},
		{"utorrent", "uTorrent", "simple-icons:utorrent", "downloads", "#44C527"},
		{"transmission", "Transmission", "mdi:transmission", "downloads", ""},
		{"sabnzbd", "SABnzbd", "mdi:download-box", "downloads", ""},
		{"nzbget", "NZBGet", "mdi:download-circle", "downloads", ""},
		{"radarr", "Radarr", "mdi:movie-open", "downloads", ""},
		{"sonarr", "Sonarr", "mdi:television-classic", "downloads", ""},
		{"lidarr", "Lidarr", "mdi:music-box", "downloads", ""},
		{"prowlarr", "Prowlarr", "mdi:file-search", "downloads", ""},
		{"bazarr", "Bazarr", "mdi:subtitles", "downloads", ""},

		// Monitoring
		{"grafana", "Grafana", "simple-icons:grafana", "monitoring", "#F46800"},
		{"prometheus", "Prometheus", "simple-icons:prometheus", "monitoring", "#E6522C"},
		{"datadog", "Datadog", "simple-icons:datadog", "monitoring", "#632CA6"},
		{"newrelic", "New Relic", "simple-icons:newrelic", "monitoring", "#008C99"},
		{"elastic", "Elastic", "simple-icons:elastic", "monitoring", "#005571"},
		{"kibana", "Kibana", "simple-icons:kibana", "monitoring", "#005571"},
		{"logstash", "Logstash", "simple-icons:logstash", "monitoring", "#005571"},
		{"splunk", "Splunk", "simple-icons:splunk", "monitoring", "#000000"},
		{"influxdb", "InfluxDB", "simple-icons:influxdb", "monitoring", "#22ADF6"},
		{"uptime-kuma", "Uptime Kuma", "mdi:heart-pulse", "monitoring", ""},
		{"netdata", "Netdata", "mdi:chart-areaspline", "monitoring", ""},
		{"zabbix", "Zabbix", "mdi:monitor-dashboard", "monitoring", ""},
		{"nagios", "Nagios", "mdi:monitor-eye", "monitoring", ""},

		// Storage & Cloud
		{"nextcloud", "Nextcloud", "simple-icons:nextcloud", "storage", "#0082C9"},
		{"dropbox", "Dropbox", "simple-icons:dropbox", "storage", "#0061FF"},
		{"googledrive", "Google Drive", "simple-icons:googledrive", "storage", "#4285F4"},
		{"onedrive", "OneDrive", "simple-icons:onedrive", "storage", "#0078D4"},
		{"box", "Box", "simple-icons:box", "storage", "#0061D5"},
		{"mega", "MEGA", "simple-icons:mega", "storage", "#D9272E"},
		{"seafile", "Seafile", "simple-icons:seafile", "storage", "#E49F3D"},
		{"syncthing", "Syncthing", "simple-icons:syncthing", "storage", "#0891D1"},
		{"filezilla", "FileZilla", "simple-icons:filezilla", "storage", "#BF0000"},
		{"owncloud", "ownCloud", "mdi:cloud", "storage", ""},
		{"minio", "MinIO", "mdi:bucket", "storage", ""},

		// Networking
		{"cloudflare", "Cloudflare", "simple-icons:cloudflare", "networking", "#F38020"},
		{"nginx", "NGINX", "simple-icons:nginx", "networking", "#009639"},
		{"traefik", "Traefik", "simple-icons:traefik", "networking", "#24A1C1"},
		{"wireguard", "WireGuard", "simple-icons:wireguard", "networking", "#88171A"},
		{"openvpn", "OpenVPN", "simple-icons:openvpn", "networking", "#EA7E20"},
		{"tailscale", "Tailscale", "simple-icons:tailscale", "networking", "#000000"},
		{"zerotier", "ZeroTier", "simple-icons:zerotier", "networking", "#FFB441"},
		{"ubiquiti", "Ubiquiti", "simple-icons:ubiquiti", "networking", "#0559C9"},
		{"mikrotik", "MikroTik", "simple-icons:mikrotik", "networking", "#293239"},
		{"cisco", "Cisco", "simple-icons:cisco", "networking", "#1BA0D7"},
		{"pfsense", "pfSense", "mdi:router-wireless", "networking", ""},
		{"opnsense", "OPNsense", "mdi:shield-check", "networking", ""},
		{"unifi", "UniFi", "mdi:access-point", "networking", ""},
		{"pihole", "Pi-hole", "mdi:shield-half-full", "networking", ""},
		{"adguard", "AdGuard Home", "mdi:shield-account", "networking", ""},
		{"haproxy", "HAProxy", "mdi:swap-horizontal", "networking", ""},
		{"squid", "Squid", "mdi:cached", "networking", ""},
		{"apache", "Apache", "mdi:apache-kafka", "networking", ""},
		{"caddy", "Caddy", "mdi:web", "networking", ""},

		// Databases
		{"postgresql", "PostgreSQL", "simple-icons:postgresql", "databases", "#4169E1"},
		{"mysql", "MySQL", "simple-icons:mysql", "databases", "#4479A1"},
		{"mariadb", "MariaDB", "simple-icons:mariadb", "databases", "#003545"},
		{"mongodb", "MongoDB", "simple-icons:mongodb", "databases", "#47A248"},
		{"redis", "Redis", "simple-icons:redis", "databases", "#DC382D"},
		{"cassandra", "Cassandra", "simple-icons:apachecassandra", "databases", "#1287B1"},
		{"couchdb", "CouchDB", "simple-icons:apachecouchdb", "databases", "#E42528"},
		{"elasticsearch", "Elasticsearch", "simple-icons:elasticsearch", "databases", "#005571"},
		{"oracle", "Oracle", "simple-icons:oracle", "databases", "#F80000"},
		{"sqlite", "SQLite", "simple-icons:sqlite", "databases", "#003B57"},
		{"mssql", "SQL Server", "mdi:microsoft-sql-server", "databases", ""},
		{"clickhouse", "ClickHouse", "mdi:database-clock", "databases", ""},
		{"timescaledb", "TimescaleDB", "mdi:database-clock-outline", "databases", ""},

		// Development
		{"github", "GitHub", "simple-icons:github", "development", "#181717"},
		{"gitlab", "GitLab", "simple-icons:gitlab", "development", "#FC6D26"},
		{"bitbucket", "Bitbucket", "simple-icons:bitbucket", "development", "#0052CC"},
		{"jenkins", "Jenkins", "simple-icons:jenkins", "development", "#D24939"},
		{"gitea", "Gitea", "simple-icons:gitea", "development", "#609926"},
		{"vscode", "VS Code", "simple-icons:visualstudiocode", "development", "#007ACC"},
		{"intellij", "IntelliJ IDEA", "simple-icons:intellijidea", "development", "#000000"},
		{"sublimetext", "Sublime Text", "simple-icons:sublimetext", "development", "#FF9800"},
		{"atom", "Atom", "simple-icons:atom", "development", "#66595C"},
		{"vim", "Vim", "simple-icons:vim", "development", "#019733"},
		{"npm", "npm", "simple-icons:npm", "development", "#CB3837"},
		{"yarn", "Yarn", "simple-icons:yarn", "development", "#2C8EBB"},
		{"webpack", "Webpack", "simple-icons:webpack", "development", "#8DD6F9"},
		{"babel", "Babel", "simple-icons:babel", "development", "#F9DC3E"},
		{"drone", "Drone CI", "mdi:drone", "development", ""},
		{"circleci", "CircleCI", "mdi:circle-slice-8", "development", ""},
		{"travis", "Travis CI", "mdi:transit-connection-variant", "development", ""},
		{"argocd", "Argo CD", "mdi:ship-wheel", "development", ""},
		{"harbor", "Harbor", "mdi:anchor", "development", ""},

		// Communication
		{"discord", "Discord", "simple-icons:discord", "communication", "#5865F2"},
		{"slack", "Slack", "simple-icons:slack", "communication", "#4A154B"},
		{"telegram", "Telegram", "simple-icons:telegram", "communication", "#26A5E4"},
		{"whatsapp", "WhatsApp", "simple-icons:whatsapp", "communication", "#25D366"},
		{"signal", "Signal", "simple-icons:signal", "communication", "#3A76F0"},
		{"teams", "Microsoft Teams", "simple-icons:microsoftteams", "communication", "#6264A7"},
		{"zoom", "Zoom", "simple-icons:zoom", "communication", "#2D8CFF"},
		{"skype", "Skype", "simple-icons:skype", "communication", "#00AFF0"},
		{"element", "Element", "simple-icons:element", "communication", "#0DBD8B"},
		{"matrix", "Matrix", "simple-icons:matrix", "communication", "#000000"},
		{"rocketchat", "Rocket.Chat", "mdi:rocket-launch", "communication", ""},
		{"mattermost", "Mattermost", "mdi:message-text", "communication", ""},
		{"mumble", "Mumble", "mdi:voice", "communication", ""},
		{"teamspeak", "TeamSpeak", "mdi:account-voice", "communication", ""},

		// Operating Systems
		{"ubuntu", "Ubuntu", "simple-icons:ubuntu", "os", "#E95420"},
		{"debian", "Debian", "simple-icons:debian", "os", "#A81D33"},
		{"fedora", "Fedora", "simple-icons:fedora", "os", "#51A2DA"},
		{"centos", "CentOS", "simple-icons:centos", "os", "#262577"},
		{"redhat", "Red Hat", "simple-icons:redhat", "os", "#EE0000"},
		{"archlinux", "Arch Linux", "simple-icons:archlinux", "os", "#1793D1"},
		{"alpine", "Alpine Linux", "simple-icons:alpinelinux", "os", "#0D597F"},
		{"freebsd", "FreeBSD", "simple-icons:freebsd", "os", "#AB2B28"},
		{"windows", "Windows", "simple-icons:windows", "os", "#0078D6"},
		{"apple", "macOS", "simple-icons:apple", "os", "#000000"},
		{"android", "Android", "simple-icons:android", "os", "#3DDC84"},
		{"ios", "iOS", "simple-icons:ios", "os", "#000000"},
		{"linux", "Linux", "mdi:linux", "os", ""},
		{"truenas", "TrueNAS", "mdi:nas", "os", ""},
		{"openmediavault", "OpenMediaVault", "mdi:server-network", "os", ""},

		// Security
		{"bitwarden", "Bitwarden", "simple-icons:bitwarden", "security", "#175DDC"},
		{"1password", "1Password", "simple-icons:1password", "security", "#0094F5"},
		{"lastpass", "LastPass", "simple-icons:lastpass", "security", "#D32D27"},
		{"keepass", "KeePass", "simple-icons:keepass", "security", "#6CAC4D"},
		{"authy", "Authy", "simple-icons:authy", "security", "#EC1C24"},
		{"letsencrypt", "Let's Encrypt", "simple-icons:letsencrypt", "security", "#003A70"},
		{"vaultwarden", "Vaultwarden", "mdi:shield-key", "security", ""},
		{"authelia", "Authelia", "mdi:shield-account", "security", ""},
		{"keycloak", "Keycloak", "mdi:key-chain", "security", ""},
		{"vault", "HashiCorp Vault", "mdi:safe-square", "security", ""},
		{"fail2ban", "Fail2ban", "mdi:shield-alert", "security", ""},
		{"crowdsec", "CrowdSec", "mdi:shield-crown", "security", ""},

		// Cloud Providers
		{"aws", "Amazon Web Services", "simple-icons:amazonaws", "cloud", "#FF9900"},
		{"azure", "Microsoft Azure", "simple-icons:microsoftazure", "cloud", "#0078D4"},
		{"gcp", "Google Cloud", "simple-icons:googlecloud", "cloud", "#4285F4"},
		{"digitalocean", "DigitalOcean", "simple-icons:digitalocean", "cloud", "#0080FF"},
		{"linode", "Linode", "simple-icons:linode", "cloud", "#00A95C"},
		{"vultr", "Vultr", "simple-icons:vultr", "cloud", "#007BFC"},
		{"ovh", "OVH", "simple-icons:ovh", "cloud", "#123F6D"},
		{"hetzner", "Hetzner", "simple-icons:hetzner", "cloud", "#D50C2D"},
		{"oracle-cloud", "Oracle Cloud", "mdi:cloud-braces", "cloud", ""},
		{"ibm-cloud", "IBM Cloud", "mdi:cloud-tags", "cloud", ""},
		{"alibaba-cloud", "Alibaba Cloud", "mdi:cloud-sync", "cloud", ""},

		// Hardware
		{"hp", "HP", "simple-icons:hp", "hardware", "#0096D6"},
		{"dell", "Dell", "simple-icons:dell", "hardware", "#007DB8"},
		{"intel", "Intel", "simple-icons:intel", "hardware", "#0071C5"},
		{"amd", "AMD", "simple-icons:amd", "hardware", "#ED1C24"},
		{"nvidia", "NVIDIA", "simple-icons:nvidia", "hardware", "#76B900"},
		{"lenovo", "Lenovo", "simple-icons:lenovo", "hardware", "#E2231A"},
		{"asus", "ASUS", "simple-icons:asus", "hardware", "#000000"},
		{"raspberry-pi", "Raspberry Pi", "mdi:raspberry-pi", "hardware", ""},
		{"synology", "Synology", "mdi:nas", "hardware", ""},
		{"qnap", "QNAP", "mdi:server", "hardware", ""},

		// Virtualization
		{"proxmox", "Proxmox", "simple-icons:proxmox", "virtualization", "#E57000"},
		{"vmware", "VMware", "simple-icons:vmware", "virtualization", "#607078"},
		{"virtualbox", "VirtualBox", "simple-icons:virtualbox", "virtualization", "#183A61"},
		{"esxi", "ESXi", "mdi:server-security", "virtualization", ""},
		{"kvm", "KVM", "mdi:laptop", "virtualization", ""},
		{"qemu", "QEMU", "mdi:memory", "virtualization", ""},
		{"hyper-v", "Hyper-V", "mdi:microsoft-windows", "virtualization", ""},
		{"xen", "Xen", "mdi:application-brackets", "virtualization", ""},
	}

	for _, icon := range icons {
		color := sql.NullString{String: icon.Color, Valid: icon.Color != ""}
		_, err := tx.Exec(
			"INSERT INTO icons (id, name, icon, category_id, color, is_preset) VALUES (?, ?, ?, ?, ?, 1)",
			icon.ID, icon.Name, icon.Icon, icon.Category, color,
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
