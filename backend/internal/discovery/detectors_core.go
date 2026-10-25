package discovery

// coreDetectors is the bundled set of specific app detectors shipped
// with HOPS. Each one declares the ports it cares about, a body or
// header signature unique enough to avoid false positives, and a
// suggested name + icon + URL + category the curate UI presents to the
// admin. The category drives auto-grouping at promote time (see
// categories.go).
//
// Adding a new detector here is the cheapest extensibility path. The
// rough recipe:
//   1. Find a substring of the service's HTTP response that's stable
//      across versions and not too generic ("Login" is a bad match;
//      "Vaultwarden" is a fine one).
//   2. Modern SPAs serve a JS shell as their root — body matching often
//      fails. Add the app's <title> to `titleContains` (case-
//      insensitive) — that catches almost everything that body matchers
//      miss.
//   3. If neither body nor title works, add one or two paths to `paths`
//      so the detector fetches an admin/login/API page that does carry
//      identifying text.
//   4. Pick an icon name from the bundled dashboard-icons set
//      (`assets/dashboard-icons/`). The orchestrator persists it
//      verbatim; the curate UI lets the admin override.
//   5. Pick a category (categories.go has the catalogue). When in doubt,
//      `CategoryOther` is fine — the admin can re-categorise in the
//      curate UI before promoting.
//   6. Add the service's default port to lightActivePorts in probe.go if
//      it isn't already there — otherwise the orchestrator never gets a
//      chance to fetch a response and your detector never runs.
//
// Confidence guidance:
//   - high   → unique body / title / header signature (Pi-hole, Proxmox)
//   - medium → ambiguous signal that's still narrowed by port
//   - low    → reserve for the generic HTTP fallback only
func coreDetectors() []Detector {
	return []Detector{
		httpFingerprintDetector{
			id: "core/pihole", name: "Pi-hole", icon: "pi-hole", category: CategoryNetwork,
			description:   "Network-wide ad blocker",
			ports:         []int{80, 443},
			paths:         []string{"/admin/"},
			urlPath:       "/admin/",
			bodyContains:  []string{"Pi-hole", "pi.hole"},
			titleContains: []string{"Pi-hole"},
			headerKeys:    []string{"x-pi-hole"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/proxmox", name: "Proxmox VE", icon: "proxmox", category: CategoryVirtualization,
			description:   "Proxmox Virtual Environment",
			ports:         []int{8006},
			bodyContains:  []string{"Proxmox Virtual Environment", "PVEAuthCookie"},
			titleContains: []string{"Proxmox"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/homeassistant", name: "Home Assistant", icon: "home-assistant", category: CategoryAutomation,
			description:   "Home automation",
			ports:         []int{8123},
			bodyContains:  []string{"Home Assistant", "home-assistant"},
			titleContains: []string{"Home Assistant"},
			headerKeys:    []string{"x-ha-version"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/plex", name: "Plex", icon: "plex", category: CategoryMedia,
			description:  "Plex media server",
			ports:        []int{32400},
			paths:        []string{"/identity"},
			bodyContains: []string{"MediaContainer", "Plex Media Server", "PlexConnect"},
			headerKeys:   []string{"x-plex-protocol"},
			confidence:   ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/jellyfin", name: "Jellyfin", icon: "jellyfin", category: CategoryMedia,
			description:   "Jellyfin media server",
			ports:         []int{8096},
			paths:         []string{"/web/index.html", "/System/Info/Public"},
			// `"ProductName":"Jellyfin` rather than bare "ProductName":
			// Emby on the same port answers /System/Info/Public too.
			bodyContains:  []string{"Jellyfin", "jellyfin-web", "\"ProductName\":\"Jellyfin"},
			titleContains: []string{"Jellyfin"},
			// An Emby page can mention Jellyfin; veto on Emby's title.
			excludeTitleContains: []string{"Emby"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/sonarr", name: "Sonarr", icon: "sonarr", category: CategoryDownloads,
			description:   "TV series automation",
			ports:         []int{8989},
			paths:         []string{"/login", "/initialize.js"},
			bodyContains:  []string{"Sonarr", "/api/v3/system/status"},
			titleContains: []string{"Sonarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/radarr", name: "Radarr", icon: "radarr", category: CategoryDownloads,
			description:   "Movie automation",
			ports:         []int{7878},
			paths:         []string{"/login", "/initialize.js"},
			bodyContains:  []string{"Radarr"},
			titleContains: []string{"Radarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/prowlarr", name: "Prowlarr", icon: "prowlarr", category: CategoryDownloads,
			description:   "Indexer manager",
			ports:         []int{9696},
			paths:         []string{"/login", "/initialize.js"},
			bodyContains:  []string{"Prowlarr"},
			titleContains: []string{"Prowlarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/lidarr", name: "Lidarr", icon: "lidarr", category: CategoryDownloads,
			description:   "Music automation",
			ports:         []int{8686},
			paths:         []string{"/login", "/initialize.js"},
			bodyContains:  []string{"Lidarr"},
			titleContains: []string{"Lidarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/bazarr", name: "Bazarr", icon: "bazarr", category: CategoryDownloads,
			description:   "Subtitle automation",
			ports:         []int{6767},
			paths:         []string{"/login"},
			bodyContains:  []string{"Bazarr"},
			titleContains: []string{"Bazarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/overseerr", name: "Overseerr", icon: "overseerr", category: CategoryDownloads,
			description:   "Media request management",
			ports:         []int{5055},
			paths:         []string{"/login", "/api/v1/status"},
			bodyContains:  []string{"Overseerr"},
			titleContains: []string{"Overseerr"},
			// Jellyseerr (a fork, same port) has its own detector and
			// can still mention Overseerr on its pages; veto on its title.
			excludeTitleContains: []string{"Jellyseerr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/tautulli", name: "Tautulli", icon: "tautulli", category: CategoryMedia,
			description:   "Plex monitoring",
			ports:         []int{8181},
			paths:         []string{"/auth/login"},
			bodyContains:  []string{"Tautulli"},
			titleContains: []string{"Tautulli"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/npm", name: "Nginx Proxy Manager", icon: "nginx-proxy-manager", category: CategoryNetwork,
			description:   "Nginx Proxy Manager",
			ports:         []int{81},
			paths:         []string{"/login", "/api/"},
			bodyContains:  []string{"Nginx Proxy Manager"},
			titleContains: []string{"Nginx Proxy Manager"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/portainer", name: "Portainer", icon: "portainer", category: CategoryVirtualization,
			description:   "Container management",
			ports:         []int{9000, 9443},
			paths:         []string{"/api/system/status", "/api/system/info"},
			bodyContains:  []string{"Portainer"},
			titleContains: []string{"Portainer"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/cockpit", name: "Cockpit", icon: "cockpit", category: CategoryMonitoring,
			description:   "Server admin console",
			ports:         []int{9090},
			bodyContains:  []string{"Cockpit", "id=\"cockpit-bus\""},
			titleContains: []string{"Cockpit"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/adguard", name: "AdGuard Home", icon: "adguard-home", category: CategoryNetwork,
			description:   "AdGuard Home DNS / ad blocker",
			ports:         []int{3000, 80},
			paths:         []string{"/control/status"},
			bodyContains:  []string{"AdGuard Home"},
			titleContains: []string{"AdGuard Home"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/grafana", name: "Grafana", icon: "grafana", category: CategoryMonitoring,
			description:   "Grafana dashboards",
			ports:         []int{3000},
			paths:         []string{"/login", "/api/health"},
			bodyContains:  []string{"Grafana"},
			titleContains: []string{"Grafana"},
			headerKeys:    []string{"x-grafana-version"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/uptime-kuma", name: "Uptime Kuma", icon: "uptime-kuma", category: CategoryMonitoring,
			description: "Self-hosted uptime monitor",
			ports:       []int{3001, 3000},
			// UK redirects "/" to "/dashboard" (302) with an empty body;
			// the SPA shell (containing the title + manifest description)
			// lives behind /dashboard. Without this path we'd never see
			// the identifying string. /api/badge serves the same SPA
			// shell — useful as a backup match.
			paths:         []string{"/dashboard", "/api/badge"},
			bodyContains:  []string{"Uptime Kuma"},
			titleContains: []string{"Uptime Kuma"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/vaultwarden", name: "Vaultwarden", icon: "vaultwarden", category: CategoryAuth,
			description:   "Vaultwarden password manager",
			ports:         []int{80, 443, 8080},
			paths:         []string{"/alive", "/#/login"},
			bodyContains:  []string{"Vaultwarden", "Bitwarden_RS"},
			titleContains: []string{"Vaultwarden", "Bitwarden"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/unifi", name: "UniFi Controller", icon: "unifi", category: CategoryNetwork,
			description:   "Ubiquiti UniFi Controller",
			ports:         []int{8443},
			paths:         []string{"/manage/account/login"},
			bodyContains:  []string{"UniFi", "unifi-network"},
			titleContains: []string{"UniFi"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/truenas", name: "TrueNAS", icon: "truenas", category: CategoryStorage,
			description:   "TrueNAS storage",
			ports:         []int{80, 443},
			bodyContains:  []string{"TrueNAS", "FreeNAS"},
			titleContains: []string{"TrueNAS", "FreeNAS"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/dozzle", name: "Dozzle", icon: "dozzle", category: CategoryVirtualization,
			description:   "Docker log viewer",
			ports:         []int{8080},
			bodyContains:  []string{"Dozzle"},
			titleContains: []string{"Dozzle"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/opnsense", name: "OPNsense", icon: "opnsense", category: CategoryNetwork,
			description:   "OPNsense firewall",
			ports:         []int{80, 443},
			titleContains: []string{"OPNsense"},
			bodyContains:  []string{"OPNsense"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/pfsense", name: "pfSense", icon: "pfsense", category: CategoryNetwork,
			description:   "pfSense firewall",
			ports:         []int{80, 443},
			titleContains: []string{"pfSense"},
			bodyContains:  []string{"pfSense"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/ntfy", name: "ntfy", icon: "ntfy", category: CategoryNotifications,
			description:   "ntfy push notifications",
			ports:         []int{80, 443, 8080},
			paths:         []string{"/v1/health"},
			titleContains: []string{"ntfy"},
			bodyContains:  []string{"\"healthy\":true", "ntfy"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/reolink", name: "Reolink", icon: "reolink", category: CategorySurveillance,
			description:   "Reolink camera / NVR",
			ports:         []int{80, 443},
			titleContains: []string{"Reolink"},
			bodyContains:  []string{"Reolink"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/tplink-deco", name: "TP-Link Deco", icon: "tp-link", category: CategoryIoT,
			description:   "TP-Link Deco mesh node",
			ports:         []int{80, 443},
			paths:         []string{"/webpages/index.html", "/webpages/login.html"},
			titleContains: []string{"TP-Link", "Deco", "Opening..."},
			// The Deco web UI is a JS shell that rewrites the title and
			// body at runtime. The static HTML *does* carry TP-Link's
			// internal "su" namespace via the script tags they bundle —
			// js/su/frame.js, $.su.App, tpEncrypt.js. Matching on those
			// catches every Deco node and TP-Link router we've seen.
			bodyContains: []string{
				"TP-Link", "tp-link", "tplink",
				"js/su/frame.js", "js/su/language.js",
				"$.su.App", "$.su.Language", "tpEncrypt.js",
			},
			confidence: ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/qnap", name: "QNAP", icon: "qnap", category: CategoryStorage,
			description: "QNAP NAS",
			ports:       []int{80, 443, 8080, 8081, 5000},
			// QNAP's root path is a JS redirect with no identifying
			// strings — the actual content lives behind /cgi-bin/.
			// authLogin.cgi serves QDocRoot XML (unambiguous); the
			// /cgi-bin/ root serves the QNAP Turbo NAS landing page.
			paths:         []string{"/cgi-bin/authLogin.cgi", "/cgi-bin/"},
			titleContains: []string{"QNAP", "Turbo NAS"},
			bodyContains:  []string{"QNAP", "Turbo NAS", "qnap-default.css", "qnap-lib.js", "QNAP.QOS", "QDocRoot"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/synology", name: "Synology DSM", icon: "synology", category: CategoryStorage,
			description:   "Synology DiskStation Manager",
			ports:         []int{5000, 5001},
			paths:         []string{"/webman/index.cgi"},
			titleContains: []string{"DSM", "Synology"},
			bodyContains:  []string{"DSM_LOGIN", "Synology"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/frigate", name: "Frigate", icon: "frigate", category: CategorySurveillance,
			description:   "Frigate NVR",
			ports:         []int{5000, 8971},
			paths:         []string{"/api/version", "/api/config"},
			titleContains: []string{"Frigate"},
			bodyContains:  []string{"Frigate"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/immich", name: "Immich", icon: "immich", category: CategoryPhotos,
			description:   "Immich photo / video manager",
			ports:         []int{2283, 80, 443},
			paths:         []string{"/api/server/ping", "/auth/login"},
			titleContains: []string{"Immich"},
			bodyContains:  []string{"Immich", "immich-web"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/paperless-ngx", name: "Paperless-ngx", icon: "paperless-ngx", category: CategoryDocuments,
			description:   "Paperless-ngx document management",
			ports:         []int{8000, 80, 443},
			paths:         []string{"/accounts/login/"},
			titleContains: []string{"Paperless"},
			bodyContains:  []string{"Paperless", "paperless-ngx"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/nextcloud", name: "Nextcloud", icon: "nextcloud", category: CategoryStorage,
			description:   "Nextcloud",
			ports:         []int{80, 443},
			paths:         []string{"/status.php", "/login"},
			titleContains: []string{"Nextcloud"},
			bodyContains:  []string{"Nextcloud", "\"productname\":\"Nextcloud\""},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/gitea", name: "Gitea", icon: "gitea", category: CategoryCode,
			description:   "Gitea self-hosted Git",
			ports:         []int{3000, 80, 443},
			titleContains: []string{"Gitea"},
			bodyContains:  []string{"Gitea"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/syncthing", name: "Syncthing", icon: "syncthing", category: CategoryStorage,
			description:   "Syncthing file sync",
			ports:         []int{8384},
			titleContains: []string{"Syncthing"},
			bodyContains:  []string{"syncthing"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/qbittorrent", name: "qBittorrent", icon: "qbittorrent", category: CategoryDownloads,
			description:   "qBittorrent web UI",
			ports:         []int{8080, 8090},
			titleContains: []string{"qBittorrent"},
			bodyContains:  []string{"qBittorrent"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/transmission", name: "Transmission", icon: "transmission", category: CategoryDownloads,
			description:   "Transmission web UI",
			ports:         []int{9091},
			titleContains: []string{"Transmission"},
			bodyContains:  []string{"Transmission"},
			confidence:    ConfidenceHigh,
		},
		// ---- Additional HTTP detectors (Phase 3.1 expansion) ----
		httpFingerprintDetector{
			id: "core/audiobookshelf", name: "Audiobookshelf", icon: "audiobookshelf", category: CategoryMedia,
			description:   "Audiobook & podcast server",
			ports:         []int{13378, 8765, 80, 443},
			paths:         []string{"/ping", "/login"},
			titleContains: []string{"Audiobookshelf"},
			bodyContains:  []string{"audiobookshelf", "Audiobookshelf"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/calibre-web", name: "Calibre-web", icon: "calibre-web", category: CategoryDocuments,
			description:   "Calibre-web e-book server",
			ports:         []int{8083, 80, 443},
			paths:         []string{"/login"},
			titleContains: []string{"Calibre-Web", "Calibre"},
			bodyContains:  []string{"calibre-web", "Calibre"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/navidrome", name: "Navidrome", icon: "navidrome", category: CategoryMedia,
			description:   "Navidrome music server",
			ports:         []int{4533, 80, 443},
			paths:         []string{"/app/", "/api/ping"},
			titleContains: []string{"Navidrome"},
			bodyContains:  []string{"Navidrome", "navidrome"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/mealie", name: "Mealie", icon: "mealie", category: CategoryDocuments,
			description:   "Mealie recipe manager",
			ports:         []int{9925, 9000, 80, 443},
			paths:         []string{"/api/app/about"},
			titleContains: []string{"Mealie"},
			bodyContains:  []string{"Mealie", "mealie"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/linkding", name: "Linkding", icon: "linkding", category: CategoryDocuments,
			description:   "Linkding bookmark manager",
			ports:         []int{9090, 80, 443},
			paths:         []string{"/login/", "/api/health"},
			titleContains: []string{"linkding"},
			bodyContains:  []string{"linkding"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/freshrss", name: "FreshRSS", icon: "freshrss", category: CategoryDocuments,
			description:   "FreshRSS feed reader",
			ports:         []int{80, 443},
			paths:         []string{"/i/", "/p/i/"},
			titleContains: []string{"FreshRSS"},
			bodyContains:  []string{"FreshRSS"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/miniflux", name: "Miniflux", icon: "miniflux", category: CategoryDocuments,
			description:   "Miniflux feed reader",
			ports:         []int{8080, 80, 443},
			paths:         []string{"/login", "/healthcheck"},
			titleContains: []string{"Miniflux"},
			bodyContains:  []string{"Miniflux", "miniflux"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/mattermost", name: "Mattermost", icon: "mattermost", category: CategoryOther,
			description:   "Mattermost team chat",
			ports:         []int{8065, 80, 443},
			paths:         []string{"/api/v4/system/ping"},
			titleContains: []string{"Mattermost"},
			bodyContains:  []string{"Mattermost", "mattermost"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/rocketchat", name: "Rocket.Chat", icon: "rocket-chat", category: CategoryOther,
			description:   "Rocket.Chat team chat",
			ports:         []int{3000, 80, 443},
			paths:         []string{"/api/info"},
			titleContains: []string{"Rocket.Chat"},
			bodyContains:  []string{"Rocket.Chat", "rocketchat"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/seafile", name: "Seafile", icon: "seafile", category: CategoryStorage,
			description:   "Seafile file hosting",
			ports:         []int{8000, 80, 443},
			paths:         []string{"/accounts/login/", "/api2/ping/"},
			titleContains: []string{"Seafile"},
			bodyContains:  []string{"Seafile", "seafile"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/owncloud", name: "ownCloud", icon: "owncloud", category: CategoryStorage,
			description:   "ownCloud file hosting",
			ports:         []int{80, 443},
			paths:         []string{"/status.php", "/login"},
			titleContains: []string{"ownCloud"},
			bodyContains:  []string{"ownCloud", "owncloud"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/vikunja", name: "Vikunja", icon: "vikunja", category: CategoryDocuments,
			description:   "Vikunja task management",
			ports:         []int{3456, 80, 443},
			paths:         []string{"/api/v1/info"},
			titleContains: []string{"Vikunja"},
			bodyContains:  []string{"Vikunja", "vikunja"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/wikijs", name: "Wiki.js", icon: "wikijs", category: CategoryDocuments,
			description:   "Wiki.js wiki",
			ports:         []int{3000, 80, 443},
			paths:         []string{"/login", "/healthz"},
			titleContains: []string{"Wiki.js"},
			bodyContains:  []string{"Wiki.js", "wikijs"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/bookstack", name: "BookStack", icon: "bookstack", category: CategoryDocuments,
			description:   "BookStack wiki",
			ports:         []int{8080, 80, 443},
			paths:         []string{"/login"},
			titleContains: []string{"BookStack"},
			bodyContains:  []string{"BookStack", "bookstack"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/minio", name: "MinIO", icon: "minio", category: CategoryStorage,
			description:   "MinIO object storage",
			ports:         []int{9000, 9001, 80, 443},
			paths:         []string{"/minio/health/live", "/login"},
			titleContains: []string{"MinIO"},
			bodyContains:  []string{"MinIO", "minio"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/prometheus", name: "Prometheus", icon: "prometheus", category: CategoryMonitoring,
			description:   "Prometheus metrics",
			ports:         []int{9090},
			paths:         []string{"/-/healthy", "/graph"},
			titleContains: []string{"Prometheus"},
			bodyContains:  []string{"Prometheus"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/alertmanager", name: "Alertmanager", icon: "alertmanager", category: CategoryMonitoring,
			description:   "Prometheus Alertmanager",
			ports:         []int{9093},
			paths:         []string{"/-/healthy", "/#/alerts"},
			titleContains: []string{"Alertmanager"},
			bodyContains:  []string{"Alertmanager", "alertmanager"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/loki", name: "Loki", icon: "loki", category: CategoryMonitoring,
			description:   "Grafana Loki log aggregation",
			ports:         []int{3100},
			paths:         []string{"/ready", "/metrics"},
			bodyContains:  []string{"loki_build_info", "Loki"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/traefik", name: "Traefik", icon: "traefik", category: CategoryNetwork,
			description:   "Traefik reverse proxy dashboard",
			ports:         []int{8080, 80, 443},
			paths:         []string{"/dashboard/", "/api/version"},
			titleContains: []string{"Traefik"},
			bodyContains:  []string{"Traefik", "traefik"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/caddy", name: "Caddy", icon: "caddy", category: CategoryNetwork,
			description:   "Caddy admin API",
			ports:         []int{2019},
			paths:         []string{"/config/", "/reverse_proxy/upstreams"},
			bodyContains:  []string{"\"admin\":", "\"apps\":"},
			confidence:    ConfidenceMedium,
		},
		httpFingerprintDetector{
			id: "core/jenkins", name: "Jenkins", icon: "jenkins", category: CategoryCode,
			description:   "Jenkins CI",
			ports:         []int{8080, 80, 443},
			paths:         []string{"/login", "/api/json"},
			titleContains: []string{"Jenkins"},
			bodyContains:  []string{"Jenkins", "jenkins"},
			headerKeys:    []string{"x-jenkins"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/gitlab", name: "GitLab", icon: "gitlab", category: CategoryCode,
			description:   "GitLab self-hosted",
			ports:         []int{80, 443, 8929},
			paths:         []string{"/users/sign_in", "/-/health"},
			titleContains: []string{"GitLab"},
			bodyContains:  []string{"GitLab", "gitlab"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/woodpecker", name: "Woodpecker CI", icon: "woodpecker-ci", category: CategoryCode,
			description:   "Woodpecker CI",
			ports:         []int{8000, 80, 443},
			paths:         []string{"/version", "/login"},
			titleContains: []string{"Woodpecker"},
			bodyContains:  []string{"Woodpecker", "woodpecker"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/n8n", name: "n8n", icon: "n8n", category: CategoryAutomation,
			description:   "n8n workflow automation",
			ports:         []int{5678, 80, 443},
			paths:         []string{"/healthz", "/rest/login"},
			titleContains: []string{"n8n"},
			bodyContains:  []string{"n8n.io", "n8n-"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/guacamole", name: "Apache Guacamole", icon: "guacamole", category: CategoryAuth,
			description:   "Guacamole remote desktop gateway",
			ports:         []int{8080, 80, 443},
			paths:         []string{"/guacamole/", "/guacamole/#/"},
			titleContains: []string{"Guacamole", "Apache Guacamole"},
			bodyContains:  []string{"Guacamole", "guacamole"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/filebrowser", name: "File Browser", icon: "filebrowser", category: CategoryStorage,
			description:   "File Browser web file manager",
			ports:         []int{80, 443, 8080},
			paths:         []string{"/login"},
			titleContains: []string{"File Browser"},
			bodyContains:  []string{"File Browser", "filebrowser"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/netdata", name: "Netdata", icon: "netdata", category: CategoryMonitoring,
			description:   "Netdata real-time monitoring",
			ports:         []int{19999},
			titleContains: []string{"Netdata"},
			bodyContains:  []string{"Netdata", "netdata"},
			headerKeys:    []string{},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/viewpower", name: "ViewPower", icon: "ups", category: CategoryMonitoring,
			description: "ViewPower UPS monitoring (Voltronic / MUST)",
			ports:       []int{15178, 8080, 80},
			// ViewPower is a Tomcat-hosted Java app; the root path serves
			// the Tomcat default page (useless), but /ViewPower/ serves
			// a tiny JS shell that pulls in /ViewPower/images/waiting.gif
			// and /ViewPower/isInitialized — both unambiguous strings.
			paths:        []string{"/ViewPower/", "/ViewPower/isInitialized"},
			bodyContains: []string{"ViewPower", "/ViewPower/"},
			confidence:   ConfidenceHigh,
		},
		// ---- Database web admin tools ----
		// HOPS is a dashboarding tool: we surface what the admin
		// clicks in a browser, not what the database protocol speaks
		// on the wire. pgAdmin / phpMyAdmin / Adminer ARE the
		// browser-accessible entry point for database administration;
		// the raw protocol ports (5432 / 3306 / etc.) live outside
		// the dashboard scope.
		httpFingerprintDetector{
			id: "core/pgadmin", name: "pgAdmin 4", icon: "pgadmin", category: CategoryOther,
			description: "pgAdmin 4 — PostgreSQL web admin",
			ports:       []int{80, 443, 5050, 8080},
			// pgAdmin is usually reverse-proxied under /pgadmin4; the
			// root path can be the reverse-proxy's default. We try
			// both / and /pgadmin4/ to cover direct and proxied
			// installs, plus the login redirect target. urlPath
			// pins the *landing* URL so the dashboard tile opens
			// the right path even when the detector matched on
			// /pgadmin4/login.
			paths:         []string{"/pgadmin4/", "/pgadmin4/login", "/login"},
			urlPath:       "/pgadmin4/",
			titleContains: []string{"pgAdmin"},
			bodyContains:  []string{"pgAdmin 4", "pgAdmin4", "pga4_session", "pgadmin4"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/phpmyadmin", name: "phpMyAdmin", icon: "phpmyadmin", category: CategoryOther,
			description:   "phpMyAdmin — MySQL/MariaDB web admin",
			ports:         []int{80, 443, 8080},
			paths:         []string{"/phpmyadmin/", "/phpmyadmin/index.php"},
			urlPath:       "/phpmyadmin/",
			titleContains: []string{"phpMyAdmin"},
			bodyContains:  []string{"phpMyAdmin", "pma_password"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/adminer", name: "Adminer", icon: "adminer", category: CategoryOther,
			description:   "Adminer — universal database web admin",
			ports:         []int{80, 443, 8080},
			paths:         []string{"/adminer/", "/adminer.php"},
			urlPath:       "/adminer/",
			titleContains: []string{"Adminer"},
			bodyContains:  []string{"Adminer", "adminer"},
			confidence:    ConfidenceHigh,
		},
		// ---- Batch: AI category and more web UIs (v3) ----
		// Principle: HOPS launches web UIs, so every detector here is a
		// UI a user opens in a browser — no raw APIs, databases, brokers
		// or game servers. Icons with a ':' are Iconify names (no
		// dashboard-icons SVG exists); they're kept in the offline bundle
		// via frontend/scripts/icon-keep.txt.
		httpFingerprintDetector{
			id: "core/node-red", name: "Node-RED", icon: "node-red", category: CategoryAutomation,
			description:   "Node-RED flow-based automation",
			ports:         []int{1880},
			titleContains: []string{"Node-RED"},
			bodyContains:  []string{"red/red.min.js"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/couchdb", name: "CouchDB Fauxton", icon: "couchdb", category: CategoryOther,
			description: "Apache CouchDB — Fauxton web admin",
			ports:       []int{5984},
			// GET / is CouchDB's JSON welcome; the browser UI lives at
			// /_utils/ (Fauxton), so that's where the tile opens.
			paths:         []string{"/_utils/"},
			urlPath:       "/_utils/",
			bodyContains:  []string{"\"couchdb\":\"Welcome\""},
			titleContains: []string{"Project Fauxton"},
			headerKeys:    []string{"server: CouchDB/"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/homepage", name: "Homepage", icon: "mdi:view-dashboard", category: CategoryOther,
			description: "Homepage (gethomepage) application dashboard",
			ports:       []int{3000, 7575},
			// The <title> is just "Homepage" (and user-editable), far too
			// generic. The default meta description is specific.
			bodyContains: []string{"A highly customizable homepage (or startpage / application dashboard)"},
			confidence:   ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/monit", name: "Monit", icon: "mdi:heart-pulse", category: CategoryMonitoring,
			description: "Monit process and system monitor",
			ports:       []int{2812},
			// Monit answers / with 401 Basic auth. The primary signal is
			// its Server header ("monit 5.x"); the Basic realm "monit" is
			// a secondary match for a proxy that strips Server.
			headerKeys: []string{"server: monit", "www-authenticate: realm=\"monit\""},
			confidence: ConfidenceHigh,
		},
		// ---- AI ----
		httpFingerprintDetector{
			id: "core/open-webui", name: "Open WebUI", icon: "open-webui", category: CategoryAI,
			description:   "Open WebUI chat interface for local LLMs",
			ports:         []int{3000, 8080},
			paths:         []string{"/api/config"},
			titleContains: []string{"Open WebUI"},
			bodyContains:  []string{"\"name\":\"Open WebUI\""},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/localai", name: "LocalAI", icon: "mdi:brain", category: CategoryAI,
			description:   "LocalAI model server web UI",
			ports:         []int{8080},
			titleContains: []string{"LocalAI"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/sd-webui", name: "Stable Diffusion WebUI", icon: "mdi:palette", category: CategoryAI,
			description: "AUTOMATIC1111 Stable Diffusion web UI",
			ports:       []int{7860},
			// A Gradio app: 7860 is Gradio's default, shared by many AI
			// UIs, so match the app title (in <title> or gradio_config),
			// never Gradio itself.
			titleContains: []string{"Stable Diffusion"},
			bodyContains:  []string{"\"title\":\"Stable Diffusion\"", "\"title\": \"Stable Diffusion\""},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/comfyui", name: "ComfyUI", icon: "mdi:graph", category: CategoryAI,
			description:   "ComfyUI node-based diffusion UI",
			ports:         []int{8188},
			paths:         []string{"/system_stats"},
			titleContains: []string{"ComfyUI"},
			bodyContains:  []string{"\"comfyui_version\""},
			confidence:    ConfidenceHigh,
		},
		// ---- Smart home ----
		httpFingerprintDetector{
			id: "core/zigbee2mqtt", name: "Zigbee2MQTT", icon: "zigbee2mqtt", category: CategoryAutomation,
			description:   "Zigbee2MQTT frontend",
			ports:         []int{8080},
			titleContains: []string{"Zigbee2MQTT"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/esphome", name: "ESPHome", icon: "esphome", category: CategoryAutomation,
			description:   "ESPHome device dashboard",
			ports:         []int{6052},
			titleContains: []string{"ESPHome"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/scrypted", name: "Scrypted", icon: "mdi:cctv", category: CategoryAutomation,
			description: "Scrypted home video integration",
			ports:       []int{10443, 11080},
			// / redirects into the core plugin's public endpoint.
			paths:         []string{"/endpoint/@scrypted/core/public/"},
			titleContains: []string{"Scrypted"},
			headerKeys:    []string{"location: /endpoint/@scrypted/"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/homebridge", name: "Homebridge", icon: "homebridge", category: CategoryAutomation,
			description:   "Homebridge UI",
			ports:         []int{8581},
			titleContains: []string{"Homebridge"},
			confidence:    ConfidenceHigh,
		},
		// ---- Media ----
		httpFingerprintDetector{
			id: "core/emby", name: "Emby", icon: "emby", category: CategoryMedia,
			description: "Emby media server",
			ports:       []int{8096},
			// Same port as Jellyfin (a fork of Emby) whose web client
			// still uses emby-* element names, so match only Emby's
			// <title>, and veto a title naming Jellyfin.
			paths:                []string{"/web/index.html"},
			titleContains:        []string{"Emby"},
			excludeTitleContains: []string{"Jellyfin"},
			confidence:      ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/jellyseerr", name: "Jellyseerr", icon: "jellyseerr", category: CategoryDownloads,
			description:   "Media request management for Jellyfin / Emby",
			ports:         []int{5055},
			paths: []string{"/login"},
			// Title only: an Overseerr page can mention Jellyseerr.
			titleContains: []string{"Jellyseerr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/readarr", name: "Readarr", icon: "readarr", category: CategoryDownloads,
			description:   "Book automation",
			ports:         []int{8787},
			paths:         []string{"/login", "/initialize.js"},
			bodyContains:  []string{"Readarr"},
			titleContains: []string{"Readarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/kavita", name: "Kavita", icon: "kavita", category: CategoryMedia,
			description:   "Kavita reading server (comics, manga, books)",
			ports:         []int{5000},
			titleContains: []string{"Kavita"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/komga", name: "Komga", icon: "komga", category: CategoryMedia,
			description:   "Komga comics / manga server",
			ports:         []int{25600},
			titleContains: []string{"Komga"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/stash", name: "Stash", icon: "stash", category: CategoryMedia,
			description: "Stash media organiser",
			ports:       []int{9999},
			// Exact title: a substring "stash" would also catch
			// Filestash, Bytestash, …
			bodyContains: []string{"<title>Stash</title>"},
			confidence:   ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/tdarr", name: "Tdarr", icon: "mdi:file-video", category: CategoryMedia,
			description:   "Tdarr distributed transcoding",
			ports:         []int{8265},
			titleContains: []string{"Tdarr"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/unmanic", name: "Unmanic", icon: "mdi:movie-cog", category: CategoryMedia,
			description:   "Unmanic library optimiser",
			ports:         []int{8888},
			titleContains: []string{"Unmanic"},
			confidence:    ConfidenceHigh,
		},
		// ---- Network ----
		httpFingerprintDetector{
			id: "core/technitium", name: "Technitium DNS", icon: "mdi:dns", category: CategoryNetwork,
			description:   "Technitium DNS Server",
			ports:         []int{5380},
			titleContains: []string{"Technitium"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/wg-easy", name: "wg-easy", icon: "wireguard", category: CategoryNetwork,
			description: "wg-easy WireGuard admin UI",
			ports:       []int{51821},
			// Older builds title the page just "WireGuard" — too generic
			// alone; the project name appears in the page.
			titleContains: []string{"wg-easy"},
			bodyContains:  []string{"wg-easy"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/openwrt", name: "OpenWrt LuCI", icon: "openwrt", category: CategoryNetwork,
			description: "OpenWrt router (LuCI web interface)",
			ports:       []int{80, 443},
			// / is a meta-refresh to cgi-bin/luci/ naming LuCI; the login
			// page (403 until signed in) loads /luci-static/ assets.
			// Never match the bare path text: verbose 403s echo it.
			paths:         []string{"/cgi-bin/luci/"},
			urlPath:       "/cgi-bin/luci/",
			titleContains: []string{" - LuCI"},
			bodyContains:  []string{"LuCI - Lua Configuration Interface", "/luci-static/"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/mikrotik", name: "MikroTik WebFig", icon: "mikrotik", category: CategoryNetwork,
			description:   "MikroTik RouterOS WebFig",
			ports:         []int{80, 443},
			titleContains: []string{"RouterOS"},
			confidence:    ConfidenceHigh,
		},
		httpFingerprintDetector{
			id: "core/omada", name: "Omada Controller", icon: "omada", category: CategoryNetwork,
			description: "TP-Link Omada SDN controller",
			ports:       []int{8043, 8088},
			// / redirects to /<omadacId>/login; /api/info names the
			// controller id without auth.
			paths:         []string{"/api/info"},
			titleContains: []string{"Omada"},
			bodyContains:  []string{"\"omadacId\""},
			confidence:    ConfidenceHigh,
		},
	}
}
