# Getting Started with HOPS

## Current Status

✅ **Phase 1 Complete - Foundation Ready**

The foundation of HOPS is built and running! Here's what's implemented:

### What's Working Now
- ✅ Go backend server with REST API
- ✅ SQLite database with migrations
- ✅ Authentication system (admin/admin)
- ✅ SvelteKit frontend framework
- ✅ Config storage and retrieval
- ✅ Both development servers running

### Access Your Instance
- **Frontend (Viewer)**: http://localhost:5173
- **Admin Panel**: http://localhost:5173/admin
- **Backend API**: http://localhost:8080/api

### Default Credentials
- Username: `admin`
- Password: `admin`

## Next Steps

The foundation is ready! Here's what to build next:

### Immediate Next Steps (Phase 2)
1. **Dashboard Viewer Component**
   - Display dashboards, tabs, and groups
   - Render entries as tiles
   - Handle different open modes

2. **Admin Interface**
   - Dashboard editor
   - Add/edit/delete dashboards, tabs, groups, entries
   - Visual configuration UI

3. **Icon System**
   - Integrate Iconify for 10K+ icons
   - Favicon auto-fetch for URLs
   - Custom icon upload

### Quick Development Workflow

1. **Start development servers**:
```bash
cd /home/jonathan/hops
./scripts/dev.sh
```

2. **Make changes** to either:
   - Frontend: `frontend/src/`
   - Backend: `backend/internal/` or `backend/cmd/`

3. **Frontend hot-reloads automatically**
   - Backend requires restart (Ctrl+C and re-run)

4. **Test changes** at http://localhost:5173

### Building Components

Here's the suggested order for building the remaining features:

#### 1. Entry/Tile Component (`frontend/src/lib/components/Entry.svelte`)
```svelte
<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';

  export let entry: Entry;

  function handleClick() {
    switch (entry.openMode) {
      case 'newtab':
        window.open(entry.url, '_blank');
        break;
      case 'sametab':
        window.location.href = entry.url;
        break;
      // etc.
    }
  }
</script>

<button class="entry {entry.size}" on:click={handleClick}>
  <Icon icon={entry.icon} width="32" />
  <span>{entry.name}</span>
</button>
```

#### 2. Group Component
Display collapsible groups of entries

#### 3. Tab Component
Show tabs with groups

#### 4. Dashboard Component
Full dashboard with background, tabs, etc.

#### 5. Admin Editor
Visual editor for creating/editing dashboards

### File Structure for New Components

```
frontend/src/lib/components/
├── Entry.svelte          # Individual tile
├── Group.svelte          # Collapsible group
├── Tab.svelte            # Tab container
├── Dashboard.svelte      # Full dashboard
├── DashboardNav.svelte   # Navigation bar
├── Search.svelte         # Global search (/)
└── admin/
    ├── DashboardEditor.svelte
    ├── TabEditor.svelte
    ├── GroupEditor.svelte
    └── EntryEditor.svelte
```

## Development Tips

### Frontend Development
- Use `$:` reactive statements for derived data
- Keep stores in `frontend/src/lib/stores/`
- Add new types to `frontend/src/lib/types/index.ts`
- Test with different screen sizes

### Backend Development
- Add new API routes in `backend/internal/api/router.go`
- Implement handlers in `backend/internal/api/handlers.go`
- Database changes go in `backend/internal/database/database.go`
- Always handle errors gracefully

### Database Changes
If you need to modify the schema:
1. Edit migrations in `backend/internal/database/database.go`
2. Delete `data/hops.db` to test fresh setup
3. Restart backend to run migrations

### Testing API Endpoints
```bash
# Get config
curl http://localhost:8080/api/config

# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Update config (use session token from login)
curl -X PUT http://localhost:8080/api/config/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"dashboards":[],"theme":{"mode":"dark"},"settings":{"searchHotkey":"/","defaultView":"/"}}'
```

## Deployment to Production

When you're ready to deploy:

1. **Build everything**:
```bash
cd /home/jonathan/hops
./scripts/build.sh
```

2. **Install as systemd service**:
```bash
sudo ./scripts/install-service.sh
```

3. **Configure Caddy** (if not already):
```bash
sudo cp Caddyfile /etc/caddy/Caddyfile.d/hops
sudo systemctl reload caddy
```

4. **Start the service**:
```bash
sudo systemctl start hops
sudo systemctl status hops
```

## Getting Help

### Check Logs
```bash
# Backend logs (systemd)
sudo journalctl -u hops -f

# Frontend dev logs
# Visible in terminal where you ran pnpm dev

# Backend dev logs
# Visible in terminal where you ran go run
```

### Common Issues

**Login fails**: Make sure the database has been initialized with the correct password hash. Run:
```bash
sqlite3 data/hops.db "SELECT username FROM users"
```

**Frontend can't connect to backend**: Check that VITE_API_BASE in `frontend/.env` points to the correct backend URL.

**CORS errors**: The backend already has CORS enabled for all origins in development. For production, you may want to restrict this.

## Resources

- [SvelteKit Documentation](https://kit.svelte.dev/docs)
- [Svelte Tutorial](https://svelte.dev/tutorial)
- [Go Documentation](https://go.dev/doc/)
- [Iconify Icon Sets](https://icon-sets.iconify.design/)

## Have Fun Building!

HOPS is your canvas. The foundation is solid, now make it yours! Start by creating a simple dashboard viewer, then gradually add features as you need them.

Remember: The goal is a **GUI-first** dashboard that's easy to use. Focus on the visual editor and user experience!
