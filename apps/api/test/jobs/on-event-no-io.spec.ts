// =============================================================================
// The listener half of queue rule 1 (issue #81, E5.1)
// =============================================================================
//
// No `@OnEvent` body downloads, uploads or calls the storage provider itself.
// The platform ships this scan as the `on-event-no-io` conformance suite, but
// that suite takes no per-file exemption, and Vault's one remaining listener is
// a recorded shim (E6). So this spec applies the SAME detector and markers
// (`eventListenerBodies`, `listenerIoMarkers` from the package) and honours the
// written exemption in `cron-source-roots.ts`. It also fails when an exempt file
// stops holding an I/O listener, so the exemption cannot outlive its code.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { eventListenerBodies, listenerIoMarkers, stripListenerComments } from '@marinoscar/platform-api/jobs/testing';

import { API_SOURCE_ROOT, LISTENER_EXEMPTIONS } from './cron-source-roots';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

const listeners = sourceFiles(API_SOURCE_ROOT)
  .map((path) => ({
    rel: relative(API_SOURCE_ROOT, path).split('\\').join('/'),
    source: stripListenerComments(readFileSync(path, 'utf8')),
  }))
  .filter((file) => file.source.includes('@On' + 'Event('))
  .map((file) => ({ ...file, bodies: eventListenerBodies(file.source) }));

describe('on-event-no-io (Vault sources, with the E6 shim exempt)', () => {
  it('finds the listeners (the scan is not vacuous)', () => {
    expect(listeners.length).toBeGreaterThanOrEqual(1);
    expect(listeners.flatMap((file) => file.bodies).length).toBeGreaterThanOrEqual(1);
  });

  it('no listener body outside the exemptions does I/O', () => {
    const exempt = new Set<string>(LISTENER_EXEMPTIONS.map((entry) => entry.file));
    const findings = listeners
      .filter((file) => !exempt.has(file.rel))
      .flatMap((file) => file.bodies.flatMap((body) => listenerIoMarkers(body).map((what) => `${file.rel}: ${what}`)));

    expect(findings).toEqual([]);
  });

  it.each(LISTENER_EXEMPTIONS.map((entry) => [entry.file, entry.why] as const))(
    'the exemption for %s still names a listener that does I/O, and gives a reason',
    (file, why) => {
      const found = listeners.find((entry) => entry.rel === file);
      expect(found).toBeDefined();
      expect(found!.bodies.some((body) => listenerIoMarkers(body).length > 0)).toBe(true);
      expect(why.length).toBeGreaterThan(40);
    },
  );
});
