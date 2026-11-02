// Role, permission, user-owned-model and model-ownership registrations (issue #77).
import '../src/app-registrations/registrations';

import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables
config({ path: resolve(__dirname, '../.env.test') });

// Set test environment
process.env.NODE_ENV = 'test';

// The booted AppModule must not poll the queue: a mocked Prisma has no claim
// result, and a real-database test enqueues and runs jobs explicitly. A suite
// that wants the worker sets JOBS_WORKER_MODE itself before building the app.
process.env.JOBS_WORKER_MODE ??= 'off';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
beforeAll(async () => {
  // Any global setup
});

afterAll(async () => {
  // Any global cleanup
});
