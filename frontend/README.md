# HOPS Frontend (v1.0.0)

The frontend for HOPS (Home Operations Portal System) - built with SvelteKit 2, TypeScript, and Svelte 5.

## Tech Stack

- **Framework**: SvelteKit 2
- **Language**: TypeScript
- **UI Library**: Svelte 5 (with runes: `$state`, `$derived`, `$effect`, `$props`)
- **Icons**: Iconify (@iconify/svelte)
- **Drag & Drop**: svelte-dnd-action
- **Search**: Fuse.js (fuzzy search)
- **Build Tool**: Vite 7
- **Package Manager**: pnpm

## Project Structure

```
frontend/
├── src/
│   ├── routes/
│   │   ├── +page.svelte                # Homepage (redirects to first dashboard)
│   │   ├── +layout.svelte              # Root layout with navbar
│   │   ├── admin/
│   │   │   ├── +page.svelte            # Admin login page
│   │   │   └── +layout.svelte          # Admin layout
│   │   ├── [dashboard]/
│   │   │   └── +page.svelte            # Dynamic dashboard routes
│   │   └── d/[secret]/
│   │       └── +page.svelte            # Secret URL dashboards (future)
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Dashboard.svelte        # Main dashboard component
│   │   │   ├── TabPanel.svelte         # Tab content panel
│   │   │   ├── Group.svelte            # Group (collapsible section)
│   │   │   ├── Entry.svelte            # Individual tile/entry
│   │   │   ├── NavBar.svelte           # Navigation bar
│   │   │   ├── modals/
│   │   │   │   ├── EntryModal.svelte   # Add/edit tile modal
│   │   │   │   ├── GroupModal.svelte   # Edit group modal
│   │   │   │   ├── TabModal.svelte     # Add/edit tab modal
│   │   │   │   └── DashboardModal.svelte # Add/edit dashboard modal
│   │   │   └── admin/
│   │   │       ├── ThemePickerModal.svelte # Theme customization
│   │   │       └── HeaderConfigModal.svelte # Header settings
│   │   ├── stores/
│   │   │   ├── config.ts               # Dashboard configuration store
│   │   │   ├── theme.ts                # Theme system with 8 presets
│   │   │   ├── clipboard.ts            # Copy/cut/paste functionality
│   │   │   ├── editMode.ts             # Edit mode toggle
│   │   │   ├── auth.ts                 # Authentication state
│   │   │   └── headerConfig.ts         # Header visibility settings
│   │   ├── types/
│   │   │   └── index.ts                # TypeScript type definitions
│   │   └── utils/
│   │       └── api.ts                  # API client functions
│   ├── app.css                          # Global styles and CSS variables
│   └── app.html                         # HTML template
├── static/
│   ├── favicon.svg                      # Favicon (hopping bunny)
│   ├── logo.svg                         # Animated logo
│   └── favicon-*.png                    # Generated favicon PNGs
├── scripts/
│   └── generate-favicons.js             # Favicon generator script
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm (install via `npm install -g pnpm`)

### Installation

```bash
cd frontend
pnpm install
```

### Development

```bash
pnpm dev
```

The dev server will start at `http://localhost:5173`

### Type Checking

```bash
pnpm check
```

Watch mode:
```bash
pnpm check:watch
```

### Building for Production

```bash
pnpm build
```

The production build will be output to the `build/` directory.

### Preview Production Build

```bash
pnpm preview
```

## Environment Configuration

The frontend expects the backend API to be available at:

- **Development**: `http://localhost:8080/api`
- **Production**: `/api` (same origin)

API base URL is configured in `src/lib/utils/api.ts`.

## Key Features

### 1. Dashboard System

- **Multiple Dashboards**: Create unlimited dashboards with custom paths (e.g., `/home`, `/media`)
- **Tabs**: Organize content into tabs within each dashboard
- **Groups**: Collapsible groups within tabs
- **Tiles**: Individual links/widgets with icons

### 2. Drag and Drop

- **Tab Reordering**: Drag tabs to reorder them (edit mode)
- **Tile Reordering**: Drag tiles within groups (edit mode)
- **Group Reordering: Drag groups by their header to reorder

### 3. Theme System

8 beautiful theme presets with light/dark variants:

1. **Default** - Blue theme
2. **Metallic** - Chrome/silver tones
3. **Modern** - Indigo minimal
4. **Subtle** - Muted pastels
5. **Cyberpunk** - Neon pink
6. **Sunset** - Orange-pink gradient ⚡
7. **Ocean** - Cyan-blue gradient ⚡
8. **Forest** - Green-lime gradient ⚡

