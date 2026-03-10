# HOPS Backend (v1.2.0)

The backend for HOPS (Home Operations Portal System) - a lightweight Go server with SQLite database.

## Tech Stack

- **Language**: Go 1.24+
- **Database**: SQLite 3
- **Router**: net/http (standard library)
- **Authentication**: Session-based with bcrypt password hashing
- **CORS**: Configurable for development/production

## Project Structure

```
backend/
├── cmd/
│   └── hops/
│       └── main.go              # Entry point
├── internal/
│   ├── api/
│   │   ├── routes.go            # HTTP route definitions
│   │   ├── handlers.go          # HTTP handlers
│   │   ├── auth_handlers.go     # Authentication endpoints
│   │   ├── config_handlers.go   # Configuration endpoints
│   │   └── middleware.go        # Auth middleware
│   ├── auth/
│   │   └── auth.go              # Authentication service
│   ├── config/
│   │   └── config.go            # Configuration management
│   ├── database/
│   │   ├── database.go          # Database initialization
│   │   └── migrations.go        # Schema migrations
│   ├── models/
│   │   └── models.go            # Data models
│   └── status/
│       └── checker.go           # Status checking (HTTP/ICMP)
├── go.mod
└── go.sum
```

## Getting Started

### Prerequisites

- Go 1.24 or higher

### Installation

```bash
cd backend
go mod download
```

### Running in Development

```bash
go run cmd/hops/main.go --port 8080 --data ../data
```

Command-line flags:
- `--port` - HTTP port (default: 8080)
- `--data` - Data directory for SQLite database (default: ../data)
- `--frontend` - Path to frontend build directory (optional, for production)

### Building

```bash
go build -o hops ./cmd/hops
```

For optimized production build:
```bash
go build -ldflags="-s -w" -o hops ./cmd/hops
```

Flags:
- `-s` - Omit symbol table
- `-w` - Omit DWARF debugging information

### Running Production Build

```bash
./hops --port 8080 --data /path/to/data --frontend /path/to/frontend/build
```

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check with database status |
| `GET` | `/api/version` | Version information |
| `GET` | `/api/config` | Dashboard configuration |
| `GET` | `/api/status/{id}` | Status check result for an entry |
| `POST` | `/api/auth/login` | Admin login (rate-limited: 20/min/IP) |
| `GET` | `/api/auth/check` | Verify authentication status |
| `GET` | `/api/icon-categories` | List icon categories |
| `GET` | `/api/icons` | List icons |
| `GET` | `/api/icons/dashboard/{filename}` | Serve dashboard icon collection |
| `GET` | `/api/backgrounds` | List background images |
| `GET` | `/icons/{filename}` | Serve uploaded icon file |
| `GET` | `/backgrounds/{filename}` | Serve uploaded background file |
| `GET` | `/presets/{filename}` | Serve preset background image |

### Protected Endpoints (Require Authentication)

Authentication is via the `hops_session` HttpOnly cookie, set on login.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/logout` | Log out current session |
| `POST` | `/api/auth/change-password` | Change admin password |
| `PUT` | `/api/config/update` | Update dashboard configuration |
| `GET` | `/api/config/export` | Export configuration (with embedded assets) |
| `POST` | `/api/config/import` | Import configuration (HOPS, Homer, Dashy, Heimdall) |
| `POST` | `/api/config/reset` | Reset to default configuration |
| `GET` | `/api/backups` | List available backups |
| `POST` | `/api/backups/{id}` | Restore a backup |
| `DELETE` | `/api/backups/{id}` | Delete a backup |
| `POST` | `/api/icons/upload` | Upload a custom icon |
| `PUT` | `/api/icons/{id}` | Update icon metadata |
| `DELETE` | `/api/icons/{id}` | Delete an icon |
| `POST` | `/api/icon-categories` | Create an icon category |
| `PUT` | `/api/icon-categories/{id}` | Update an icon category |
| `DELETE` | `/api/icon-categories/{id}` | Delete an icon category |
| `POST` | `/api/backgrounds` | Upload a background image |
| `PUT` | `/api/backgrounds/{id}` | Update background metadata |
| `DELETE` | `/api/backgrounds/{id}` | Delete a background image |
| `GET` | `/api/backgrounds/categories` | List background categories |
| `POST` | `/api/backgrounds/categories` | Create a background category |
| `PUT` | `/api/backgrounds/categories/{id}` | Update a background category |
| `DELETE` | `/api/backgrounds/categories/{id}` | Delete a background category |

### Authentication Example

```bash
# Login (sets hops_session cookie)
curl -c cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Authenticated request
curl -b cookies.txt http://localhost:8080/api/config/export

