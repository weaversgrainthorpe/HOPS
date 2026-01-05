#!/usr/bin/env python3
"""Import dashboard icons into the HOPS database with proper categorization."""

import os
import sqlite3
import re

# Paths
ICONS_DIR = "/home/jonathan/data/icons/dashboard-icons"
DB_PATH = "/home/jonathan/HOPS/data/hops.db"

# Category mappings based on keywords in icon names
CATEGORY_KEYWORDS = {
    # Operating Systems
    "os": [
        "linux", "ubuntu", "debian", "fedora", "arch", "alpine", "centos", "redhat",
        "windows", "macos", "android", "ios", "freebsd", "openbsd", "mint", "manjaro",
        "kali", "parrot", "pop-os", "elementary", "zorin", "alma", "rocky", "nixos",
        "gentoo", "slackware", "suse", "opensuse", "oracle-linux", "chromeos",
        "tails", "qubes", "haiku", "reactos", "freenas", "truenas", "openmediavault"
    ],

    # Cloud Providers & Services
    "cloud": [
        "aws", "amazon-web", "azure", "gcp", "google-cloud", "cloudflare", "digitalocean",
        "linode", "vultr", "hetzner", "ovh", "oracle-cloud", "ibm-cloud", "alibaba",
        "aliyun", "heroku", "vercel", "netlify", "railway", "render", "fly-io",
        "scaleway", "backblaze", "wasabi", "minio", "s3", "cloudwatch", "route53"
    ],

    # Containers & Orchestration
    "containers": [
        "docker", "kubernetes", "k3s", "k8s", "podman", "containerd", "rancher",
        "portainer", "yacht", "helm", "istio", "linkerd", "traefik", "nginx-proxy",
        "caddy", "haproxy", "envoy", "consul", "nomad", "swarm", "compose",
        "watchtower", "dozzle", "lazydocker"
    ],

    # Virtualization
    "virtualization": [
        "proxmox", "vmware", "esxi", "vcenter", "virtualbox", "hyper-v", "qemu",
        "kvm", "xen", "citrix", "ovirt", "openstack", "vagrant", "virt-manager",
        "cockpit", "guacamole"
    ],

    # Databases
    "databases": [
        "mysql", "mariadb", "postgres", "postgresql", "mongodb", "redis", "sqlite",
        "elasticsearch", "influxdb", "cassandra", "couchdb", "neo4j", "dynamodb",
        "firebird", "cockroachdb", "timescale", "questdb", "clickhouse", "druid",
        "dgraph", "arangodb", "rethinkdb", "memcached", "etcd", "valkey"
    ],

    # Monitoring & Logging
    "monitoring": [
        "grafana", "prometheus", "zabbix", "nagios", "datadog", "netdata", "uptime",
        "statping", "healthchecks", "gatus", "checkly", "better-stack", "loki",
        "kibana", "logstash", "fluentd", "graylog", "splunk", "sentry", "glances",
        "monit", "icinga", "observium", "librenms", "prtg", "checkmk", "victoria",
        "alertmanager", "telegraf", "collectd", "speedtest"
    ],

    # Media & Entertainment
    "media": [
        "plex", "jellyfin", "emby", "kodi", "infuse", "vlc", "mpv", "stremio",
        "sonarr", "radarr", "lidarr", "readarr", "prowlarr", "bazarr", "overseerr",
        "ombi", "tautulli", "audiobookshelf", "calibre", "kavita", "komga", "komf",
        "mylar", "navidrome", "funkwhale", "airsonic", "ampache", "subsonic",
        "spotify", "youtube", "netflix", "disney", "hbo", "amazon-prime", "apple-tv",
        "tidal", "deezer", "soundcloud", "beets", "libreelec", "stash", "dim",
        "petio", "requestrr", "unmanic", "tdarr", "fileflows", "photoprism",
        "immich", "ente", "lychee", "pigallery", "piwigo", "librephotos", "nextcloud-photos"
    ],

    # Downloads & Torrents
    "downloads": [
        "qbittorrent", "deluge", "transmission", "rtorrent", "rutorrent", "aria2",
        "sabnzbd", "nzbget", "usenet", "newshosting", "jackett", "flaresolverr",
        "nzbhydra", "sickbeard", "sickrage", "sickgear", "medusa", "jdownloader",
        "pyload", "youtube-dl", "yt-dlp", "metube", "tube", "flood", "cross-seed",
        "autobrr", "1337x"
    ],

    # Security & VPN
    "security": [
        "vpn", "wireguard", "openvpn", "tailscale", "zerotier", "headscale",
        "pritunl", "softether", "ipsec", "strongswan", "wg-easy", "pi-vpn",
        "adguard", "pihole", "blocky", "unbound", "dnscrypt", "doh", "dot",
        "vaultwarden", "bitwarden", "keepass", "passbolt", "hashicorp-vault",
        "2fauth", "authelia", "authentik", "keycloak", "dex", "oauth", "ldap",
        "crowdsec", "fail2ban", "snort", "suricata", "wazuh", "ossec", "nessus",
        "openvas", "1password", "dashlane", "lastpass", "nordvpn", "expressvpn",
        "mullvad", "protonvpn", "surfshark", "certbot", "acme", "letsencrypt",
        "step-ca", "smallstep", "cfssl"
    ],

    # Networking & DNS
    "networking": [
        "nginx", "apache", "caddy", "haproxy", "squid", "pound", "varnish",
        "cloudflare", "route53", "bind", "powerdns", "coredns", "dnsmasq",
        "technitium", "pihole", "adguard-home", "blocky", "unifi", "omada",
        "opnsense", "pfsense", "openwrt", "ddwrt", "mikrotik", "ubiquiti",
        "netgear", "tp-link", "asus", "synology", "qnap", "zyxel", "fritzbox",
        "speedtest", "smokeping", "ntopng", "wireshark", "zeek", "snmp",
        "gophish"
    ],

    # Development & DevOps
    "development": [
        "github", "gitlab", "gitea", "forgejo", "gogs", "bitbucket", "svn",
        "jenkins", "drone", "woodpecker", "buildkite", "circleci", "travis",
        "teamcity", "bamboo", "argocd", "fluxcd", "tekton", "spinnaker",
        "terraform", "ansible", "puppet", "chef", "saltstack", "pulumi",
        "crossplane", "vault", "consul", "nomad", "waypoint", "packer",
        "vscode", "jetbrains", "intellij", "pycharm", "webstorm", "rider",
        "sublime", "atom", "notepad", "vim", "neovim", "emacs", "helix",
        "python", "nodejs", "node", "npm", "yarn", "pnpm", "deno", "bun",
        "java", "spring", "maven", "gradle", "kotlin", "scala", "clojure",
        "ruby", "rails", "php", "laravel", "symfony", "wordpress", "drupal",
        "go", "golang", "rust", "cargo", "crates", "swift", "dart", "flutter",
        "react", "vue", "angular", "svelte", "nextjs", "nuxt", "gatsby",
        "webpack", "vite", "rollup", "esbuild", "turbopack", "rspack",
        "sonarqube", "snyk", "trivy", "clair", "grype", "syft", "cosign",
        "backstage", "port", "cortex", "opslevel", "code-server", "eclipse",
        "swagger", "openapi", "postman", "insomnia", "httpie", "curl",
        "act", "goreleaser", "semantic-release", "changesets", "renovate",
        "dependabot", "greenkeeper", "n8n", "huginn", "activepieces", "windmill"
    ],

    # Communication & Collaboration
    "communication": [
        "discord", "slack", "teams", "zoom", "jitsi", "matrix", "element",
        "mattermost", "rocket-chat", "rocketchat", "zulip", "revolt", "gotify", "ntfy", "pushover",
        "telegram", "signal", "whatsapp", "messenger", "skype", "viber", "wechat",
        "email", "smtp", "imap", "postfix", "dovecot", "roundcube", "mailcow",
        "mailu", "iredmail", "zimbra", "mailpile", "thunderbird", "outlook", "gmail",
        "protonmail", "tutanota", "fastmail", "mailchimp", "sendgrid", "mailgun",
        "rspamd", "spamassassin", "clamav", "amavis", "sogo", "kopano", "horde"
    ],

    # Storage & Backup
    "storage": [
        "nextcloud", "owncloud", "seafile", "syncthing", "resilio", "sparkleshare",
        "filebrowser", "filestash", "cloudreve", "alist", "chevereto", "lychee",
        "nas", "freenas", "truenas", "openmediavault", "unraid", "xpenology",
        "synology", "qnap", "asustor", "drobo", "buffalo",
        "samba", "smb", "nfs", "cifs", "webdav", "sftp", "ftp", "rsync",
        "rclone", "duplicati", "borgbackup", "borg", "restic", "kopia", "duplicacy",
        "urbackup", "bacula", "bareos", "amanda", "veeam", "acronis", "crashplan",
        "backblaze", "carbonite", "idrive", "wasabi", "arq", "timeshift", "snapper",
        "proxmox-backup", "pbs", "minio", "ceph", "glusterfs", "longhorn", "rook",
        "paperless", "paperless-ng", "paperless-ngx", "mayan-edms", "docspell"
    ],

    # Hardware & IoT
    "hardware": [
        "raspberry", "pi", "arduino", "esp",
        "nvidia", "amd", "intel", "asus", "msi", "gigabyte", "asrock",
        "hp", "dell", "lenovo", "thinkpad", "macbook", "imac",
        "cpu", "gpu", "ram", "ssd", "hdd", "nvme", "usb", "thunderbolt",
        "printer", "scanner", "ups", "apc", "cyberpower", "tripplite",
        "ipmi", "ilo", "idrac", "bmc", "ikvm", "pikvm"
    ],

    # Automation & Smart Home
    "automation": [
        "home-assistant", "homeassistant", "hass", "openhab", "domoticz", "homebridge",
        "hubitat", "smartthings", "node-red", "nodered", "n8n", "huginn", "activepieces",
        "zigbee", "z-wave", "mqtt", "mosquitto", "esphome", "tasmota", "iot",
        "frigate", "scrypted", "wyze", "ring", "nest", "ecobee", "sonoff", "shelly", "tuya",
        "zigbee2mqtt", "zwave-js", "zwavejs", "deconz", "conbee", "double-take", "compreface"
    ]
}

