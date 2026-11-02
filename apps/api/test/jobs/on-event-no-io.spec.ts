// =============================================================================
// The listener half of queue rule 1 (issue #81, E5.1; E6.1 removed the last shim)
// =============================================================================
//
// No `@OnEvent` body downloads, uploads or calls the storage provider itself.
// The platform ships this scan as the `on-event-no-io` conformance suite, but it
// guards against a vacuous pass by requiring at least one listener, and since
// E6.1 (#84) Vault has none: the upload listener that downloaded the object
// inline is the platform's `storage.object.process` job. So this spec applies the
// SAME detector and markers (`eventListenerBodies`, `listenerIoMarkers` from the
// package) to Vault's sources with NO exemption, and passes while there is no
// listener. The first listener Vault adds is scanned at once.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { eventListenerBodies, listenerIoMarkers, stripListenerComments } from '@marinoscar/platform-api/jobs/testing';

import { LISTENER_EXEMPTIONS, VAULT_SOURCE_ROOTS } from './cron-source-roots';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

const listeners = VAULT_SOURCE_ROOTS.flatMap((root) => sourceFiles(root).map((path) => ({ root, path })))
  .map(({ root, path }) => ({
    rel: relative(root, path).split('\\').join('/'),
    source: stripListenerComments(readFileSync(path, 'utf8')),
  }))
  .filter((file) => file.source.includes('@On' + 'Event('))
  .map((file) => ({ ...file, bodies: eventListenerBodies(file.source) }));

describe('on-event-no-io (Vault sources)', () => {
  it('has no exemption left', () => {
    expect(LISTENER_EXEMPTIONS).toEqual([]);
  });

  it('no listener body does I/O', () => {
    const findings = listeners.flatMap((file) =>
      file.bodies.flatMap((body) => listenerIoMarkers(body).map((what) => `${file.rel}: ${what}`)),
    );
    expect(findings).toEqual([]);
  });
});
