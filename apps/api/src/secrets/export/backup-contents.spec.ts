import {
  BACKUP_CONTENT_MESSAGES,
  contentSelectionIssues,
  describeContents,
  resolveContentSelection,
  selectedContentKeys,
} from './backup-contents';

const messages = (raw: Parameters<typeof contentSelectionIssues>[0], level: 'user' | 'system') =>
  contentSelectionIssues(raw, level).map((i) => i.message);

describe('contentSelectionIssues', () => {
  it.each(['user', 'system'] as const)('accepts the defaults (%s)', (level) => {
    expect(messages({}, level)).toEqual([]);
  });

  it.each(['user', 'system'] as const)('requires at least one of secrets/media (%s)', (level) => {
    expect(messages({ includeSecrets: false }, level)).toEqual([BACKUP_CONTENT_MESSAGES.nothingSelected]);
    expect(messages({ includeSecrets: false, includeMedia: false }, level)).toEqual([
      BACKUP_CONTENT_MESSAGES.nothingSelected,
    ]);
  });

  it('accepts media only', () => {
    expect(messages({ includeSecrets: false, includeMedia: true }, 'user')).toEqual([]);
    expect(messages({ includeSecrets: false, includeMedia: true }, 'system')).toEqual([]);
  });

  it('accepts system only at the system level', () => {
    expect(messages({ includeSecrets: false, includeSystem: true }, 'system')).toEqual([]);
    expect(messages({ includeSecrets: false, includeSystem: false }, 'system')).toEqual([
      BACKUP_CONTENT_MESSAGES.nothingSelected,
    ]);
  });

  it.each([true, false, 'yes', null])('rejects includeSystem=%p at the user level', (value) => {
    expect(messages({ includeSystem: value }, 'user')).toEqual([BACKUP_CONTENT_MESSAGES.systemNotOffered]);
  });

  it('rejects attachments or versions explicitly requested without secrets', () => {
    expect(messages({ includeSecrets: false, includeMedia: true, includeAttachments: true }, 'user')).toEqual([
      BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets,
    ]);
    expect(messages({ includeSecrets: false, includeMedia: true, includeVersions: true }, 'system')).toEqual([
      BACKUP_CONTENT_MESSAGES.versionsWithoutSecrets,
    ]);
  });

  it('allows attachments/versions false (or left out) without secrets', () => {
    expect(
      messages({ includeSecrets: false, includeMedia: true, includeAttachments: false, includeVersions: false }, 'user'),
    ).toEqual([]);
    expect(messages({ includeSecrets: false, includeMedia: true }, 'user')).toEqual([]);
  });

  it('reports "nothing selected" first, then the dependency errors', () => {
    expect(messages({ includeSecrets: false, includeAttachments: true, includeVersions: true }, 'user')).toEqual([
      BACKUP_CONTENT_MESSAGES.nothingSelected,
      BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets,
      BACKUP_CONTENT_MESSAGES.versionsWithoutSecrets,
    ]);
  });
});

describe('resolveContentSelection', () => {
  it('applies the defaults: secrets + attachments', () => {
    expect(resolveContentSelection({})).toEqual({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
      includeSystem: false,
    });
  });

  it('turns attachments and versions off when secrets are off', () => {
    expect(resolveContentSelection({ includeSecrets: false, includeMedia: true })).toMatchObject({
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  it('only a literal true includes system', () => {
    expect(resolveContentSelection({ includeSystem: 'yes' }).includeSystem).toBe(false);
    expect(resolveContentSelection({ includeSystem: true }).includeSystem).toBe(true);
  });
});

describe('selectedContentKeys / describeContents', () => {
  it('lists keys in the fixed order', () => {
    expect(
      selectedContentKeys({
        includeSecrets: true,
        includeAttachments: true,
        includeVersions: true,
        includeMedia: true,
        includeSystem: true,
      }),
    ).toEqual(['secrets', 'attachments', 'versions', 'media', 'system']);
  });

  it('never lists attachments/versions without secrets', () => {
    expect(
      selectedContentKeys({ includeSecrets: false, includeAttachments: true, includeVersions: true, includeMedia: true }),
    ).toEqual(['media']);
  });

  it('describes the selection for a README', () => {
    expect(
      describeContents({ includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: false }),
    ).toBe('secrets (with attachments)');
    expect(
      describeContents({
        includeSecrets: false,
        includeAttachments: false,
        includeVersions: false,
        includeMedia: true,
        includeSystem: true,
      }),
    ).toBe('media library, system configuration');
  });
});
