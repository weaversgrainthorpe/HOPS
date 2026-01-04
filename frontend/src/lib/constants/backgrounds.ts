// Bundled royalty-free background images
// These are served from /presets/ directory by the backend

export interface BackgroundImage {
  id: string;
  name: string;
  category: string;
  url: string;
  source: 'preset' | 'uploaded';
  thumbnail?: string;
}

export interface BackgroundCategory {
  id: string;
  name: string;
  icon: string;
}

// Alias for backwards compatibility
export type BackgroundPreset = BackgroundImage;

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  // Network themed
  {
    id: 'network-1',
    name: 'Network Grid',
    category: 'network',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'network-2',
    name: 'Data Center',
    category: 'network',
    url: '/presets/data-center.jpg',
    source: 'preset'
  },
  {
    id: 'network-3',
    name: 'Fiber Optics',
    category: 'network',
    url: '/presets/fiber-optics.jpg',
    source: 'preset'
  },
  {
    id: 'network-4',
    name: 'Network Cables',
    category: 'network',
    url: '/presets/network-cables.jpg',
    source: 'preset'
  },
  {
    id: 'network-5',
    name: 'Switch Panel',
    category: 'network',
    url: '/presets/switch-panel.jpg',
    source: 'preset'
  },
  {
    id: 'network-6',
    name: 'Blue Cables',
    category: 'network',
    url: '/presets/blue-cables.jpg',
    source: 'preset'
  },
  {
    id: 'network-7',
    name: 'Abstract Network',
    category: 'network',
    url: '/presets/abstract-network.jpg',
    source: 'preset'
  },
  {
    id: 'network-8',
    name: 'Tech Lines',
    category: 'network',
    url: '/presets/tech-lines.jpg',
    source: 'preset'
  },

  // Server / Infrastructure themed
  {
    id: 'server-1',
    name: 'Server Room',
    category: 'servers',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'server-2',
    name: 'Data Center Aisle',
    category: 'servers',
    url: '/presets/data-center-aisle.jpg',
    source: 'preset'
  },
  {
    id: 'server-3',
    name: 'Cloud Infrastructure',
    category: 'servers',
    url: '/presets/fiber-optics.jpg',
    source: 'preset'
  },
  {
    id: 'server-4',
    name: 'Rack Servers',
    category: 'servers',
    url: '/presets/rack-servers.jpg',
    source: 'preset'
  },
  {
    id: 'server-5',
    name: 'Server Hardware',
    category: 'servers',
    url: '/presets/server-hardware.jpg',
    source: 'preset'
  },
  {
    id: 'server-6',
    name: 'Blue Server Lights',
    category: 'servers',
    url: '/presets/data-center.jpg',
    source: 'preset'
  },
  {
    id: 'server-7',
    name: 'Modern Data Center',
    category: 'servers',
    url: '/presets/circuit-board.jpg',
    source: 'preset'
  },
  {
    id: 'server-8',
    name: 'Server Closeup',
    category: 'servers',
    url: '/presets/server-closeup.jpg',
    source: 'preset'
  },

  // Docker / Containers
  {
    id: 'docker-1',
    name: 'Container Ship',
    category: 'docker',
    url: '/presets/container-ship.jpg',
    source: 'preset'
  },
  {
    id: 'docker-2',
    name: 'Shipping Containers',
    category: 'docker',
    url: '/presets/shipping-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-3',
    name: 'Container Stack',
    category: 'docker',
    url: '/presets/container-stack.jpg',
    source: 'preset'
  },
  {
    id: 'docker-4',
    name: 'Blue Containers',
    category: 'docker',
    url: '/presets/blue-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-5',
    name: 'Container Port',
    category: 'docker',
    url: '/presets/container-port.jpg',
    source: 'preset'
  },
  {
    id: 'docker-6',
    name: 'Red Containers',
    category: 'docker',
    url: '/presets/red-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-7',
    name: 'Container Yard',
    category: 'docker',
    url: '/presets/container-yard.jpg',
    source: 'preset'
  },
  {
    id: 'docker-8',
    name: 'Ship Deck',
    category: 'docker',
    url: '/presets/ship-deck.jpg',
    source: 'preset'
  },

  // Homelab
  {
    id: 'homelab-1',
    name: 'Home Server Rack',
    category: 'homelab',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-2',
    name: 'Raspberry Pi Cluster',
    category: 'homelab',
    url: '/presets/raspberry-pi.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-3',
    name: 'Electronics Workbench',
    category: 'homelab',
    url: '/presets/electronics-workbench.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-4',
    name: 'Tech Desk Setup',
    category: 'homelab',
    url: '/presets/tech-desk.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-5',
    name: 'PC Hardware',
    category: 'homelab',
    url: '/presets/pc-hardware.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-6',
    name: 'LED Gaming Setup',
    category: 'homelab',
    url: '/presets/led-gaming.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-7',
    name: 'Network Equipment',
    category: 'homelab',
    url: '/presets/network-equipment.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-8',
    name: 'Home Office Tech',
    category: 'homelab',
    url: '/presets/home-office.jpg',
    source: 'preset'
  },

  // Smart Home themed
  {
    id: 'smarthome-1',
    name: 'Modern Smart Home',
    category: 'smarthome',
    url: '/presets/data-center-aisle.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-2',
    name: 'Home Automation',
    category: 'smarthome',
    url: '/presets/home-automation.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-3',
    name: 'Connected Living',
    category: 'smarthome',
    url: '/presets/connected-living.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-4',
    name: 'Smart Lighting',
    category: 'smarthome',
    url: '/presets/smart-lighting.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-5',
    name: 'Modern Interior',
    category: 'smarthome',
    url: '/presets/modern-interior.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-6',
    name: 'Cozy Tech Home',
    category: 'smarthome',
    url: '/presets/cozy-home.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-7',
    name: 'Smart Device',
    category: 'smarthome',
    url: '/presets/smart-device.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-8',
    name: 'Voice Assistant',
    category: 'smarthome',
    url: '/presets/voice-assistant.jpg',
    source: 'preset'
  },

  // Tech / Abstract themed
  {
    id: 'tech-1',
    name: 'Circuit Board',
    category: 'tech',
    url: '/presets/circuit-board.jpg',
    source: 'preset'
  },
  {
    id: 'tech-2',
    name: 'Digital Matrix',
    category: 'tech',
    url: '/presets/digital-matrix.jpg',
    source: 'preset'
  },
  {
    id: 'tech-3',
    name: 'Code Background',
    category: 'tech',
    url: '/presets/code-background.jpg',
    source: 'preset'
  },
  {
    id: 'tech-4',
    name: 'Green Circuit',
    category: 'tech',
    url: '/presets/green-circuit.jpg',
    source: 'preset'
  },
  {
    id: 'tech-5',
    name: 'Digital Code',
    category: 'tech',
    url: '/presets/digital-code.jpg',
    source: 'preset'
  },
  {
    id: 'tech-6',
    name: 'Binary Code',
    category: 'tech',
    url: '/presets/binary-code.jpg',
    source: 'preset'
  },
  {
    id: 'tech-7',
    name: 'Motherboard',
    category: 'tech',
    url: '/presets/motherboard.jpg',
    source: 'preset'
  },
  {
    id: 'tech-8',
    name: 'Tech Abstract',
    category: 'tech',
    url: '/presets/tech-abstract.jpg',
    source: 'preset'
  },

  // Space / Futuristic themed
  {
    id: 'space-1',
    name: 'Starfield',
    category: 'space',
    url: '/presets/starfield.jpg',
    source: 'preset'
  },
  {
    id: 'space-2',
    name: 'Galaxy',
    category: 'space',
    url: '/presets/galaxy.jpg',
    source: 'preset'
  },
  {
    id: 'space-3',
    name: 'Nebula',
    category: 'space',
    url: '/presets/nebula.jpg',
    source: 'preset'
  },
  {
    id: 'space-4',
    name: 'Milky Way',
    category: 'space',
    url: '/presets/milky-way.jpg',
    source: 'preset'
  },
  {
    id: 'space-5',
    name: 'Purple Nebula',
    category: 'space',
    url: '/presets/purple-nebula.jpg',
    source: 'preset'
  },
  {
    id: 'space-6',
    name: 'Earth from Space',
    category: 'space',
    url: '/presets/earth-from-space.jpg',
    source: 'preset'
  },
  {
    id: 'space-7',
    name: 'Cosmic Clouds',
    category: 'space',
    url: '/presets/cosmic-clouds.jpg',
    source: 'preset'
  },
  {
    id: 'space-8',
    name: 'Deep Space',
    category: 'space',
    url: '/presets/deep-space.jpg',
    source: 'preset'
  },

  // Minimal / Clean themed
  {
    id: 'minimal-1',
    name: 'Dark Gradient',
    category: 'minimal',
    url: '/presets/dark-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-2',
    name: 'Blue Abstract',
    category: 'minimal',
    url: '/presets/blue-abstract.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-3',
    name: 'Purple Waves',
    category: 'minimal',
    url: '/presets/purple-waves.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-4',
    name: 'Soft Gradient',
    category: 'minimal',
    url: '/presets/soft-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-5',
    name: 'Pink Gradient',
    category: 'minimal',
    url: '/presets/pink-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-6',
    name: 'Teal Flow',
    category: 'minimal',
    url: '/presets/teal-flow.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-7',
    name: 'Orange Glow',
    category: 'minimal',
    url: '/presets/orange-glow.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-8',
    name: 'Smooth Blue',
    category: 'minimal',
    url: '/presets/smooth-blue.jpg',
    source: 'preset'
  },

  // Applications / Services themed
  {
    id: 'apps-1',
    name: 'Cloud Services',
    category: 'apps',
    url: '/presets/apps-cloud-services.jpg',
    source: 'preset'
  },
  {
    id: 'apps-2',
    name: 'Mobile Apps',
    category: 'apps',
    url: '/presets/apps-mobile.jpg',
    source: 'preset'
  },
  {
    id: 'apps-3',
    name: 'Dashboard',
    category: 'apps',
    url: '/presets/apps-dashboard.jpg',
    source: 'preset'
  },
  {
    id: 'apps-4',
    name: 'Coding',
    category: 'apps',
    url: '/presets/apps-coding.jpg',
    source: 'preset'
  },
  {
    id: 'apps-5',
    name: 'API Services',
    category: 'apps',
    url: '/presets/apps-api.jpg',
    source: 'preset'
  },
  {
    id: 'apps-6',
    name: 'Microservices',
    category: 'apps',
    url: '/presets/apps-microservices.jpg',
    source: 'preset'
  },
  {
    id: 'apps-7',
    name: 'DevOps',
    category: 'apps',
    url: '/presets/apps-devops.jpg',
    source: 'preset'
  },
  {
    id: 'apps-8',
    name: 'Terminal',
    category: 'apps',
    url: '/presets/apps-terminal.jpg',
    source: 'preset'
  },

  // Multimedia themed
  {
    id: 'media-1',
    name: 'Vinyl Records',
    category: 'multimedia',
    url: '/presets/media-vinyl.jpg',
    source: 'preset'
  },
  {
    id: 'media-2',
    name: 'Speakers',
    category: 'multimedia',
    url: '/presets/media-speakers.jpg',
    source: 'preset'
  },
  {
    id: 'media-3',
    name: 'Headphones',
    category: 'multimedia',
    url: '/presets/media-headphones.jpg',
    source: 'preset'
  },
  {
    id: 'media-4',
    name: 'Cinema',
    category: 'multimedia',
    url: '/presets/media-cinema.jpg',
    source: 'preset'
  },
  {
    id: 'media-5',
    name: 'Streaming',
    category: 'multimedia',
    url: '/presets/media-streaming.jpg',
    source: 'preset'
  },
  {
    id: 'media-6',
    name: 'Audio Waves',
    category: 'multimedia',
    url: '/presets/media-audio-waves.jpg',
    source: 'preset'
  },
  {
    id: 'media-7',
    name: 'Studio',
    category: 'multimedia',
    url: '/presets/media-studio.jpg',
    source: 'preset'
  },
  {
    id: 'media-8',
    name: 'TV Screen',
    category: 'multimedia',
    url: '/presets/media-tv.jpg',
    source: 'preset'
  },

  // Weather themed
  {
    id: 'weather-1',
    name: 'Clouds',
    category: 'weather',
    url: '/presets/weather-clouds.jpg',
    source: 'preset'
  },
  {
    id: 'weather-2',
    name: 'Storm',
    category: 'weather',
    url: '/presets/weather-storm.jpg',
    source: 'preset'
  },
  {
    id: 'weather-3',
    name: 'Sunset',
    category: 'weather',
    url: '/presets/weather-sunset.jpg',
    source: 'preset'
  },
  {
    id: 'weather-4',
    name: 'Rain',
    category: 'weather',
    url: '/presets/weather-rain.jpg',
    source: 'preset'
  },
  {
    id: 'weather-5',
    name: 'Lightning',
    category: 'weather',
    url: '/presets/weather-lightning.jpg',
    source: 'preset'
  },
  {
    id: 'weather-6',
    name: 'Snow',
    category: 'weather',
    url: '/presets/weather-snow.jpg',
    source: 'preset'
  },
  {
    id: 'weather-7',
    name: 'Fog',
    category: 'weather',
    url: '/presets/weather-fog.jpg',
    source: 'preset'
  },
  {
    id: 'weather-8',
    name: 'Aurora',
    category: 'weather',
    url: '/presets/weather-aurora.jpg',
    source: 'preset'
  },

  // Storage themed
  {
    id: 'storage-1',
    name: 'Hard Drives',
    category: 'storage',
    url: '/presets/storage-hard-drives.jpg',
    source: 'preset'
  },
  {
    id: 'storage-2',
    name: 'SSD',
    category: 'storage',
    url: '/presets/storage-ssd.jpg',
    source: 'preset'
  },
  {
    id: 'storage-3',
    name: 'Server Rack',
    category: 'storage',
    url: '/presets/storage-server-rack.jpg',
    source: 'preset'
  },
  {
    id: 'storage-4',
    name: 'Data Center',
    category: 'storage',
    url: '/presets/storage-data-center.jpg',
    source: 'preset'
  },
  {
    id: 'storage-5',
    name: 'NAS',
    category: 'storage',
    url: '/presets/storage-nas.jpg',
    source: 'preset'
  },
  {
    id: 'storage-6',
    name: 'Cloud Storage',
    category: 'storage',
    url: '/presets/storage-cloud.jpg',
    source: 'preset'
  },
  {
    id: 'storage-7',
    name: 'Storage Cables',
    category: 'storage',
    url: '/presets/storage-cables.jpg',
    source: 'preset'
  },
  {
    id: 'storage-8',
    name: 'Backup Systems',
    category: 'storage',
    url: '/presets/storage-backup.jpg',
    source: 'preset'
  }
];

export const BACKGROUND_CATEGORIES = [
  { id: 'network', name: 'Network', icon: 'mdi:network' },
  { id: 'servers', name: 'Servers', icon: 'mdi:server' },
  { id: 'docker', name: 'Docker', icon: 'mdi:docker' },
  { id: 'homelab', name: 'Homelab', icon: 'mdi:raspberry-pi' },
  { id: 'smarthome', name: 'Smart Home', icon: 'mdi:home-automation' },
  { id: 'apps', name: 'Applications', icon: 'mdi:application' },
  { id: 'multimedia', name: 'Multimedia', icon: 'mdi:multimedia' },
  { id: 'weather', name: 'Weather', icon: 'mdi:weather-partly-cloudy' },
  { id: 'storage', name: 'Storage', icon: 'mdi:harddisk' },
  { id: 'tech', name: 'Technology', icon: 'mdi:chip' },
  { id: 'space', name: 'Space', icon: 'mdi:space-station' },
  { id: 'minimal', name: 'Minimal', icon: 'mdi:palette-outline' }
];