# Additional specific app categorizations
SPECIFIC_APPS = {
    # Specific popular apps that might be miscategorized
    "home-assistant": "automation",
    "homeassistant": "automation",
    "hass": "automation",
    "frigate": "automation",
    "scrypted": "automation",
    "wyze": "automation",
    "ring": "automation",
    "nest": "automation",
    "ecobee": "automation",
    "sonoff": "automation",
    "shelly": "automation",
    "tuya": "automation",
    "zigbee2mqtt": "automation",
    "zwave-js": "automation",
    "zwavejs": "automation",
    "node-red": "automation",
    "nodered": "automation",
    "n8n": "automation",
    "mosquitto": "automation",

    # Game servers
    "minecraft": "media",
    "valheim": "media",
    "terraria": "media",
    "factorio": "media",
    "satisfactory": "media",
    "ark": "media",
    "rust-game": "media",
    "csgo": "media",
    "steam": "media",
    "epic-games": "media",
    "gog": "media",
    "lutris": "media",
    "heroic": "media",
    "playnite": "media",
    "retroarch": "media",
    "emulationstation": "media",
    "launchbox": "media",
    "pterodactyl": "media",
    "crafty": "media",
    "amp": "media",

    # Productivity & Office
    "libreoffice": "development",
    "onlyoffice": "development",
    "collabora": "development",
    "cryptpad": "development",
    "etherpad": "development",
    "hedgedoc": "development",
    "codimd": "development",
    "hackmd": "development",
    "outline": "development",
    "wiki-js": "development",
    "bookstack": "development",
    "docusaurus": "development",
    "mkdocs": "development",
    "hugo": "development",
    "ghost": "development",

    # Specific apps
    "homarr": "monitoring",
    "homer": "monitoring",
    "dashy": "monitoring",
    "heimdall": "monitoring",
    "organizr": "monitoring",
    "flame": "monitoring",
    "muximux": "monitoring",
    "sui": "monitoring",

    # Finance
    "firefly": "development",
    "actual-budget": "development",
    "gnucash": "development",
    "beancount": "development",

    # AI/ML
    "ollama": "development",
    "openai": "development",
    "chatgpt": "development",
    "anthropic": "development",
    "claude": "development",
    "stable-diffusion": "development",
    "automatic1111": "development",
    "comfyui": "development",
    "invoke-ai": "development",
    "text-generation": "development",
    "koboldai": "development",
    "oobabooga": "development",
    "localai": "development",
    "anything-llm": "development",
}

