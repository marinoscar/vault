import { randomUUID } from 'crypto';

import request from 'supertest';
import { FileEntry, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock, prismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockViewerUser,
  authHeader,
  TestUser,
} from '../helpers/auth-mock.helper';
import { rolePermissionsMap } from '../fixtures/test-data.factory';

/**
 * rolePermissionsMap has no secrets:* permissions, so the viewer role is
 * granted secrets:read for the duration of these tests only.
 */
const secretsRead = {
  id: randomUUID(),
  name: 'secrets:read',
  description: 'Read own secrets',
};

const URL = '/api/secrets/export';
const PASSWORD = 'sunshine-6';

function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('POST /api/secrets/export (Integration)', () => {
  let context: TestContext;
  let originalViewer: typeof rolePermissionsMap.viewer;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    originalViewer = rolePermissionsMap.viewer;
    setupBaseMocks();
    prismaMock.secret.findMany.mockResolvedValue([]);
    prismaMock.auditEvent.create.mockResolvedValue({});
  });

  afterEach(() => {
    rolePermissionsMap.viewer = originalViewer;
  });

  async function userWithSecretsRead(): Promise<TestUser> {
    rolePermissionsMap.viewer = [...originalViewer, secretsRead] as any;
    return createMockViewerUser(context);
  }

  it('returns 401 when unauthenticated', async () => {
    await request(context.app.getHttpServer())
      .post(URL)
      .send({ password: PASSWORD })
      .expect(401);
  });

  it('returns 403 without secrets:read', async () => {
    const viewer = await createMockViewerUser(context);

    await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(viewer.accessToken))
      .send({ password: PASSWORD })
      .expect(403);
    expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 with a specific message for a 5 character password', async () => {
    const user = await userWithSecretsRead();

    const res = await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken))
      .send({ password: '12345' })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('Password must be at least 6 characters');
    expect(JSON.stringify(res.body)).not.toContain('"12345"');
    expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['a missing password', {}],
    ['a non-string password', { password: 123456 }],
    ['a non-boolean option', { password: PASSWORD, includeVersions: 'yes' }],
    ['an over-long password', { password: 'x'.repeat(257) }],
  ])('returns 400 for %s', async (_label, body) => {
    const user = await userWithSecretsRead();
    const req = request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken));

    await (body === undefined ? req : req.send(body as object)).expect(400);
  });

  it('returns the raw zip with the documented headers, not wrapped in {data}', async () => {
    const user = await userWithSecretsRead();

    const res = await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken))
      .send({ password: PASSWORD })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^application\/zip/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="vault-backup-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers['content-disposition']).toContain(
      `vault-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    expect(res.headers['x-vault-export-secrets']).toBe('0');
    expect(res.headers['x-vault-export-attachments']).toBe('0');
    expect(res.headers['x-vault-export-media-files']).toBe('0');
    expect(res.headers['cache-control']).toBe('no-store');

    // A zip, not JSON: local file header magic, not "{".
    const body = res.body as Buffer;
    expect(body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);

    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(body)));
    const entries = await reader.getEntries();
    const json = entries.find((e) => e.filename === 'secrets.json') as FileEntry;
    const text = Buffer.from(
      await json.getData(new Uint8ArrayWriter(), { password: PASSWORD }),
    ).toString('utf8');
    expect(JSON.parse(text).owner.id).toBe(user.id);
    await reader.close();
  });

  it('queries only the caller\'s own secrets and audits without the password', async () => {
    const user = await userWithSecretsRead();

    await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken))
      .send({ password: PASSWORD, includeVersions: true, includeAttachments: false })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(prismaMock.secret.findMany.mock.calls[0][0].where).toEqual({
      createdById: user.id,
    });
    const audit = prismaMock.auditEvent.create.mock.calls.find(
      (c: any[]) => c[0].data.action === 'secrets.export',
    );
    expect(audit).toBeDefined();
    expect(audit![0].data.meta).toMatchObject({
      includeVersions: true,
      includeAttachments: false,
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it.each([
    ['nothing selected', { password: PASSWORD, includeSecrets: false }, 'Choose at least one thing to back up'],
    [
      'attachments without secrets',
      { password: PASSWORD, includeSecrets: false, includeMedia: true, includeAttachments: true },
      'Attachments can only be backed up together with secrets',
    ],
    [
      'includeSystem at the user level',
      { password: PASSWORD, includeSystem: true },
      'System configuration can only be included in a scheduled system backup',
    ],
  ])('returns 400 for %s', async (_label, body, message) => {
    const user = await userWithSecretsRead();
    const res = await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken))
      .send(body)
      .expect(400);
    expect(JSON.stringify(res.body)).toContain(message);
    expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
  });

  it("exports only the caller's media folders and reports them in X-Vault-Export-Media-Files", async () => {
    const user = await userWithSecretsRead();
    prismaMock.mediaFolder.findMany.mockResolvedValue([]);

    const res = await request(context.app.getHttpServer())
      .post(URL)
      .set(authHeader(user.accessToken))
      .send({ password: PASSWORD, includeSecrets: false, includeMedia: true })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['x-vault-export-media-files']).toBe('0');
    expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
    expect(prismaMock.mediaFolder.findMany.mock.calls[0][0].where).toEqual({ userId: user.id });
    const audit = prismaMock.auditEvent.create.mock.calls.find(
      (c: any[]) => c[0].data.action === 'secrets.export',
    );
    expect(audit![0].data.meta).toMatchObject({ includeSecrets: false, includeMedia: true, mediaFileCount: 0 });
  });
});
