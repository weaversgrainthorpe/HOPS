// Bundled royalty-free background images
// These are placeholder URLs - in production, these would be local files in /backgrounds/

export interface BackgroundPreset {
  id: string;
  name: string;
  category: string;
  url: string;
  thumbnail?: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  // Network themed
  {
    id: 'network-1',
    name: 'Network Grid',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80' // Network visualization
  },
  {
    id: 'network-2',
    name: 'Data Center',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1920&q=80' // Server racks
  },
  {
    id: 'network-3',
    name: 'Fiber Optics',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80' // Fiber optic cables
  },

  // Server / Infrastructure themed
  {
    id: 'server-1',
    name: 'Server Room',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80' // Server room
  },
  {
    id: 'server-2',
    name: 'Data Center Aisle',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80' // Data center aisle
  },
  {
    id: 'server-3',
    name: 'Cloud Infrastructure',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80' // Cloud concept
  },

  // Smart Home themed
  {
    id: 'smarthome-1',
    name: 'Modern Smart Home',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=80' // Modern home interior
  },
  {
    id: 'smarthome-2',
    name: 'Home Automation',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=1920&q=80' // Smart home device
  },
  {
    id: 'smarthome-3',
    name: 'Connected Living',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1580508174046-170816f65662?w=1920&q=80' // Modern living room
  },

  // Tech / Abstract themed
  {
    id: 'tech-1',
    name: 'Circuit Board',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920&q=80' // Circuit board
  },
  {
    id: 'tech-2',
    name: 'Digital Matrix',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1920&q=80' // Matrix style
  },
  {
    id: 'tech-3',
    name: 'Code Background',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1920&q=80' // Code on screen
  },

  // Space / Futuristic themed
  {
    id: 'space-1',
    name: 'Starfield',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80' // Stars
  },
  {
    id: 'space-2',
    name: 'Galaxy',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80' // Galaxy
  },
  {
    id: 'space-3',
    name: 'Nebula',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=1920&q=80' // Nebula
  },

  // Minimal / Clean themed
  {
    id: 'minimal-1',
    name: 'Dark Gradient',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&q=80' // Dark gradient
  },
  {
    id: 'minimal-2',
    name: 'Blue Abstract',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1920&q=80' // Blue abstract
  },
  {
    id: 'minimal-3',
    name: 'Purple Waves',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1920&q=80' // Purple waves
  }
];

export const BACKGROUND_CATEGORIES = [
  { id: 'network', name: 'Network', icon: 'mdi:network' },
  { id: 'servers', name: 'Servers', icon: 'mdi:server' },
  { id: 'smarthome', name: 'Smart Home', icon: 'mdi:home-automation' },
  { id: 'tech', name: 'Technology', icon: 'mdi:chip' },
  { id: 'space', name: 'Space', icon: 'mdi:space-station' },
  { id: 'minimal', name: 'Minimal', icon: 'mdi:palette-outline' }
];
