import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_TABLE_PREFERENCES_STORAGE_KEY,
  createLocalStorageDataTablePreferencesPort,
} from '../../platform/dataTablePreferences';

describe('localStorage DataTable preferences port (PLATFORM-ADOPTION-SHIM(E4))', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a table layout under the Vault key', async () => {
    const port = createLocalStorageDataTablePreferencesPort();
    await port.save('secrets', { density: 'compact', pageSize: 50 });
    expect(JSON.parse(window.localStorage.getItem(DATA_TABLE_PREFERENCES_STORAGE_KEY)!)).toEqual({
      secrets: { density: 'compact', pageSize: 50 },
    });
    expect(await createLocalStorageDataTablePreferencesPort().load()).toEqual({
      secrets: { density: 'compact', pageSize: 50 },
    });
  });

  it('removes a table entry on reset', async () => {
    const port = createLocalStorageDataTablePreferencesPort();
    await port.save('secrets', { density: 'compact' });
    await port.save('other', { density: 'standard' });
    await port.save('secrets', null);
    expect(await port.load()).toEqual({ other: { density: 'standard' } });
  });

  it('reads a corrupt store as empty', async () => {
    window.localStorage.setItem(DATA_TABLE_PREFERENCES_STORAGE_KEY, '{not json');
    expect(await createLocalStorageDataTablePreferencesPort().load()).toEqual({});
    window.localStorage.setItem(DATA_TABLE_PREFERENCES_STORAGE_KEY, '[1,2]');
    expect(await createLocalStorageDataTablePreferencesPort().load()).toEqual({});
  });

  it('keeps working in memory when storage is blocked', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const port = createLocalStorageDataTablePreferencesPort();
    await port.save('secrets', { density: 'comfortable' });
    expect(await port.load()).toEqual({ secrets: { density: 'comfortable' } });
  });
});
