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
    name: 'Network grid',
    category: 'network',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'network-2',
    name: 'Data center',
    category: 'network',
    url: '/presets/data-center.jpg',
    source: 'preset'
  },
  {
    id: 'network-3',
    name: 'Fiber optics',
    category: 'network',
    url: '/presets/fiber-optics.jpg',
    source: 'preset'
  },
  {
    id: 'network-4',
    name: 'Network cables',
    category: 'network',
    url: '/presets/network-cables.jpg',
    source: 'preset'
  },
  {
    id: 'network-5',
    name: 'Switch panel',
    category: 'network',
    url: '/presets/switch-panel.jpg',
    source: 'preset'
  },
  {
    id: 'network-6',
    name: 'Blue cables',
    category: 'network',
    url: '/presets/blue-cables.jpg',
    source: 'preset'
  },
  {
    id: 'network-7',
    name: 'Abstract network',
    category: 'network',
    url: '/presets/abstract-network.jpg',
    source: 'preset'
  },
  {
    id: 'network-8',
    name: 'Tech lines',
    category: 'network',
    url: '/presets/tech-lines.jpg',
    source: 'preset'
  },

  // Server / Infrastructure themed
  {
    id: 'server-1',
    name: 'Server room',
    category: 'servers',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'server-2',
    name: 'Data center aisle',
    category: 'servers',
    url: '/presets/data-center-aisle.jpg',
    source: 'preset'
  },
  {
    id: 'server-3',
    name: 'Cloud infrastructure',
    category: 'servers',
    url: '/presets/fiber-optics.jpg',
    source: 'preset'
  },
  {
    id: 'server-4',
    name: 'Rack servers',
    category: 'servers',
    url: '/presets/rack-servers.jpg',
    source: 'preset'
  },
  {
    id: 'server-5',
    name: 'Server hardware',
    category: 'servers',
    url: '/presets/server-hardware.jpg',
    source: 'preset'
  },
  {
    id: 'server-6',
    name: 'Blue server lights',
    category: 'servers',
    url: '/presets/data-center.jpg',
    source: 'preset'
  },
  {
    id: 'server-7',
    name: 'Modern data center',
    category: 'servers',
    url: '/presets/circuit-board.jpg',
    source: 'preset'
  },
  {
    id: 'server-8',
    name: 'Server closeup',
    category: 'servers',
    url: '/presets/server-closeup.jpg',
    source: 'preset'
  },

  // Docker / Containers
  {
    id: 'docker-1',
    name: 'Container ship',
    category: 'docker',
    url: '/presets/container-ship.jpg',
    source: 'preset'
  },
  {
    id: 'docker-2',
    name: 'Shipping containers',
    category: 'docker',
    url: '/presets/shipping-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-3',
    name: 'Container stack',
    category: 'docker',
    url: '/presets/container-stack.jpg',
    source: 'preset'
  },
  {
    id: 'docker-4',
    name: 'Blue containers',
    category: 'docker',
    url: '/presets/blue-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-5',
    name: 'Container port',
    category: 'docker',
    url: '/presets/container-port.jpg',
    source: 'preset'
  },
  {
    id: 'docker-6',
    name: 'Red containers',
    category: 'docker',
    url: '/presets/red-containers.jpg',
    source: 'preset'
  },
  {
    id: 'docker-7',
    name: 'Container yard',
    category: 'docker',
    url: '/presets/container-yard.jpg',
    source: 'preset'
  },
  {
    id: 'docker-8',
    name: 'Ship deck',
    category: 'docker',
    url: '/presets/ship-deck.jpg',
    source: 'preset'
  },

  // Homelab
  {
    id: 'homelab-1',
    name: 'Home server rack',
    category: 'homelab',
    url: '/presets/network-grid.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-2',
    name: 'Raspberry Pi cluster',
    category: 'homelab',
    url: '/presets/raspberry-pi.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-3',
    name: 'Electronics workbench',
    category: 'homelab',
    url: '/presets/electronics-workbench.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-4',
    name: 'Tech desk setup',
    category: 'homelab',
    url: '/presets/tech-desk.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-5',
    name: 'PC hardware',
    category: 'homelab',
    url: '/presets/pc-hardware.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-6',
    name: 'LED gaming setup',
    category: 'homelab',
    url: '/presets/led-gaming.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-7',
    name: 'Network equipment',
    category: 'homelab',
    url: '/presets/network-equipment.jpg',
    source: 'preset'
  },
  {
    id: 'homelab-8',
    name: 'Home office tech',
    category: 'homelab',
    url: '/presets/home-office.jpg',
    source: 'preset'
  },

  // Smart home themed
  {
    id: 'smarthome-1',
    name: 'Modern smart home',
    category: 'smarthome',
    url: '/presets/data-center-aisle.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-2',
    name: 'Home automation',
    category: 'smarthome',
    url: '/presets/home-automation.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-3',
    name: 'Connected living',
    category: 'smarthome',
    url: '/presets/connected-living.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-4',
    name: 'Smart lighting',
    category: 'smarthome',
    url: '/presets/smart-lighting.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-5',
    name: 'Modern interior',
    category: 'smarthome',
    url: '/presets/modern-interior.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-6',
    name: 'Cozy tech home',
    category: 'smarthome',
    url: '/presets/cozy-home.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-7',
    name: 'Smart device',
    category: 'smarthome',
    url: '/presets/smart-device.jpg',
    source: 'preset'
  },
  {
    id: 'smarthome-8',
    name: 'Voice assistant',
    category: 'smarthome',
    url: '/presets/voice-assistant.jpg',
    source: 'preset'
  },

  // Tech / Abstract themed
  {
    id: 'tech-1',
    name: 'Circuit board',
    category: 'tech',
    url: '/presets/circuit-board.jpg',
    source: 'preset'
  },
  {
    id: 'tech-2',
    name: 'Digital matrix',
    category: 'tech',
    url: '/presets/digital-matrix.jpg',
    source: 'preset'
  },
  {
    id: 'tech-3',
    name: 'Code background',
    category: 'tech',
    url: '/presets/code-background.jpg',
    source: 'preset'
  },
  {
    id: 'tech-4',
    name: 'Green circuit',
    category: 'tech',
    url: '/presets/green-circuit.jpg',
    source: 'preset'
  },
  {
    id: 'tech-5',
    name: 'Digital code',
    category: 'tech',
    url: '/presets/digital-code.jpg',
    source: 'preset'
  },
  {
    id: 'tech-6',
    name: 'Binary code',
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
    name: 'Tech abstract',
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
    name: 'Purple nebula',
    category: 'space',
    url: '/presets/purple-nebula.jpg',
    source: 'preset'
  },
  {
    id: 'space-6',
    name: 'Earth from space',
    category: 'space',
    url: '/presets/earth-from-space.jpg',
    source: 'preset'
  },
  {
    id: 'space-7',
    name: 'Cosmic clouds',
    category: 'space',
    url: '/presets/cosmic-clouds.jpg',
    source: 'preset'
  },
  {
    id: 'space-8',
    name: 'Deep space',
    category: 'space',
    url: '/presets/deep-space.jpg',
    source: 'preset'
  },

  // Minimal / Clean themed
  {
    id: 'minimal-1',
    name: 'Dark gradient',
    category: 'minimal',
    url: '/presets/dark-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-2',
    name: 'Blue abstract',
    category: 'minimal',
    url: '/presets/blue-abstract.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-3',
    name: 'Purple waves',
    category: 'minimal',
    url: '/presets/purple-waves.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-4',
    name: 'Soft gradient',
    category: 'minimal',
    url: '/presets/soft-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-5',
    name: 'Pink gradient',
    category: 'minimal',
    url: '/presets/pink-gradient.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-6',
    name: 'Teal flow',
    category: 'minimal',
    url: '/presets/teal-flow.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-7',
    name: 'Orange glow',
    category: 'minimal',
    url: '/presets/orange-glow.jpg',
    source: 'preset'
  },
  {
    id: 'minimal-8',
    name: 'Smooth blue',
    category: 'minimal',
    url: '/presets/smooth-blue.jpg',
    source: 'preset'
  },

  // Applications / Services themed
  {
    id: 'apps-1',
    name: 'Cloud services',
    category: 'apps',
    url: '/presets/apps-cloud-services.jpg',
    source: 'preset'
  },
  {
    id: 'apps-2',
    name: 'Mobile apps',
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
    name: 'API services',
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
    name: 'Vinyl records',
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
    name: 'Audio waves',
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
    name: 'TV screen',
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
    name: 'Hard drives',
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
    name: 'Server rack',
    category: 'storage',
    url: '/presets/storage-server-rack.jpg',
    source: 'preset'
  },
  {
    id: 'storage-4',
    name: 'Data center',
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
    name: 'Cloud storage',
    category: 'storage',
    url: '/presets/storage-cloud.jpg',
    source: 'preset'
  },
  {
    id: 'storage-7',
    name: 'Storage cables',
    category: 'storage',
    url: '/presets/storage-cables.jpg',
    source: 'preset'
  },
  {
    id: 'storage-8',
    name: 'Backup systems',
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
  { id: 'smarthome', name: 'Smart home', icon: 'mdi:home-automation' },
  { id: 'apps', name: 'Applications', icon: 'mdi:application' },
  { id: 'multimedia', name: 'Multimedia', icon: 'mdi:multimedia' },
  { id: 'weather', name: 'Weather', icon: 'mdi:weather-partly-cloudy' },
  { id: 'storage', name: 'Storage', icon: 'mdi:harddisk' },
  { id: 'tech', name: 'Technology', icon: 'mdi:chip' },
  { id: 'space', name: 'Space', icon: 'mdi:space-station' },
  { id: 'minimal', name: 'Minimal', icon: 'mdi:palette-outline' }
];