# Logout
curl -b cookies.txt -X POST http://localhost:8080/api/auth/logout
```

## Database Schema

### users table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### config table
```sql
CREATE TABLE config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### sessions table
```sql
CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Configuration

### Environment Variables

Currently, all configuration is done via command-line flags. Environment variable support can be added if needed.

### Default Admin User

On first run, a default admin user is created:
- **Username**: `admin`
- **Password**: `admin`

**⚠️ Change this immediately in production!**

### Session Management

- Sessions expire after 24 hours
- Session tokens are 32-byte random strings (hex encoded)
- Expired sessions are cleaned up on login

## Authentication Flow

1. User sends credentials to `/api/auth/login`
2. Backend validates credentials against bcrypt hash
3. If valid, creates session in database
4. Returns session token as HTTP-only cookie
5. Frontend includes cookie in subsequent requests
6. Middleware validates session before protected routes
7. User can log out via `/api/auth/logout` (deletes session)

## CORS Configuration

Development mode (when frontend runs on different port):
```go
w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
w.Header().Set("Access-Control-Allow-Credentials", "true")
```

Production mode (when frontend is served by backend):
- No CORS headers needed (same origin)

## File Serving

In production mode (when `--frontend` flag is provided):

1. Serve static files from the frontend build directory
2. Serve `index.html` for all non-API routes (SPA support)
3. API routes take precedence over file serving

Example:
```
GET /api/config     -> API handler
GET /home           -> index.html (SPA route)
GET /assets/app.js  -> static file
```

## Error Handling

All API error responses use a consistent JSON format:

```json
{
  "error": "Error message",
  "status": 400
}
```

HTTP status codes:
- `200` - Success
- `400` - Bad request (validation error)
- `401` - Unauthorized (auth required)
- `404` - Not found
- `500` - Internal server error

## Testing

```bash
go test ./...
```

Tests cover:
- Authentication service (login, logout, session validation, password change)
- API endpoints (health, version, config, auth, rate limiting)
- Cookie-based session management

## Security Considerations

1. **Password Storage**
   - Passwords are hashed using bcrypt (cost factor 10)
   - Never store or log plaintext passwords

2. **Session Security**
   - HTTP-only cookies (not accessible via JavaScript)
   - Secure flag in production (HTTPS only)
   - Session tokens are cryptographically random
   - Sessions expire after 24 hours

3. **SQL Injection**
   - Using parameterized queries via database/sql
   - No string concatenation for queries

4. **CORS**
   - Restrictive CORS in production
   - Credentials required for cross-origin requests

5. **Input Validation**
   - Validate all user inputs
   - Sanitize configuration JSON
   - Check for required fields

## Performance

- **SQLite** - Single file database, no external dependencies
- **Connection Pooling** - Managed by database/sql
- **Static File Serving** - Efficient file serving with proper caching headers
- **Lightweight** - Minimal dependencies, small binary size (~10MB)

## Deployment

### Systemd Service

Create `/etc/systemd/system/hops.service`:

```ini
[Unit]
Description=HOPS - Home Operations Portal System
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/hops/backend
ExecStart=/path/to/hops/backend/hops --port 8080 --data /path/to/hops/data --frontend /path/to/hops/frontend/build
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable hops
sudo systemctl start hops
sudo systemctl status hops
```

### Reverse Proxy (Caddy)

Example Caddyfile:

```
hops.example.com {
    reverse_proxy localhost:8080
}
```

### Reverse Proxy (Nginx)

Example nginx config:

```nginx
server {
    listen 80;
    server_name hops.example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Logging

Current logging includes:
- Server startup information
- Request logging (method, path, status code)
- Error logging for failed operations

Enhance logging as needed for your deployment.

## Contributing

When adding new features:

1. Follow Go best practices and idioms
2. Use meaningful variable names
3. Add error handling for all operations
4. Validate all inputs
5. Add logging for debugging
6. Keep handlers focused and testable
7. Update API documentation

## License

MIT