def categorize_icon(name: str) -> str:
    """Determine the best category for an icon based on its name."""
    # Normalize the name - keep hyphens for better matching
    name_lower = name.lower().replace(".svg", "").replace("-light", "").replace("-dark", "")
    name_normalized = name_lower.replace("-", " ").replace("_", " ")
    name_words = set(name_normalized.split())

    # Check specific apps first (exact matching)
    for app_key, category in SPECIFIC_APPS.items():
        if name_lower == app_key or name_lower.startswith(app_key + "-") or name_lower.endswith("-" + app_key):
            return category

    # Check category keywords with word-boundary matching
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            keyword_normalized = keyword.replace("-", " ")
            keyword_words = set(keyword_normalized.split())

            # Check for exact name match
            if name_lower == keyword:
                return category

            # Check if the icon name starts with the keyword (e.g., "docker-compose" matches "docker")
            if name_lower.startswith(keyword + "-"):
                return category

            # Check if keyword is a complete word in the name
            if keyword in name_words:
                return category

            # Check if all words of a multi-word keyword are present
            if len(keyword_words) > 1 and keyword_words.issubset(name_words):
                return category

            # For very long keywords (8+ chars), allow substring matching as they're specific enough
            if len(keyword) >= 8 and keyword in name_lower:
                return category

    # Default to development (largest catch-all for tech icons)
    return "development"


