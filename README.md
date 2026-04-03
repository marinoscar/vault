# Vault

[![CI](https://github.com/marinoscar/vault/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/marinoscar/vault/actions/workflows/ci.yml)

Vault is a self-hosted secrets manager. It stores credentials, API keys, credit cards, tokens, notes, and documents with AES-256-GCM encryption at rest, full version history, and role-based access control.

## Features

- **Encrypted Secrets Storage**: AES-256-GCM encryption for all secret values. Six built-in secret types (Credential, API Key, Card, Token, Note, Document) plus user-defined custom types with flexible field schemas.
- **Version History and Rollback**: Every update creates an immutable version. View any historical version in decrypted form and roll back, which creates a new version from the historical data.
- **File Attachments**: Secrets can carry file attachments via S3-compatible storage. The Document type has attachments enabled by default.
- **Custom Secret Types**: Define your own secret types with custom field schemas (field name, label, data type, required flag, sensitive flag).
- **Authentication**: Google OAuth 2.0 with JWT access tokens, refresh token rotation, and Device Authorization Flow (RFC 8628) for CLI and IoT devices.
- **Authorization**: Role-based access control (RBAC) with Admin, Contributor, and Viewer roles. Admins can view secrets across all users.
- **Access Control**: Email allowlist restricts access to pre-authorized users only.
- **Personal Access Tokens**: Long-lived tokens for programmatic API and CLI access.
- **Audit Logging**: All secret operations are logged to the audit event store.
- **Observability**: OpenTelemetry instrumentation with traces, metrics, and structured logging via Uptrace.
- **API Documentation**: Swagger/OpenAPI documentation at `/api/docs`.
- **Same-Origin Architecture**: Frontend and API served from the same host via Nginx reverse proxy.

## Technology Stack

### Backend
- **Framework**: NestJS with Fastify adapter
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Passport.js (Google OAuth)
- **Observability**: OpenTelemetry + Uptrace
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: React 18 with TypeScript
- **UI Library**: Material-UI (MUI)
- **State Management**: React Context API
- **Testing**: Vitest + React Testing Library
- **Build Tool**: Vite

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx
- **Database**: PostgreSQL 16

## Prerequisites

- Node.js 18+
- Docker Desktop
- Google OAuth credentials (from [Google Cloud Console](https://console.cloud.google.com))

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/marinoscar/vault.git
cd vault

# Set up environment variables
cd infra/compose
cp .env.example .env
```

### 2. Generate the Encryption Key

Vault requires a 256-bit encryption key for AES-256-GCM. Generate one and add it to `.env`:

```bash
openssl rand -hex 32
```

```bash
# In infra/compose/.env
VAULT_ENCRYPTION_KEY=<64-char hex string from above>
```

This key is required. The API will refuse to start without it.

### 3. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3535/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 4. Start Application

```bash
# From infra/compose directory
docker compose -f base.compose.yml -f dev.compose.yml up
```

### 5. Seed Database (Required before first login)

```bash
# In a new terminal
docker compose exec api sh
cd /app/apps/api
npx tsx prisma/seed.ts
exit
```

**Why seeding is required:**
- Creates RBAC roles (admin, contributor, viewer)
- Creates permissions and built-in secret types
- Without seeds, first login will fail with "Default role not found"

### 6. Access Application

- **Frontend**: http://localhost:3535
- **API**: http://localhost:3535/api
- **Swagger Docs**: http://localhost:3535/api/docs

### 7. First Login

The first user to log in with the email matching `INITIAL_ADMIN_EMAIL` (from `.env`) is automatically granted the **admin** role. All subsequent users receive the **viewer** role by default.

Only email addresses in the **allowlist** can log in. `INITIAL_ADMIN_EMAIL` is automatically added to the allowlist during seeding. After your first login as admin, use the Admin Panel to manage the allowlist and grant other users Contributor or Admin roles.

## Development

### Running with Observability Stack

To enable full observability (Uptrace UI for traces, metrics, logs):

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up
```

Access Uptrace UI at: http://localhost:14318

### Running Tests

**Backend Tests:**
```bash
cd apps/api
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:cov      # With coverage
npm run test:e2e      # E2E tests only
```

**Frontend Tests:**
```bash
cd apps/web
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

**E2E Tests (Playwright):**
```bash
cd tests/e2e
npm install              # First time setup
npx playwright install   # Install browsers
npm test                 # Run E2E tests
npm run test:ui          # Run with visual UI
```

Note: E2E tests use a test authentication bypass (`/testing/login`) that is only available in development/test environments. See [TESTING.md](docs/TESTING.md#e2e-testing-with-playwright) for details.

### Database Migrations

```bash
cd apps/api

# Create a new migration
npm run prisma:migrate:dev -- --name migration_name

# Apply migrations (production)
npm run prisma:migrate

# Generate Prisma Client after schema changes
npm run prisma:generate
```

Use the `prisma:*` npm scripts rather than direct `npx prisma` commands. The scripts construct `DATABASE_URL` automatically from the individual `POSTGRES_*` environment variables.

### Hot Reload

Development mode (`dev.compose.yml`) includes hot reload for both frontend and backend:
- Backend: Changes to `apps/api/src/**` trigger restart
- Frontend: Vite HMR updates immediately

## CLI Tool

A cross-platform CLI (`app`) is available for managing development, testing, and API operations. The CLI can connect to any deployed instance, not just localhost.

### Installation

```bash
# Build the CLI
cd tools/app && npm run build

# Link globally (recommended)
npm link

# Now you can use 'app' from anywhere
app --help
```

### Quick CLI Commands

```bash
# Configure CLI to connect to a server
app config set-url https://vault.example.com

# Start development environment
app start

# Login (opens browser for OAuth)
app auth login

# Run tests
app test

# Manage users (admin only)
app users list
app allowlist add newuser@example.com

# Database operations
app prisma migrate
app prisma seed

# Interactive mode (menu-driven)
app
```

### Working with Remote Servers

```bash
# Configure for production
app config set-url https://vault.example.com
app auth login
app users list

# Switch to another instance
app config set-url https://vault-staging.example.com

# View current configuration
app config show
```

For complete CLI documentation, see [tools/app/README.md](tools/app/README.md).

## Project Structure

```
vault/
├── apps/
│   ├── api/                    # Backend API (NestJS + Fastify)
│   │   ├── src/
│   │   │   ├── auth/           # Authentication and authorization
│   │   │   ├── users/          # User management
│   │   │   ├── secrets/        # Secrets CRUD, versioning, attachments
│   │   │   ├── secret-types/   # Built-in and custom secret type definitions
│   │   │   ├── settings/       # Settings endpoints
│   │   │   ├── common/
│   │   │   │   └── services/
│   │   │   │       └── crypto.service.ts  # AES-256-GCM encryption
│   │   │   └── prisma/         # Database service
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema
│   │   │   ├── seed.ts         # Database seeds
│   │   │   └── migrations/     # Migration history
│   │   └── test/               # Integration tests
│   └── web/                    # Frontend (React + MUI)
│       ├── src/
│       │   ├── components/
│       │   │   ├── secrets/    # Secret list, detail, form, version history
│       │   │   └── secret-types/  # Secret type management UI
│       │   ├── pages/
│       │   │   ├── SecretsPage.tsx
│       │   │   ├── SecretDetailPage.tsx
│       │   │   └── SecretTypesPage.tsx
│       │   ├── contexts/       # React contexts (Auth, Theme)
│       │   └── services/       # API client
│       └── src/__tests__/      # Component tests
├── tools/
│   └── app/                    # CLI tool for development and API management
├── docs/                       # Documentation
│   ├── DEVELOPMENT.md          # Development guide (start here)
│   ├── SECURITY.md             # Security design and practices
│   ├── OBSERVABILITY.md        # Monitoring, logging, and tracing
│   ├── TESTING.md              # Testing guide
│   └── API.md                  # Complete API reference
├── infra/
│   ├── compose/                # Docker Compose configs
│   │   ├── base.compose.yml    # Core services
│   │   ├── dev.compose.yml     # Development overrides
│   │   ├── prod.compose.yml    # Production overrides
│   │   └── otel.compose.yml    # Observability stack
│   ├── nginx/                  # Nginx config
│   └── otel/                   # OpenTelemetry config
└── CLAUDE.md                   # AI assistant guidance
```

## Documentation

- **[CLI Tool](tools/app/README.md)** - CLI for development, testing, and API management
- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development setup, common patterns, and troubleshooting
- **[SECURITY.md](docs/SECURITY.md)** - Security design and implementation
- **[OBSERVABILITY.md](docs/OBSERVABILITY.md)** - Monitoring, logging, and tracing
- **[TESTING.md](docs/TESTING.md)** - Testing strategy and best practices
- **[DEVICE-AUTH.md](docs/DEVICE-AUTH.md)** - Device Authorization Flow guide and integration examples
- **[API.md](docs/API.md)** - Complete API reference

## API Documentation

Interactive API documentation is available at `/api/docs` when running the application.

### Key Endpoints

**Authentication:**
- `GET /api/auth/providers` - List OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout

**Device Authorization (RFC 8628):**
- `POST /api/auth/device/code` - Generate device code for CLI/IoT devices
- `POST /api/auth/device/token` - Poll for device authorization
- `GET /api/auth/device/sessions` - List authorized devices
- `DELETE /api/auth/device/sessions/:id` - Revoke device access

**Secrets:**
- `POST /api/secrets` - Create a secret
- `GET /api/secrets` - List secrets (paginated)
- `GET /api/secrets/:id` - Get secret (decrypted)
- `PUT /api/secrets/:id` - Update secret (creates new version)
- `DELETE /api/secrets/:id` - Delete secret
- `GET /api/secrets/:id/versions` - List version history
- `GET /api/secrets/:id/versions/:versionId` - Get a specific version (decrypted)
- `POST /api/secrets/:id/rollback/:versionId` - Roll back to a previous version
- `POST /api/secrets/:id/attachments` - Upload file attachment
- `GET /api/secrets/:id/attachments/:attachmentId/download` - Get signed download URL
- `DELETE /api/secrets/:id/attachments/:attachmentId` - Delete attachment

**Secret Types:**
- `POST /api/secret-types` - Create a custom secret type
- `GET /api/secret-types` - List all secret types (built-in and custom)
- `GET /api/secret-types/:id` - Get a secret type
- `PUT /api/secret-types/:id` - Update a custom secret type
- `DELETE /api/secret-types/:id` - Delete a custom secret type

**Users (Admin only):**
- `GET /api/users` - List users
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user

**Allowlist (Admin only):**
- `GET /api/allowlist` - List allowlisted emails
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/:id` - Remove email from allowlist

**Personal Access Tokens:**
- `POST /api/pat` - Create a personal access token
- `GET /api/pat` - List current user's tokens
- `DELETE /api/pat/:id` - Revoke a token

**Health:**
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

## Environment Variables

Key configuration (see `infra/compose/.env.example` for full list):

```bash
# Application
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3535

# Database (constructed into DATABASE_URL at runtime)
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=appdb

# Secrets encryption — REQUIRED
# Generate with: openssl rand -hex 32
VAULT_ENCRYPTION_KEY=your-64-char-hex-string

# JWT
JWT_SECRET=your-secret-min-32-chars
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3535/api/auth/google/callback

# Admin Bootstrap
INITIAL_ADMIN_EMAIL=admin@example.com

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

## Important Notes for Developers

### Encryption Key Management

`VAULT_ENCRYPTION_KEY` is a 64-character hex string (32 bytes). It is used as the AES-256-GCM key for all secret field encryption. Keep this key safe:

- Never commit it to source control
- Back it up securely — losing the key means losing access to all stored secrets
- Rotating the key requires re-encrypting all existing secrets
- Generate with `openssl rand -hex 32`

### NestJS with Fastify (Not Express)

This application uses **Fastify** as the HTTP adapter, not Express. Key differences:

- Fastify: `res.code(200).send(data)`
- Express: `res.status(200).json(data)` (do not use)

Best practice: let NestJS handle responses automatically by not using the `@Res()` decorator.

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed guidance.

### Database Seeding is Required

Before your first login, you must seed the database:

```bash
docker compose exec api sh
cd /app/apps/api
npx tsx prisma/seed.ts
```

This creates roles, permissions, built-in secret types, and default settings. Without seeding, OAuth login will fail.

### OAuth with Fastify

Passport OAuth strategies expect Express-style objects. The `GoogleOAuthGuard` handles compatibility by returning raw Node.js request/response objects to Passport. See [SECURITY.md](docs/SECURITY.md) for details.

## Troubleshooting

### "Default role not found" error
**Solution:** Run database seeds (see step 5 in Quick Start).

### "Email not authorized" error during login
**Solution:** The email must be in the allowlist. If you are the first admin:
1. Ensure your email matches `INITIAL_ADMIN_EMAIL` in `.env` exactly
2. Restart containers to apply environment variable changes
3. Re-run database seeds if needed

If you are not the first admin, ask an existing admin to add your email at `/admin/users` (Allowlist tab).

### Secrets cannot be decrypted
**Solution:** The `VAULT_ENCRYPTION_KEY` in `.env` does not match the key used when the secrets were written. Restore the original key. If the key is lost, the encrypted data cannot be recovered.

### OAuth redirect fails
**Solution:**
1. Verify `GOOGLE_CALLBACK_URL` matches Google Cloud Console exactly
2. Check container logs: `docker compose logs api -f`

### Database connection error
**Solution:**
1. Ensure containers are running: `docker compose ps`
2. Check `POSTGRES_*` variables in `.env`
3. Restart: `docker compose restart db`

### Port already in use
**Solution:** Change `PORT` in `.env` or stop the conflicting service.

For more troubleshooting, see [DEVELOPMENT.md](docs/DEVELOPMENT.md#debugging-tips).

## Production Deployment

1. Use `prod.compose.yml` overrides
2. Set `NODE_ENV=production`
3. Generate strong secrets:
   - `openssl rand -hex 32` for `VAULT_ENCRYPTION_KEY`
   - `openssl rand -base64 32` for `JWT_SECRET`
4. Enable HTTPS with valid certificates
5. Set `secure: true` on cookies
6. Configure proper OAuth callback URLs
7. Set up database backups — back up both the database and the encryption key together
8. Configure monitoring and alerting

See [SECURITY.md](docs/SECURITY.md) for the production security checklist.

## Architecture Decisions

- **AES-256-GCM encryption**: Authenticated encryption — protects both confidentiality and integrity of stored secrets. Each encrypted value uses a unique random IV.
- **Immutable version history**: Updates never overwrite data; a new version row is always written. Rollback creates a new version rather than modifying history, preserving a complete audit trail.
- **Fastify over Express**: 2-3x better performance, better TypeScript support.
- **Prisma**: Type-safe ORM with excellent migration tooling.
- **Same-origin hosting**: Simplifies security, eliminates CORS complexity.
- **JWT + Refresh tokens**: Short-lived access tokens with secure refresh rotation.
- **RBAC**: Role-based permissions with Admin visibility into all users' secrets.
- **OpenTelemetry**: Vendor-neutral observability.
- **Docker Compose**: Reproducible local development environment.

## License

[Your License Here]

## Support

For issues, questions, or contributions:
- Review [DEVELOPMENT.md](docs/DEVELOPMENT.md) for common issues
- Check [documentation](docs/) for detailed guides
- Submit issues via [GitHub Issues](https://github.com/marinoscar/vault/issues)

---

**Happy coding!** 🚀
