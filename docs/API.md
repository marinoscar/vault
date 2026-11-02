# API Reference

## Base URL

- **Development**: http://localhost:3535/api
- **Production**: https://yourdomain.com/api

## Authentication

All endpoints require JWT Bearer token authentication unless explicitly marked as **Public**.

**Authorization Header:**
```
Authorization: Bearer <access_token>
```

Access tokens are short-lived (15 minutes by default). Use the refresh token flow to obtain new access tokens.

Since E3.2 the `/api/auth/*`, `/api/users*`, `/api/allowlist*`, `/api/pat*` and `/api/auth/device/*` routes are served by the platform identity slice with the same paths and bodies. Additions: `POST /api/auth/switch-org`, `GET /api/roles`, `/api/org/*` and `/api/admin/organizations` (organization routes exist but a single-organization deployment has one organization), `GET /api/auth/:providerId` for extra providers, and `/api/node-credentials`. The device token poll can return a personal access token (`credentialType: 'pat'`, no `refreshToken`) when the request's `clientInfo.tokenType` is `'pat'`; the default response is unchanged. Roles are `admin` (system) and `org_admin`, `contributor`, `viewer` (organization); a role the API will not assign answers `400 ROLE_NOT_ASSIGNABLE`.

## Response Format

### Success Response

