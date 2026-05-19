# HOPS Frontend (v1.4.5)

The frontend for HOPS (Home Operations Portal System) — a SvelteKit 2 + Svelte 5 SPA, built as static files and served by the Go backend.

## Tech Stack

- **Framework**: SvelteKit 2 with `@sveltejs/adapter-static`
- **UI Library**: Svelte 5 (using runes: `$state`, `$derived`, `$effect`, `$props`)
- **Language**: TypeScript
- **Build Tool**: Vite 7
- **Package Manager**: npm (NOT pnpm — both were present before v1.4.1, leading to drift)
- **Icons**: `@iconify/svelte` (200,000+ icons via Iconify, lazy-loaded from iconify.design CDN) + ~2,300 bundled SVGs from homarr-labs/dashboard-icons stored locally
- **Drag & Drop**: `svelte-dnd-action`
- **QR Codes**: `qrcode` (browser-side SVG generation; added in v1.4.0)
- **Favicons (build-time only)**: `sharp`
- **Testing**: Vitest 4 + `@testing-library/svelte` + `@testing-library/user-event` + `jsdom`

## Project Structure

```
frontend/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte                  # Root layout: navbar, toasts, confirm modal, forced password change
│   │   ├── +page.svelte                    # Admin landing page (login form + dashboard list)
│   │   └── [dashboard]/
│   │       └── +page.svelte                # Dynamic dashboard routes (e.g. /home, /media)
│   ├── lib/
│   │   ├── components/
│   │   │   ├── shared/                     # Button, Modal, AsyncContent, ErrorBoundary
│   │   │   ├── admin/                      # All admin modals (EntryEdit, TabEdit, GroupEdit,
│   │   │   │                                #   IconPicker, BackgroundConfig, Theme, Backup,
│   │   │   │                                #   ChangePassword, Import, Export, QRCode, etc.)
│   │   │   ├── Dashboard.svelte            # Top-level dashboard view
│   │   │   ├── TabPanel.svelte             # Tab content
│   │   │   ├── Group.svelte                # Collapsible group of tiles
│   │   │   ├── Entry.svelte                # Single tile
│   │   │   ├── Navbar.svelte               # Top navbar
│   │   │   ├── ConfirmModal.svelte         # Singleton confirm dialog (store-driven)
│   │   │   ├── Toast.svelte                # Toast notification rendering
│   │   │   ├── PopupModal.svelte           # Iframe/popup open-mode for tiles
│   │   │   ├── HelpModal.svelte            # In-app help
│   │   │   ├── AboutModal.svelte           # In-app about
│   │   │   ├── BackendStatus.svelte        # Live backend connectivity indicator
│   │   │   ├── ColoredIcon.svelte          # Iconify wrapper with theming
│   │   │   ├── StatusIndicator.svelte      # Up/down dot for tiles with status checks
│   │   │   └── DashboardSkeleton.svelte    # Loading skeleton
│   │   ├── stores/
│   │   │   ├── auth.ts                     # Login/logout + mustChangePassword flag
│   │   │   ├── config.ts                   # Dashboard configuration (synced with backend)
│   │   │   ├── theme.ts                    # 8 theme presets + light/dark/auto
│   │   │   ├── clipboard.ts                # Copy/cut/paste for tiles
│   │   │   ├── editMode.ts                 # Edit mode toggle
│   │   │   ├── selection.ts                # Single + multi-tile selection
│   │   │   ├── confirmModal.ts             # Promise-based confirm dialog
│   │   │   ├── toast.ts                    # Toast notifications (4 types, auto-dismiss)
│   │   │   ├── textSize.ts                 # Text size preference (persisted)
│   │   │   ├── backendStatus.ts            # Live backend health polling
│   │   │   ├── status.ts                   # Tile status check polling
│   │   │   └── easterEggs.ts               # 🐰
│   │   ├── utils/
│   │   │   ├── api.ts                      # API client + CSRF helpers (getCSRFToken, withCSRFHeader)
│   │   │   ├── url.ts                      # URL validation + safeOpenUrl (XSS guard)
│   │   │   ├── validation.ts               # Form validation (password, match)
│   │   │   ├── colorContrast.ts            # WCAG contrast → auto light/dark text
│   │   │   ├── focusTrap.ts                # Modal focus trapping
│   │   │   ├── iconColors.ts               # Iconify color helpers
│   │   │   ├── gridKeyboardNav.ts          # Keyboard nav for icon grids
│   │   │   └── errors.ts                   # Dev-only logging helpers
│   │   ├── constants/
│   │   │   ├── colors.ts                   # Color palette constants
│   │   │   └── backgrounds.ts              # Preset background metadata
│   │   ├── types/
│   │   │   └── index.ts                    # Shared TypeScript types
│   │   └── index.ts
│   ├── test/                               # Test infrastructure
│   │   ├── setup.ts                        # Vitest setup (jest-dom matchers, cleanup, matchMedia polyfill)
│   │   ├── smoke.test.ts
│   │   └── mocks/app/                      # $app/environment + $app/stores mocks for SvelteKit imports
│   ├── app.css                             # Global styles + design tokens (CSS custom properties)
│   ├── app.html                            # HTML template
│   └── app.d.ts                            # SvelteKit type augmentation
├── static/                                 # Favicons, logo
├── scripts/
│   └── generate-favicons.js                # Favicon generation (sharp)
├── vite.config.ts                          # Vite dev server + build config
├── vitest.config.ts                        # Vitest test runner config
├── tsconfig.json
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 24+
- npm

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

The dev server starts at `http://localhost:5173` and proxies `/api`, `/icons`, `/backgrounds`, `/presets` to `http://localhost:8080` (the Go backend). Start the backend separately.

