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
