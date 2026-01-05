// Curated icon presets for homelab services and applications
// Using Material Design Icons (mdi) and Simple Icons collections

export interface IconPreset {
  id: string;
  name: string;
  category: string;
  icon: string; // Iconify icon name (e.g., 'mdi:docker', 'simple-icons:plex')
}

export const ICON_PRESETS: IconPreset[] = [
  // Container & Orchestration
  {
    id: 'containers-generic',
    name: 'Containers',
    category: 'containers',
    icon: 'mdi:package-variant-closed'
  },
  {
    id: 'docker',
    name: 'Docker',
    category: 'containers',
    icon: 'mdi:docker'
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    category: 'containers',
    icon: 'mdi:kubernetes'
  },
  {
    id: 'portainer',
    name: 'Portainer',
    category: 'containers',
    icon: 'simple-icons:portainer'
  },
  {
    id: 'podman',
    name: 'Podman',
    category: 'containers',
    icon: 'simple-icons:podman'
  },
  {
    id: 'rancher',
    name: 'Rancher',
    category: 'containers',
    icon: 'simple-icons:rancher'
  },

  // Media Servers
  {
    id: 'media-generic',
    name: 'Media',
    category: 'media',
    icon: 'mdi:filmstrip'
  },
  {
    id: 'media-play',
    name: 'Media Player',
    category: 'media',
    icon: 'mdi:play-circle'
  },
  {
    id: 'media-library',
    name: 'Media Library',
    category: 'media',
    icon: 'mdi:movie-open'
  },
  {
    id: 'plex',
    name: 'Plex',
    category: 'media',
    icon: 'simple-icons:plex'
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    category: 'media',
    icon: 'simple-icons:jellyfin'
  },
  {
    id: 'emby',
    name: 'Emby',
    category: 'media',
    icon: 'simple-icons:emby'
  },
  {
    id: 'kodi',
    name: 'Kodi',
    category: 'media',
    icon: 'simple-icons:kodi'
  },
  {
    id: 'sonarr',
    name: 'Sonarr',
    category: 'media',
    icon: 'simple-icons:sonarr'
  },
  {
    id: 'radarr',
    name: 'Radarr',
    category: 'media',
    icon: 'simple-icons:radarr'
  },
  {
    id: 'lidarr',
    name: 'Lidarr',
    category: 'media',
    icon: 'simple-icons:lidarr'
  },
  {
    id: 'prowlarr',
    name: 'Prowlarr',
    category: 'media',
    icon: 'simple-icons:prowlarr'
  },
  {
    id: 'bazarr',
    name: 'Bazarr',
    category: 'media',
    icon: 'simple-icons:bazarr'
  },
  {
    id: 'tautulli',
    name: 'Tautulli',
    category: 'media',
    icon: 'simple-icons:tautulli'
  },

  // Download Clients
  {
    id: 'downloads-generic',
    name: 'Downloads',
    category: 'downloads',
    icon: 'mdi:download'
  },
  {
    id: 'downloads-arrow',
    name: 'Download Arrow',
    category: 'downloads',
    icon: 'mdi:arrow-down-bold-circle'
  },
  {
    id: 'transmission',
    name: 'Transmission',
    category: 'downloads',
    icon: 'simple-icons:transmission'
  },
  {
    id: 'deluge',
    name: 'Deluge',
    category: 'downloads',
    icon: 'mdi:download'
  },
  {
    id: 'qbittorrent',
    name: 'qBittorrent',
    category: 'downloads',
    icon: 'simple-icons:qbittorrent'
  },
  {
    id: 'sabnzbd',
    name: 'SABnzbd',
    category: 'downloads',
    icon: 'mdi:download-box'
  },
  {
    id: 'nzbget',
    name: 'NZBGet',
    category: 'downloads',
    icon: 'mdi:download-circle'
  },

  // Home Automation
  {
    id: 'automation-generic',
    name: 'Automation',
    category: 'automation',
    icon: 'mdi:home-automation'
  },
  {
    id: 'automation-robot',
    name: 'Robot',
    category: 'automation',
    icon: 'mdi:robot'
  },
  {
    id: 'automation-cog',
    name: 'Automation Cog',
    category: 'automation',
    icon: 'mdi:cog-transfer'
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    category: 'automation',
    icon: 'simple-icons:homeassistant'
  },
  {
    id: 'nodered',
    name: 'Node-RED',
    category: 'automation',
    icon: 'simple-icons:nodered'
  },
  {
    id: 'mqtt',
    name: 'MQTT',
    category: 'automation',
    icon: 'simple-icons:mqtt'
  },
  {
    id: 'zigbee',
    name: 'Zigbee',
    category: 'automation',
    icon: 'simple-icons:zigbee'
  },
  {
    id: 'esphome',
    name: 'ESPHome',
    category: 'automation',
    icon: 'simple-icons:esphome'
  },
  {
    id: 'homebridge',
    name: 'Homebridge',
    category: 'automation',
    icon: 'simple-icons:homebridge'
  },

  // Monitoring & Dashboards
  {
    id: 'monitoring-generic',
    name: 'Monitoring',
    category: 'monitoring',
    icon: 'mdi:chart-line'
  },
  {
    id: 'monitoring-pulse',
    name: 'Pulse',
    category: 'monitoring',
    icon: 'mdi:pulse'
  },
  {
    id: 'monitoring-gauge',
    name: 'Gauge',
    category: 'monitoring',
    icon: 'mdi:gauge'
  },
  {
    id: 'monitoring-eye',
    name: 'Eye Monitor',
    category: 'monitoring',
    icon: 'mdi:eye'
  },
  {
    id: 'grafana',
    name: 'Grafana',
    category: 'monitoring',
    icon: 'simple-icons:grafana'
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    category: 'monitoring',
    icon: 'simple-icons:prometheus'
  },
  {
    id: 'influxdb',
    name: 'InfluxDB',
    category: 'monitoring',
    icon: 'simple-icons:influxdb'
  },
  {
    id: 'telegraf',
    name: 'Telegraf',
    category: 'monitoring',
    icon: 'mdi:chart-line'
  },
  {
    id: 'netdata',
    name: 'Netdata',
    category: 'monitoring',
    icon: 'simple-icons:netdata'
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'monitoring',
    icon: 'mdi:heartbeat'
  },
  {
    id: 'zabbix',
    name: 'Zabbix',
    category: 'monitoring',
    icon: 'simple-icons:zabbix'
  },

  // Storage & NAS
  {
    id: 'storage-generic',
    name: 'Storage',
    category: 'storage',
    icon: 'mdi:nas'
  },
  {
    id: 'storage-hdd',
    name: 'Hard Drive',
    category: 'storage',
    icon: 'mdi:harddisk'
  },
  {
    id: 'storage-folder',
    name: 'Folder Network',
    category: 'storage',
    icon: 'mdi:folder-network'
  },
  {
    id: 'storage-database',
    name: 'Database Storage',
    category: 'storage',
    icon: 'mdi:database'
  },
  {
    id: 'truenas',
    name: 'TrueNAS',
    category: 'storage',
    icon: 'simple-icons:truenas'
  },
  {
    id: 'unraid',
    name: 'Unraid',
    category: 'storage',
    icon: 'simple-icons:unraid'
  },
  {
    id: 'synology',
    name: 'Synology',
    category: 'storage',
    icon: 'simple-icons:synology'
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    category: 'storage',
    icon: 'simple-icons:nextcloud'
  },
  {
    id: 'owncloud',
    name: 'ownCloud',
    category: 'storage',
    icon: 'simple-icons:owncloud'
  },
  {
    id: 'minio',
    name: 'MinIO',
    category: 'storage',
    icon: 'simple-icons:minio'
  },
  {
    id: 'samba',
    name: 'Samba',
    category: 'storage',
    icon: 'mdi:server-network'
  },
  {
    id: 'nfs',
    name: 'NFS',
    category: 'storage',
    icon: 'mdi:folder-network'
  },

  // Virtualization
  {
    id: 'virtualization-generic',
    name: 'Virtualization',
    category: 'virtualization',
    icon: 'mdi:server-plus'
  },
  {
    id: 'virtualization-vm',
    name: 'Virtual Machine',
    category: 'virtualization',
    icon: 'mdi:laptop'
  },
  {
    id: 'virtualization-layers',
    name: 'Layers',
    category: 'virtualization',
    icon: 'mdi:layers-triple'
  },
  {
    id: 'proxmox',
    name: 'Proxmox',
    category: 'virtualization',
    icon: 'simple-icons:proxmox'
  },
  {
    id: 'vmware',
    name: 'VMware',
    category: 'virtualization',
    icon: 'simple-icons:vmware'
  },
  {
    id: 'virtualbox',
    name: 'VirtualBox',
    category: 'virtualization',
    icon: 'simple-icons:virtualbox'
  },
  {
    id: 'qemu',
    name: 'QEMU',
    category: 'virtualization',
    icon: 'simple-icons:qemu'
  },

  // Networking
  {
    id: 'networking-generic',
    name: 'Network',
    category: 'networking',
    icon: 'mdi:network'
  },
  {
    id: 'networking-lan',
    name: 'LAN',
    category: 'networking',
    icon: 'mdi:lan'
  },
  {
    id: 'networking-router',
    name: 'Router',
    category: 'networking',
    icon: 'mdi:router'
  },
  {
    id: 'networking-ethernet',
    name: 'Ethernet',
    category: 'networking',
    icon: 'mdi:ethernet'
  },
  {
    id: 'networking-wifi',
    name: 'WiFi',
    category: 'networking',
    icon: 'mdi:wifi'
  },
  {
    id: 'networking-firewall',
    name: 'Firewall',
    category: 'networking',
    icon: 'mdi:wall-fire'
  },
  {
    id: 'networking-switch',
    name: 'Network Switch',
    category: 'networking',
    icon: 'mdi:switch'
  },
  {
    id: 'networking-vpn',
    name: 'VPN',
    category: 'networking',
    icon: 'mdi:vpn'
  },
  {
    id: 'pfsense',
    name: 'pfSense',
    category: 'networking',
    icon: 'simple-icons:pfsense'
  },
  {
    id: 'opnsense',
    name: 'OPNsense',
    category: 'networking',
    icon: 'mdi:router-network'
  },
  {
    id: 'pihole',
    name: 'Pi-hole',
    category: 'networking',
    icon: 'simple-icons:pihole'
  },
  {
    id: 'adguard',
    name: 'AdGuard Home',
    category: 'networking',
    icon: 'simple-icons:adguard'
  },
  {
    id: 'unifi',
    name: 'UniFi',
    category: 'networking',
    icon: 'simple-icons:ubiquiti'
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    category: 'networking',
    icon: 'simple-icons:wireguard'
  },
  {
    id: 'openvpn',
    name: 'OpenVPN',
    category: 'networking',
    icon: 'simple-icons:openvpn'
  },
  {
    id: 'nginx',
    name: 'Nginx',
    category: 'networking',
    icon: 'simple-icons:nginx'
  },
  {
    id: 'traefik',
    name: 'Traefik',
    category: 'networking',
    icon: 'simple-icons:traefikproxy'
  },
  {
    id: 'haproxy',
    name: 'HAProxy',
    category: 'networking',
    icon: 'simple-icons:haproxy'
  },
  {
    id: 'caddy',
    name: 'Caddy',
    category: 'networking',
    icon: 'simple-icons:caddy'
  },

  // Databases
  {
    id: 'databases-generic',
    name: 'Database',
    category: 'databases',
    icon: 'mdi:database'
  },
  {
    id: 'databases-table',
    name: 'Database Table',
    category: 'databases',
    icon: 'mdi:table'
  },
  {
    id: 'databases-search',
    name: 'Database Search',
    category: 'databases',
    icon: 'mdi:database-search'
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'databases',
    icon: 'simple-icons:postgresql'
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'databases',
    icon: 'simple-icons:mysql'
  },
  {
    id: 'mariadb',
    name: 'MariaDB',
    category: 'databases',
    icon: 'simple-icons:mariadb'
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    category: 'databases',
    icon: 'simple-icons:mongodb'
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'databases',
    icon: 'simple-icons:redis'
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    category: 'databases',
    icon: 'simple-icons:sqlite'
  },

  // Development Tools
  {
    id: 'development-generic',
    name: 'Development',
    category: 'development',
    icon: 'mdi:code-tags'
  },
  {
    id: 'development-code',
    name: 'Code',
    category: 'development',
    icon: 'mdi:code-braces'
  },
  {
    id: 'development-console',
    name: 'Console',
    category: 'development',
    icon: 'mdi:console'
  },
  {
    id: 'git',
    name: 'Git',
    category: 'development',
    icon: 'simple-icons:git'
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'development',
    icon: 'simple-icons:github'
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'development',
    icon: 'simple-icons:gitlab'
  },
  {
    id: 'gitea',
    name: 'Gitea',
    category: 'development',
    icon: 'simple-icons:gitea'
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    category: 'development',
    icon: 'simple-icons:jenkins'
  },
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'development',
    icon: 'simple-icons:visualstudiocode'
  },

  // Backup & Recovery
  {
    id: 'backup-generic',
    name: 'Backup',
    category: 'backup',
    icon: 'mdi:backup-restore'
  },
  {
    id: 'backup-cloud',
    name: 'Cloud Backup',
    category: 'backup',
    icon: 'mdi:cloud-upload'
  },
  {
    id: 'backup-sync',
    name: 'Sync',
    category: 'backup',
    icon: 'mdi:sync'
  },
  {
    id: 'duplicati',
    name: 'Duplicati',
    category: 'backup',
    icon: 'mdi:backup-restore'
  },
  {
    id: 'restic',
    name: 'Restic',
    category: 'backup',
    icon: 'mdi:cloud-upload'
  },
  {
    id: 'borg',
    name: 'BorgBackup',
    category: 'backup',
    icon: 'mdi:shield-check'
  },
  {
    id: 'rclone',
    name: 'Rclone',
    category: 'backup',
    icon: 'mdi:sync'
  },

  // Communication
  {
    id: 'communication-generic',
    name: 'Communication',
    category: 'communication',
    icon: 'mdi:message'
  },
  {
    id: 'communication-chat',
    name: 'Chat',
    category: 'communication',
    icon: 'mdi:chat'
  },
  {
    id: 'communication-forum',
    name: 'Forum',
    category: 'communication',
    icon: 'mdi:forum'
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'communication',
    icon: 'simple-icons:discord'
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    icon: 'simple-icons:slack'
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    category: 'communication',
    icon: 'simple-icons:mattermost'
  },
  {
    id: 'rocketchat',
    name: 'Rocket.Chat',
    category: 'communication',
    icon: 'simple-icons:rocketchat'
  },

  // Password Managers
  {
    id: 'security-generic',
    name: 'Security',
    category: 'security',
    icon: 'mdi:shield'
  },
  {
    id: 'security-lock',
    name: 'Lock',
    category: 'security',
    icon: 'mdi:lock'
  },
  {
    id: 'security-key',
    name: 'Key',
    category: 'security',
    icon: 'mdi:key'
  },
  {
    id: 'security-password',
    name: 'Password',
    category: 'security',
    icon: 'mdi:form-textbox-password'
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    category: 'security',
    icon: 'mdi:shield-key'
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    category: 'security',
    icon: 'simple-icons:bitwarden'
  },
  {
    id: 'keepass',
    name: 'KeePass',
    category: 'security',
    icon: 'mdi:key-variant'
  },
  {
    id: 'authelia',
    name: 'Authelia',
    category: 'security',
    icon: 'mdi:shield-account'
  },

  // Hardware
  {
    id: 'hardware-generic',
    name: 'Hardware',
    category: 'hardware',
    icon: 'mdi:chip'
  },
  {
    id: 'hardware-server',
    name: 'Server',
    category: 'hardware',
    icon: 'mdi:server'
  },
  {
    id: 'hardware-cpu',
    name: 'CPU',
    category: 'hardware',
    icon: 'mdi:cpu-64-bit'
  },
  {
    id: 'hardware-memory',
    name: 'Memory',
    category: 'hardware',
    icon: 'mdi:memory'
  },
  {
    id: 'raspberrypi',
    name: 'Raspberry Pi',
    category: 'hardware',
    icon: 'simple-icons:raspberrypi'
  },
  {
    id: 'arduino',
    name: 'Arduino',
    category: 'hardware',
    icon: 'simple-icons:arduino'
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    category: 'hardware',
    icon: 'simple-icons:nvidia'
  },
  {
    id: 'intel',
    name: 'Intel',
    category: 'hardware',
    icon: 'simple-icons:intel'
  },
  {
    id: 'amd',
    name: 'AMD',
    category: 'hardware',
    icon: 'simple-icons:amd'
  },

  // Operating Systems
  {
    id: 'os-generic',
    name: 'Operating System',
    category: 'os',
    icon: 'mdi:linux'
  },
  {
    id: 'os-desktop',
    name: 'Desktop',
    category: 'os',
    icon: 'mdi:desktop-classic'
  },
  {
    id: 'os-terminal',
    name: 'Terminal',
    category: 'os',
    icon: 'mdi:console-line'
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu',
    category: 'os',
    icon: 'simple-icons:ubuntu'
  },
  {
    id: 'debian',
    name: 'Debian',
    category: 'os',
    icon: 'simple-icons:debian'
  },
  {
    id: 'centos',
    name: 'CentOS',
    category: 'os',
    icon: 'simple-icons:centos'
  },
  {
    id: 'redhat',
    name: 'Red Hat',
    category: 'os',
    icon: 'simple-icons:redhat'
  },
  {
    id: 'alpine',
    name: 'Alpine Linux',
    category: 'os',
    icon: 'simple-icons:alpinelinux'
  },
  {
    id: 'arch',
    name: 'Arch Linux',
    category: 'os',
    icon: 'simple-icons:archlinux'
  },
  {
    id: 'windows',
    name: 'Windows',
    category: 'os',
    icon: 'simple-icons:windows'
  },

  // Generic Icons
  {
    id: 'web',
    name: 'Web Browser',
    category: 'generic',
    icon: 'mdi:web'
  },
  {
    id: 'server',
    name: 'Server',
    category: 'generic',
    icon: 'mdi:server'
  },
  {
    id: 'cloud',
    name: 'Cloud',
    category: 'generic',
    icon: 'mdi:cloud'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'generic',
    icon: 'mdi:terminal'
  },
  {
    id: 'folder',
    name: 'Folder',
    category: 'generic',
    icon: 'mdi:folder'
  },
  {
    id: 'file',
    name: 'File',
    category: 'generic',
    icon: 'mdi:file'
  },
  {
    id: 'settings',
    name: 'Settings',
    category: 'generic',
    icon: 'mdi:cog'
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    category: 'generic',
    icon: 'mdi:view-dashboard'
  },
  {
    id: 'chart',
    name: 'Chart',
    category: 'generic',
    icon: 'mdi:chart-line'
  },
  {
    id: 'camera',
    name: 'Camera',
    category: 'generic',
    icon: 'mdi:camera'
  },
  {
    id: 'video',
    name: 'Video',
    category: 'generic',
    icon: 'mdi:video'
  },
  {
    id: 'music',
    name: 'Music',
    category: 'generic',
    icon: 'mdi:music'
  },
  {
    id: 'book',
    name: 'Book',
    category: 'generic',
    icon: 'mdi:book'
  },
  {
    id: 'email',
    name: 'Email',
    category: 'generic',
    icon: 'mdi:email'
  },
  {
    id: 'calendar',
    name: 'Calendar',
    category: 'generic',
    icon: 'mdi:calendar'
  },
  {
    id: 'clock',
    name: 'Clock',
    category: 'generic',
    icon: 'mdi:clock'
  },
  {
    id: 'bell',
    name: 'Notifications',
    category: 'generic',
    icon: 'mdi:bell'
  },
  {
    id: 'shield',
    name: 'Security',
    category: 'generic',
    icon: 'mdi:shield'
  },
  {
    id: 'lock',
    name: 'Lock',
    category: 'generic',
    icon: 'mdi:lock'
  },
  {
    id: 'key',
    name: 'Key',
    category: 'generic',
    icon: 'mdi:key'
  },

  // Additional Popular Homelab Services (with brand colors from Simple Icons)

  // More Media & Streaming
  {
    id: 'spotify',
    name: 'Spotify',
    category: 'media',
    icon: 'simple-icons:spotify'
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'media',
    icon: 'simple-icons:youtube'
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'media',
    icon: 'simple-icons:twitch'
  },
  {
    id: 'subsonic',
    name: 'Subsonic',
    category: 'media',
    icon: 'simple-icons:subsonic'
  },

  // More Download Clients
  {
    id: 'utorrent',
    name: 'uTorrent',
    category: 'downloads',
    icon: 'simple-icons:utorrent'
  },
  {
    id: 'jdownloader',
    name: 'JDownloader',
    category: 'downloads',
    icon: 'mdi:download-network'
  },
  {
    id: 'aria2',
    name: 'aria2',
    category: 'downloads',
    icon: 'mdi:download-multiple'
  },

  // More Monitoring & Analytics
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'monitoring',
    icon: 'simple-icons:datadog'
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    category: 'monitoring',
    icon: 'simple-icons:newrelic'
  },
  {
    id: 'elastic',
    name: 'Elastic',
    category: 'monitoring',
    icon: 'simple-icons:elastic'
  },
  {
    id: 'kibana',
    name: 'Kibana',
    category: 'monitoring',
    icon: 'simple-icons:kibana'
  },
  {
    id: 'logstash',
    name: 'Logstash',
    category: 'monitoring',
    icon: 'simple-icons:logstash'
  },
  {
    id: 'splunk',
    name: 'Splunk',
    category: 'monitoring',
    icon: 'simple-icons:splunk'
  },

  // More Storage & File Management
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    icon: 'simple-icons:dropbox'
  },
  {
    id: 'googledrive',
    name: 'Google Drive',
    category: 'storage',
    icon: 'simple-icons:googledrive'
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    category: 'storage',
    icon: 'simple-icons:onedrive'
  },
  {
    id: 'box',
    name: 'Box',
    category: 'storage',
    icon: 'simple-icons:box'
  },
  {
    id: 'mega',
    name: 'MEGA',
    category: 'storage',
    icon: 'simple-icons:mega'
  },
  {
    id: 'seafile',
    name: 'Seafile',
    category: 'storage',
    icon: 'simple-icons:seafile'
  },
  {
    id: 'filezilla',
    name: 'FileZilla',
    category: 'storage',
    icon: 'simple-icons:filezilla'
  },

  // More Networking Services
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'networking',
    icon: 'simple-icons:cloudflare'
  },
  {
    id: 'zerotier',
    name: 'ZeroTier',
    category: 'networking',
    icon: 'simple-icons:zerotier'
  },
  {
    id: 'mikrotik',
    name: 'MikroTik',
    category: 'networking',
    icon: 'simple-icons:mikrotik'
  },
  {
    id: 'cisco',
    name: 'Cisco',
    category: 'networking',
    icon: 'simple-icons:cisco'
  },

  // More Databases
  {
    id: 'cassandra',
    name: 'Cassandra',
    category: 'databases',
    icon: 'simple-icons:apachecassandra'
  },
  {
    id: 'couchdb',
    name: 'CouchDB',
    category: 'databases',
    icon: 'simple-icons:apachecouchdb'
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    category: 'databases',
    icon: 'simple-icons:elasticsearch'
  },
  {
    id: 'oracle',
    name: 'Oracle',
    category: 'databases',
    icon: 'simple-icons:oracle'
  },

  // More Development Tools
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    category: 'development',
    icon: 'simple-icons:bitbucket'
  },
  {
    id: 'intellij',
    name: 'IntelliJ',
    category: 'development',
    icon: 'simple-icons:intellijidea'
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    category: 'development',
    icon: 'simple-icons:sublimetext'
  },
  {
    id: 'atom',
    name: 'Atom',
    category: 'development',
    icon: 'simple-icons:atom'
  },
  {
    id: 'vim',
    name: 'Vim',
    category: 'development',
    icon: 'simple-icons:vim'
  },
  {
    id: 'npm',
    name: 'npm',
    category: 'development',
    icon: 'simple-icons:npm'
  },
  {
    id: 'yarn',
    name: 'Yarn',
    category: 'development',
    icon: 'simple-icons:yarn'
  },
  {
    id: 'webpack',
    name: 'Webpack',
    category: 'development',
    icon: 'simple-icons:webpack'
  },
  {
    id: 'babel',
    name: 'Babel',
    category: 'development',
    icon: 'simple-icons:babel'
  },

  // More Communication Tools
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'communication',
    icon: 'simple-icons:telegram'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'communication',
    icon: 'simple-icons:whatsapp'
  },
  {
    id: 'signal',
    name: 'Signal',
    category: 'communication',
    icon: 'simple-icons:signal'
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'communication',
    icon: 'simple-icons:microsoftteams'
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    icon: 'simple-icons:zoom'
  },
  {
    id: 'skype',
    name: 'Skype',
    category: 'communication',
    icon: 'simple-icons:skype'
  },
  {
    id: 'element',
    name: 'Element',
    category: 'communication',
    icon: 'simple-icons:element'
  },
  {
    id: 'matrix',
    name: 'Matrix',
    category: 'communication',
    icon: 'simple-icons:matrix'
  },
  {
    id: 'irc',
    name: 'IRC',
    category: 'communication',
    icon: 'mdi:chat'
  },

  // More Operating Systems
  {
    id: 'macos',
    name: 'macOS',
    category: 'os',
    icon: 'simple-icons:apple'
  },
  {
    id: 'android',
    name: 'Android',
    category: 'os',
    icon: 'simple-icons:android'
  },
  {
    id: 'ios',
    name: 'iOS',
    category: 'os',
    icon: 'simple-icons:ios'
  },

  // More Security Tools
  {
    id: 'onepassword',
    name: '1Password',
    category: 'security',
    icon: 'simple-icons:1password'
  },
  {
    id: 'lastpass',
    name: 'LastPass',
    category: 'security',
    icon: 'simple-icons:lastpass'
  },
  {
    id: 'authy',
    name: 'Authy',
    category: 'security',
    icon: 'simple-icons:authy'
  },
  {
    id: 'letsencrypt',
    name: "Let's Encrypt",
    category: 'security',
    icon: 'simple-icons:letsencrypt'
  },
  {
    id: 'snort',
    name: 'Snort',
    category: 'security',
    icon: 'mdi:security-network'
  },
  {
    id: 'suricata',
    name: 'Suricata',
    category: 'security',
    icon: 'mdi:shield-bug'
  },

  // Cloud Platforms
  {
    id: 'aws',
    name: 'AWS',
    category: 'virtualization',
    icon: 'simple-icons:amazonaws'
  },
  {
    id: 'azure',
    name: 'Azure',
    category: 'virtualization',
    icon: 'simple-icons:microsoftazure'
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    category: 'virtualization',
    icon: 'simple-icons:googlecloud'
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    category: 'virtualization',
    icon: 'simple-icons:digitalocean'
  },
  {
    id: 'linode',
    name: 'Linode',
    category: 'virtualization',
    icon: 'simple-icons:linode'
  },
  {
    id: 'vultr',
    name: 'Vultr',
    category: 'virtualization',
    icon: 'simple-icons:vultr'
  },
  {
    id: 'ovh',
    name: 'OVH',
    category: 'virtualization',
    icon: 'simple-icons:ovh'
  },
  {
    id: 'hetzner',
    name: 'Hetzner',
    category: 'virtualization',
    icon: 'simple-icons:hetzner'
  },

  // Additional Hardware Brands
  {
    id: 'hp',
    name: 'HP',
    category: 'hardware',
    icon: 'simple-icons:hp'
  },
  {
    id: 'dell',
    name: 'Dell',
    category: 'hardware',
    icon: 'simple-icons:dell'
  },
  {
    id: 'supermicro',
    name: 'Supermicro',
    category: 'hardware',
    icon: 'mdi:server-security'
  },
  {
    id: 'lenovo',
    name: 'Lenovo',
    category: 'hardware',
    icon: 'simple-icons:lenovo'
  },
  {
    id: 'asus',
    name: 'ASUS',
    category: 'hardware',
    icon: 'simple-icons:asus'
  }
];

