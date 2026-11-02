import { ConflictException } from '@nestjs/common';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { SystemSettingsShim } from './system-settings.shim';

describe('SystemSettingsShim (host core settings, E3.1)', () => {
  let prisma: MockPrismaService;
  let shim: SystemSettingsShim;

  const row = (value: unknown, version = 3) => ({ id: 's1', key: 'global', value, version });

  beforeEach(() => {
    prisma = createMockPrismaService();
    shim = new SystemSettingsShim(prisma as never);
    prisma.systemSettings.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.auditEvent.create.mockResolvedValue({} as never);
  });

  it('reads the maintenance defaults without writing when the row is absent', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue(null);

    await expect(shim.getMaintenancePolicy()).resolves.toMatchObject({ enabled: false, allowAdmins: true });
    expect(prisma.systemSettings.create).not.toHaveBeenCalled();
    expect(prisma.systemSettings.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to the defaults for an unreadable stored value', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue(row({ maintenance: { enabled: 'yes' } }) as never);

    await expect(shim.getMaintenancePolicy()).resolves.toMatchObject({ enabled: false });
  });

  it('patches only the maintenance namespace, keeps the other keys and bumps the version', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue(
      row({ ui: { allowUserThemeOverride: true }, features: { a: true } }) as never,
    );

    const updated = await shim.patchSettings({ maintenance: { enabled: true, message: 'Down' } }, 'admin-1');

    const call = prisma.systemSettings.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ key: 'global', version: 3 });
    expect((call.data as { value: Record<string, unknown> }).value).toMatchObject({
      ui: { allowUserThemeOverride: true },
      features: { a: true },
      maintenance: { enabled: true, message: 'Down', allowAdmins: true },
    });
    expect(updated.version).toBe(4);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale If-Match version and a concurrent write', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue(row({}) as never);
    await expect(shim.patchSettings({ maintenance: { enabled: true } }, 'a', 99)).rejects.toBeInstanceOf(ConflictException);

    prisma.systemSettings.updateMany.mockResolvedValue({ count: 0 } as never);
    await expect(shim.patchSettings({ maintenance: { enabled: true } }, 'a', 3)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a namespace it cannot merge rather than dropping the write', async () => {
    await expect(shim.patchSettings({ jobs: {} }, 'a')).rejects.toThrow(/cannot patch/);
  });
});
