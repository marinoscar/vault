import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A throwaway certificate authority and a local HTTPS server for the broker specs: the broker's
 * connection is verified against `ca` (extra trust, verification stays ON), so a spec proves the
 * real TLS path without ever disabling a check. Needs the `openssl` binary.
 */
export interface TestPki {
  caPem: string;
  issue(hostname: string): { key: string; cert: string };
  dispose(): void;
}

export function createTestPki(): TestPki {
  const dir = mkdtempSync(join(tmpdir(), 'vault-broker-pki-'));
  const run = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  };
  run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Broker Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  let serial = 0;
  return {
    caPem: readFileSync(join(dir, 'ca.pem'), 'utf8'),
    issue(hostname: string) {
      serial += 1;
      const name = `leaf${serial}`;
      writeFileSync(join(dir, `${name}.cnf`), `subjectAltName=DNS:${hostname}\nbasicConstraints=CA:FALSE\n`);
      run(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${hostname}`]);
      run(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', String(serial + 100), '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.cnf`]);
      return { key: readFileSync(join(dir, `${name}.key`), 'utf8'), cert: readFileSync(join(dir, `${name}.pem`), 'utf8') };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface LocalHttps {
  port: number;
  /** Every request the server saw: method, url, headers and the body text. */
  seen: Array<{ method: string; url: string; headers: IncomingMessage['headers']; body: string }>;
  close(): Promise<void>;
}

export async function startLocalHttps(
  credentials: { key: string; cert: string },
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
): Promise<LocalHttps> {
  const seen: LocalHttps['seen'] = [];
  const server: Server = createServer(credentials, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: body.toString('utf8') });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