### Type Checking

```bash
npm run check
```

Watch mode:

```bash
npm run check:watch
```

### Testing

```bash
npm test              # one-shot run
npm run test:watch    # watch mode
npm run test:ui       # browser-based test UI
npm run test:coverage # with HTML coverage report
```

The test suite (163 tests across 14 files as of v1.4.5) covers:
- **Utilities**: `validation`, `url` (incl. XSS vector blocking), `colorContrast`, `api` (incl. CSRF helpers)
- **Stores**: `auth` (with mocked API), `toast`, `textSize`, `selection`, `clipboard`, `confirmModal`
- **Components**: `Button`, `Toast`, `QRCodeModal`

### Building for Production

```bash
npm run build
```

Output goes to `build/`. The Go backend serves these files when run with `--frontend ./frontend/build`.

### Preview Production Build

```bash
npm run preview
```

## API Integration

API calls go through `src/lib/utils/api.ts`. Two important helpers:

- **`fetchAPI(endpoint, options)`** — wraps `fetch` with the API base URL, JSON content type, and automatic CSRF header injection for mutation methods
- **`getCSRFToken()`** / **`withCSRFHeader(headers, method)`** — reads `hops_csrf` cookie and adds the `X-CSRF-Token` header. Exported so FormData uploads (`importConfig`, `uploadIconImage`, `uploadBackground`) can include it too

The CSRF token is set by the backend on `/api/auth/login` as a non-HttpOnly cookie. The frontend reads it from `document.cookie` and echoes it back. This is the double-submit cookie pattern — the Same-Origin Policy prevents cross-origin scripts from reading the cookie, so attackers can't forge a matching header.

## State Management

Svelte stores for global state:

- **`auth`** — `isAuthenticated`, `isLoggingIn`, `mustChangePassword`, plus `login()`, `logout()`, `initAuth()`
- **`config`** — full dashboard configuration; synced with backend
- **`theme`** — 8 presets + light/dark/auto mode + animated CSS gradients for some
- **`clipboard`** — copy/cut a tile, paste into a group; survives navigation within a session
- **`editMode`** — toggle; resets to off on logout
- **`selection`** — primary focused tile + multi-select
- **`toast`** — fire-and-forget notifications (`toast.success`, `toast.error`, `toast.warning`, `toast.info`)
- **`confirmModal`** — promise-based confirm dialog (`await confirm({title, message, ...})`)
- **`backendStatus`** — polls `/api/health` every 30s; shows live indicator
- **`status`** — polls `/api/status/{id}` for each subscribed tile (ref-counted)
- **`textSize`** — 4 size presets, persisted to `localStorage`

## Styling

Design tokens live as CSS custom properties at `:root` in `src/app.css`:

```css
:root {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text-primary: #f1f5f9;
  --text-secondary: #dbe4f0;  /* WCAG AAA on all backgrounds */
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --radius-md: 0.375rem;
  --space-4: 1rem;
  /* etc. */
}
```

Light theme overrides via `[data-theme="light"]`.

Shared button classes (`.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm`) are global in `app.css` — components shouldn't redefine them. Component-specific styles use Svelte's scoped `<style>` blocks.

## Responsive Breakpoints

Three breakpoints used consistently across components:

- **`max-width: 1024px`** — tablet: tighter padding, slightly denser grids
- **`max-width: 768px`** — mobile landscape: hide nav-links and text-size controls
- **`max-width: 480px`** — mobile portrait: compact icons, hide edit/export buttons (editing on touch is awkward), hide wordmark and dev badge

There's also a `max-width: 360px` fallback for tiny phones that hides the version chip and secondary action icons to prevent navbar overflow.

## Svelte 5 Runes

This project uses Svelte 5 with runes:

```svelte
<script lang="ts">
  // State
  let count = $state(0);

  // Derived
  let doubled = $derived(count * 2);

  // Props
  interface Props {
    title: string;
    onSave: (value: string) => void;
  }
  let { title, onSave }: Props = $props();

  // Effects (with cleanup)
  $effect(() => {
    const interval = setInterval(() => count++, 1000);
    return () => clearInterval(interval);
  });
</script>
```

## Adding a New Component

1. Create the file under `src/lib/components/` (or `components/admin/` for admin-only)
2. Use TypeScript for props via an `interface` + `$props()`
3. Use scoped styles; pull from CSS custom properties for design tokens
4. If it imports stores or utilities, add a test in `*.test.ts` alongside it
5. For modals, use the shared `Modal` component to get focus trap + close-button + Esc handling for free

## Scripts

### Generate Favicons

```bash
node scripts/generate-favicons.js
```

Produces:
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` (180x180)

## Contributing

When adding new features:

1. Follow existing component patterns
2. Use TypeScript for all new code
3. Add tests in `*.test.ts` files alongside the code (utilities and stores especially)
4. Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`)
5. Use CSS custom properties from `app.css` for design tokens — don't hardcode colors/spacing
6. Use the shared `<Button>` and `<Modal>` components — don't reimplement
7. Test in both light and dark themes, and at all three responsive breakpoints

## License

MIT
