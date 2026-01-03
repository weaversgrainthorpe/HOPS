// Brand colors for Simple Icons
// These are the official brand colors from https://simpleicons.org/

export const ICON_COLORS: Record<string, string> = {
  // Media & Streaming
  'simple-icons:spotify': '#1DB954',
  'simple-icons:plex': '#E5A00D',
  'simple-icons:jellyfin': '#00A4DC',
  'simple-icons:emby': '#52B54B',
  'simple-icons:youtube': '#FF0000',
  'simple-icons:twitch': '#9146FF',
  'simple-icons:subsonic': '#3793FF',
  'simple-icons:kodi': '#17B2E7',

  // Containers
  'simple-icons:docker': '#2496ED',
  'simple-icons:kubernetes': '#326CE5',
  'simple-icons:portainer': '#13BEF9',
  'simple-icons:podman': '#892CA0',
  'simple-icons:rancher': '#0075A8',

  // Downloads
  'simple-icons:qbittorrent': '#2f67ba',
  'simple-icons:deluge': '#3f4652',
  'simple-icons:utorrent': '#44C527',

  // Monitoring
  'simple-icons:grafana': '#F46800',
  'simple-icons:prometheus': '#E6522C',
  'simple-icons:datadog': '#632CA6',
  'simple-icons:newrelic': '#008C99',
  'simple-icons:elastic': '#005571',
  'simple-icons:kibana': '#005571',
  'simple-icons:logstash': '#005571',
  'simple-icons:splunk': '#000000',
  'simple-icons:influxdb': '#22ADF6',

  // Storage
  'simple-icons:nextcloud': '#0082C9',
  'simple-icons:dropbox': '#0061FF',
  'simple-icons:googledrive': '#4285F4',
  'simple-icons:onedrive': '#0078D4',
  'simple-icons:box': '#0061D5',
  'simple-icons:mega': '#D9272E',
  'simple-icons:seafile': '#E49F3D',
  'simple-icons:syncthing': '#0891D1',
  'simple-icons:filezilla': '#BF0000',

  // Networking
  'simple-icons:cloudflare': '#F38020',
  'simple-icons:nginx': '#009639',
  'simple-icons:traefik': '#24A1C1',
  'simple-icons:wireguard': '#88171A',
  'simple-icons:openvpn': '#EA7E20',
  'simple-icons:tailscale': '#000000',
  'simple-icons:zerotier': '#FFB441',
  'simple-icons:ubiquiti': '#0559C9',
  'simple-icons:mikrotik': '#293239',
  'simple-icons:cisco': '#1BA0D7',

  // Databases
  'simple-icons:postgresql': '#4169E1',
  'simple-icons:mysql': '#4479A1',
  'simple-icons:mariadb': '#003545',
  'simple-icons:mongodb': '#47A248',
  'simple-icons:redis': '#DC382D',
  'simple-icons:apachecassandra': '#1287B1',
  'simple-icons:apachecouchdb': '#E42528',
  'simple-icons:elasticsearch': '#005571',
  'simple-icons:oracle': '#F80000',
  'simple-icons:sqlite': '#003B57',

  // Development
  'simple-icons:github': '#181717',
  'simple-icons:gitlab': '#FC6D26',
  'simple-icons:bitbucket': '#0052CC',
  'simple-icons:jenkins': '#D24939',
  'simple-icons:gitea': '#609926',
  'simple-icons:visualstudiocode': '#007ACC',
  'simple-icons:intellijidea': '#000000',
  'simple-icons:sublimetext': '#FF9800',
  'simple-icons:atom': '#66595C',
  'simple-icons:vim': '#019733',
  'simple-icons:npm': '#CB3837',
  'simple-icons:yarn': '#2C8EBB',
  'simple-icons:webpack': '#8DD6F9',
  'simple-icons:babel': '#F9DC3E',

  // Communication
  'simple-icons:discord': '#5865F2',
  'simple-icons:slack': '#4A154B',
  'simple-icons:telegram': '#26A5E4',
  'simple-icons:whatsapp': '#25D366',
  'simple-icons:signal': '#3A76F0',
  'simple-icons:microsoftteams': '#6264A7',
  'simple-icons:zoom': '#2D8CFF',
  'simple-icons:skype': '#00AFF0',
  'simple-icons:element': '#0DBD8B',
  'simple-icons:matrix': '#000000',

  // Operating Systems
  'simple-icons:ubuntu': '#E95420',
  'simple-icons:debian': '#A81D33',
  'simple-icons:fedora': '#51A2DA',
  'simple-icons:centos': '#262577',
  'simple-icons:redhat': '#EE0000',
  'simple-icons:archlinux': '#1793D1',
  'simple-icons:alpinelinux': '#0D597F',
  'simple-icons:freebsd': '#AB2B28',
  'simple-icons:windows': '#0078D6',
  'simple-icons:apple': '#000000',
  'simple-icons:android': '#3DDC84',
  'simple-icons:ios': '#000000',

  // Security
  'simple-icons:bitwarden': '#175DDC',
  'simple-icons:1password': '#0094F5',
  'simple-icons:lastpass': '#D32D27',
  'simple-icons:keepass': '#6CAC4D',
  'simple-icons:authy': '#EC1C24',
  'simple-icons:letsencrypt': '#003A70',

  // Cloud
  'simple-icons:amazonaws': '#FF9900',
  'simple-icons:microsoftazure': '#0078D4',
  'simple-icons:googlecloud': '#4285F4',
  'simple-icons:digitalocean': '#0080FF',
  'simple-icons:linode': '#00A95C',
  'simple-icons:vultr': '#007BFC',
  'simple-icons:ovh': '#123F6D',
  'simple-icons:hetzner': '#D50C2D',

  // Hardware
  'simple-icons:hp': '#0096D6',
  'simple-icons:dell': '#007DB8',
  'simple-icons:intel': '#0071C5',
  'simple-icons:amd': '#ED1C24',
  'simple-icons:nvidia': '#76B900',
  'simple-icons:lenovo': '#E2231A',
  'simple-icons:asus': '#000000',

  // Virtualization
  'simple-icons:proxmox': '#E57000',
  'simple-icons:vmware': '#607078',
  'simple-icons:virtualbox': '#183A61'
};

/**
 * Get the brand color for an icon
 */
export function getIconColor(iconName: string): string | undefined {
  return ICON_COLORS[iconName];
}
