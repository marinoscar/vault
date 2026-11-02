import { dropRequiredNotNull, withRequiredFieldFilters } from './required-field-filters';

const REQUIRED = new Set(['userId', 'id']);

describe('dropRequiredNotNull', () => {
  it('drops a { not: null } condition on a required column and nothing else', () => {
    expect(dropRequiredNotNull({ userId: { not: null } }, REQUIRED)).toEqual({});
    expect(dropRequiredNotNull({ userId: { not: null }, name: 'x' }, REQUIRED)).toEqual({ name: 'x' });
  });

  it('keeps a not-null condition on an optional column, a value, and a non-object where', () => {
    const optional = { ownerId: { not: null } };
    expect(dropRequiredNotNull(optional, REQUIRED)).toBe(optional);
    const value = { userId: 'u-1' };
    expect(dropRequiredNotNull(value, REQUIRED)).toBe(value);
    expect(dropRequiredNotNull({ userId: { not: 'u-1' } }, REQUIRED)).toEqual({ userId: { not: 'u-1' } });
    expect(dropRequiredNotNull(undefined, REQUIRED)).toBeUndefined();
  });
});

describe('withRequiredFieldFilters', () => {
  it('reads required columns from the composed schema: MediaFolder.userId is required, BackupRun.ownerId is not', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const client = withRequiredFieldFilters({ mediaFolder: { count }, backupRun: { count } });
    await client.mediaFolder.count({ where: { userId: { not: null } } });
    await client.backupRun.count({ where: { ownerId: { not: null } } });
    expect(count.mock.calls).toEqual([[{ where: {} }], [{ where: { ownerId: { not: null } } }]]);
  });

  it('rewrites count on a model whose column is required (MediaFolder.userId) and leaves other methods and models alone', async () => {
    const mediaCount = jest.fn().mockResolvedValue(3);
    const mediaDelete = jest.fn().mockResolvedValue({ count: 1 });
    const backupCount = jest.fn().mockResolvedValue(2);
    const client = withRequiredFieldFilters({
      mediaFolder: { count: mediaCount, deleteMany: mediaDelete },
      backupRun: { count: backupCount },
      $queryRaw: () => 'raw',
    });

    await expect(client.mediaFolder.count({ where: { userId: { not: null } } })).resolves.toBe(3);
    expect(mediaCount).toHaveBeenCalledWith({ where: {} });

    await client.mediaFolder.deleteMany({ where: { userId: 'u' } });
    expect(mediaDelete).toHaveBeenCalledWith({ where: { userId: 'u' } });

    // BackupRun.ownerId is optional: its filter is meaningful and passes through.
    await client.backupRun.count({ where: { ownerId: { not: null } } });
    expect(backupCount).toHaveBeenCalledWith({ where: { ownerId: { not: null } } });
    expect(client.$queryRaw()).toBe('raw');
  });
});
