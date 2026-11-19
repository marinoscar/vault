import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { PlatformHttpClient } from '@marinoscar/platform-web/core';

import { configureHostBetaWeb } from '../src/HostBetaApp';

export const API = 'http://host.example.test/api';
export const server = setupServer();

// The host configures the package once, before the first render, as its entry point would.
configureHostBetaWeb(new PlatformHttpClient({ baseUrl: API, refreshLockName: 'hostbeta-auth-refresh' }), API);

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
Object.defineProperty(window, 'scrollTo', { writable: true, value: vi.fn() });
globalThis.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as never;

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
