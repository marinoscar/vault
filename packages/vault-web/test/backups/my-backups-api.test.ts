import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import {
  api,
  ApiError,
  deleteMyBackup,
  downloadAdminBackup,
  getMyBackupDownloadUrl,
  getMyBackups,
  getMyBackupsConfig,
  saveMyBackupToStorage,
} from '../../src/core/headless/api.js';

const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]);

beforeEach(() => {
  api.setAccessToken('test-token');
});
afterEach(() => {
  api.setAccessToken(null);
});

describe('saved backups API functions', () => {
  it('getMyBackupsConfig unwraps the data envelope', async () => {
    server.use(
      http.get('*/api/backups/me/config', () =>
        HttpResponse.json({ data: { storageConfigured: true, keepCount: 10 } }),
      ),
    );

    await expect(getMyBackupsConfig()).resolves.toEqual({ storageConfigured: true, keepCount: 10 });
  });

  it('saveMyBackupToStorage POSTs the export body to /backups/me with auth', async () => {
    let received: { body: unknown; auth: string | null } | null = null;
    server.use(
      http.post('*/api/backups/me', async ({ request }) => {
        received = { body: await request.json(), auth: request.headers.get('Authorization') };
        return HttpResponse.json({ data: { id: 'mine-1', status: 'running' } }, { status: 202 });
      }),
    );

    const run = await saveMyBackupToStorage({
      password: 'blue tiger river',
      includeSecrets: true,
      includeAttachments: false,
      includeVersions: true,
      includeMedia: true,
    });

    expect(received).toEqual({
      body: {
        password: 'blue tiger river',
        includeSecrets: true,
        includeAttachments: false,
        includeVersions: true,
        includeMedia: true,
      },
      auth: 'Bearer test-token',
    });
    expect(run).toMatchObject({ id: 'mine-1', status: 'running' });
  });

  it('saveMyBackupToStorage forces the nested options off without secrets', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/backups/me', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { id: 'mine-1' } }, { status: 202 });
      }),
    );

    await saveMyBackupToStorage({
      password: 'blue tiger river',
      includeSecrets: false,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: true,
    });

    expect(body).toEqual({
      password: 'blue tiger river',
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  it('saveMyBackupToStorage rejects with the server message (409)', async () => {
    server.use(
      http.post('*/api/backups/me', () =>
        HttpResponse.json({ message: 'A backup is already running' }, { status: 409 }),
      ),
    );

    const err = await saveMyBackupToStorage({ password: 'blue tiger river' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'A backup is already running' });
  });

  it('getMyBackups sends the page query and returns the page', async () => {
    let url = '';
    server.use(
      http.get('*/api/backups/me', ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          data: { items: [], total: 0, page: 2, pageSize: 20, totalPages: 0 },
        });
      }),
    );

    const res = await getMyBackups({ page: 2, pageSize: 20 });

    expect(new URL(url).pathname).toBe('/api/backups/me');
    expect(new URL(url).searchParams.get('page')).toBe('2');
    expect(new URL(url).searchParams.get('pageSize')).toBe('20');
    expect(res.page).toBe(2);
  });

  it('getMyBackupDownloadUrl GETs the signed link for the id', async () => {
    let path = '';
    server.use(
      http.get('*/api/backups/me/:id/download', ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({
          data: { url: 'https://files.example.test/x', expiresAt: 'later', fileName: 'b.zip' },
        });
      }),
    );

    const link = await getMyBackupDownloadUrl('mine/1');

    expect(path).toBe('/api/backups/me/mine%2F1/download');
    expect(link).toEqual({ url: 'https://files.example.test/x', expiresAt: 'later', fileName: 'b.zip' });
  });

  it('deleteMyBackup sends DELETE and resolves on 204', async () => {
    let method = '';
    let path = '';
    server.use(
      http.delete('*/api/backups/me/:id', ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(deleteMyBackup('mine-1')).resolves.toBeUndefined();
    expect(method).toBe('DELETE');
    expect(path).toBe('/api/backups/me/mine-1');
  });
});

describe('downloadAdminBackup', () => {
  const flags = {
    includeSecrets: true,
    includeAttachments: true,
    includeVersions: false,
    includeMedia: true,
    includeSystem: true,
  };

  function zipResponse() {
    return new HttpResponse(zipBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="vault-admin-backup-2026-11-02_101500.zip"',
        'X-Vault-Export-Users': '3',
        'X-Vault-Export-Secrets': '12',
        'X-Vault-Export-Attachments': '4',
        'X-Vault-Export-Media-Files': '5',
      },
    });
  }

  it('POSTs the password and contents and returns the streamed zip', async () => {
    let received: { body: unknown; auth: string | null } | null = null;
    server.use(
      http.post('*/api/admin/backups/export', async ({ request }) => {
        received = { body: await request.json(), auth: request.headers.get('Authorization') };
        return zipResponse();
      }),
    );

    const result = await downloadAdminBackup({ password: 'blue tiger river', ...flags });

    expect(received).toEqual({
      body: { password: 'blue tiger river', ...flags },
      auth: 'Bearer test-token',
    });
    expect(result.filename).toBe('vault-admin-backup-2026-11-02_101500.zip');
    expect(result.userCount).toBe(3);
    expect(result.secretCount).toBe(12);
    expect(result.attachmentCount).toBe(4);
    expect(result.mediaFileCount).toBe(5);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(zipBytes);
  });

  it('sends useScheduledPassword and no password key when using the stored one', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/api/admin/backups/export', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return zipResponse();
      }),
    );

    await downloadAdminBackup({ useScheduledPassword: true, password: 'ignored', ...flags });

    expect(body).toEqual({ useScheduledPassword: true, ...flags });
    expect(body).not.toHaveProperty('password');
  });

  it('forces the nested options off without secrets', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/api/admin/backups/export', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return zipResponse();
      }),
    );

    await downloadAdminBackup({
      password: 'blue tiger river',
      ...flags,
      includeSecrets: false,
      includeVersions: true,
    });

    expect(body).toMatchObject({
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
    });
  });

  it('falls back to the default file name and null counts without headers', async () => {
    server.use(
      http.post('*/api/admin/backups/export', () => new HttpResponse(zipBytes, { status: 200 })),
    );

    const result = await downloadAdminBackup({ password: 'blue tiger river', ...flags });

    expect(result.filename).toMatch(/^vault-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(result.userCount).toBeNull();
    expect(result.secretCount).toBeNull();
  });

  it('rejects with the server message on 400', async () => {
    server.use(
      http.post('*/api/admin/backups/export', () =>
        HttpResponse.json(
          { message: 'Send a password or useScheduledPassword, not both' },
          { status: 400 },
        ),
      ),
    );

    const err = await downloadAdminBackup({ password: 'blue tiger river', ...flags }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400 });
  });
});
