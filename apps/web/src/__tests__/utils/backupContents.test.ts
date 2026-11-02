import { describe, it, expect } from 'vitest';
import {
  BACKUP_NOTHING_SELECTED_MESSAGE,
  DEFAULT_BACKUP_CONTENTS,
  areSecretOptionsDisabled,
  backupRunContentChips,
  defaultBackupContents,
  describeBackupContents,
  effectiveBackupContents,
  fromBackupContentFlags,
  rawBackupContentFlags,
  toBackupContentFlags,
  toUserBackupRequest,
  validateBackupContents,
  type BackupContentSelection,
} from '../../utils/backupContents';

function sel(overrides: Partial<BackupContentSelection> = {}): BackupContentSelection {
  return { ...defaultBackupContents(), ...overrides };
}

const NONE: BackupContentSelection = {
  secrets: false,
  attachments: false,
  versions: false,
  media: false,
  system: false,
};

describe('defaults', () => {
  it('is secrets with attachments, nothing else', () => {
    expect(DEFAULT_BACKUP_CONTENTS).toEqual({
      secrets: true,
      attachments: true,
      versions: false,
      media: false,
      system: false,
    });
  });

  it('returns a fresh copy each time', () => {
    const a = defaultBackupContents();
    a.media = true;
    expect(defaultBackupContents().media).toBe(false);
    expect(DEFAULT_BACKUP_CONTENTS.media).toBe(false);
  });

  it('is valid', () => {
    expect(validateBackupContents(defaultBackupContents())).toBeNull();
  });
});

describe('nested secret options', () => {
  it('are disabled only while Secrets is off', () => {
    expect(areSecretOptionsDisabled(sel())).toBe(false);
    expect(areSecretOptionsDisabled(sel({ secrets: false }))).toBe(true);
  });

  it('do not count while Secrets is off, but keep their values', () => {
    const input = sel({ secrets: false, attachments: true, versions: true, media: true });
    expect(effectiveBackupContents(input)).toEqual({
      secrets: false,
      attachments: false,
      versions: false,
      media: true,
      system: false,
    });
    expect(input.attachments).toBe(true);
    expect(input.versions).toBe(true);
  });
});

describe('validateBackupContents', () => {
  it('rejects nothing selected', () => {
    expect(validateBackupContents(NONE)).toBe(BACKUP_NOTHING_SELECTED_MESSAGE);
    expect(BACKUP_NOTHING_SELECTED_MESSAGE).toBe('Choose at least one thing to back up');
  });

  it('rejects only nested options without Secrets', () => {
    expect(validateBackupContents({ ...NONE, attachments: true, versions: true })).toBe(
      BACKUP_NOTHING_SELECTED_MESSAGE,
    );
  });

  it.each([
    [{ secrets: true }],
    [{ media: true }],
    [{ system: true }],
  ])('accepts %j alone', (overrides) => {
    expect(validateBackupContents({ ...NONE, ...overrides })).toBeNull();
  });
});

describe('describeBackupContents', () => {
  it.each<[Partial<BackupContentSelection>, string]>([
    [{}, 'Secrets with attachments'],
    [{ versions: true }, 'Secrets with attachments and old versions'],
    [{ attachments: false, versions: true }, 'Secrets with old versions'],
    [{ attachments: false }, 'Secrets only'],
    [{ media: true }, 'Secrets with attachments, media library'],
    [{ attachments: false, media: true }, 'Secrets, media library'],
    [{ secrets: false, media: true }, 'Media library'],
    [{ secrets: false, system: true }, 'System configuration'],
    [
      { versions: true, media: true, system: true },
      'Secrets with attachments and old versions, media library, system configuration',
    ],
  ])('%j -> %s', (overrides, expected) => {
    expect(describeBackupContents(sel(overrides))).toBe(expected);
  });

  it('says nothing is selected', () => {
    expect(describeBackupContents(NONE)).toBe('Nothing selected');
  });
});

describe('payloads', () => {
  it('maps the defaults to the user request', () => {
    expect(toUserBackupRequest(defaultBackupContents())).toEqual({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
    });
  });

  it('never includes includeSystem in the user request', () => {
    expect(toUserBackupRequest(sel({ system: true }))).not.toHaveProperty('includeSystem');
  });

  it('sends nested options as false while Secrets is off', () => {
    expect(
      toUserBackupRequest(sel({ secrets: false, attachments: true, versions: true, media: true })),
    ).toEqual({
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  it('maps every flag for the schedule', () => {
    expect(toBackupContentFlags(sel({ versions: true, media: true, system: true }))).toEqual({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: true,
      includeSystem: true,
    });
  });

  it('keeps the raw values for form state', () => {
    expect(rawBackupContentFlags(sel({ secrets: false, versions: true }))).toEqual({
      includeSecrets: false,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: false,
      includeSystem: false,
    });
  });

  it('round-trips through the flags', () => {
    const s = sel({ secrets: false, versions: true, media: true, system: true });
    expect(fromBackupContentFlags(rawBackupContentFlags(s))).toEqual(s);
  });

  it('takes the defaults for missing flags', () => {
    expect(fromBackupContentFlags({ includeAttachments: false, includeVersions: true })).toEqual({
      secrets: true,
      attachments: false,
      versions: true,
      media: false,
      system: false,
    });
    expect(fromBackupContentFlags(undefined)).toEqual(DEFAULT_BACKUP_CONTENTS);
  });
});

describe('backupRunContentChips', () => {
  it('shows Secrets, Media, System in a fixed order', () => {
    expect(backupRunContentChips(['system', 'media', 'attachments', 'secrets'])).toEqual([
      'Secrets',
      'Media',
      'System',
    ]);
  });

  it('gives nested and unknown keys no chip', () => {
    expect(backupRunContentChips(['attachments', 'versions', 'audit'])).toEqual([]);
  });

  it('returns nothing for empty or missing contents', () => {
    expect(backupRunContentChips([])).toEqual([]);
    expect(backupRunContentChips(undefined)).toEqual([]);
    expect(backupRunContentChips(null)).toEqual([]);
  });
});