def format_name(filename: str) -> str:
    """Convert filename to a nice display name."""
    name = filename.replace(".svg", "")
    # Remove -light and -dark suffixes for cleaner names
    name = re.sub(r"-(light|dark)$", "", name)
    # Convert kebab-case to Title Case
    name = name.replace("-", " ").replace("_", " ")
    # Capitalize words
    words = name.split()
    formatted = []
    for word in words:
        # Handle common acronyms
        if word.upper() in ["AI", "ML", "API", "UI", "UX", "DB", "SQL", "AWS", "GCP", "DNS", "VPN", "SSH", "FTP", "NFS", "SMB", "HTTP", "HTTPS", "TCP", "UDP", "IP", "NAS", "VPS", "VM", "OS", "TV", "PC", "IT", "ID", "LLM", "GPU", "CPU", "RAM", "SSD", "HDD", "USB"]:
            formatted.append(word.upper())
        else:
            formatted.append(word.capitalize())
    return " ".join(formatted)


def main():
    # Get list of all SVG files
    svg_files = sorted([f for f in os.listdir(ICONS_DIR) if f.endswith(".svg")])
    print(f"Found {len(svg_files)} SVG icons to import")

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get existing icons to avoid duplicates
    cursor.execute("SELECT id FROM icons")
    existing_ids = set(row[0] for row in cursor.fetchall())
    print(f"Found {len(existing_ids)} existing icons in database")

    # Track stats
    imported = 0
    skipped = 0
    by_category = {}

    for filename in svg_files:
        # Create ID from filename
        icon_id = filename.replace(".svg", "").lower()

        # Skip if already exists
        if icon_id in existing_ids:
            skipped += 1
            continue

        # Categorize
        category = categorize_icon(filename)
        by_category[category] = by_category.get(category, 0) + 1

        # Format display name
        name = format_name(filename)

        # Build image URL path
        image_url = f"/api/icons/dashboard/{filename}"

        # Insert into database
        try:
            cursor.execute("""
                INSERT INTO icons (id, name, icon, category_id, color, is_preset, image_url)
                VALUES (?, ?, '', ?, '', 1, ?)
            """, (icon_id, name, category, image_url))
            imported += 1
        except sqlite3.IntegrityError as e:
            print(f"Error importing {filename}: {e}")
            skipped += 1

    # Commit changes
    conn.commit()
    conn.close()

    print(f"\nImport complete!")
    print(f"  Imported: {imported}")
    print(f"  Skipped (duplicates): {skipped}")
    print(f"\nIcons by category:")
    for cat, count in sorted(by_category.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
