// Issue #209: the Passport and ID Document system types end to end over HTTP, on the mocked
// database (an in-memory store behind prismaMock). Fixtures are invented: Person A, X1234567.
import { randomUUID } from 'crypto';

import request from 'supertest';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock, prismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockViewerUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { rolePermissionsMap } from '../fixtures/test-data.factory';
import { CryptoService } from '../../src/common/services/crypto.service';

const permission = (name: string) => ({ id: randomUUID(), name, description: name });
const GRANTED = [
  'secrets:read',
  'secrets:write',
  'secret_types:read',
  'secret_types:write',
  'secret_types:delete',
].map(permission);

const PASSPORT_NUMBER = 'X1234567';
const DOCUMENT_NUMBER = 'D0000001';

interface TypeRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: unknown;
  allowAttachments: boolean;
  isSystem: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}
interface SecretRow {
  id: string;
  name: string;
  description: string | null;
  typeId: string;
  createdById: string;
  agentAccess: string;
  origins: string[];
  createdAt: Date;
  updatedAt: Date;
}
interface VersionRow {
  id: string;
  secretId: string;
  version: number;
  encryptedData: string;
  iv: string;
  authTag: string;
  isCurrent: boolean;
  createdById: string;
  createdAt: Date;
}

describe('Passport and ID Document system types (Integration, issue #209)', () => {
  let context: TestContext;
  let originalViewer: typeof rolePermissionsMap.viewer;
  let types: TypeRow[];
  let secrets: SecretRow[];
  let versions: VersionRow[];

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    const crypto = context.app.get(CryptoService);
    // The test app may boot without VAULT_ENCRYPTION_KEY; install a test key.
    if (!(crypto as any).encryptionKey) {
      (crypto as any).encryptionKey = Buffer.alloc(32, 7);
    }
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    originalViewer = rolePermissionsMap.viewer;
    setupBaseMocks();
    installStore();
  });

  afterEach(() => {
    rolePermissionsMap.viewer = originalViewer;
  });

  /** The seeded system types and an in-memory secrets/versions store behind prismaMock. */
  function installStore() {
    const now = new Date('2026-01-01T00:00:00Z');
    types = SYSTEM_SECRET_TYPES.map((t) => ({
      id: randomUUID(),
      name: t.name,
      description: t.description,
      icon: t.icon,
      fields: t.fields,
      allowAttachments: t.allowAttachments,
      isSystem: true,
      createdById: null,
      createdAt: now,
      updatedAt: now,
    }));
    secrets = [];
    versions = [];
    const typeOf = (row: SecretRow) => types.find((t) => t.id === row.typeId)!;
    const withRelations = (row: SecretRow, include: any) => {
      if (!include) return { ...row };
      const out: any = { ...row };
      if (include.type) out.type = typeOf(row);
      if (include.versions) {
        let list = versions.filter((v) => v.secretId === row.id);
        if (include.versions.where?.isCurrent) list = list.filter((v) => v.isCurrent);
        out.versions = list.map((v) => ({ ...v, createdBy: null }));
      }
      if (include.attachments) out.attachments = [];
      return out;
    };

    prismaMock.secretType.findMany.mockImplementation(async () => [...types]);
    prismaMock.secretType.findUnique.mockImplementation(
      async ({ where }: any) => types.find((t) => t.id === where.id) ?? null,
    );

    prismaMock.secret.findFirst.mockImplementation(
      async ({ where }: any) =>
        secrets.find((s) => s.name === where.name && s.createdById === where.createdById) ?? null,
    );
    prismaMock.secret.findUnique.mockImplementation(async ({ where, include }: any) => {
      const row = secrets.find((s) => s.id === where.id);
      return row ? withRelations(row, include) : null;
    });
    prismaMock.secret.create.mockImplementation(async ({ data, include }: any) => {
      const row: SecretRow = {
        id: randomUUID(),
        name: data.name,
        description: data.description ?? null,
        typeId: data.typeId,
        createdById: data.createdById,
        agentAccess: 'none',
        origins: data.origins ?? [],
        createdAt: now,
        updatedAt: now,
      };
      secrets.push(row);
      return withRelations(row, include);
    });
    prismaMock.secret.update.mockImplementation(async ({ where, data, include }: any) => {
      const row = secrets.find((s) => s.id === where.id)!;
      Object.assign(row, data);
      return withRelations(row, include);
    });

    prismaMock.secretVersion.create.mockImplementation(async ({ data }: any) => {
      const row: VersionRow = { id: randomUUID(), createdAt: now, ...data };
      versions.push(row);
      return row;
    });
    prismaMock.secretVersion.findFirst.mockImplementation(async ({ where }: any) => {
      const list = versions
        .filter((v) => v.secretId === where.secretId && (where.isCurrent === undefined || v.isCurrent === where.isCurrent))
        .sort((a, b) => b.version - a.version);
      return list[0] ?? null;
    });
    prismaMock.secretVersion.updateMany.mockImplementation(async ({ where, data }: any) => {
      const list = versions.filter((v) => v.secretId === where.secretId);
      list.forEach((v) => Object.assign(v, data));
      return { count: list.length };
    });
    prismaMock.secretVersion.findMany.mockImplementation(async ({ where }: any) =>
      versions
        .filter((v) => v.secretId === where.secretId)
        .sort((a, b) => b.version - a.version)
        .map((v) => ({ id: v.id, version: v.version, isCurrent: v.isCurrent, createdAt: v.createdAt, createdBy: null })),
    );
    prismaMock.secretVersion.findUnique.mockImplementation(async ({ where }: any) => {
      const v = versions.find((row) => row.id === where.id);
      return v ? { ...v, createdBy: null, attachments: [] } : null;
    });
    prismaMock.secretAttachment.findMany.mockResolvedValue([]);
  }

  async function user(): Promise<TestUser> {
    rolePermissionsMap.viewer = [...originalViewer, ...GRANTED] as any;
    return createMockViewerUser(context);
  }

  const typeId = (name: string) => types.find((t) => t.name === name)!.id;
  const server = () => context.app.getHttpServer();

  const passportData = {
    surname: 'PERSON',
    given_names: 'A',
    passport_number: PASSPORT_NUMBER,
    passport_type: 'P',
    issuing_country: 'can',
    nationality: 'CAN',
    date_of_birth: '1990-01-01',
    sex: 'X',
    expiry_date: '2031-01-01',
    mrz: 'P<CANPERSON<<A<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
  };

  const idDocumentData = {
    document_kind: 'Driver License',
    holder_name: 'Person A',
    document_number: DOCUMENT_NUMBER,
    issuing_country: 'CAN',
    issuing_authority: 'Region A',
    expiry_date: '2030-06-30',
    attributes: [
      { key: 'license_class', label: 'Class', value: 'G', sensitive: false },
      { key: 'restrictions', label: 'Restrictions', value: 'Corrective lenses', sensitive: false },
    ],
  };

  describe('GET /api/secret-types', () => {
    it('lists both types as system types with their fields', async () => {
      const u = await user();
      const res = await request(server()).get('/api/secret-types').set(authHeader(u.accessToken)).expect(200);
      const items: any[] = res.body.data.items ?? res.body.data;
      const passport = items.find((t) => t.name === 'Passport');
      const doc = items.find((t) => t.name === 'ID Document');
      expect(passport).toMatchObject({ isSystem: true, icon: 'TravelExplore', allowAttachments: true });
      expect(doc).toMatchObject({ isSystem: true, icon: 'AssignmentInd', allowAttachments: true });
      expect(doc.fields.find((f: any) => f.name === 'attributes').type).toBe('keyvalue');
    });

    it.each(['Passport', 'ID Document'])('refuses to update or delete the %s type', async (name) => {
      const u = await user();
      const id = typeId(name);
      const put = await request(server())
        .put(`/api/secret-types/${id}`)
        .set(authHeader(u.accessToken))
        .send({ name: 'Renamed' })
        .expect(400);
      expect(put.body.message).toMatch(/System types cannot be modified/);
      const del = await request(server()).delete(`/api/secret-types/${id}`).set(authHeader(u.accessToken)).expect(400);
      expect(del.body.message).toMatch(/System types cannot be deleted/);
      expect(prismaMock.secretType.update).not.toHaveBeenCalled();
      expect(prismaMock.secretType.delete).not.toHaveBeenCalled();
    });
  });

  describe('secrets of the new types', () => {
    it('creates, reads, updates and versions a Passport; the country code is stored upper-case', async () => {
      const u = await user();
      const created = await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: 'Passport A', typeId: typeId('Passport'), data: passportData })
        .expect(201);
      const id = created.body.data.id;
      expect(created.body.data.values.issuing_country).toBe('CAN');

      const got = await request(server()).get(`/api/secrets/${id}`).set(authHeader(u.accessToken)).expect(200);
      expect(got.body.data.values).toMatchObject({ surname: 'PERSON', passport_number: PASSPORT_NUMBER, issuing_country: 'CAN' });
      expect(got.body.data.currentVersion).toBe(1);

      const updated = await request(server())
        .put(`/api/secrets/${id}`)
        .set(authHeader(u.accessToken))
        .send({ data: { ...passportData, expiry_date: '2036-01-01', issuing_country: 'fra' } })
        .expect(200);
      expect(updated.body.data.currentVersion).toBe(2);
      expect(updated.body.data.values).toMatchObject({ expiry_date: '2036-01-01', issuing_country: 'FRA' });

      const list = await request(server()).get(`/api/secrets/${id}/versions`).set(authHeader(u.accessToken)).expect(200);
      const history: any[] = list.body.data;
      expect(history.map((v) => [v.version, v.isCurrent])).toEqual([
        [2, true],
        [1, false],
      ]);
      const first = await request(server())
        .get(`/api/secrets/${id}/versions/${history[1].id}`)
        .set(authHeader(u.accessToken))
        .expect(200);
      expect(first.body.data.values).toMatchObject({ expiry_date: '2031-01-01', issuing_country: 'CAN' });
    });

    it('refuses a Passport without its required fields or with an unknown country code', async () => {
      const u = await user();
      await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: 'Passport B', typeId: typeId('Passport'), data: { surname: 'PERSON' } })
        .expect(400);
      await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: 'Passport C', typeId: typeId('Passport'), data: { ...passportData, issuing_country: 'ZZZ' } })
        .expect(400);
      expect(secrets).toHaveLength(0);
    });

    it('creates, reads, updates and versions an ID Document with attributes', async () => {
      const u = await user();
      const created = await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: 'License A', typeId: typeId('ID Document'), data: idDocumentData })
        .expect(201);
      const id = created.body.data.id;

      const got = await request(server()).get(`/api/secrets/${id}`).set(authHeader(u.accessToken)).expect(200);
      expect(got.body.data.values.attributes).toEqual(idDocumentData.attributes);
      expect(got.body.data.values.document_kind).toBe('Driver License');

      // The same data again keeps the version.
      const same = await request(server())
        .put(`/api/secrets/${id}`)
        .set(authHeader(u.accessToken))
        .send({ data: idDocumentData })
        .expect(200);
      expect(same.body.data.currentVersion).toBe(1);

      const attributes = [...idDocumentData.attributes, { key: 'organ_donor', label: 'Organ Donor', value: 'Yes', sensitive: false }];
      const updated = await request(server())
        .put(`/api/secrets/${id}`)
        .set(authHeader(u.accessToken))
        .send({ data: { ...idDocumentData, attributes } })
        .expect(200);
      expect(updated.body.data.currentVersion).toBe(2);
      expect(updated.body.data.values.attributes).toEqual(attributes);
      expect(versions.filter((v) => v.secretId === id)).toHaveLength(2);
    });

    it('refuses an ID Document with a kind outside the catalog', async () => {
      const u = await user();
      await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: 'Card Z', typeId: typeId('ID Document'), data: { ...idDocumentData, document_kind: 'Library Card' } })
        .expect(400);
    });

    it.each(['Passport', 'ID Document'])('answers 422 when opening the %s secret to agents', async (name) => {
      const u = await user();
      const created = await request(server())
        .post('/api/secrets')
        .set(authHeader(u.accessToken))
        .send({ name: `${name} item`, typeId: typeId(name), data: name === 'Passport' ? passportData : idDocumentData })
        .expect(201);
      const res = await request(server())
        .patch(`/api/secrets/${created.body.data.id}/agent-access`)
        .set(authHeader(u.accessToken))
        .send({ agentAccess: 'fill' })
        .expect(422);
      expect(JSON.stringify(res.body)).toContain('AGENT_ACCESS_UNSUPPORTED_TYPE');
      expect(secrets[0]!.agentAccess).toBe('none');
    });
  });
});