```json
{
  "data": <response_data>,
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response

Errors are produced by the platform `HttpExceptionFilter` (`@marinoscar/platform-api/host`):

```json
{
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Human readable error message",
  "details": { },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/..."
}
```

`details` is present only when the error carries some (validation issues, a maintenance window, a non-production stack). `code` is the machine-readable code: the status default (`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED`, `PAYLOAD_TOO_LARGE`, `UNPROCESSABLE_ENTITY`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`, and `ERROR` for any other status, for example a `502` or `503` that names no application code; before the platform host these two were `BAD_GATEWAY` and `SERVICE_UNAVAILABLE`) or an application code Vault registered for that status (see [Error Codes](#error-codes)). A code that is not registered for the status it was thrown with is replaced by the status default, so a new code a client reads must be registered in `apps/api/src/app-registrations/error-codes.ts`.

During a maintenance window every non-exempt request answers `503` with `details.reason: "MAINTENANCE_MODE"` and a `Retry-After` header (`/api/health/*`, `/api/admin/maintenance`, `/api/admin/about`, `/api/admin/doctor` and admins stay reachable).

## Pagination

Endpoints returning lists support pagination with the following query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | number | 1 | - | Page number (1-indexed) |
| `pageSize` | number | 20 | 100 | Items per page |

**Paginated Response Format:**
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

---

## Endpoints

### Authentication

#### GET /auth/providers
**Public endpoint** - List enabled OAuth providers.

**Response:**
```json
{
  "data": {
    "providers": [
      {
        "name": "google",
        "enabled": true
      }
    ]
  }
}
```

---

#### GET /auth/google
**Public endpoint** - Initiate Google OAuth flow. Redirects to Google consent screen.

**Response:** HTTP 302 redirect to Google

---

#### GET /auth/google/callback
**Public endpoint** - OAuth callback handler (called by Google).

**Query Parameters:**
- `code` (string) - Authorization code from Google
- `state` (string, optional) - CSRF protection state

**Response:** HTTP 302 redirect to frontend with access token in query parameter
- Sets HttpOnly refresh token cookie
- Redirects to `/auth/callback?accessToken=<token>`

**Error Cases:**
- Email not in allowlist → Redirects to `/auth/error?error=not_authorized`
- OAuth failure → Redirects to `/auth/error?error=oauth_failed`

---

#### GET /auth/me
**Requires Authentication** - Get current user profile.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    }
  ],
  "permissions": ["users:read", "users:write", "system_settings:read", ...]
}
```

---

#### POST /auth/refresh
**Public endpoint** - Refresh access token using refresh token cookie.

**Request:** No body required (uses HttpOnly cookie)

**Response:**
```json
{
  "accessToken": "new_jwt_access_token",
  "expiresIn": 900
}
```

Sets new refresh token in HttpOnly cookie (token rotation).

**Error Cases:**
- 401 Unauthorized - Missing or invalid refresh token
- 403 Forbidden - User is disabled

---

#### POST /auth/logout
**Requires Authentication** - Logout and revoke refresh token.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes refresh token in database

---

#### POST /auth/logout-all
**Requires Authentication** - Logout from all devices and revoke all refresh tokens.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes ALL refresh tokens for the current user across all devices

**Use Case:** Security feature to force re-authentication on all sessions (e.g., after password change or suspected compromise).

---

### Device Authorization (RFC 8628)

The Device Authorization Flow enables input-constrained devices (CLI tools, IoT devices, Smart TVs) to obtain user authorization. See [DEVICE-AUTH.md](DEVICE-AUTH.md) for comprehensive guide and integration examples.

#### POST /auth/device/code
**Public endpoint** - Generate device code pair to initiate device authorization flow.

**Request Body:**
```json
{
  "clientInfo": {
    "name": "My CLI Tool",
    "version": "1.0.0",
    "platform": "linux"
  }
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientInfo` | object | No | Optional metadata about client device |
| `clientInfo.name` | string | No | Application name |
| `clientInfo.version` | string | No | Application version |
| `clientInfo.platform` | string | No | Platform identifier |

**Response:**
```json
{
  "data": {
    "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4",
    "userCode": "ABCD-1234",
    "verificationUri": "http://localhost:3535/device",
    "verificationUriComplete": "http://localhost:3535/device?code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `deviceCode` | string | Opaque code for device polling (keep secret) |
| `userCode` | string | Human-readable code for user entry (XXXX-XXXX format) |
| `verificationUri` | string | URL where user should authorize |
| `verificationUriComplete` | string | URL with user code pre-filled |
| `expiresIn` | number | Code lifetime in seconds (default: 900) |
| `interval` | number | Minimum polling interval in seconds (default: 5) |

---

#### POST /auth/device/token
**Public endpoint** - Poll for authorization status and obtain tokens when approved.

**Request Body:**
```json
{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4"
}
```

**Response (200 OK - Authorized):**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

**Error Responses (400 Bad Request):**

While authorization is pending:
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet authorized this device"
}
```

Device polling too frequently:
```json
{
  "error": "slow_down",
  "error_description": "Polling too frequently. Please slow down."
}
```

Code has expired:
```json
{
  "error": "expired_token",
  "error_description": "The device code has expired"
}
```

User denied authorization:
```json
{
  "error": "access_denied",
  "error_description": "User denied the authorization request"
}
```

**Error Response (401 Unauthorized):**

Invalid device code:
```json
{
  "error": "invalid_grant",
  "error_description": "Invalid device code"
}
```

**Usage:**
1. Device requests code from `/auth/device/code`
2. Device displays `userCode` and `verificationUri` to user
3. Device polls this endpoint every `interval` seconds
4. User visits verification page and approves device
5. Polling returns tokens when approved

---

#### GET /auth/device/activate
**Requires Authentication** - Get activation page information and validate user code.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | No | User verification code to validate |

**Request (No Code):**
```http
GET /auth/device/activate
Authorization: Bearer <token>
```

**Response (No Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device"
  }
}
```

**Request (With Code):**
```http
GET /auth/device/activate?code=ABCD-1234
Authorization: Bearer <token>
```

**Response (With Valid Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device",
    "userCode": "ABCD-1234",
    "clientInfo": {
      "name": "My CLI Tool",
      "version": "1.0.0",
      "platform": "linux"
    },
    "expiresAt": "2024-01-01T12:15:00.000Z"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### POST /auth/device/authorize
**Requires Authentication** - Approve or deny device authorization request.

**Request Body:**
```json
{
  "userCode": "ABCD-1234",
  "approve": true
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userCode` | string | Yes | User code from the device |
| `approve` | boolean | Yes | true to approve, false to deny |

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device authorized successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### GET /auth/device/sessions
**Requires Authentication** - List current user's approved device sessions.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 10 | Items per page |

**Response:**
```json
{
  "data": {
    "sessions": [
      {
        "id": "uuid-1234",
        "userCode": "ABCD-1234",
        "status": "approved",
        "clientInfo": {
          "name": "My CLI Tool",
          "version": "1.0.0",
          "platform": "linux"
        },
        "createdAt": "2024-01-01T12:00:00.000Z",
        "expiresAt": "2024-01-01T12:15:00.000Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

**Use Case:** View all devices that have been authorized to access the account.

---

#### DELETE /auth/device/sessions/:id
**Requires Authentication** - Revoke a specific device session.

**Parameters:**
- `id` (UUID) - Session ID to revoke

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device session revoked successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Session not found or doesn't belong to current user

**Use Case:** Revoke access for lost or compromised devices.

---

### Test Authentication (Development/Test Only)

**Security Notice:** These endpoints are completely disabled in production. They exist solely to enable automated E2E testing without requiring real OAuth credentials.

#### POST /auth/test/login
**Development/Test Only** - Authenticate as a test user without OAuth.

**Availability:** Only when `NODE_ENV !== 'production'`

**Request Body:**
```json
{
  "email": "test@test.local",
  "role": "admin",
  "displayName": "Test Admin"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address for test user |
| `role` | enum | No | Role to assign: `admin`, `contributor`, `viewer` (default: `viewer`) |
| `displayName` | string | No | Display name for the user |

**Response:** HTTP 302 redirect to `/auth/callback?token=<accessToken>&expiresIn=900`
- Sets HttpOnly refresh token cookie (same as OAuth flow)
- Creates user if not exists, assigns specified role

**Error Cases:**
- 403 Forbidden - Endpoint disabled (production environment)
- 400 Bad Request - Invalid email or role

**Use Case:** Playwright E2E tests use this endpoint to authenticate without Google OAuth.

---

### Users

**All user endpoints require Admin role (`users:read` or `users:write` permissions)**

#### GET /users
List all users with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email or display name |
| `isActive` | boolean | - | Filter by active status |
| `role` | string | - | Filter by role name |
| `sortBy` | enum | `createdAt` | Sort field: `email`, `createdAt`, `updatedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "displayName": "John Doe",
      "profileImageUrl": "https://...",
      "providerDisplayName": "John Doe",
      "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "roles": [
        {
          "id": "uuid",
          "name": "contributor"
        }
      ]
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

---

#### GET /users/:id
Get user by ID.

**Parameters:**
- `id` (UUID) - User ID

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "providerDisplayName": "John Doe",
  "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "roles": [
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ],
  "identities": [
    {
      "provider": "google",
      "providerEmail": "user@example.com"
    }
  ]
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

**Error Cases:**
- 404 Not Found - User not found

---

#### PATCH /users/:id
Update user properties (activation status, display name).

**Requires:** `users:write` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "isActive": false,
  "displayName": "New Name"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isActive` | boolean | No | Activate or deactivate user |
| `displayName` | string | No | Update user's display name |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "New Name",
  "isActive": false,
  "roles": [
    {
      "id": "uuid",
      "name": "viewer"
    }
  ]
}
```

**Error Cases:**
- 404 Not Found - User not found

---

#### PUT /users/:id/roles
Update user roles (replaces all current roles).

**Requires:** `rbac:manage` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "roleNames": ["admin", "contributor"]
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roleNames` | string[] | Yes | Array of role names to assign (min: 1) |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    },
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ]
}
```

**Validation Rules:**
- Cannot remove own admin role (prevents accidental lockout)
- At least one role must be assigned
- Role names must exist in the system

**Error Cases:**
- 400 Bad Request - Invalid role names, empty array, or attempting to remove own admin role
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Missing `rbac:manage` permission
- 404 Not Found - User not found

---

### Allowlist

**All allowlist endpoints require Admin role (`allowlist:read` or `allowlist:write` permissions)**

The allowlist restricts application access to pre-authorized email addresses. Users must have their email in the allowlist before they can complete OAuth login.

#### GET /allowlist
List allowlisted emails with pagination, filtering, and sorting.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email |
| `status` | enum | `all` | Filter by status: `all`, `pending`, `claimed` |
| `sortBy` | enum | `addedAt` | Sort by: `email`, `addedAt`, `claimedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-01T00:00:00.000Z",
      "claimedBy": {
        "id": "uuid",
        "email": "user@example.com",
        "displayName": "John Doe"
      },
      "claimedAt": "2024-01-02T00:00:00.000Z",
      "notes": "New team member"
    },
    {
      "id": "uuid",
      "email": "pending@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-03T00:00:00.000Z",
      "claimedBy": null,
      "claimedAt": null,
      "notes": null
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`). `claimedBy` object contains `id`, `email`, and `displayName` when not null.

**Status Filters:**
- `all` - All allowlist entries
- `pending` - Emails not yet claimed by a user (claimedBy is null)
- `claimed` - Emails claimed by registered users (claimedBy is not null)

---

#### POST /allowlist
Add email to allowlist.

**Requires:** `allowlist:write` permission

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "notes": "Marketing team member - starts next week"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email address (case-insensitive) |
| `notes` | string | No | Optional notes about this user |

**Response:**
```json
{
  "id": "uuid",
  "email": "newuser@example.com",
  "addedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "addedAt": "2024-01-01T00:00:00.000Z",
  "claimedBy": null,
  "claimedAt": null,
  "notes": "Marketing team member - starts next week"
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`).

**Error Cases:**
- 409 Conflict - Email already exists in allowlist
- 400 Bad Request - Invalid email format

---

#### DELETE /allowlist/:id
Remove email from allowlist.

**Requires:** `allowlist:write` permission

**Parameters:**
- `id` (UUID) - Allowlist entry ID

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Allowlist entry not found
- 400 Bad Request - Cannot remove entry that has been claimed by a user

**Note:** Entries that have been claimed (user has logged in) cannot be removed. This prevents accidentally removing access for existing users.

---

### Settings

> **Since E4.1 (#79) these routes are the platform settings slice's** (`/api/system-settings`, `/api/user-settings`, `/api/org-settings`; conventions, `If-Match` and the full schema are in the live OpenAPI at `/api/docs`). Vault registers its namespaces in `apps/api/src/app-registrations/settings.ts`: `ui`, `features`, `ai` (same keys and shapes as before), `vaultCards` (`imageMaxBytes`, default from `CARD_IMAGE_MAX_BYTES`; `expiryWarningDays`), `vaultBackups` (`keepCount` and the content flags the admin backup schedule starts from), plus the platform's `maintenance`. `/api/user-settings` also carries the optional `dataTables` and `navigation` namespaces. Request bodies are closed (unknown keys are dropped); stored keys the code does not model are kept.
>
> **User profile** is the platform's: `profile.imageSource` (`none` or `provider`; `upload` is refused until the storage slice) and `profile.imageObjectId` replace `profile.useProviderImage`. A row from before E4.1 reads as `useProviderImage: false` = `none`, otherwise `provider` (`npm run vault:migrate-settings` rewrites the rows once; [runbook](runbooks/settings-migration.md)). `profile.customImageUrl` is kept as a Vault profile field (`null` on PATCH deletes it).

#### GET /user-settings
**Requires Authentication** - Get current user's settings.

**Response:**
```json
{
  "theme": "light",
  "profile": {
    "displayName": "John Doe",
    "useProviderImage": true,
    "customImageUrl": null
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `theme` | enum | UI theme: `light`, `dark`, `system` |
| `profile.displayName` | string \| null | User's display name override |
| `profile.useProviderImage` | boolean | Whether to use OAuth provider's profile image |
| `profile.customImageUrl` | string \| null | Custom profile image URL |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `version` | number | Version number for optimistic concurrency control |

---

#### PUT /user-settings
**Requires Authentication** - Replace all user settings.

**Request Body:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "useProviderImage": false,
    "customImageUrl": "https://example.com/avatar.jpg"
  }
}
```

**Response:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "useProviderImage": false,
    "customImageUrl": "https://example.com/avatar.jpg"
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "version": 2
}
```

**Note:** This replaces the entire settings object. Use PATCH for partial updates.

---

#### PATCH /user-settings
**Requires Authentication** - Partially update user settings.

**Request Body:**
```json
{
  "theme": "dark"
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "John Doe",
    "useProviderImage": true,
    "customImageUrl": null
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates in concurrent scenarios

**Note:** This performs a shallow merge with existing settings.

---

#### GET /system-settings
**Requires:** `system_settings:read` permission (Admin only)

Get system-wide settings.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {},
  "ai": {
    "enabled": false,
    "keyPolicy": "byok",
    "providers": { "openai": { "enabled": false } },
    "limits": {},
    "cardExtractModel": "gpt-4o-mini"
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `ui.allowUserThemeOverride` | boolean | Allow users to override system theme |
| `features` | object | Feature flags (extensible) |
| `ai` | object | The platform AI policy plus Vault's `cardExtractModel`; no key material. See [System Settings `ai` namespace](#system-settings-ai-namespace). Reads as its defaults when the row has no block |
| `vaultCards` | object | `imageMaxBytes` (card face image cap, 1 to 1 GiB; default `CARD_IMAGE_MAX_BYTES` or 5 MB), `expiryWarningDays` (0 to 365, default 30; no consumer yet) |
| `vaultBackups` | object | Defaults of the admin backup schedule until one is saved: `keepCount` (1 to 365) and `includeAttachments`, `includeVersions`, `includeSecrets`, `includeMedia`, `includeSystem` |
| `maintenance` | object | The host's maintenance window (see `/api/admin/maintenance`) |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `updatedBy` | object | User who last updated settings |
| `version` | number | Version number for optimistic concurrency control |

**JWT token lifetimes are not part of this payload.** They are configured
exclusively through the `JWT_ACCESS_TTL_MINUTES` and `JWT_REFRESH_TTL_DAYS`
environment variables and are not readable or writable over the API. Earlier
revisions of this document showed a `security: { jwtAccessTtlMinutes,
refreshTtlDays }` block here; no such key has ever been returned by
`SystemSettingsService.toResponse()`, and sending one is silently ignored.

---

#### PUT /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Replace all system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {}
}
```

`ui` and `features` are required; every other namespace may be omitted and is then kept as stored. A `PUT` that carries `ai` replaces the policy as the platform AI slice defines it; a key in a `PUT` is ignored. The deployment key is never touched by a `PUT`.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {},
  "ai": {
    "enabled": false,
    "keyPolicy": "byok",
    "providers": { "openai": { "enabled": false } },
    "limits": {},
    "cardExtractModel": "gpt-4o-mini"
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

---

#### PATCH /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Partially update system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  }
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  },
  "features": {},
  "ai": {
    "enabled": false,
    "keyPolicy": "byok",
    "providers": { "openai": { "enabled": false } },
    "limits": {},
    "cardExtractModel": "gpt-4o-mini"
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates when multiple admins modify settings concurrently

---

### Jobs and Worker Nodes

The background queue and the worker-node fleet are the platform's (`@marinoscar/platform-api/jobs` and `/nodes`, E5.1), mounted in `apps/api/src/platform/jobs/`. The per-endpoint reference is the generated OpenAPI at `/api/docs`. Every route is `@Auth` with a **system** permission (granted to `admin` only):

| Routes | Permission | Notes |
|---|---|---|
| `GET /admin/jobs`, `/admin/jobs/stats`, `/admin/jobs/insights` | `jobs:read` | Paginated list (`type`, `status`, `page`, `pageSize`), counts and throughput |
| `POST /admin/jobs/:id/retry`, `/admin/jobs/retry-failed`, `/admin/jobs/reset-stuck`, `/admin/jobs/insights/reset-history`; `DELETE /admin/jobs/:id` | `jobs:write` | Operator actions; a handler may veto a delete |
| `GET /admin/nodes`, `/admin/nodes/:id`, `/admin/nodes/:id/events`, `/admin/nodes/credentials` | `nodes:read` | Fleet inventory |
| `DELETE /admin/nodes/:id`, `/admin/nodes/credentials/:id` | `nodes:write` | Remove a node, revoke a credential |
| `POST /node-credentials`, `GET /node-credentials`, `DELETE /node-credentials/:id` | `nodes:write` / `nodes:read` | Mint, list, revoke the `nod_` tokens a worker node authenticates with |
| `/nodes/*` (register, heartbeat, claim, job renew/result/failure/secret/download-url/upload-url, telemetry) | `nodes:write` / `nodes:read` | The worker-node data plane; callers use a `nod_` token |

Vault registers no node-eligible job type: every handler is server-only, so a registered node is never offered a job. The job types in the queue today are the platform's housekeeping ones (`job.history.purge`, `audit.events.purge`, `auth.token.cleanup`, `device-auth.code.cleanup`, `nodes.fleet.sweep`, `nodes.fleet.prune`, `nodes.node_events_purge`); the backup types are `vault.backup.run` (label "Secrets backup") and `vault.user_backup.run` ("My backup"), both server-only, one attempt, up to 30 minutes. The `jobs`, `retention` and `nodes` namespaces of `/system-settings` carry the worker, retention and offload settings.

---

### Email and Notifications

Email and notifications are the platform's slices (`@marinoscar/platform-api/email` and `/notifications`, E7.1), mounted in `apps/api/src/platform/email/` and `apps/api/src/platform/notifications/`. The per-endpoint reference is the generated OpenAPI at `/api/docs`. **SMTP, SES and Web Push (VAPID) are configured at runtime in the admin UI and have no environment variable**; the secrets live in the credential store (purposes `smtp`, `email_ses`, `push_vapid`).

| Routes | Permission | Notes |
|---|---|---|
| `GET /email-settings` | `system_settings:read` | The transport, sender and which secrets are set (never a secret value) |
| `PUT /email-settings`, `POST /email-settings/test` | `system_settings:write` | Save the transport; the test send goes to the caller's own address only |
| `GET /notifications`, `/notifications/unread-count`, `/notifications/stream` (SSE), `/notifications/events`, `/notifications/channels`, `/notifications/config` | signed-in user | The caller's own inbox and the preference catalog |
| `POST /notifications/:id/read`, `/notifications/read-all` | signed-in user | Mark the caller's rows read |
| `POST` / `DELETE /notifications/push/subscriptions` | signed-in user | Register or remove the caller's Web Push subscription |
| `GET /admin/push-config` | `push:read` | Web Push configuration (public key, subject, private-key status) |
| `PUT`, `DELETE /admin/push-config`, `POST /admin/push-config/generate`, `/rotate`, `/test` | `push:write` | Manage the VAPID key pair; the private key never leaves the credential store |
| `GET /admin/broadcasts`, `/admin/broadcasts/audience`, `/admin/broadcasts/:id` | `broadcasts:read` or `org_broadcasts:read` | Either admits; the service scopes to the caller's organization for the org permission |
| `POST /admin/broadcasts`, `/admin/broadcasts/test`, `/:id/cancel`, `/:id/resume`; `DELETE /admin/broadcasts/:id` | `broadcasts:write` or `org_broadcasts:write` | An admin broadcast fans out through the `admin.broadcast.start` and `admin.broadcast.chunk` jobs into every recipient's inbox (the bell) and, when chosen, email and push |

`broadcasts:*` and `push:*` are system permissions held by `admin`; `org_broadcasts:*` is an organization permission held by `org_admin`. The `notifications` namespace of `/system-settings` is the deployment policy (a channel can be switched off for everyone) and the `notifications` namespace of `/user-settings` holds each user's per-channel preferences. The identity events are `user.welcome` (email), `allowlist.invitation` (email) and `security.role_changed` (email and the bell, mandatory), raised through `IDENTITY_NOTIFIER`. Event keys, channel ids and template names are persisted: never rename one. Vault's own events (E7.2, #86) are below; the bell, preference pages, admin pages and the push service worker are the web follow-up.

**Event catalog.** An event key is `<domain>.<name>` (the registry accepts exactly one dot), so Vault's are `vault.backup_succeeded`, `vault.backup_failed` and `vault.card_expiring`. All three are in `GET /notifications/events` and therefore in the preferences matrix; none is `mandatory`.

| Event | Channels | Default | Audience | Raised by |
|---|---|---|---|---|
| `vault.backup_succeeded` | email, bell/push | off (routine) | the owner of a "My backups" run; the holders of `system_settings:read` for a system run | `BackupNotifier`, after the `backup_runs` row is updated |
| `vault.backup_failed` | email, bell/push | on | same as above | same |
| `vault.card_expiring` | email, bell/push | on | the owner of the card secret | job `vault.cards.expiry_scan` |

Backup messages carry the scope, time, size and counts and a deep link (`/settings/backups` for a user run, `/admin/settings/backups` for a system run); a failure carries only one of the static `BACKUP_FAILURE_MESSAGES`, never a raw error, storage key or password. `vault.card_expiring` fires 30 days, 7 days and on the last day of the card's expiry month, once per card, expiry and threshold (the dedup record is an `audit_events` row `vault.card.expiry_notified`, so no table was added; a renewed card is re-armed by its new expiry). Its message carries the secret's name, `MM/YYYY` and a link to `/secrets/:id`; the payload has no field for a number, last four, CVV or any value. Email templates: `vault-backup-succeeded`, `vault-backup-failed`, `vault-card-expiring` (`apps/api/src/email-templates/`).

---

### Storage Objects

The storage system provides file upload and management capabilities with support for large files (GB scale) through resumable multipart uploads. Since E6.1 (#84) these routes, `GET /api/storage/status` and `/api/admin/storage-config` are the **platform storage slice's** (`@marinoscar/platform-api/storage`, mounted in `apps/api/src/platform/storage/`); the generated OpenAPI at `/api/docs` is the per-route reference. What changed for callers:

- Permissions are explicit: `storage:read` (list, get, download, status) and `storage:write` (upload, complete, abort, metadata, delete); `storage:delete_any` (admin) deletes another user's object. Contributors hold read and write, viewers read only.
- The object store is runtime-configured. `GET/PUT /api/admin/storage-config`, `POST /api/admin/storage-config/test` and `POST /api/admin/storage-config/bucket` need `storage_config:read` / `storage_config:write` (admin). Until a configuration is saved every route that moves bytes answers `503` (`details.reason: "storage_not_configured"`). The migration from the old environment variables: [storage-config-migration](runbooks/storage-config-migration.md).
- New objects get the key `uploads/<orgId>/<timestamp>/<uuid><ext>`; objects written earlier keep `uploads/<timestamp>/<uuid><ext>` and are served by their stored key.
- The simple upload (`POST /api/storage/objects`) streams through the API up to the smaller of `MAX_FILE_SIZE` and 10 GiB.

#### Initialize Resumable Upload

`POST /api/storage/objects/upload/init`

**Requires Authentication** - Initialize a multipart upload for large files. Returns presigned URLs for direct-to-S3 uploads.

**Request Body:**
```json
{
  "name": "document.pdf",
  "size": 104857600,
  "mimeType": "application/pdf"
}
```

**Response:**
```json
{
  "data": {
    "objectId": "uuid",
    "uploadId": "s3-upload-id",
    "partSize": 10485760,
    "totalParts": 10,
    "presignedUrls": [
      { "partNumber": 1, "url": "https://..." },
      { "partNumber": 2, "url": "https://..." }
    ]
  }
}
```

---

#### Get Upload Status

`GET /api/storage/objects/:id/upload/status`

**Requires Authentication** - Check progress of an in-progress upload.

**Response:**
```json
{
  "data": {
    "status": "uploading",
    "uploadedParts": 5,
    "totalParts": 10,
    "progress": 50
  }
}
```

---

#### Complete Upload

`POST /api/storage/objects/:id/upload/complete`

**Requires Authentication** - Finalize multipart upload after all parts are uploaded.

**Request Body:**
```json
{
  "parts": [
    { "partNumber": 1, "eTag": "\"etag1\"" },
    { "partNumber": 2, "eTag": "\"etag2\"" }
  ]
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "processing"
  }
}
```

---

#### Abort Upload

`DELETE /api/storage/objects/:id/upload/abort`

**Requires Authentication** - Cancel an in-progress upload and clean up resources.

**Response:** HTTP 204 No Content

---

#### Simple Upload

`POST /api/storage/objects`

**Requires Authentication** - Direct upload for small files (< 100MB) using multipart/form-data.

**Request:**
- Content-Type: `multipart/form-data`
- Body: File attached as form data with key `file`

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "status": "uploading"
  }
}
```

---

#### List Objects

`GET /api/storage/objects`

**Requires Authentication** - List storage objects with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `status` | enum | - | Filter by status: `pending`, `uploading`, `processing`, `ready`, `failed` |
| `sortBy` | enum | `createdAt` | Sort field: `createdAt`, `name`, `size` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "document.pdf",
      "size": 104857600,
      "mimeType": "application/pdf",
      "status": "ready",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

---

#### Get Object

`GET /api/storage/objects/:id`

**Requires Authentication** - Get storage object metadata.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "ready",
    "metadata": {
      "customField": "value"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### Get Download URL

`GET /api/storage/objects/:id/download`

**Requires Authentication** - Get a signed download URL for the object.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | number | 3600 | URL expiration in seconds |

**Response:**
```json
{
  "data": {
    "url": "https://s3.amazonaws.com/...",
    "expiresAt": "2024-01-01T01:00:00.000Z"
  }
}
```

---

#### Delete Object

`DELETE /api/storage/objects/:id`

**Requires Authentication** - Delete a storage object and its associated file.

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Object not found
- 403 Forbidden - User does not own object (non-admin)

---

#### Update Metadata

`PATCH /api/storage/objects/:id/metadata`

**Requires Authentication** - Update custom metadata for an object.

**Request Body:**
```json
{
  "metadata": {
    "customField": "value",
    "tags": ["document", "important"]
  }
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "metadata": {
      "customField": "value",
      "tags": ["document", "important"]
    },
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### Secrets

The secrets feature (encrypted credential/card/document storage, versioning, rollback, and file attachments) is documented in full in [SECRETS.md](SECRETS.md). This section covers only the endpoints not yet described there in request/response form, plus the AI-assisted card capture surface that sits alongside it. All secrets endpoints require authentication; ownership is enforced at the service layer (non-admins may only act on secrets they created, unless they hold the `*_any` variant of the relevant permission).

Base paths: `/api/secrets` and `/api/secret-types`.

The backup download, [`POST /secrets/export`](#post-secretsexport), returns a raw `application/zip` stream rather than the JSON envelope.

#### POST /secrets/export

**Requires Authentication** (`secrets:read`) - Download a password-protected backup of the secrets **you own**. The response is a streamed AES-256 encrypted zip (WinZip AE-2), not JSON. For what is inside the archive, how to open it and the password trade-offs, see [SECRETS.md § Backup and export](SECRETS.md#backup-and-export).

Only data the caller owns is exported (secrets they created, media folders they own), even for a user holding `secrets:read_any`. There is no all-users variant here; an administrator's backup of everyone is [`POST /admin/backups/export`](#post-adminbackupsexport).

The same body is accepted by [`POST /backups/me`](#post-backupsme), which builds the zip in the background and keeps it in object storage instead of streaming it.

**Request Body:**
```json
{
  "password": "blue tiger river",
  "includeSecrets": true,
  "includeAttachments": true,
  "includeVersions": false,
  "includeMedia": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `password` | string | required | 6 to 256 characters, no complexity rules. Used as-is (not trimmed). Never stored or logged; it cannot be recovered. |
| `includeSecrets` | boolean | `true` | Include your secrets (`secrets.html`, `secrets.json`). |
| `includeAttachments` | boolean | `true` | Include attachment files (card images and other files). Needs `includeSecrets`. |
| `includeVersions` | boolean | `false` | Include every version of each secret, not just the current one. Needs `includeSecrets`. |
| `includeMedia` | boolean | `false` | Include the media library folders you own and their files. |

`includeSystem` is not accepted here: sending it at all, even as `false`, is a `400`. System configuration belongs only to the administrator's backup. What each option puts in the zip: [SECRETS.md § What each option includes](SECRETS.md#what-each-option-includes).

**Success Response (200 OK):**

The body is the raw zip. It is **not** wrapped in `{ "data": ... }` and has no `meta` envelope (the response interceptor passes streamed files through untouched).

| Header | Value |
|--------|-------|
| `Content-Type` | `application/zip` |
| `Content-Disposition` | `attachment; filename="vault-backup-YYYY-MM-DD.zip"` (date is the server's UTC date) |
| `X-Vault-Export-Secrets` | Number of secrets in the archive |
| `X-Vault-Export-Attachments` | Number of attachment files in the archive |
| `X-Vault-Export-Media-Files` | Number of media library files in the archive (`0` unless `includeMedia`) |
| `Cache-Control` | `no-store` |

`Content-Disposition` and the `X-Vault-Export-*` headers are exposed through CORS, so a cross-origin browser client can read them.

**Example:**
```bash
curl -sS -X POST http://localhost:3535/api/secrets/export \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"password":"blue tiger river"}' \
  -o vault-backup.zip -D -
```

**Error Cases:**
- `400 Bad Request` - the body failed validation. The `message` is the first specific problem (for example `Password must be at least 6 characters`, `Password must be at most 256 characters`, `Password is required`, `includeVersions must be a boolean`); `details` lists every problem as `{ "field", "message" }`. Messages never echo the submitted value. The content rules have fixed messages, shared with the other backup routes (see [Backup content validation](#backup-content-validation)).
- `401 Unauthorized` - missing or invalid token
- `403 Forbidden` - caller lacks `secrets:read`

All of these are ordinary JSON error responses; they are sent before any zip byte. Once streaming has started, a server-side failure aborts the connection instead (the download ends truncated, so a client must not treat a dropped stream as a complete file).

**Warnings:** an attachment that cannot be read from storage (never finished uploading, or missing from the bucket) does not fail the request. It is skipped and listed under `warnings` in the archive's `secrets.json` and `README.txt`; the response headers count only attachments actually written. Media files that are not ready are skipped silently, and media files missing from storage are skipped with a warning in `media/media.json` and `README.txt`. A version whose values cannot be decrypted is exported with empty values and a warning.

**Audit:** a `secrets.export` event is written before the first byte is sent, with metadata `{ secretCount, attachmentCount, mediaFolderCount, mediaFileCount, includeSecrets, includeAttachments, includeVersions, includeMedia, warningCount }`. The password is never part of it. See [SECRETS.md § Audit Trail](SECRETS.md#audit-trail).

**Rate limits:** none specific to this endpoint (see [Rate Limits](#rate-limits)). It reads and decrypts every owned secret, so avoid calling it in a tight loop.

---

#### Backup content validation

Every route that takes a content selection (`POST /secrets/export`, `POST /backups/me`, `PUT /admin/backups/schedule`, `POST /admin/backups/export`) applies the same rules and returns these exact `message` values with `400 Bad Request`:

| Condition | Message |
|-----------|---------|
| None of secrets, media and system selected | `Choose at least one thing to back up` |
| `includeAttachments: true` with `includeSecrets: false` | `Attachments can only be backed up together with secrets` |
| `includeVersions: true` with `includeSecrets: false` | `Old versions can only be backed up together with secrets` |
| `includeSystem` sent to a user-level route (`POST /secrets/export`, `POST /backups/me`) | `System configuration can only be included in a scheduled system backup` |

A flag left out takes its default (`includeSecrets` and `includeAttachments` true; `includeVersions`, `includeMedia` and `includeSystem` false). Attachments and versions left out while secrets are off are simply off; only an explicit `true` is an error. `includeSystem: false` is also refused on the user routes, because the field must not be sent at all.

---

#### POST /secrets/:id/renew

**Requires Authentication** (`secrets:write`) - Renew a secret with a new set of field values, optionally replacing individual attachment roles (e.g. the front/back images of a reissued card). See [SECRETS.md § Renewal](SECRETS.md#renewal-post-secretsidrenew) for the full semantics — in short: this mints the next version from **replacement** data (not a merge of the old and new), carries every attachment forward except the roles/objects the request replaces, and does all of it in one transaction.

**Request Body:**
```json
{
  "data": {
    "cardholder_name": "Jane Doe",
    "number": "4111111111111111",
    "exp_month": "07",
    "exp_year": "2029",
    "cvv": "123",
    "card_network": "Visa",
    "card_kind": "Credit"
  },
  "attachments": [
    { "storageObjectId": "uuid-of-new-front-image", "role": "card_front" },
    { "storageObjectId": "uuid-of-new-back-image", "role": "card_back" }
  ],
  "aiAssisted": true
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|--------------|
| `data` | object | Yes | Full field set for the type, validated exactly as `PUT /secrets/:id` validates `data` |
| `attachments` | array | No | Up to 20 entries. An entry with a `role` replaces the existing attachment of that role; without a `role` it is an addition |
| `attachments[].storageObjectId` | string (UUID) | Yes | Must already exist and be owned by the caller (or caller holds `secrets:write_any`) |
| `attachments[].role` | `"card_front"` \| `"card_back"` | No | Omit for a generic (non-card-face) attachment |
| `attachments[].label` | string | No | Max 255 characters |
| `aiAssisted` | boolean | No | Audit-only flag; recorded as `secret.renew`'s `extractionMethod` (`ai_assisted` vs `manual`). No effect on validation or storage |

**Response:** `201 Created` — the full secret detail (same shape as `GET /secrets/:id`), reflecting the new current version.

**Error Cases:**
- `400 Bad Request` — data failed type validation; duplicate `role` or `storageObjectId` within `attachments`; the secret's type does not allow attachments but `attachments` was non-empty; a `card_front`/`card_back` image failed the card image MIME/size check (see [SECRETS.md § Roles](SECRETS.md#roles-card_front-and-card_back))
- `403 Forbidden` — caller lacks access to the secret or to one of the referenced storage objects
- `404 Not Found` — secret or a referenced storage object does not exist
- `409 Conflict` — a concurrent renewal already claimed the same attachment role on the new version

---

#### GET/POST/DELETE /secrets/:id/attachments

**Requires Authentication** (`secrets:read` for `GET`, `secrets:write` for `POST`/`DELETE`).

- `POST /secrets/:id/attachments` — link a storage object to the secret's **current** version. Body: `{ "storageObjectId": "uuid", "role": "card_front", "label": "optional" }` (`role` and `label` optional). `role`, if present, must be `card_front` or `card_back` — these are the only roles the API defines today.
- `GET /secrets/:id/attachments` — list attachments. Query parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|--------------|
| `versionId` | string (UUID) | No | Read a specific historical version's attachments instead of the current version's |
| `role` | `"card_front"` \| `"card_back"` | No | Filter to one card face |

- `DELETE /secrets/:id/attachments/:attachmentId` — unlink. The underlying storage object (and its blob) is deleted only if no other attachment row — on any version, of any secret — still references it; otherwise only the link is removed. Returns `204 No Content`.

**Response shape (attachment object):**
```json
{
  "id": "uuid",
  "secretId": "uuid",
  "secretVersionId": "uuid",
  "storageObjectId": "uuid",
  "role": "card_front",
  "label": null,
  "createdAt": "2026-07-27T00:00:00.000Z",
  "storageObject": {
    "id": "uuid",
    "name": "card-front.jpg",
    "size": "482112",
    "mimeType": "image/jpeg",
    "status": "ready",
    "metadata": null,
    "createdAt": "2026-07-27T00:00:00.000Z",
    "updatedAt": "2026-07-27T00:00:00.000Z"
  }
}
```

`storageObject.size` is a string — it is a BigInt column and is stringified before serialization.

**Error Cases:**
- `400 Bad Request` — the secret's type does not allow attachments
- `403 Forbidden` — caller does not own the secret or the referenced storage object
- `404 Not Found` — secret, version, storage object, or attachment not found
- `409 Conflict` — the same file is already linked to this version, or this version already has an attachment with the given role

---

### AI card extraction

Since E8.1 ([#87](https://github.com/marinoscar/vault/issues/87)) card scanning runs on the **platform AI slice** (`@marinoscar/platform-api/ai`, mounted in `apps/api/src/platform/ai/`). Vault has no provider code, key reader, verify probe or burst limiter of its own. The platform serves, under the usual `{ data }` envelope and `/api/docs`:

- `GET /api/ai/config` (any signed-in user, open while AI is off): whether AI is on, the key policy, each provider and whether a deployment key is stored. The web moves to it in E10; until then `GET /api/ai/status` is the compatibility alias below.
- `/api/admin/ai/*` (`ai_config:read` / `ai_config:write`, **not** behind the kill switch): the deployment policy (the `ai` system-settings namespace), the deployment provider key (write-only, stored at credential `('ai', 'openai')`, where Vault's key has been since E4.2), the model catalogue (`ai_models`: enable a model, run the key test), usage. `/api/admin/ai/org-*` are the organization's own (`org_ai_config:*`).
- `/api/ai/*` consumer routes (`AiEnabledGuard` + `ai:use`): responses, runs, features, usage, own keys. Vault's UI uses none of them yet.

The feature id is `card_extract` (lower snake case: the platform refuses a hyphen). Admin walkthrough: [runbooks/ai-platform-migration.md](runbooks/ai-platform-migration.md).

#### GET /ai/status

**Requires Authentication** (no permission). Compatibility alias of `GET /ai/config`, kept until E11 for the web (`useAiStatus`) and unchanged on the wire:

```json
{ "data": { "enabled": true, "features": { "cardExtract": true } } }
```

`enabled` is true only when the caller's organization has AI on, the OpenAI provider is switched on, the deployment key is stored, and the key policy is `byok_with_org_fallback` (Vault users hold no key of their own; a policy of `byok` makes the alias answer false). It is not behind the kill switch, and exposes no model, key hint or reason.

---

#### GET /secrets/cards/summary

Card summaries for Home and the Cards gallery, so a client needs one request instead of one `GET /secrets/:id` (one decryption each) per card. Permission `secrets:read`. Ownership follows `GET /secrets`: the caller's own card secrets, or every card for a holder of `secrets:read_any`.

Query: `page` (default 1), `pageSize` (default 20, max 100; 400 above it).

Sorted by expiry, soonest first; cards with an unknown expiry year last; ties by name. Sorting happens after decryption, so pagination is applied to the sorted list.

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Visa travel",
        "last4": "1111",
        "expMonth": 3,
        "expYear": 2027,
        "network": "Visa",
        "kind": "Credit",
        "issuingBank": "Bank X",
        "cardholderName": "Person A",
        "hasPhotos": true,
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "meta": { "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
  }
}
```

`last4` is `string | null`; `expMonth` (1 to 12) and `expYear` (four digits) are `number | null`. `network`, `kind`, `issuingBank` and `cardholderName` are the card's non-sensitive display fields (`string | null`, trimmed, `null` when blank or absent); `hasPhotos` is `true` when the current version has a `card_front` or `card_back` attachment (read in the same query). A field that is missing or malformed in an old card is `null`; one unreadable card never fails the request (it appears with every decrypted field `null`). The full number, the CVV, the secondary security code, notes and every other field are never returned. The route is registered before `GET /secrets/:id`.

---

#### POST /secrets/cards/extract

**Requires Authentication** (`secrets:write` **and** `ai:use`), and the platform kill switch (`AiEnabledGuard`: `403` with `details.reason: "AI_DISABLED"` while AI is off). It runs after authentication, so an anonymous caller still gets `401`. Extracts candidate card field values from one or two card face images.

Deliberately namespaced under `/secrets/cards`, not `/ai/*`: it is a step in the card-creation flow.

**Request Body:**
```json
{
  "front": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "back": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

`front` is required; `back` is optional. Both are full, uncropped camera frames (`image/jpeg`, `image/png` or `image/webp`; at most about 4.5 MB each). The JSON transport is unchanged.

**How it runs.** `CardExtractService` calls `AiService.forUser(userId, { orgId, feature: 'card_extract' }).respondStructured(...)` with both images as image parts of one message (the model cross-references the sides). The model is `ai.cardExtractModel` (`VaultAiTargetResolver`) and must be enabled in the catalogue; the key is the deployment key; the platform records one `ai_usage_events` row (tokens, model, feature, latency). **Persists nothing about the card**: no image byte, card number or name reaches `ai_usage_events`, `ai_runs`, `audit_events` or a log (`test/ai/card-extract.db.spec.ts` proves it).

**Response:**
```json
{
  "data": {
    "fields": {
      "cardholder_name": "JANE DOE",
      "number": "4111111111111111",
      "exp_month": "07",
      "exp_year": "2029",
      "cvv": null,
      "card_network": "Visa",
      "card_kind": "Credit",
      "issuing_bank": null,
      "security_code_2": null,
      "notes": "Customer service: 1-800-555-0100\nMember since 2019"
    },
    "confidence": {
      "cardholder_name": 0.94, "number": 0.88, "exp_month": 0.91, "exp_year": 0.91, "cvv": 0,
      "card_network": 0.99, "card_kind": 0.6, "issuing_bank": 0, "security_code_2": 0, "notes": 0.85
    },
    "warnings": [],
    "model": "gpt-4o-mini",
    "crops": {
      "front": { "x": 0.18, "y": 0.31, "width": 0.64, "height": 0.4, "quarterTurns": 0, "confidence": 0.92 },
      "back": null
    },
    "partial": false
  }
}
```

**The security code is never requested.** (Behaviour change in E8.1: before it, `cvv` and `security_code_2` were extracted.) The prompt forbids reading either, the model schema has no field for them, and `normalizeExtractions` forces both to `null` with confidence `0` and removes any line of `notes` that names a security code. The two keys stay in the response so the review form's shape does not change; the user types the code from the card.

`crops`, `warnings`, `partial`, the `card_kind` inference, the `notes` rules and the network/kind enums (the seeded `Card` options) are as before. `normalizeExtractions` still merges, validates the number (Luhn warning), and normalizes expiry.

**Error Cases** (see [Error Codes](#error-codes)). The platform's `AI_*` failures are mapped onto the codes the web already handles:

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `AI_INVALID_IMAGE` | Body was not one or two acceptable base64 image data URLs |
| 401 | | No credential |
| 403 | `FORBIDDEN` + `details.reason: AI_DISABLED` | The platform kill switch is off (also the organization's own switch) |
| 403 | `FORBIDDEN` | Missing `secrets:write` or `ai:use` |
| 422 | `AI_EXTRACTION_FAILED` | The model could not read the card, its output failed the schema, or content was filtered |
| 429 | `AI_RATE_LIMITED` | The platform per-user per-minute cap (`ai.limits.perUser.requestsPerMinute`); unset by default |
| 429 | `AI_QUOTA_EXCEEDED` | A daily cap (`ai.limits.perUser.requestsPerDay`, or an organization cap), UTC calendar day; `Retry-After` set |
| 429 | `AI_UPSTREAM_RATE_LIMITED` | OpenAI itself rate-limited the request |
| 502 | `AI_UPSTREAM_AUTH` | OpenAI rejected the deployment key (never 401/403) |
| 502 | `AI_UPSTREAM_UNAVAILABLE` | OpenAI 5xx, network failure, or the 90 s timeout |
| 503 | `AI_NOT_CONFIGURED` | No enabled provider, model not enabled in the catalogue, or no deployment key |

A `429`/`502` may include a `Retry-After` header (seconds). **Limits replace the old budget.** The per-process burst limiter (10 per 5 minutes) is gone; the per-user daily budget (`maxCallsPerUserPerDay`, a rolling 24 hours counted from `audit_events` rows `ai.card.extract`) is now the platform cap `ai.limits.perUser.requestsPerDay` (a UTC day, counting every AI call of the user). Both are set on `/admin/settings/ai`.

---

### System Settings `ai` namespace

`GET|PUT|PATCH /system-settings` carry an `ai` object that is the **platform AI policy** extended with one Vault field:

| Field | Meaning |
|-------|---------|
| `enabled` | The kill switch |
| `keyPolicy` | `byok` or `byok_with_org_fallback`; Vault runs `byok_with_org_fallback` (the deployment key serves every caller) |
| `providers.openai.enabled` (+ other provider slots, inert) | Switches the OpenAI adapter on |
| `limits.perUser.requestsPerMinute` / `requestsPerDay`, `limits.perOrg.*` | Caps; absent = unlimited |
| `defaults`, `hostedTools`, `logPromptContent`, `usageRetentionDays`, `deploymentKeyServesOrgs` | Platform policy (see the platform AI README) |
| **`cardExtractModel`** | Vault's field: the model the `card_extract` feature runs on (1-128 characters, default `gpt-4o-mini`); replaces `ai.model` |

**There is no key in this block and no `apiKeyConfigured` / `apiKeyLast4` projection any more.** `ai.apiKey` in a `PATCH` is ignored (stored nowhere). Set the key through `PUT /admin/ai/config` / the Admin AI page; read whether one is stored from `GET /ai/config` (`providers[].hasOrgKey`). The old fields `provider`, `model` and `maxCallsPerUserPerDay` are rewritten by `npm run vault:migrate-ai-platform` ([runbook](runbooks/ai-platform-migration.md)); until it runs, the platform reads a legacy block as "no provider switched on" (card scanning answers `503 AI_NOT_CONFIGURED`, nothing errors). The `ai` namespace is **not required on `PUT`**.

Every settings write is audited (`system_settings:patch` / `system_settings:replace`).

---

### Backups (Admin)

Scheduled, system-wide backups of every user's vault data into object storage, plus a one-off streamed download. Concepts, zip layout and the password risks are in [SECRETS.md § Scheduled backups (admin)](SECRETS.md#scheduled-backups-admin). Base path: `/api/admin/backups`. Reads need `system_settings:read`; anything that changes state or hands out an archive needs `system_settings:write`. All responses use the standard `{ "data": ... }` envelope, except `POST /admin/backups/export`, which streams a raw zip.

These routes see only system backups (`scope: "system"`). A user's own saved backups ([`/api/backups/me`](#my-backups)) never appear in the list and cannot be downloaded or deleted here.

#### GET /admin/backups/schedule

**Requires Authentication** (`system_settings:read`) - Returns the schedule, or the defaults (disabled, daily 03:00 UTC, keep 7) when none is saved.

**Success Response (200 OK):**
```json
{
  "data": {
    "enabled": true,
    "frequency": "daily",
    "intervalHours": null,
    "timeOfDay": "03:00",
    "dayOfWeek": null,
    "dayOfMonth": null,
    "timezone": "America/Chicago",
    "keepCount": 7,
    "includeSecrets": true,
    "includeAttachments": true,
    "includeVersions": false,
    "includeMedia": false,
    "includeSystem": false,
    "passwordConfigured": true,
    "passwordUpdatedAt": "2026-11-01T20:15:38.000Z",
    "nextRunAt": "2026-11-03T09:00:00.000Z",
    "lastRunAt": "2026-11-02T09:00:04.000Z",
    "storageConfigured": true,
    "updatedAt": "2026-11-01T20:15:38.000Z"
  }
}
```

The password and its ciphertext are never returned; only `passwordConfigured` and `passwordUpdatedAt`.

#### PUT /admin/backups/schedule

**Requires Authentication** (`system_settings:write`) - Replaces the schedule and recomputes `nextRunAt`. Returns the same shape as GET.

**Request Body:**
```json
{
  "enabled": true,
  "frequency": "weekly",
  "intervalHours": null,
  "timeOfDay": "03:00",
  "dayOfWeek": 0,
  "dayOfMonth": null,
  "timezone": "America/Chicago",
  "keepCount": 7,
  "includeSecrets": true,
  "includeAttachments": true,
  "includeVersions": false,
  "includeMedia": false,
  "includeSystem": false,
  "password": "blue tiger river lamp"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Required. Enabling needs a stored (or supplied) password and configured storage. |
| `frequency` | string | `hourly`, `daily`, `weekly` or `monthly`. |
| `intervalHours` | number \| null | `hourly` only: 1, 2, 3, 4, 6, 8 or 12. Runs on the hour, counted from local midnight; `timeOfDay` is ignored. |
| `timeOfDay` | string | `HH:mm`, for daily, weekly and monthly. |
| `dayOfWeek` | number \| null | Weekly only, 0 (Sunday) to 6. |
| `dayOfMonth` | number \| null | Monthly only, 1 to 28. |
| `timezone` | string | IANA zone, for example `America/Chicago`. |
| `keepCount` | number | 1 to 365 (default 7). |
| `includeSecrets` | boolean | Every user's secrets. Optional, default `true`. |
| `includeAttachments` | boolean | Include attachment files. Needs `includeSecrets`. |
| `includeVersions` | boolean | Include every version, not just the current one. Needs `includeSecrets`. |
| `includeMedia` | boolean | Every user's media library folders and files. Optional, default `false`. |
| `includeSystem` | boolean | System configuration: users and roles, allowlist, custom secret types, system settings. Optional, default `false`. |
| `password` | string | Optional, write-only, 6 to 256 characters, not trimmed. Omit to keep the stored password; a string replaces it. |

All fields except `password`, `includeSecrets`, `includeMedia` and `includeSystem` are required (full replace); the three optional content flags take their defaults when left out, so an older client keeps working. The content rules and their messages are under [Backup content validation](#backup-content-validation).

**Error Cases:**
- `400 Bad Request` - validation failed (including the content rules), or `enabled: true` without a password or without configured storage. Messages never echo the password.
- `401 Unauthorized` / `403 Forbidden`

**Audit:** `backups.schedule.update` with `{ changedFields, passwordChanged }`. The password is never logged or audited.

#### POST /admin/backups/run

**Requires Authentication** (`system_settings:write`) - Queues a backup now (the `vault.backup.run` job), saved to storage, using the stored schedule password and the schedule's contents. Returns `202 Accepted` with the run (`status: "running"`, also while the job waits for a worker). The run finishes in the background; poll `GET /admin/backups`. To get a zip straight to the browser instead, use [`POST /admin/backups/export`](#post-adminbackupsexport).

If storage or the password is not configured, the call still returns 202 and the run then fails with a clear message in `error`. If a system backup is already queued or running (scheduled or manual), the request returns `409 Conflict` (`A backup is already running`) and creates nothing: the queue allows one active `vault.backup.run` job.

**Audit:** `backups.run` with `{ runId }`.

#### GET /admin/backups

**Requires Authentication** (`system_settings:read`) - Lists runs, newest first. Query: `page` (default 1), `pageSize` (default 20, max 100).

**Success Response (200 OK):**
```json
{
  "data": {
    "items": [
      {
        "id": "<run-uuid>",
        "scope": "system",
        "status": "succeeded",
        "trigger": "schedule",
        "triggeredBy": null,
        "sizeBytes": 1048576,
        "userCount": 3,
        "secretCount": 42,
        "attachmentCount": 7,
        "mediaFileCount": 0,
        "warningCount": 0,
        "contents": ["secrets", "attachments"],
        "error": null,
        "startedAt": "2026-11-02T09:00:00.000Z",
        "finishedAt": "2026-11-02T09:00:04.000Z",
        "deletedAt": null,
        "downloadable": true
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

`status` is `running`, `succeeded` or `failed`; `scope` is `system` here and `user` on [`/backups/me`](#my-backups); `trigger` is `schedule` or `manual`; `triggeredBy` is `{ id, email, displayName }` for manual runs. `contents` lists what the run backed up, a subset of `secrets`, `attachments`, `versions`, `media` and `system` in that order; a system run fills it in when it ends, so it is empty while `running` and for runs made before content selection existed. `mediaFileCount` counts media files written. `downloadable` is true for a succeeded run whose object has not been deleted. This list wraps its paging fields inside `data` rather than using the `meta` envelope shown under [Pagination](#pagination).

#### GET /admin/backups/:id/download

**Requires Authentication** (`system_settings:write`) - Returns a signed storage URL valid for 300 seconds.

```json
{ "data": { "url": "https://storage.example.test/...", "expiresAt": "2026-11-02T09:05:00.000Z", "fileName": "vault-backup-2026-11-02_090000-9d8c7b6a.zip" } }
```

`404 Not Found` if the run does not exist, did not succeed or its object was deleted. **Audit:** `backups.download` with `{ runId }`.

#### DELETE /admin/backups/:id

**Requires Authentication** (`system_settings:write`) - Deletes the backup object and marks the run `deletedAt`; the row stays as history. Returns `204 No Content`.

- `404 Not Found` - unknown id
- `409 Conflict` - the run is still running
- `502 Bad Gateway` - storage refused the delete (the run is not marked deleted)
- Deleting an already-deleted backup is a `204` no-op.

**Audit:** `backups.delete` with `{ runId }`.

#### POST /admin/backups/export

**Requires Authentication** (`system_settings:write`) - Download a system backup now. The response is a streamed AES-256 zip (WinZip AE-2) with the same layout as a scheduled backup (`index.json`, `users/NNNN/...`, `system/...`) built from the contents you choose. Nothing is stored in object storage and no run is recorded. Like [`POST /secrets/export`](#post-secretsexport) the body of the response is raw, not wrapped in `{ "data": ... }`.

**Request Body:**
```json
{
  "useScheduledPassword": true,
  "includeSecrets": true,
  "includeAttachments": true,
  "includeVersions": false,
  "includeMedia": true,
  "includeSystem": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `password` | string | - | 6 to 256 characters, not trimmed. Never stored or logged. |
| `useScheduledPassword` | boolean | `false` | Use the stored schedule password (decrypted only for this stream). |
| `includeSecrets` | boolean | `true` | Every user's secrets. |
| `includeAttachments` | boolean | `true` | Needs `includeSecrets`. |
| `includeVersions` | boolean | `false` | Needs `includeSecrets`. |
| `includeMedia` | boolean | `false` | Every user's media library. |
| `includeSystem` | boolean | `false` | System configuration. |

Give **exactly one** of `password` and `useScheduledPassword: true`.

**Success Response (200 OK):** the raw zip.

| Header | Value |
|--------|-------|
| `Content-Type` | `application/zip` |
| `Content-Disposition` | `attachment; filename="vault-backup-YYYY-MM-DD_HHmmss.zip"` (UTC) |
| `X-Vault-Export-Users` | Number of users in `index.json` |
| `X-Vault-Export-Secrets` | Number of secrets in the archive |
| `X-Vault-Export-Attachments` | Number of attachment files in the archive |
| `X-Vault-Export-Media-Files` | Number of media files in the archive |
| `Cache-Control` | `no-store` |

All `X-Vault-Export-*` headers and `Content-Disposition` are exposed through CORS.

**Error Cases:**
- `400 Bad Request` - `Enter a password, or use the scheduled backup password` (neither given), `Use either a password or the scheduled backup password, not both`, a password length message, a [content rule](#backup-content-validation), or `No scheduled backup password is set. Enter a password for this download.` when `useScheduledPassword` is true and none is stored. Messages never echo the password.
- `401 Unauthorized` / `403 Forbidden`

Validation errors are ordinary JSON responses sent before any zip byte; a failure after streaming has started aborts the connection, so a client must not treat a dropped stream as a complete file.

**Audit:** `backups.export`, written before the first byte, with `{ contents, passwordSource: "provided" | "scheduled", counts: { users, secrets, attachments, mediaFiles, warnings } }`. The password is never part of it.

---

### My backups

A user's own backups saved to object storage ("Save to the storage account"). The server builds the same zip as [`POST /secrets/export`](#post-secretsexport) in the background and stores it under `user-backups/<userId>/vault-backup-YYYY-MM-DD_HHmmss-<runId8>.zip`. Concepts and risks: [SECRETS.md § Saved user backups](SECRETS.md#saved-user-backups). Base path: `/api/backups/me`. Every route needs `secrets:read` and works on the caller's own saved backups only: another user's id answers `404`, whatever permissions the caller holds, and an administrator does not see these in the admin list. Responses use the standard `{ "data": ... }` envelope; a run has the shape shown under [`GET /admin/backups`](#get-adminbackups) with `scope: "user"`, `trigger: "manual"` and `triggeredBy` set to you.

#### GET /backups/me/config

Returns whether saving to storage is available, so a client can disable the option.

```json
{ "data": { "storageConfigured": true, "keepCount": 10 } }
```

#### POST /backups/me

Starts a saved backup. Body: the same as `POST /secrets/export` (`password`, `includeSecrets`, `includeAttachments`, `includeVersions`, `includeMedia`, with the same defaults and [content rules](#backup-content-validation); `includeSystem` is a `400`). Returns `202 Accepted` with the run (`status: "running"`, `contents` already set); poll `GET /backups/me`. The run is the `vault.user_backup.run` job.

The password is used only while the zip is built. It is held in the job payload only as encrypted ciphertext until the run settles (then removed), decrypted in memory, and never logged, audited or put in an error. After a successful run the newest 10 saved backups are kept and older ones are deleted.

**Error Cases:**
- `400 Bad Request` - validation failed, or storage is not configured: `Saving to storage isn't set up. Ask an administrator, or download the backup instead.`
- `409 Conflict` - `You already have a backup running` (one queued or running saved backup per user; the queue's dedup key, so the answer is the same whichever instance is asked)
- `401 Unauthorized` / `403 Forbidden`

**Audit:** `backups.user.run` with `{ runId, contents }` when started; `backups.user.run.completed` with `{ runId, status, trigger, sizeBytes, contents, counts }` when it ends.

#### GET /backups/me

Lists your saved backups, newest first. Query: `page` (default 1), `pageSize` (default 20, max 100). Same paginated shape as [`GET /admin/backups`](#get-adminbackups).

#### GET /backups/me/:id/download

Returns a signed storage URL valid for 300 seconds, served as an attachment: `{ "data": { "url", "expiresAt", "fileName" } }`. `404 Not Found` if the run is not yours, does not exist, did not succeed, is still running or was deleted. **Audit:** `backups.user.download` with `{ runId }`.

#### DELETE /backups/me/:id

Deletes the stored object and sets `deletedAt`; the row stays in your list. Returns `204 No Content`. `404` if not yours or unknown, `409` while the backup is running, `502` if storage refuses the delete (the run is not marked deleted); deleting an already-deleted backup is a `204` no-op. **Audit:** `backups.user.delete` with `{ runId }`.

---

### Health

**Public endpoints**, served by the platform host core (`PlatformHostCoreModule`); used for liveness and readiness probes. All three are reachable during a maintenance window except `/health/ready`, which answers `503` while a window is open. Bodies are wrapped like every other response (`{ "data": ..., "meta": ... }`).

#### GET /health/live
Liveness: `200` whenever the process runs. Runs no indicator, never touches the database.

```json
{ "data": { "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" } }
```

---

#### GET /health/ready
Readiness: the critical indicators (the `database` indicator is a timed `SELECT 1`). `200` when all are up; `503` with the standard error body when one is down or a maintenance window is open.

```json
{
  "data": {
    "status": "ok",
    "info": { "database": { "status": "up", "responseTime": "3ms" } },
    "error": {},
    "details": { "database": { "status": "up", "responseTime": "3ms" } },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### GET /health
Full health check: every registered indicator. Same body as `/health/ready`; `503` when any is down.

---

### Database backup (admin)

Whole-database disaster recovery from the platform `db-backup` slice (`@marinoscar/platform-api/db-backup`, E9.1): a streaming `pg_dump -Fc` of every table into object storage under `database-backups/`, its schedule and retention, and an in-app restore. **Not** the encrypted secret backups of [Backups (Admin)](#backups-admin) above; the difference is in [SECRETS.md](SECRETS.md#whole-database-backup-versus-encrypted-secret-backups). Base path: `/api/admin/db-backup`. System scope: every route needs the `admin` role **and** the permission below, so an organization's `org_admin` gets 403. All responses use the standard `{ "data": ... }` envelope; the exact shapes are in the generated OpenAPI at `/api/docs` and `@marinoscar/platform-contract/db-backup`.

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /api/admin/db-backup/config` | `db_backup:read` | The policy (schedule, retention, rollback mode), the next scheduled run and whether restore is available |
| `PUT /api/admin/db-backup/config` | `db_backup:write` | Save the policy (`daily`, `weekly`, `monthly` or a validated `cron`; retention count and age) |
| `POST /api/admin/db-backup/runs` | `db_backup:write` | Back up now: claims a run (one active run at a time, 409 otherwise) and enqueues `db.backup.run` |
| `GET /api/admin/db-backup/runs`, `GET /api/admin/db-backup/runs/:id` | `db_backup:read` | History (paginated) and one run: status, size, checksum, `migration_name`, restore progress |
| `GET /api/admin/db-backup/runs/:id/download` | `db_backup:read` | A signed download URL, valid five minutes (a complete copy of the database: treat as a credential) |
| `GET /api/admin/db-backup/node-credential-preflight` | `db_backup:read` | Whether a worker node could be issued the per-job SELECT-only role |
| `POST /api/admin/db-backup/runs/:id/cancel`, `DELETE /api/admin/db-backup/runs/:id` | `db_backup:write` | Cancel an active run; delete a finished one and its archive |
| `POST /api/admin/db-backup/runs/:id/restore` | `db_backup:restore` | Pre-flight (`ok`, `guided` or `blocked`) and, confirmed, start `db.restore.run` |
| `POST /api/admin/db-backup/runs/:id/rollback` | `db_backup:restore` | Roll the last restore back |

Restore and rollback answer `403` with `details.reason: "deployment_mode_saas"` when `DEPLOYMENT_MODE=saas`, before any lookup. Every dump and restore carries `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (environment, never argv). Procedures: [runbooks/database-restore.md](runbooks/database-restore.md). Notifications: `db_backup.backup_failed` and the mandatory `db_backup.restore_completed`, to the holders of `db_backup:read`.

---

### Exports, user data and onboarding

The platform's `exports`, `user-data` and `onboarding` slices (E9.3, [#91](https://github.com/marinoscar/vault/issues/91)), mounted in `apps/api/src/platform/{exports,user-data,onboarding}/`. The per-endpoint reference is the generated OpenAPI at `/api/docs`; the conventions are the platform's (`{ data }` envelope, `202` for a queued job).

| Routes | Permission | Notes |
|---|---|---|
| `GET /exports/sources` | signed-in user | The sources the caller may use: `user-data` (platform) and `vault-secrets` (secret metadata only) |
| `POST /exports`, `GET /exports`, `GET /exports/:id` | signed-in user | `POST` queues `export.run` (`{ source, format, request }`), the id is the job id. `GET /exports/:id` of a `ready` export mints a signed URL that lives 5 minutes. Someone else's export is a `404`. Never contains a secret value or ciphertext ([SECRETS.md](SECRETS.md#download-your-data-vs-the-password-protected-zip)); values leave only through `POST /secrets/export` |
| `GET /user-data/summary` | `user_settings:write` | Categories with live counts, the scopes and what is kept |
| `POST /user-data/deletions` | `user_settings:write` | `{ scope, confirmation }`: scope `backups` (`DELETE MY BACKUPS`), `content` (`DELETE MY CONTENT`) or `everything` (`DELETE MY DATA`); queues `user.data.purge` (`202`, `{ jobId }`) |
| `GET /user-data/deletions/:jobId` | `user_settings:write` | The job's status and result counts |
| `GET /admin/factory-reset/summary`, `POST /admin/factory-reset` (`{ confirmation: "FACTORY RESET" }`), `GET /admin/factory-reset/:jobId` | `system:factory_reset` | Admin only; refused with `403 FACTORY_RESET_DISABLED_IN_SAAS` when `DEPLOYMENT_MODE=saas` |
| `GET /admin/orgs/:orgId/offboarding/*`, `POST /admin/orgs/:orgId/offboarding` | `orgs:offboard` | Admin only; answers in `TENANCY_MODE=multi` only. Vault runs one organization and ships no page for it |
| `GET /onboarding` | `user_settings:read` | The caller's `user` checklist and, for a holder of `system_settings:read`, the `admin` checklist. Statuses are derived on every read, never stored |
| `GET /admin/onboarding/metrics` | `system_settings:read` | Aggregate activation metrics (counts only) |

Job types (all server-only, permanent): `export.run`, `export.purge`, `user.data.purge`, `admin.factory_reset`, `org.offboard`, and Vault's `vault.user_data.purge` (the delegate that deletes a user's saved backups, archive first, and their unused custom secret types). Notification events `export.ready` and `export.failed` (bell and push only, no email).

Onboarding steps (ids are permanent: a user's skipped steps store them): platform `admin.storage`, `admin.email`, `admin.access`, `admin.ai`, `admin.push` (and `admin.backup` for database backups once that slice is mounted); Vault's `admin.vault_backups` (schedule on and a password stored), `user.first_secret`, `user.scan_card` (offered only while card scanning is usable), `user.first_backup` and `user.install_cli` (an access token exists, such as the one `vault login` creates).

---

### Host and operations (admin)

All require `system_settings:read` unless noted; served by the platform (`PlatformHostCoreModule`, `DoctorModule`, `AboutModule`).

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/doctor` | Runs every read-only health check (platform: `db.connection`, `db.migrations`, `db.rls_role`, `secrets.encryption-key`, `maintenance.mode`, ...; Vault: `vault.encryption_key`, `vault.backup_schedule`) and reports pass / warn / fail / skip with a remedy |
| `GET /api/admin/doctor/support-bundle` | Redacted diagnostic archive |
| `GET /api/admin/about` | API version, deployment mode, deploy record and a database liveness fact |
| `GET /api/admin/maintenance`, `PUT /api/admin/maintenance` (`system_settings:write`) | Read or set the maintenance window (stored under the `maintenance` key of the `global` system-settings row) |

---

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 204 | No Content - Request successful, no response body |
| 400 | Bad Request - Invalid request format or validation error |
| 401 | Unauthorized - Missing or invalid authentication token |
| 403 | Forbidden - Insufficient permissions or user disabled |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists or version mismatch (optimistic concurrency) |
| 500 | Internal Server Error - Server error occurred |
| 503 | Service Unavailable - Service temporarily unavailable |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | No valid authentication token provided |
| `INVALID_TOKEN` | 401 | JWT token is invalid or expired |
| `FORBIDDEN` | 403 | User does not have required permissions |
| `USER_DISABLED` | 403 | User account is disabled |
| `NOT_FOUND` | 404 | Requested resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `CONFLICT` | 409 | Resource already exists or version mismatch |
| `NOT_AUTHORIZED` | 403 | Email not in allowlist |
| `VERSION_MISMATCH` | 409 | Optimistic concurrency conflict (If-Match header) |
| `AI_INVALID_IMAGE` | 400 | Card extraction body was not one or two acceptable base64 image data URLs |
| `AI_EXTRACTION_FAILED` | 422 | Card extraction call succeeded but the model could not read the card, or its output failed schema validation |
| `AI_RATE_LIMITED` | 429 | The platform per-user per-minute AI cap was reached |
| `AI_QUOTA_EXCEEDED` | 429 | A daily AI cap (per user or per organization) was reached |
| `AI_UPSTREAM_RATE_LIMITED` | 429 | OpenAI itself rate-limited the extraction request |
| `AI_UPSTREAM_AUTH` | 502 | OpenAI rejected the configured API key (deliberately never 401/403 — see below) |
| `AI_UPSTREAM_UNAVAILABLE` | 502 | OpenAI 5xx, network failure, or the API's own request timeout |
| `AI_NOT_CONFIGURED` | 503 | AI card scanning is not set up: no enabled provider, model or deployment key |
| `ENCRYPTION_UNAVAILABLE` | 503 | `VAULT_ENCRYPTION_KEY` is not configured, so a key or backup password could not be stored |
| `DATABASE_SEED_REQUIRED` | 500 | Migrations ran but the seed data is missing |
| `ERROR` | 502, 503, any other | Fallback for a status without a registered code: an object-storage failure (502), a failed readiness probe (503), a maintenance window (503, `details.reason: "MAINTENANCE_MODE"`) |

**`AI_*` codes are never 401/403, on purpose.** An upstream OpenAI credential rejection is surfaced as `502 AI_UPSTREAM_AUTH`, not 401/403 — the web client (`apps/web/src/services/api.ts`) treats any 401 as an expired session and reactively refreshes the token and retries, which could sign a user out over nothing more than an administrator's stale OpenAI key.

**Registered codes.** Every `AI_*` code, `ENCRYPTION_UNAVAILABLE` and `DATABASE_SEED_REQUIRED` is registered in `apps/api/src/app-registrations/error-codes.ts` with the status it is thrown with, so the platform `HttpExceptionFilter` delivers it unchanged (the former issue #35 limitation, where clients saw only the status default, no longer applies).

---

## Rate Limits

> **Note:** General-purpose rate limiting is recommended for production deployments but is not currently implemented for most of the application. Consider adding `@nestjs/throttler` or Nginx rate limiting before production deployment.
>
> **Exception:** `POST /secrets/cards/extract` makes a paid outbound call, so it is governed by the platform AI caps (`ai.limits`, see [AI card extraction](#ai-card-extraction)); there is no in-process burst window any more.

**Recommended limits:**

| Endpoint Pattern | Recommended Limit | Window |
|------------------|-------------------|--------|
| `/api/auth/*` | 10 requests | 1 minute |
| `/api/allowlist` (POST) | 30 requests | 1 minute |
| `/api/system-settings` (PUT/PATCH) | 30 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

---

## API Reference (Scalar / OpenAPI)

Interactive API documentation is served by the platform host slice (`registerPlatformDocs`) from the OpenAPI 3.1 document it generates from the code:

- **Reference UI (Scalar):** http://localhost:3535/api/docs
- **Machine-readable document:** http://localhost:3535/api/openapi.json

The routes sit outside Nest's router (so outside the maintenance guard) and answer `503` instead of failing the boot if the document cannot be generated. Authenticated operations declare the `JWT-auth` bearer scheme.

---

## CORS Policy

The API uses a **same-origin architecture**. Both the frontend and API are served from the same host (via Nginx reverse proxy):

- Frontend: `http://localhost:3535/`
- API: `http://localhost:3535/api`

This eliminates CORS complexity and improves security. No cross-origin requests are required. With `CORS_ORIGIN` unset the API sends **no** CORS headers (same-origin only); a comma-separated list of exact origins (`https://a.example,https://b.example`) allows exactly those origins with credentials; a wildcard or a malformed origin stops the boot (`buildCorsOptions`).

---

## Security Headers

All API responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## Versioning

The API currently does not use versioning (v1, v2, etc.). Breaking changes will be avoided when possible. When breaking changes are necessary, they will be:

1. Announced in advance
2. Documented in migration guides
3. Implemented with a transition period when feasible

For future versions, the API may adopt URL-based versioning: `/api/v2/...`
