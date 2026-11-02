import { vi } from 'vitest';

/**
 * Makes `window.matchMedia` answer width queries for a viewport `width` px
 * wide (MUI's `useMediaQuery` asks `(min-width:600px)` / `(max-width:599.95px)`),
 * so the platform shell mounts the rail or the bottom bar as it would in a
 * browser. Pair it with `restoreViewport()` in `afterEach`.
 */
const original = window.matchMedia;

export function restoreViewport(): void {
  window.matchMedia = original;
}

export function setViewportWidth(width: number): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])) && Boolean(min || max);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}
