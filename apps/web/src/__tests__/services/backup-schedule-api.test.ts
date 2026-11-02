import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  api,
  ApiError,
  deleteBackupRun,
  getBackupDownloadUrl,
  getBackupRuns,
  getBackupSchedule,
  runBackupNow,
  updateBackupSchedule,
} from '../../services/api';
import type { BackupSchedule, UpdateBackupScheduleRequest } from '../../types';

const schedule: BackupSchedule = {
  enabled: false,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'UTC',
  keepCount: 7,
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: false,
  passwordConfigured: false,
  passwordUpdatedAt: null,
  nextRunAt: null,
  lastRunAt: null,
  storageConfigured: true,
  updatedAt: null,
};

describe('scheduled backup API functions', () => {
  beforeEach(() => {
    api.setAccessToken('test-token');
  });
  afterEach(() => {
    api.setAccessToken(null);
  });

  it('getBackupSchedule unwraps the data envelope and sends auth', async () => {
    let auth: string | null = null;
    server.use(
      http.get('*/api/admin/backups/schedule', ({ request }) => {
        auth = request.headers.get('Authorization');
        return HttpResponse.json({ data: schedule });
      }),
    );

    await expect(getBackupSchedule()).resolves.toEqual(schedule);
    expect(auth).toBe('Bearer test-token');
  });

  it('updateBackupSchedule PUTs the body as given', async () => {
    let body: unknown;
    server.use(
      http.put('*/api/admin/backups/schedule', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { ...schedule, passwordConfigured: true } });
      }),
    );
    const request: UpdateBackupScheduleRequest = {
      enabled: true,
      frequency: 'weekly',
      intervalHours: null,
      timeOfDay: '04:30',
      dayOfWeek: 2,
      dayOfMonth: null,
      timezone: 'Europe/Paris',
      keepCount: 10,
      includeSecrets: true,
      includeAttachments: false,
      includeVersions: true,
      includeMedia: true,
      includeSystem: true,
      password: 'blue tiger river',
    };

    const result = await updateBackupSchedule(request);

    expect(body).toEqual(request);
    expect(result.passwordConfigured).toBe(true);
  });

  it('updateBackupSchedule leaves password out when not provided', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.put('*/api/admin/backups/schedule', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: schedule });
      }),
    );
    const { passwordConfigured, passwordUpdatedAt, nextRunAt, lastRunAt, storageConfigured, updatedAt, ...editable } =
      schedule;
    void [passwordConfigured, passwordUpdatedAt, nextRunAt, lastRunAt, storageConfigured, updatedAt];

    await updateBackupSchedule(editable);

    expect(body).not.toHaveProperty('password');
  });

  it('runBackupNow POSTs to /admin/backups/run and returns the run', async () => {
    let method = '';
    server.use(
      http.post('*/api/admin/backups/run', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ data: { id: 'run-9', status: 'running' } }, { status: 202 });
      }),
    );

    const result = await runBackupNow();

    expect(method).toBe('POST');
    expect(result).toMatchObject({ id: 'run-9', status: 'running' });
  });

  it('runBackupNow rejects with an ApiError carrying the 409 status and message', async () => {
    server.use(
      http.post('*/api/admin/backups/run', () =>
        HttpResponse.json(
          { code: 'CONFLICT', message: 'A backup is already running' },
          { status: 409 },
        ),
      ),
    );

    const error = await runBackupNow().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'A backup is already running',
    });
  });

  it('getBackupRuns sends page and pageSize as query params', async () => {
    let search = '';
    server.use(
      http.get('*/api/admin/backups', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({
          data: { items: [], total: 0, page: 2, pageSize: 20, totalPages: 0 },
        });
      }),
    );

    const result = await getBackupRuns({ page: 2, pageSize: 20 });

    expect(search).toBe('?page=2&pageSize=20');
    expect(result.items).toEqual([]);
  });

  it('getBackupRuns sends no query string without params', async () => {
    let search = 'unset';
    server.use(
      http.get('*/api/admin/backups', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        });
      }),
    );

    await getBackupRuns();

    expect(search).toBe('');
  });

  it('getBackupDownloadUrl requests the encoded id and returns the signed link', async () => {
    let pathname = '';
    const link = {
      url: 'https://files.example.test/signed',
      expiresAt: '2026-11-02T10:00:00.000Z',
      fileName: 'backup.zip',
    };
    server.use(
      http.get('*/api/admin/backups/:id/download', ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ data: link });
      }),
    );

    await expect(getBackupDownloadUrl('run/1 x')).resolves.toEqual(link);
    expect(pathname).toBe('/api/admin/backups/run%2F1%20x/download');
  });

  it('deleteBackupRun DELETEs and resolves on 204', async () => {
    let method = '';
    server.use(
      http.delete('*/api/admin/backups/:id', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(deleteBackupRun('run-1')).resolves.toBeUndefined();
    expect(method).toBe('DELETE');
  });

  it('deleteBackupRun rejects with the server error', async () => {
    server.use(
      http.delete('*/api/admin/backups/:id', () =>
        HttpResponse.json({ message: 'Backup not found' }, { status: 404 }),
      ),
    );

    await expect(deleteBackupRun('missing')).rejects.toMatchObject({
      status: 404,
      message: 'Backup not found',
    });
  });
});
