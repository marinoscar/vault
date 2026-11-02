# Testing Framework

This document describes the testing strategy, frameworks, and conventions used in this project. It serves as a guide for developers writing new tests and for AI agents that need to understand the testing approach.

## Table of Contents

1. [Testing Framework Overview](#testing-framework-overview)
2. [Test Structure](#test-structure)
3. [Running Tests](#running-tests)
4. [Test Patterns & Conventions](#test-patterns--conventions)
5. [Mocking Strategies](#mocking-strategies)
6. [Writing New Tests](#writing-new-tests)
7. [Test Configuration](#test-configuration)
8. [Best Practices](#best-practices)

## Testing Framework Overview

### Backend (API)

**Framework:** Jest + Supertest + @nestjs/testing

**Why These Frameworks:**
- **Jest**: Industry-standard JavaScript testing framework with excellent TypeScript support, built-in mocking, and parallel test execution
- **Supertest**: HTTP assertion library that works seamlessly with NestJS applications, allowing end-to-end API testing without spinning up a real server
- **@nestjs/testing**: Official NestJS testing utilities that provide dependency injection and module compilation for isolated testing

**Key Features:**
- Unit tests run in isolation with mocked dependencies
- E2E tests use a real test database (PostgreSQL)
- OAuth strategies are mocked to avoid external dependencies
- Test database is reset between test suites for isolation

### Frontend (Web)

**Framework:** Vitest + React Testing Library + MSW (Mock Service Worker)

**Why These Frameworks:**
- **Vitest**: Fast, modern test runner built for Vite projects with Jest-compatible API, native ESM support, and excellent performance
- **React Testing Library**: Encourages testing components from the user's perspective rather than implementation details, promoting maintainable tests
- **MSW (Mock Service Worker)**: Intercepts network requests at the network level, providing realistic API mocking without changing application code
- **@testing-library/user-event**: Simulates real user interactions more accurately than fireEvent

**Key Features:**
- Component tests render UI in jsdom environment
- API calls are mocked with MSW handlers
- User interactions tested with user-event library
- Context providers (Auth, Theme) tested in isolation

## Test Structure

### Backend Test Organization

```
apps/api/
├── src/
│   └── **/*.spec.ts          # Unit tests (co-located with source)
├── test/
│   ├── jest.config.js         # Jest configuration
│   ├── setup.ts               # Global test setup
│   ├── teardown.ts            # Global test cleanup
│   ├── helpers/               # Test utilities
│   │   ├── test-app.helper.ts    # App creation/teardown
│   │   ├── auth.helper.ts        # User creation & JWT helpers
│   │   └── database.helper.ts    # DB seeding & cleanup
│   ├── mocks/                 # Mock implementations
│   │   ├── prisma.mock.ts        # Prisma client mocks
│   │   └── google-oauth.mock.ts  # OAuth strategy mocks
│   └── **/*.e2e.spec.ts       # E2E integration tests
└── .env.test                  # Test environment variables
```

**Test Types:**
- **Unit tests** (`*.spec.ts`): Located alongside source files, test individual services/controllers/guards in isolation
- **E2E tests** (`*.e2e.spec.ts`): Located in `test/` directory, test full request-response cycles with real database

### Frontend Test Organization

```
apps/web/
├── src/
│   ├── __tests__/
│   │   ├── setup.ts              # Test setup (MSW, mocks)
│   │   ├── utils/
│   │   │   └── test-utils.tsx    # Custom render utilities
│   │   ├── mocks/
│   │   │   ├── server.ts         # MSW server setup
│   │   │   └── handlers.ts       # API mock handlers
│   │   ├── components/
│   │   │   └── **/*.test.tsx     # Component tests
│   │   ├── contexts/
│   │   │   └── **/*.test.tsx     # Context/hook tests
│   │   └── pages/
│   │       └── **/*.test.tsx     # Page tests
└── vitest.config.ts          # Vitest configuration
```

**Test Types:**
- **Component tests**: Test individual React components in isolation
- **Page tests**: Test entire pages with routing and context
- **Context tests**: Test React contexts and custom hooks
- **Integration tests**: Test multiple components working together

## Running Tests

### Backend Tests

```bash
# Navigate to API directory
cd apps/api

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:cov

# Run only unit tests (exclude e2e)
npm run test:unit

# Run only e2e tests
npm run test:e2e

# Debug tests
npm run test:debug

# CI mode (coverage + junit reporter)
npm run test:ci
```

### Frontend Tests

```bash
# Navigate to web directory
cd apps/web

# Run all tests
npm test

# Run tests in watch mode (interactive)
npm run test:watch

# Run tests once (CI mode)
npm run test:run

# Run with coverage
npm run test:coverage

# Open Vitest UI
npm run test:ui

# CI mode (coverage + junit reporter)
npm run test:ci
```

### Environment Variables

Backend tests require a test database. Create `apps/api/.env.test`:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/app_test"
JWT_SECRET="test-secret-key-min-32-characters"
NODE_ENV="test"
```

**Important:** The test database should be separate from development database. Tests will truncate all data between runs.

## Test Patterns & Conventions

### Naming Conventions

**Backend:**
- Unit tests: `*.spec.ts` (e.g., `auth.service.spec.ts`)
- E2E tests: `*.e2e.spec.ts` (e.g., `auth.e2e.spec.ts`)

**Frontend:**
- All tests: `*.test.tsx` or `*.test.ts`
- Test files mirror source structure (e.g., `LoginPage.tsx` → `LoginPage.test.tsx`)

### Test Structure Pattern

Use nested `describe` blocks to organize tests logically:

```typescript
describe('ComponentName or ServiceName', () => {
  // Setup
  beforeEach(() => {
    // Reset state before each test
  });

  describe('Feature Group 1', () => {
    it('should do something specific', () => {
      // Arrange
      // Act
      // Assert
    });

    it('should handle error case', () => {
      // Test error handling
    });
  });

  describe('Feature Group 2', () => {
    it('should behave differently', () => {
      // Another test
    });
  });
});
```

**Best Practices:**
- Group related tests in `describe` blocks
- Use descriptive test names starting with "should"
- Follow Arrange-Act-Assert pattern
- One logical assertion per test (exceptions for related assertions)
- Test both success and error cases

### Backend Test Pattern (Unit Test)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceName } from './service-name.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../../test/mocks/prisma.mock';

describe('ServiceName', () => {
  let service: ServiceName;
  let mockPrisma: MockPrismaService;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceName,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ServiceName>(ServiceName);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should return expected result', async () => {
      // Arrange
      mockPrisma.model.findUnique.mockResolvedValue({ id: '1' });

      // Act
      const result = await service.methodName('1');

      // Assert
      expect(result).toEqual({ id: '1' });
      expect(mockPrisma.model.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });
});
```

### Backend Test Pattern (E2E Test)

```typescript
import request from 'supertest';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetDatabase } from '../helpers/database.helper';
import { createTestUser, authHeader } from '../helpers/auth.helper';

describe('Controller (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  describe('GET /api/endpoint', () => {
    it('should return data for authenticated user', async () => {
      const user = await createTestUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/endpoint')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should return 401 without token', async () => {
      await request(context.app.getHttpServer())
        .get('/api/endpoint')
        .expect(401);
    });
  });
});
```

### Frontend Test Pattern (Component Test)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import { ComponentName } from '../../components/ComponentName';

describe('ComponentName', () => {
  beforeEach(() => {
    // Reset any state
  });

  describe('Rendering', () => {
    it('should render component with props', () => {
      render(<ComponentName title="Test" />);

      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });

  describe('User Interaction', () => {
    it('should handle button click', async () => {
      const user = userEvent.setup();
      const onClickMock = vi.fn();

      render(<ComponentName onClick={onClickMock} />);

      await user.click(screen.getByRole('button'));

      expect(onClickMock).toHaveBeenCalledTimes(1);
    });
  });
});
```

### Frontend Test Pattern (Hook Test)

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCustomHook } from '../../hooks/useCustomHook';

describe('useCustomHook', () => {
  it('should return initial state', () => {
    const { result } = renderHook(() => useCustomHook());

    expect(result.current.value).toBe(null);
    expect(result.current.isLoading).toBe(false);
  });

  it('should update state on action', async () => {
    const { result } = renderHook(() => useCustomHook());

    act(() => {
      result.current.updateValue('new');
    });

    await waitFor(() => {
      expect(result.current.value).toBe('new');
    });
  });
});
```

## Mocking Strategies

### Backend Mocking

#### 1. Prisma Client Mocking (Unit Tests)

Use the provided mock factory for consistent Prisma mocking:

```typescript
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';

let mockPrisma: MockPrismaService;

beforeEach(() => {
  mockPrisma = createMockPrismaService();

  // Configure specific mocks
  mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@example.com' });
});
```

The mock factory provides Jest mock functions for all Prisma operations (findUnique, findMany, create, update, delete, etc.).

#### 2. OAuth Strategy Mocking

Google OAuth is mocked using a custom Passport strategy:

```typescript
import { MockGoogleStrategy, createMockGoogleProfile } from '../../test/mocks/google-oauth.mock';

// Set mock profile for next auth
MockGoogleStrategy.setMockProfile({
  email: 'custom@example.com',
  displayName: 'Custom User',
});

// Reset to defaults
MockGoogleStrategy.resetMockProfile();
```

This allows E2E tests to simulate OAuth flows without calling Google's servers.

#### 3. JWT Service Mocking (Unit Tests)

```typescript
const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({ sub: '1', email: 'test@example.com' }),
} as any;
```

#### 4. Config Service Mocking

```typescript
const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, any> = {
      'jwt.secret': 'test-secret',
      'jwt.accessTtlMinutes': 15,
    };
    return config[key];
  }),
} as any;
```

### Frontend Mocking

#### 1. API Mocking with MSW

MSW intercepts HTTP requests at the network level. Handlers are defined in `apps/web/src/__tests__/mocks/handlers.ts`:

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/auth/me', () => {
    return HttpResponse.json({
      data: {
        id: 'user-1',
        email: 'test@example.com',
        roles: ['viewer'],
      },
    });
  }),

  http.post('/api/auth/logout', () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
```

**Override handlers in specific tests:**

```typescript
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

it('should handle error', async () => {
  server.use(
    http.get('/api/auth/me', () => {
      return new HttpResponse(null, { status: 500 });
    }),
  );

  // Test error handling
});
```

#### 2. Browser API Mocking

Common browser APIs are mocked in `setup.ts`:

```typescript
// Mock window.matchMedia (for MUI responsive components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

#### 3. Context Mocking

Use custom render utilities to wrap components with necessary providers:

```typescript
import { render } from '../utils/test-utils';

// Render with authenticated context
render(<Component />, {
  wrapperOptions: { authenticated: true },
});

// Render with unauthenticated context
render(<Component />, {
  wrapperOptions: { authenticated: false },
});
```

#### 4. Router Mocking

```typescript
import { MemoryRouter } from 'react-router-dom';

render(
  <MemoryRouter initialEntries={['/login']}>
    <LoginPage />
  </MemoryRouter>
);
```

## Writing New Tests

### Adding a Backend Unit Test

1. **Create test file** next to source file: `feature.service.spec.ts`
2. **Import testing utilities:**
   ```typescript
   import { Test, TestingModule } from '@nestjs/testing';
   ```
3. **Mock dependencies** using provided mock factories
4. **Test each method** with success and error cases
5. **Verify calls** to mocked dependencies

### Adding a Backend E2E Test

1. **Create test file** in `apps/api/test/` directory: `feature.e2e.spec.ts`
2. **Use test helpers:**
   ```typescript
   import { createTestApp, closeTestApp } from '../helpers/test-app.helper';
   import { resetDatabase } from '../helpers/database.helper';
   import { createTestUser, authHeader } from '../helpers/auth.helper';
   ```
3. **Set up test context** in `beforeAll`
4. **Reset database** in `beforeEach` for test isolation
5. **Test HTTP endpoints** with Supertest
6. **Test RBAC** by creating users with different roles

### Adding a Frontend Component Test

1. **Create test file** in `apps/web/src/__tests__/components/`: `Component.test.tsx`
2. **Import testing utilities:**
   ```typescript
   import { render } from '../utils/test-utils';
   import { screen, waitFor } from '@testing-library/react';
   import userEvent from '@testing-library/user-event';
   ```
3. **Test rendering** with different props
4. **Test user interactions** with `userEvent`
5. **Test async behavior** with `waitFor`
6. **Mock API calls** with MSW if needed

### Adding a Frontend Context/Hook Test

1. **Create test file** in `apps/web/src/__tests__/contexts/`: `Context.test.tsx`
2. **Use `renderHook`** from React Testing Library
3. **Create wrapper** with necessary providers
4. **Test state changes** with `act` and `waitFor`
5. **Test error handling** by mocking failing API calls

## Test Configuration

### Backend Configuration

**File:** `apps/api/test/jest.config.js`

```javascript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  globalTeardown: '<rootDir>/test/teardown.ts',
  testTimeout: 30000,
  verbose: true,
};
```

**Key Settings:**
- `testRegex`: Matches `*.spec.ts` files
- `roots`: Includes both `src/` and `test/` directories
- `setupFilesAfterEnv`: Runs setup before tests
- `testTimeout`: 30 seconds for database operations
- `moduleNameMapper`: Supports `@/` path alias

### Frontend Configuration

**File:** `apps/web/vitest.config.ts`

```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'src/__tests__',
        '**/*.d.ts',
        '**/*.config.*',
        'src/main.tsx',
      ],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

**Key Settings:**
- `environment: 'jsdom'`: Browser-like environment for React
- `globals: true`: No need to import `describe`, `it`, `expect`
- `setupFiles`: Runs MSW setup and browser mocks
- `coverage.thresholds`: Enforces minimum 70% coverage
- `testTimeout`: 10 seconds for async operations

## Best Practices

### General

1. **Test Behavior, Not Implementation**
   - Test what the code does, not how it does it
   - Avoid testing internal state or private methods
   - Focus on public API and observable outcomes

2. **Test Isolation**
   - Each test should run independently
   - Use `beforeEach` to reset state
   - Don't rely on test execution order

3. **Clear Test Names**
   - Use descriptive names: `should return 401 when token is invalid`
   - Follow pattern: "should [expected behavior] when [condition]"

4. **Arrange-Act-Assert Pattern**
   - **Arrange:** Set up test data and mocks
   - **Act:** Execute the code under test
   - **Assert:** Verify the outcome

5. **Test Error Cases**
   - Always test both success and failure paths
   - Test edge cases and boundary conditions
   - Test validation errors and exceptions

### Backend-Specific

1. **Unit Test External Dependencies**
   - Mock Prisma, external APIs, file system
   - Unit tests should be fast (<100ms per test)

2. **E2E Test Critical Paths**
   - Auth flows (login, logout, refresh)
   - RBAC enforcement
   - Database transactions
   - API contract validation

3. **Use Test Helpers**
   - Leverage provided helpers for user creation, auth headers, DB reset
   - Keep test code DRY with shared utilities

4. **Database Isolation**
   - Always reset database in `beforeEach`
   - Use separate test database
   - Never use production data in tests

### Frontend-Specific

1. **Query by Accessibility**
   - Prefer `getByRole`, `getByLabelText`, `getByText`
   - Avoid `getByTestId` unless necessary
   - Mirrors how users interact with UI

2. **User-Centric Testing**
   - Use `userEvent` instead of `fireEvent`
   - Test user flows, not implementation
   - Wait for async updates with `waitFor`

3. **Mock Network at Network Level**
   - Use MSW for realistic API mocking
   - Define default handlers, override in tests
   - MSW works in both tests and browser

4. **Avoid Testing Implementation Details**
   - Don't test component state directly
   - Don't test CSS classes or internal methods
   - Test visible output and user interactions

### Coverage Guidelines

**Target Coverage:** 70% minimum (enforced in frontend)

**What to Focus On:**
- Business logic in services
- RBAC guards and decorators
- API controllers (especially auth)
- React contexts and custom hooks
- Critical user flows (login, settings)

**What Can Have Lower Coverage:**
- DTOs and type definitions
- Module configuration files
- Simple getter/setter methods
- UI styling components

### Debugging Tests

**Backend:**
```bash
# Run tests with Node debugger
npm run test:debug

# Add breakpoint in code
debugger;

# Run single test file
npm test -- auth.service.spec.ts

# Run single test by name
npm test -- -t "should create user"
```

**Frontend:**
```bash
# Open Vitest UI for interactive debugging
npm run test:ui

# Run single test file
npm test -- LoginPage.test.tsx

# Run with browser-like debugging
npm run test:ui
```

**Helpful Debugging Tools:**
- `screen.debug()` - Print current DOM state
- `screen.logTestingPlaygroundURL()` - Get query suggestions
- `console.log` in tests (shown in output)
- VS Code debugger integration

## Common Issues and Solutions

### Backend

**Issue:** Tests timeout waiting for database
- **Solution:** Check `DATABASE_URL` in `.env.test`, ensure test DB is running

**Issue:** `test/db-backup/db-backup-rls.db.spec.ts` is skipped (E9.1)
- **Solution:** The whole-database dump proof needs `pg_dump` and `pg_restore` on `PATH` (a client major at least the server's; the API image installs `postgresql17-client`) and a reachable Postgres superuser. It builds a throwaway database owned by an ordinary role, dumps it with `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (environment, not argv), restores into a sibling database and counts rows per organization; the console prints the skip reason. Run it with `npm run test:db --workspace=api`.

**Issue:** Prisma mock not working as expected
- **Solution:** Clear mocks in `afterEach`, use `mockResolvedValue` for promises

**Issue:** JWT validation fails in tests
- **Solution:** Ensure `JWT_SECRET` is set in test environment

### Frontend

**Issue:** "Target container is not a DOM element"
- **Solution:** Ensure `jsdom` environment is set in vitest.config.ts

**Issue:** "window.matchMedia is not a function"
- **Solution:** Check that setup.ts is imported in vitest.config

**Issue:** MSW not intercepting requests
- **Solution:** Verify server.listen() is called in beforeAll

**Issue:** Async state not updating in tests
- **Solution:** Use `await waitFor()` to wait for async updates

## Platform conformance

The platform's invariants run against Vault in one spec per side, so a regression in a mounted slice fails CI rather than a review.

- **API**: `apps/api/test/conformance.spec.ts` calls `runPlatformConformance()` with every suite the installed `@marinoscar/platform-api` offers. `apps/api/test/ai-conformance.spec.ts` runs the five AI suites that boot the app (their harness is `test/ai-conformance/`); `doctor-read-only` boots it through `test/conformance/doctor-fixture.ts`. A suite for a slice Vault does not mount (`sharing`, `webhooks`, `alerts`, `android-app`) and the `on-event-no-io` vacuity case are `skip`ped with a written reason; the harness prints the run and skipped suites in a table.
- **Web**: `apps/web/src/__tests__/conformance.test.tsx` calls `runPlatformWebConformance()` over `ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`, the `App.tsx` route table and the destinations of `@marinoscar/vault-web/navigation`. `shell-local-host` and `settings-ai-cards` are skipped with reasons.
- **OpenAPI**: `npm run openapi:dump && npm run openapi:lint` (CI job `OpenAPI`) dumps the document in Nest preview mode and lints it with Spectral (`.spectral.yaml`). Every controller's `@ApiTags` name must be declared in `apps/api/src/openapi/tags.ts`.

Adding a skip needs a reason that names why the suite cannot apply; removing one is the follow-up that adopts the slice.

## E2E and Visual Regression (Playwright)

Two Playwright suites live under `tests/` (E10.7, #98). They share `tests/support/`: invented fixtures (`fixtures.ts`), the network-layer API (`mock-api.ts`) and the determinism helpers (`stabilize.ts`, with the vendored subset fonts in `fonts/`).

**Both suites run against the built web app with every `/api` call answered by `mock-api.ts`. The e2e suite does NOT exercise the real API, the database, OAuth or an AI provider**; API behaviour is covered by the Jest tiers above. What e2e proves is the browser journey: routing, forms, the UI's use of the API contract as the mock encodes it. The mock records any `/api` call it does not know (`api.unhandled`) and the specs assert it stays empty.

| Suite | Folder | Covers |
|---|---|---|
| e2e | `tests/e2e/specs/journeys.spec.ts` | sign in (the OAuth redirect is collapsed into `/auth/callback`), create a secret, reveal and copy a value, import a card with a mocked AI extraction, save a My backup |
| visual | `tests/visual/specs/screens.spec.ts` | Home, Secrets, Secret detail, Cards, `/settings`, `/admin/settings`, each at 390 and 1440 px, light and dark (24 screenshots) |

The obsolete `tests/e2e` specs (`auth.spec.ts`, `example.spec.ts`, `helpers/auth.helper.ts`, `fixtures/auth.fixture.ts`) drove `/testing/login` against the docker-compose stack and were removed; the production build has no `/testing/login` route.

### Running locally

```bash
npm run build --workspace=web              # both suites serve apps/web/dist with `vite preview`
cd tests/e2e && npm ci && npx playwright test
cd tests/visual && npm ci && npx playwright test
```

`@playwright/test` is pinned to an exact version in both `package.json` files (1.63.0), and the CI image tag (`mcr.microsoft.com/playwright:v1.63.0-noble`) must match it: bump all three together. Run Playwright through `node_modules/.bin/playwright`, not `npx`, in CI.

### Visual regression

Determinism: the clock is fixed to `2026-06-15T12:00:00Z`, locale `en-US`, timezone UTC, reduced motion, animations and carets off, the theme is set through `localStorage.theme_mode`, Inter (400/500/600/700) and a monospace face are vendored as woff2 subsets and injected, and secret values (generic `monospace`) are switched to the vendored face before each shot. `retries` is 0: a flaky screenshot is a bug to fix, not to retry.

Baselines are pixel-exact to the browser build and system fonts, so **they are generated in CI, in the Playwright image, not on a developer machine** (a local Chromium build differs). The committed PNGs live in `tests/visual/specs/__screenshots__/`.

- First time, or after an intentional UI change: run the **Visual baselines** workflow (Actions tab, `workflow_dispatch`, pick the branch). It regenerates the PNGs, re-runs the suite to prove they are stable, and commits them to the branch. Review the image diff in that commit.
- Until baselines are committed, the `visual` job in `ci.yml` emits a warning and skips the comparison; it fails on any diff once they exist. The report and diffs are uploaded as the `visual-report` artifact.
- Locally, `npx playwright test` is only meaningful with baselines generated by the same build; use it to debug a failing screen (`--ui`, `--headed`), not to update committed baselines.

### Writing a spec

Use `stabilizePage(page, { theme })` then `installMockApi(page, options)` before `page.goto`; call `settle(page)` before a screenshot. Add the endpoint to `mock-api.ts` when a new page calls one (the `unhandled` assertion will say which). Fixtures use invented data only (`Person A`, `Org Alpha`, `@example.test`, test card numbers).


## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW Documentation](https://mswjs.io/docs/)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Playwright Documentation](https://playwright.dev/)

## Summary

This project uses industry-standard testing frameworks tailored to each layer:

- **Backend:** Jest + Supertest for comprehensive API testing with real database
- **Frontend:** Vitest + React Testing Library + MSW for fast, user-centric component testing
- **Mocking:** Prisma mocks, OAuth mocks, MSW handlers for realistic test scenarios
- **Helpers:** Shared utilities for user creation, database reset, and test app setup

When writing tests, focus on behavior over implementation, maintain test isolation, and leverage the provided helpers for consistency. Target 70% coverage with emphasis on business logic, auth flows, and RBAC enforcement.
