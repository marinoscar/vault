import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  api,
  ApiError,
  defaultBackupFilename,
  downloadSecretsBackup,
  parseContentDispositionFilename,
} from '../../services/api';

describe('parseContentDispositionFilename', () => {
  it.each([
    ['attachment; filename="vault-backup-2026-01-02.zip"', 'vault-backup-2026-01-02.zip'],
    ['attachment; filename=vault-backup-2026-01-02.zip', 'vault-backup-2026-01-02.zip'],
    ['attachment; filename=backup.zip; size=3', 'backup.zip'],
    ["attachment; filename*=UTF-8''my%20backup.zip", 'my backup.zip'],
    [
      "attachment; filename=\"fallback.zip\"; filename*=UTF-8''better%20name.zip",
      'better name.zip',
    ],
    ['ATTACHMENT; FILENAME="Upper.zip"', 'Upper.zip'],
  ])('parses %j', (header, expected) => {
    expect(parseContentDispositionFilename(header)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['attachment'], ['attachment; filename=""']])(
    'returns null for %j',
    (header) => {
      expect(parseContentDispositionFilename(header as string | null | undefined)).toBeNull();
    },
  );

  it('strips path components so it can only name a file', () => {
    expect(parseContentDispositionFilename('attachment; filename="../../etc/passwd"')).toBe(
      'passwd',
    );
    expect(parseContentDispositionFilename('attachment; filename="C:\\temp\\x.zip"')).toBe(
      'x.zip',
    );
    expect(
      parseContentDispositionFilename("attachment; filename*=UTF-8''..%2F..%2Fevil.zip"),
    ).toBe('evil.zip');
  });

  it('falls back to the plain filename when the extended value is malformed', () => {
    expect(
      parseContentDispositionFilename("attachment; filename=\"ok.zip\"; filename*=UTF-8''%E0%A4%A"),
    ).toBe('ok.zip');
  });
});

describe('defaultBackupFilename', () => {
  it('uses the UTC date', () => {
    expect(defaultBackupFilename(new Date('2026-03-09T23:59:59Z'))).toBe(
      'vault-backup-2026-03-09.zip',
    );
    expect(defaultBackupFilename(new Date('2026-12-31T23:30:00-05:00'))).toBe(
      'vault-backup-2027-01-01.zip',
    );
  });

  it('defaults to today', () => {
    expect(defaultBackupFilename()).toMatch(/^vault-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

describe('downloadSecretsBackup', () => {
  beforeEach(() => {
    api.setAccessToken('test-token');
  });
  afterEach(() => {
    api.setAccessToken(null);
  });

  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

  it('posts the options with auth and returns blob, filename and counts', async () => {
    let received: { body: unknown; auth: string | null; contentType: string | null } | null = null;
    server.use(
      http.post('*/api/secrets/export', async ({ request }) => {
        received = {
          body: await request.json(),
          auth: request.headers.get('Authorization'),
          contentType: request.headers.get('Content-Type'),
        };
        return new HttpResponse(zipBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="vault-backup-2026-05-06.zip"',
            'X-Vault-Export-Secrets': '7',
            'X-Vault-Export-Attachments': '3',
          },
        });
      }),
    );

    const result = await downloadSecretsBackup({
      password: 'blue tiger river',
      includeAttachments: false,
      includeVersions: true,
    });

    expect(received).toEqual({
      body: { password: 'blue tiger river', includeAttachments: false, includeVersions: true },
      auth: 'Bearer test-token',
      contentType: 'application/json',
    });
    expect(result.filename).toBe('vault-backup-2026-05-06.zip');
    expect(result.secretCount).toBe(7);
    expect(result.attachmentCount).toBe(3);
    expect(result.blob.size).toBe(zipBytes.length);
  });

  it('defaults to attachments on and versions off', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/secrets/export', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(zipBytes, { status: 200 });
      }),
    );

    await downloadSecretsBackup({ password: 'abcdef' });

    expect(body).toEqual({ password: 'abcdef', includeAttachments: true, includeVersions: false });
  });

  it('falls back to the default file name and null counts without headers', async () => {
    server.use(
      http.post('*/api/secrets/export', () => new HttpResponse(zipBytes, { status: 200 })),
    );

    const result = await downloadSecretsBackup({ password: 'abcdef' });

    expect(result.filename).toBe(defaultBackupFilename());
    expect(result.secretCount).toBeNull();
    expect(result.attachmentCount).toBeNull();
  });

  it('treats malformed count headers as null', async () => {
    server.use(
      http.post(
        '*/api/secrets/export',
        () =>
          new HttpResponse(zipBytes, {
            status: 200,
            headers: { 'X-Vault-Export-Secrets': 'abc', 'X-Vault-Export-Attachments': '-4' },
          }),
      ),
    );

    const result = await downloadSecretsBackup({ password: 'abcdef' });

    expect(result.secretCount).toBeNull();
    expect(result.attachmentCount).toBeNull();
  });

  it('surfaces the server error message', async () => {
    server.use(
      http.post('*/api/secrets/export', () =>
        HttpResponse.json(
          { code: 'BAD_REQUEST', message: 'Password must be at least 6 characters' },
          { status: 400 },
        ),
      ),
    );

    const promise = downloadSecretsBackup({ password: 'abcdef' });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      message: 'Password must be at least 6 characters',
      status: 400,
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    server.use(
      http.post('*/api/secrets/export', () => new HttpResponse('boom', { status: 500 })),
    );

    await expect(downloadSecretsBackup({ password: 'abcdef' })).rejects.toMatchObject({
      message: 'Request failed',
      status: 500,
    });
  });

  it('refreshes the token on 401 and retries once', async () => {
    let calls = 0;
    const auths: Array<string | null> = [];
    server.use(
      http.post('*/api/secrets/export', ({ request }) => {
        calls += 1;
        auths.push(request.headers.get('Authorization'));
        if (calls === 1) {
          return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        return new HttpResponse(zipBytes, {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="after-refresh.zip"' },
        });
      }),
      http.post('*/api/auth/refresh', () =>
        HttpResponse.json({ data: { accessToken: 'fresh-token' } }),
      ),
    );

    const result = await downloadSecretsBackup({ password: 'abcdef' });

    expect(calls).toBe(2);
    expect(auths).toEqual(['Bearer test-token', 'Bearer fresh-token']);
    expect(result.filename).toBe('after-refresh.zip');
  });

  it('throws Unauthorized when the refresh fails', async () => {
    server.use(
      http.post('*/api/secrets/export', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
      http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })),
    );

    await expect(downloadSecretsBackup({ password: 'abcdef' })).rejects.toMatchObject({
      status: 401,
    });
  });
});
