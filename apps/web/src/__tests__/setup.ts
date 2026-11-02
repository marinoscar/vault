import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { configureNotificationsWeb } from '@marinoscar/platform-web/notifications/headless';
import { server } from './mocks/server';
import { api } from '../services/api';

// The notifications slice, configured as main.tsx does through
// platform/notifications.ts, minus the SSE connector (no live stream in jsdom):
// the shell's NotificationProvider loads the inbox through the MSW handlers.
configureNotificationsWeb({ api, apiBaseUrl: '/api' });

// Set base URL for fetch
const BASE_URL = 'http://localhost:3000';
if (typeof globalThis !== 'undefined') {
  (globalThis as any).BASE_URL = BASE_URL;
}

// Mock location for testing
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    href: BASE_URL,
    origin: BASE_URL,
    protocol: 'http:',
    host: 'localhost:3000',
    hostname: 'localhost',
    port: '3000',
    pathname: '/',
    search: '',
    hash: '',
    reload: vi.fn(),
    assign: vi.fn(),
    replace: vi.fn(),
  },
});

// Mock window.matchMedia
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

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock the Clipboard API — jsdom does not implement navigator.clipboard.
// Exported so tests can assert on writes, stub readback, or simulate a
// rejection (permission denied / insecure context).
export const clipboardMock = {
  writeText: vi.fn<(text: string) => Promise<void>>(),
  readText: vi.fn<() => Promise<string>>(),
};

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: clipboardMock,
});

/**
 * Restore the clipboard mock to its default resolving behaviour and clear any
 * recorded calls. Runs automatically between tests; call it directly after a
 * test replaces navigator.clipboard wholesale.
 */
export function resetClipboardMock(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: clipboardMock,
  });
  clipboardMock.writeText.mockReset();
  clipboardMock.readText.mockReset();
  clipboardMock.writeText.mockResolvedValue(undefined);
  clipboardMock.readText.mockResolvedValue('');
}

resetClipboardMock();

// Mock ResizeObserver as a class
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver as a class
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [];
}
globalThis.IntersectionObserver = IntersectionObserverMock as any;

// Setup MSW server
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'warn' // Changed from 'error' to 'warn' for debugging
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetClipboardMock();
});

afterAll(() => {
  server.close();
});

// jsdom ships its own Blob, File and FormData, but fetch/Request/Response stay
// Node's (undici). Node 24's undici brand-checks bodies against the *global*
// Blob/File, so a jsdom File inside a FormData is sent as "[object File]",
// request.formData() asserts, and response.blob() returns a jsdom Blob without
// arrayBuffer(). Real browsers have one implementation, so use Node's for all
// three; the tests then exercise the same Blob that fetch produces and consumes.
// Built-in module name is assembled so web's tsconfig (no Node types) need not resolve it.
const nodeBuffer: { Blob: typeof Blob; File: typeof File } = await import(
  /* @vite-ignore */ 'node:' + 'buffer'
);
const nativeFormData = (
  await new Response('', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData()
).constructor as typeof FormData;
Object.assign(globalThis, {
  Blob: nodeBuffer.Blob,
  File: nodeBuffer.File,
  FormData: nativeFormData,
});
