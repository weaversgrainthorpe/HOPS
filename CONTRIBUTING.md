# Contributing to HOPS

Thanks for your interest in contributing to HOPS! This document covers the guidelines for contributing to the project.

## Ways to Contribute

- **Bug Reports** — Found something broken? [Open an issue](https://github.com/weaversgrainthorpe/HOPS/issues/new) with steps to reproduce.
- **Feature Requests** — Have an idea? Open an issue describing what you'd like and why.
- **Pull Requests** — Bug fixes and improvements are welcome. For larger changes, please open an issue first to discuss.

## Development Setup

### Prerequisites

- Go 1.25+
- Node.js 24+
- npm
- SQLite3

### Getting Started

1. Fork and clone the repository
2. Start the backend:
   ```bash
   cd backend
   go run cmd/hops/main.go --data ../data --frontend ../frontend/build
   ```
3. Start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
4. Open http://localhost:5173 (default credentials: `admin` / `admin`)

### Project Structure

```
hops/
├── backend/
│   ├── cmd/
│   │   └── hops/              # Main application entry point
│   ├── internal/
│   │   ├── api/               # HTTP handlers and routing
│   │   ├── auth/              # Authentication service
│   │   ├── config/            # Configuration management
│   │   ├── converters/        # Format converters (Homer, Dashy, etc.)
│   │   ├── database/          # SQLite setup, migrations, backups
│   │   ├── models/            # Data models
│   │   ├── status/            # Status checking (HTTP)
│   │   └── version/           # Version information
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/    # Svelte components
│   │   │   ├── stores/        # Svelte stores (state management)
│   │   │   ├── types/         # TypeScript type definitions
│   │   │   └── utils/         # Utility functions (API client, etc.)
│   │   └── routes/
│   │       ├── admin/         # Admin panel route
│   │       └── [dashboard]/   # Dynamic dashboard routes
│   └── package.json
├── scripts/                   # Build, dev, and deployment scripts
├── data/                      # Runtime data directory (not checked in)
├── Dockerfile
└── docker-compose.yml
```

## Pull Request Guidelines

1. **One concern per PR** — Keep changes focused. A bug fix and a new feature should be separate PRs.
2. **Test your changes** — Make sure the app builds and runs correctly with your changes.
3. **Follow existing patterns** — Match the code style and conventions already in the project.
4. **Update documentation** — If your change affects user-facing behavior, update the relevant docs (README, USER_GUIDE, DEPLOY, etc.).
5. **Write clear commit messages** — Describe *what* changed and *why*.

### Running Tests

```bash
# Backend
cd backend
go test ./...

# Frontend
cd frontend
npm test
```

### Building for Production

```bash
# Backend
cd backend
go build -o hops ./cmd/hops

# Frontend
cd frontend
npm run build
```

## Code Style

- **Go** — Standard `gofmt` formatting. Keep dependencies minimal.
- **Svelte/TypeScript** — Follow existing component patterns. Use TypeScript types for all data structures.
- **CSS** — Scoped component styles per Svelte convention. Design tokens (colors, spacing, radii, shadows, transitions, z-index layers) are CSS custom properties defined at `:root` in `frontend/src/app.css` — reference them as `var(--accent)`, `var(--radius-md)`, etc. instead of hardcoded values. Shared button classes (`.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm`) live in `app.css` too — don't redefine them per-component.

## Reporting Security Issues

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing to HOPS, you agree that your contributions will be licensed under the [MIT License](LICENSE).