export const ICON_CATEGORIES = [
  { id: 'containers', name: 'Containers', icon: 'mdi:docker' },
  { id: 'media', name: 'Media', icon: 'mdi:filmstrip' },
  { id: 'downloads', name: 'Downloads', icon: 'mdi:download' },
  { id: 'automation', name: 'Automation', icon: 'mdi:home-automation' },
  { id: 'monitoring', name: 'Monitoring', icon: 'mdi:chart-line' },
  { id: 'storage', name: 'Storage', icon: 'mdi:nas' },
  { id: 'virtualization', name: 'Virtualization', icon: 'mdi:server-plus' },
  { id: 'networking', name: 'Networking', icon: 'mdi:network' },
  { id: 'databases', name: 'Databases', icon: 'mdi:database' },
  { id: 'development', name: 'Development', icon: 'mdi:code-tags' },
  { id: 'backup', name: 'Backup', icon: 'mdi:backup-restore' },
  { id: 'communication', name: 'Communication', icon: 'mdi:message' },
  { id: 'security', name: 'Security', icon: 'mdi:shield' },
  { id: 'hardware', name: 'Hardware', icon: 'mdi:chip' },
  { id: 'os', name: 'Operating Systems', icon: 'mdi:linux' },
  { id: 'generic', name: 'Generic', icon: 'mdi:apps' }
];