Features:
- Three brightness modes: Dark, Light, Auto (follows system)
- Gradient theme support with `background-image`
- Each preset adapts to light/dark mode
- Preferences saved in localStorage

### 4. Copy/Cut/Paste

- Right-click context menu on tiles
- Copy/cut tiles and paste them into different groups or tabs
- Clipboard state managed via Svelte store

### 5. Icon System

- 150,000+ icons via Iconify
- Common prefixes: `mdi:`, `fa:`, `simple-icons:`, `logos:`
- Icons load on-demand from CDN

### 6. Edit Mode

- Toggle edit mode to show/hide editing controls
- Admin-only feature (requires authentication)
- Enables drag-and-drop, delete buttons, and modals

## Svelte 5 Runes

This project uses Svelte 5 with modern runes syntax:

```typescript
// State
let count = $state(0);

// Derived state
let doubled = $derived(count * 2);

// Props
let { name, age = 18 }: Props = $props();

// Effects
$effect(() => {
  console.log(`Count is ${count}`);
});
```

## State Management

The app uses Svelte stores for global state:

- `config` - Dashboard configuration (synced with backend)
- `theme` - Current theme and preset
- `clipboard` - Copy/cut/paste state
- `editMode` - Edit mode toggle
- `auth` - Authentication state
- `headerConfig` - Header visibility settings

## API Integration

API calls are made through `src/lib/utils/api.ts`:

```typescript
import { getConfig, updateConfig } from '$lib/utils/api';

// Fetch configuration
const config = await getConfig();

// Update configuration
await updateConfig(updatedConfig);
```

## Styling

Global styles use CSS custom properties (variables) for theming:

```css
:root {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --border: #475569;
  --shadow: rgba(0, 0, 0, 0.3);
}
```

Component-specific styles are scoped within each `.svelte` file.

## Adding a New Component

1. Create the component in `src/lib/components/`
2. Use TypeScript for props:

```svelte
<script lang="ts">
  interface Props {
    title: string;
    count?: number;
  }

  let { title, count = 0 }: Props = $props();
</script>

<div>
  <h2>{title}</h2>
  <p>Count: {count}</p>
</div>

<style>
  div {
    padding: 1rem;
  }
</style>
```

3. Import and use:

```svelte
<script lang="ts">
  import MyComponent from '$lib/components/MyComponent.svelte';
</script>

<MyComponent title="Hello" count={42} />
```

## TypeScript Types

Main types are defined in `src/lib/types/index.ts`:

```typescript
export interface Dashboard {
  id: string;
  name: string;
  path: string;
  tabs: Tab[];
  order: number;
}

export interface Tab {
  id: string;
  name: string;
  groups: Group[];
  order: number;
  color?: string;
  opacity?: number;
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  entries: Entry[];
  order: number;
}

export interface Entry {
  id: string;
  name: string;
  subtitle?: string;
  url: string;
  icon: string;
  openMode?: 'newtab' | 'sametab' | 'iframe' | 'modal';
  size?: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  order: number;
}
```

## Scripts

### Generate Favicons

Generate PNG favicons from the SVG source:

```bash
node scripts/generate-favicons.js
```

Generates:
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` (180x180)

## Deployment

The frontend is deployed as static files served by the Go backend.

1. Build the frontend:
```bash
pnpm build
```

2. The backend will serve files from `../frontend/build`

3. Configure the backend to point to the build directory:
```bash
./hops --frontend ../frontend/build
```

## Development Tips

### Hot Module Replacement (HMR)

Vite provides instant HMR during development. Changes to `.svelte` files will update in the browser without a full page reload.

### Debugging

1. Use browser DevTools (F12)
2. Install [Svelte DevTools](https://chrome.google.com/webstore/detail/svelte-devtools/ckolcbmkjpjmangdbmnkpjigpkddpogn) extension
3. Add `console.log()` statements in reactive blocks:

```typescript
$effect(() => {
  console.log('Count changed:', count);
});
```

### Performance

- Use `$derived` for computed values (more efficient than recreating in render)
- Avoid unnecessary reactivity by using `$state.raw()` for non-reactive objects
- Use `{#key}` blocks sparingly
- Lazy-load heavy components with dynamic imports

## Contributing

When adding new features:

1. Follow existing code style
2. Use TypeScript for all new code
3. Add proper types for props and state
4. Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`)
5. Keep components small and focused
6. Test in both light and dark themes
7. Ensure responsive design

## License

MIT
