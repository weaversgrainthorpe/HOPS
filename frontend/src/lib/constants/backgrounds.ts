// Bundled royalty-free background images
// These are placeholder URLs - in production, these would be local files in /backgrounds/

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
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80'
  },
  {
    id: 'network-2',
    name: 'Data Center',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1920&q=80'
  },
  {
    id: 'network-3',
    name: 'Fiber Optics',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80'
  },
  {
    id: 'network-4',
    name: 'Network Cables',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?w=1920&q=80'
  },
  {
    id: 'network-5',
    name: 'Switch Panel',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1590859808308-3d2d9c515b1a?w=1920&q=80'
  },
  {
    id: 'network-6',
    name: 'Blue Cables',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1551808525-51a94da548ce?w=1920&q=80'
  },
  {
    id: 'network-7',
    name: 'Abstract Network',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1558346490-a72e53ae2d4f?w=1920&q=80'
  },
  {
    id: 'network-8',
    name: 'Tech Lines',
    category: 'network',
    url: 'https://images.unsplash.com/photo-1563206767-5b18f218e8de?w=1920&q=80'
  },

  // Server / Infrastructure themed
  {
    id: 'server-1',
    name: 'Server Room',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80'
  },
  {
    id: 'server-2',
    name: 'Data Center Aisle',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=80'
  },
  {
    id: 'server-3',
    name: 'Cloud Infrastructure',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80'
  },
  {
    id: 'server-4',
    name: 'Rack Servers',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1597733336794-12d05021d510?w=1920&q=80'
  },
  {
    id: 'server-5',
    name: 'Server Hardware',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1591799265444-d66432b91588?w=1920&q=80'
  },
  {
    id: 'server-6',
    name: 'Blue Server Lights',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1920&q=80'
  },
  {
    id: 'server-7',
    name: 'Modern Data Center',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920&q=80'
  },
  {
    id: 'server-8',
    name: 'Server Closeup',
    category: 'servers',
    url: 'https://images.unsplash.com/photo-1580584126903-c17d41830450?w=1920&q=80'
  },

  // Docker / Containers
  {
    id: 'docker-1',
    name: 'Container Ship',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1494412651409-8963ce7935a7?w=1920&q=80'
  },
  {
    id: 'docker-2',
    name: 'Shipping Containers',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=1920&q=80'
  },
  {
    id: 'docker-3',
    name: 'Container Stack',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1920&q=80'
  },
  {
    id: 'docker-4',
    name: 'Blue Containers',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1605745341112-85968b19335b?w=1920&q=80'
  },
  {
    id: 'docker-5',
    name: 'Container Port',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1920&q=80'
  },
  {
    id: 'docker-6',
    name: 'Red Containers',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=1920&q=80'
  },
  {
    id: 'docker-7',
    name: 'Container Yard',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1583537206542-f992c9c94066?w=1920&q=80'
  },
  {
    id: 'docker-8',
    name: 'Ship Deck',
    category: 'docker',
    url: 'https://images.unsplash.com/photo-1585555603918-b3bc7e87dedd?w=1920&q=80'
  },

  // Homelab
  {
    id: 'homelab-1',
    name: 'Home Server Rack',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80'
  },
  {
    id: 'homelab-2',
    name: 'Raspberry Pi Cluster',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=1920&q=80'
  },
  {
    id: 'homelab-3',
    name: 'Electronics Workbench',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=1920&q=80'
  },
  {
    id: 'homelab-4',
    name: 'Tech Desk Setup',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=1920&q=80'
  },
  {
    id: 'homelab-5',
    name: 'PC Hardware',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1591238371080-7b7cc5be7324?w=1920&q=80'
  },
  {
    id: 'homelab-6',
    name: 'LED Gaming Setup',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=1920&q=80'
  },
  {
    id: 'homelab-7',
    name: 'Network Equipment',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1623857503831-e8da7c92da85?w=1920&q=80'
  },
  {
    id: 'homelab-8',
    name: 'Home Office Tech',
    category: 'homelab',
    url: 'https://images.unsplash.com/photo-1620188467120-5042ed1eb5da?w=1920&q=80'
  },

  // Smart Home themed
  {
    id: 'smarthome-1',
    name: 'Modern Smart Home',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=80'
  },
  {
    id: 'smarthome-2',
    name: 'Home Automation',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=1920&q=80'
  },
  {
    id: 'smarthome-3',
    name: 'Connected Living',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1580508174046-170816f65662?w=1920&q=80'
  },
  {
    id: 'smarthome-4',
    name: 'Smart Lighting',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1585316143267-4c0c3f0ecb36?w=1920&q=80'
  },
  {
    id: 'smarthome-5',
    name: 'Modern Interior',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1556912167-f556f1f39faa?w=1920&q=80'
  },
  {
    id: 'smarthome-6',
    name: 'Cozy Tech Home',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1920&q=80'
  },
  {
    id: 'smarthome-7',
    name: 'Smart Device',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1558089687-23d8fcd7a2f1?w=1920&q=80'
  },
  {
    id: 'smarthome-8',
    name: 'Voice Assistant',
    category: 'smarthome',
    url: 'https://images.unsplash.com/photo-1543512214-318c7553f230?w=1920&q=80'
  },

  // Tech / Abstract themed
  {
    id: 'tech-1',
    name: 'Circuit Board',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920&q=80'
  },
  {
    id: 'tech-2',
    name: 'Digital Matrix',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1920&q=80'
  },
  {
    id: 'tech-3',
    name: 'Code Background',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1920&q=80'
  },
  {
    id: 'tech-4',
    name: 'Green Circuit',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1920&q=80'
  },
  {
    id: 'tech-5',
    name: 'Digital Code',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=1920&q=80'
  },
  {
    id: 'tech-6',
    name: 'Binary Code',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1510519138101-570d1dca3d66?w=1920&q=80'
  },
  {
    id: 'tech-7',
    name: 'Motherboard',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1591489378542-0dd1db315c3a?w=1920&q=80'
  },
  {
    id: 'tech-8',
    name: 'Tech Abstract',
    category: 'tech',
    url: 'https://images.unsplash.com/photo-1535223289827-42f1e9919769?w=1920&q=80'
  },

  // Space / Futuristic themed
  {
    id: 'space-1',
    name: 'Starfield',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80'
  },
  {
    id: 'space-2',
    name: 'Galaxy',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80'
  },
  {
    id: 'space-3',
    name: 'Nebula',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=1920&q=80'
  },
  {
    id: 'space-4',
    name: 'Milky Way',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1506443432602-ac2fcd6f54e0?w=1920&q=80'
  },
  {
    id: 'space-5',
    name: 'Purple Nebula',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=1920&q=80'
  },
  {
    id: 'space-6',
    name: 'Earth from Space',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=1920&q=80'
  },
  {
    id: 'space-7',
    name: 'Cosmic Clouds',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1464802686167-b939a6910659?w=1920&q=80'
  },
  {
    id: 'space-8',
    name: 'Deep Space',
    category: 'space',
    url: 'https://images.unsplash.com/photo-1608178398319-48f814d0750c?w=1920&q=80'
  },

  // Minimal / Clean themed
  {
    id: 'minimal-1',
    name: 'Dark Gradient',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&q=80'
  },
  {
    id: 'minimal-2',
    name: 'Blue Abstract',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1920&q=80'
  },
  {
    id: 'minimal-3',
    name: 'Purple Waves',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1920&q=80'
  },
  {
    id: 'minimal-4',
    name: 'Soft Gradient',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682268-e3955fed4d24?w=1920&q=80'
  },
  {
    id: 'minimal-5',
    name: 'Pink Gradient',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682204-e53bb269ae87?w=1920&q=80'
  },
  {
    id: 'minimal-6',
    name: 'Teal Flow',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557683311-eac922347aa1?w=1920&q=80'
  },
  {
    id: 'minimal-7',
    name: 'Orange Glow',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1920&q=80'
  },
  {
    id: 'minimal-8',
    name: 'Smooth Blue',
    category: 'minimal',
    url: 'https://images.unsplash.com/photo-1557682260-96773eb01377?w=1920&q=80'
  }
];

export const BACKGROUND_CATEGORIES = [
  { id: 'network', name: 'Network', icon: 'mdi:network' },
  { id: 'servers', name: 'Servers', icon: 'mdi:server' },
  { id: 'docker', name: 'Docker', icon: 'mdi:docker' },
  { id: 'homelab', name: 'Homelab', icon: 'mdi:raspberry-pi' },
  { id: 'smarthome', name: 'Smart Home', icon: 'mdi:home-automation' },
  { id: 'tech', name: 'Technology', icon: 'mdi:chip' },
  { id: 'space', name: 'Space', icon: 'mdi:space-station' },
  { id: 'minimal', name: 'Minimal', icon: 'mdi:palette-outline' }
];
