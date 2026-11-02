import { Test } from '@nestjs/testing';

import { CryptoService } from '../../common/services/crypto.service';
import { DEFAULT_SYSTEM_SETTINGS } from '../../common/types/settings.types';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { SystemSettingsService } from './system-settings.service';

// The `global` row is shared with the platform's namespaces (`maintenance` today).
// A legacy admin save must not erase a key it does not own (issue #76).
describe('SystemSettingsService keeps keys it does not own', () => {
  const maintenance = {
    enabled: true,
    message: 'Back soon',
    allowAdmins: true,
    startedAt: '2026-06-10T12:00:00.000Z',
    startedById: 'admin-1',
  };
  const stored = { ...DEFAULT_SYSTEM_SETTINGS, ai: undefined, maintenance };

  let service: SystemSettingsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const row = { id: 's1', key: 'global', value: stored, version: 4, updatedAt: new Date(), updatedByUser: null };
    prisma.systemSettings.findUnique.mockResolvedValue(row as never);
    prisma.systemSettings.update.mockImplementation((async (args: { data: { value: unknown } }) => ({
      ...row,
      value: args.data.value,
      version: 5,
    })) as never);
    prisma.systemSettings.upsert.mockImplementation((async (args: { update: { value: unknown } }) => ({
      ...row,
      value: args.update.value,
      version: 5,
    })) as never);

    const module = await Test.createTestingModule({
      providers: [
        SystemSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: { encrypt: jest.fn(), decrypt: jest.fn() } },
      ],
    }).compile();
    service = module.get(SystemSettingsService);
  });

  it('PATCH writes the maintenance key back unchanged', async () => {
    await service.patchSettings({ features: { beta: true } }, 'admin-1');

    const written = prisma.systemSettings.update.mock.calls[0][0].data.value as Record<string, unknown>;
    expect(written.maintenance).toEqual(maintenance);
    expect(written.features).toEqual({ beta: true });
  });

  it('PUT writes the maintenance key back unchanged', async () => {
    await service.replaceSettings({ ui: { allowUserThemeOverride: false }, features: {} } as never, 'admin-1');

    const written = prisma.systemSettings.upsert.mock.calls[0][0].update.value as Record<string, unknown>;
    expect(written.maintenance).toEqual(maintenance);
    expect((written.ui as { allowUserThemeOverride: boolean }).allowUserThemeOverride).toBe(false);
  });
});
