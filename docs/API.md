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

```json
{
  "statusCode": 400,
  "message": "Human readable error message",
  "error": "BadRequest"
}
```

For validation errors:
```json
{
  "statusCode": 400,
  "message": ["Field validation error 1", "Field validation error 2"],
  "error": "BadRequest"
}
```

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
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
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
| `security.jwtAccessTtlMinutes` | number | JWT access token TTL in minutes |
| `security.refreshTtlDays` | number | Refresh token TTL in days |
| `features` | object | Feature flags (extensible) |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `updatedBy` | object | User who last updated settings |
| `version` | number | Version number for optimistic concurrency control |

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
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {}
}
```

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
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
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
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

### Storage Objects

The storage system provides file upload and management capabilities with support for large files (GB scale) through resumable multipart uploads.

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

### AI Card Extraction

Reads already-cropped card face photos with an admin-configured OpenAI vision model and returns candidate field values for the user to review before saving — it does not create or modify a secret itself. **Persists nothing about the card**: no image and no extracted field value is ever stored; the only database row this writes is a minimal audit event (`ai.card.extract`, counts/timing/model only — see [SECRETS.md § Audit Trail](SECRETS.md#audit-trail)). See [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) §8 for the full data-egress writeup.

**The CVV is never requested or returned.** It is not in the set of fields the model is asked for, and it is not a key in the response.

Disabled by default: an administrator must set `ai.enabled: true` and store a working OpenAI API key in system settings (see [System Settings — `ai` block](#system-settings-ai-block) below) before this endpoint returns anything but `503`.

#### GET /ai/status

**Requires Authentication** - Whether AI-backed features are available to the *current* user. Intentionally available to every authenticated user (not gated by any permission) so a Viewer — who cannot read system settings — can still know whether to show the "scan a card" button.

**Response:**
```json
{
  "data": {
    "enabled": true,
    "features": { "cardExtract": true }
  }
}
```

`enabled` is `false` when the feature flag is off, no key is stored, or the stored key cannot be decrypted (e.g. `VAULT_ENCRYPTION_KEY` was rotated). No model name, key mask, or failure reason is exposed at this endpoint — those require admin access to system settings.

---

#### POST /secrets/cards/extract

**Requires Authentication** (`secrets:write`) - Extract candidate card field values from one or two card face images.

Deliberately namespaced under `/secrets/cards`, not a general `/ai/*` path — this is a step in the card-creation flow, not a standalone AI utility.

**Request Body:**
```json
{
  "front": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "back": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

`front` is required; `back` is optional (a failed or omitted back-of-card read only downgrades the response to `partial: true` with a warning — it does not fail the request, since the number, expiry and cardholder name all live on the front). Both must be `data:image/{jpeg|png|webp};base64,...` URLs no longer than roughly 2 MB each (`MAX_IMAGE_DATA_URL_LENGTH`); the request is JSON, not multipart, and both images together must fit inside the API's 8 MiB body limit.

**Response:**
```json
{
  "data": {
    "fields": {
      "cardholder_name": "JANE DOE",
      "number": "4111111111111111",
      "exp_month": "07",
      "exp_year": "2029",
      "card_network": "Visa",
      "card_kind": "Credit",
      "issuing_bank": null,
      "security_code_2": null
    },
    "confidence": {
      "cardholder_name": 0.94,
      "number": 0.88,
      "exp_month": 0.91,
      "exp_year": 0.91,
      "card_network": 0.99,
      "card_kind": 0.6,
      "issuing_bank": 0,
      "security_code_2": 0
    },
    "warnings": [
      "The card number did not pass its checksum, so at least one digit was probably misread. Please check it against the card."
    ],
    "model": "gpt-4o-mini",
    "partial": false
  }
}
```

Fields are `null` (with confidence `0`) when unread. `cvv` never appears in `fields` or `confidence` — there is no key for it. Note the `4111 1111 1111 1111` test PAN used above is the well-known Luhn-valid test number; it is not a real card.

**Error Cases** (see [Error Codes](#error-codes) for the full `AI_*` taxonomy):

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `AI_INVALID_IMAGE` | Body was not one or two acceptable base64 image data URLs |
| 422 | `AI_EXTRACTION_FAILED` | The call succeeded but the model could not read the card, or its output failed schema validation |
| 429 | `AI_RATE_LIMITED` | Per-user in-memory burst window exhausted (10 extractions per 5 minutes per API replica) |
| 429 | `AI_QUOTA_EXCEEDED` | Per-user durable daily budget exhausted (default 50/day, admin-configurable via `ai.maxCallsPerUserPerDay`) |
| 429 | `AI_UPSTREAM_RATE_LIMITED` | OpenAI itself rate-limited the request |
| 502 | `AI_UPSTREAM_AUTH` | OpenAI rejected the configured API key |
| 502 | `AI_UPSTREAM_UNAVAILABLE` | OpenAI 5xx, network failure, or the API's own 20s timeout |
| 503 | `AI_NOT_CONFIGURED` | Feature disabled, or no key stored |
| 503 | `AI_KEY_UNREADABLE` | Key is stored but cannot be decrypted (`VAULT_ENCRYPTION_KEY` missing or rotated) |

A `429`/`502` response may include a `Retry-After` header (seconds).

**Known limitation — issue #35:** the codes above are what `AiException` actually carries in its response body, but the API's global `HttpExceptionFilter` (`apps/api/src/common/filters/http-exception.filter.ts`) unconditionally overwrites any custom `code` with one derived purely from the HTTP status before the response is sent. **In the app's current state, a client cannot distinguish `AI_RATE_LIMITED` from `AI_QUOTA_EXCEEDED` (both arrive as `TOO_MANY_REQUESTS`), or `AI_UPSTREAM_AUTH` from any other 502, by the `code` field alone** — every one of the codes in the table above is present in the exception that is thrown, but is discarded before the client sees it. Callers must currently branch on HTTP status instead. The web client's `describeCardExtractionError()` (`apps/web/src/hooks/useCardImport.ts`) already works around this by checking `code` first (for when #35 is fixed) and falling back to status-only messaging that intentionally hedges between the two 429 causes. This is a known, tracked defect, not intended behavior — fix it in the exception filter, not by re-deriving codes on the client.

**Rate limiting on this endpoint specifically:** unlike the rest of the API (see [Rate Limits](#rate-limits) below), `POST /secrets/cards/extract` has real, enforced limits: a per-user, per-API-replica in-memory burst window (10 calls / 5 minutes, reset on deploy, does not add up across replicas) and a per-user durable daily budget (counts `ai.card.extract` audit rows in the last 24 hours, so it is restart-proof and correct across replicas). Only the daily budget is meant to bound spend; the burst window exists solely to stop a stuck client from hammering the provider.

---

### System Settings `ai` block

`GET /system-settings` / `PUT /system-settings` / `PATCH /system-settings` (documented above) now include an `ai` object controlling the card-extraction feature. It is **write-only** for the credential: the API key can be set or cleared, but is never returned in plaintext or ciphertext.

**Response shape (`ai` key, as returned by `GET`/`PUT`/`PATCH /system-settings`):**
```json
{
  "ai": {
    "enabled": false,
    "provider": "openai",
    "model": "gpt-4o-mini",
    "maxCallsPerUserPerDay": 50,
    "apiKeyConfigured": true,
    "apiKeyLast4": "aBcD",
    "apiKeyUpdatedAt": "2026-07-20T00:00:00.000Z"
  }
}
```

`ai` is `null` on a row written before this block existed.

**PATCH body (`ai` key) — the only write path for the credential:**
```json
{
  "ai": {
    "enabled": true,
    "model": "gpt-4o-mini",
    "maxCallsPerUserPerDay": 50,
    "apiKey": "sk-..."
  }
}
```

| Field | Type | Effect when present | Effect when absent |
|-------|------|----------------------|---------------------|
| `enabled` | boolean | Sets the flag | Keeps current value |
| `model` | string, 1-100 chars | Sets the model name | Keeps current value |
| `maxCallsPerUserPerDay` | integer, 0-10000 | Sets the daily budget | Keeps current value |
| `apiKey` | string (20-300 chars) \| `null` | A string encrypts and replaces the stored key; `null` clears it | Keeps the currently stored key untouched |

The three states of `apiKey` (absent / `null` / string) are distinguished with `'apiKey' in patch`, not `!== undefined` — this is why "don't touch the key" and "clear the key" are both expressible. `PUT /system-settings` cannot touch `ai` at all (its DTO has no `ai` field); the existing stored `ai` block is read from the raw row and carried over untouched so a `PUT` used to flip an unrelated flag can never silently wipe the credential.

**Storage:** the key is encrypted with AES-256-GCM via the same `CryptoService` used for secret values, keyed by `VAULT_ENCRYPTION_KEY`. Only the last 4 characters (`apiKeyLast4`) and an update timestamp are ever exposed. **Rotating `VAULT_ENCRYPTION_KEY` makes the stored key permanently undecryptable** — `GET /ai/status` then reports `enabled: false` and card extraction returns `503 AI_KEY_UNREADABLE` until an administrator re-enters the key.

Every settings write is audited (`system_settings:patch` / `system_settings:replace`), with the `ai` block redacted to `{ enabled, model, maxCallsPerUserPerDay, apiKeyChanged, apiKeyLast4 }` — neither plaintext nor ciphertext is ever written to the audit log, on either side of the diff.

---

### Health

**Public endpoints** - Used for Kubernetes liveness/readiness probes.

#### GET /health
Full health check - includes database connectivity test. Equivalent to GET /health/ready.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

---

#### GET /health/live
Liveness check - always returns 200 if service is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

#### GET /health/ready
Readiness check - includes database connectivity test.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

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
| `AI_RATE_LIMITED` | 429 | Per-user in-memory burst window for card extraction exhausted |
| `AI_QUOTA_EXCEEDED` | 429 | Per-user durable daily card extraction budget exhausted |
| `AI_UPSTREAM_RATE_LIMITED` | 429 | OpenAI itself rate-limited the extraction request |
| `AI_UPSTREAM_AUTH` | 502 | OpenAI rejected the configured API key (deliberately never 401/403 — see below) |
| `AI_UPSTREAM_UNAVAILABLE` | 502 | OpenAI 5xx, network failure, or the API's own request timeout |
| `AI_NOT_CONFIGURED` | 503 | AI card scanning disabled, or no API key stored |
| `AI_KEY_UNREADABLE` | 503 | Stored OpenAI API key cannot be decrypted (`VAULT_ENCRYPTION_KEY` missing or rotated) |

**`AI_*` codes are never 401/403, on purpose.** An upstream OpenAI credential rejection is surfaced as `502 AI_UPSTREAM_AUTH`, not 401/403 — the web client (`apps/web/src/services/api.ts`) treats any 401 as an expired session and reactively refreshes the token and retries, which could sign a user out over nothing more than an administrator's stale OpenAI key.

**Known limitation — issue #35 — every code above except the first nine is currently unreachable by clients in practice.** The `AI_*` codes (and any other custom `code` an `HttpException`'s response body carries) are computed correctly by the throwing code, but `HttpExceptionFilter` (`apps/api/src/common/filters/http-exception.filter.ts`) unconditionally overwrites `code` with a value derived purely from the HTTP status before the response is sent — the custom code is read from the exception body and then immediately discarded on the next line. Until that filter is fixed, a card-extraction client sees `TOO_MANY_REQUESTS` (for both `AI_RATE_LIMITED` and `AI_QUOTA_EXCEEDED`), `BAD_REQUEST`, `UNPROCESSABLE_ENTITY`, or a generic `ERROR` (for the 502/503 cases, which have no entry in the filter's status-to-code map) instead of the specific `AI_*` code — HTTP status and the `message` string are the only reliable signals right now. See [AI Card Extraction](#ai-card-extraction) for how the web client currently compensates.

---

## Rate Limits

> **Note:** General-purpose rate limiting is recommended for production deployments but is not currently implemented for most of the application. Consider adding `@nestjs/throttler` or Nginx rate limiting before production deployment.
>
> **Exception:** `POST /secrets/cards/extract` (see [AI Card Extraction](#ai-card-extraction)) already has real, enforced limits — a per-user in-memory burst window and a per-user durable daily budget — because it is the one endpoint in this application that costs real money per call.

**Recommended limits:**

| Endpoint Pattern | Recommended Limit | Window |
|------------------|-------------------|--------|
| `/api/auth/*` | 10 requests | 1 minute |
| `/api/allowlist` (POST) | 30 requests | 1 minute |
| `/api/system-settings` (PUT/PATCH) | 30 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

---

## Swagger/OpenAPI Documentation

Interactive API documentation with request/response examples is available at:

**Development:** http://localhost:3535/api/docs

The Swagger UI allows you to:
- Explore all endpoints
- View request/response schemas
- Test API calls directly from the browser
- Authenticate with JWT tokens

---

## CORS Policy

The API uses a **same-origin architecture**. Both the frontend and API are served from the same host (via Nginx reverse proxy):

- Frontend: `http://localhost:3535/`
- API: `http://localhost:3535/api`

This eliminates CORS complexity and improves security. No cross-origin requests are required.

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
