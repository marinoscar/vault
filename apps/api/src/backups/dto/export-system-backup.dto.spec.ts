import { BadRequestException } from '@nestjs/common';

import { BACKUP_CONTENT_MESSAGES } from '../../secrets/export/backup-contents';
import { EXPORT_PASSWORD_CHOICE_MESSAGES, parseExportSystemBackupBody } from './export-system-backup.dto';

const contents = {
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: true,
};

function messageOf(body: unknown): string {
  try {
    parseExportSystemBackupBody(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string }).message;
  }
  throw new Error('expected a 400');
}

describe('parseExportSystemBackupBody', () => {
  it('accepts a password', () => {
    expect(parseExportSystemBackupBody({ ...contents, password: 'secret1' })).toEqual({
      password: 'secret1',
      useScheduledPassword: false,
      selection: contents,
    });
  });

  it('accepts useScheduledPassword: true without a password', () => {
    expect(parseExportSystemBackupBody({ ...contents, useScheduledPassword: true })).toMatchObject({
      password: null,
      useScheduledPassword: true,
    });
  });

  it('accepts a password with useScheduledPassword: false', () => {
    expect(parseExportSystemBackupBody({ ...contents, password: 'secret1', useScheduledPassword: false }).password).toBe(
      'secret1',
    );
  });

  it('400 when neither password source is given', () => {
    expect(messageOf({ ...contents })).toBe(EXPORT_PASSWORD_CHOICE_MESSAGES.missing);
    expect(messageOf({ ...contents, useScheduledPassword: false })).toBe(EXPORT_PASSWORD_CHOICE_MESSAGES.missing);
  });

  it('400 when both are given', () => {
    expect(messageOf({ ...contents, password: 'secret1', useScheduledPassword: true })).toBe(
      EXPORT_PASSWORD_CHOICE_MESSAGES.both,
    );
  });

  it('applies the password length rules and never echoes the value', () => {
    expect(messageOf({ ...contents, password: 'abc12' })).toMatch(/at least 6/);
    expect(messageOf({ ...contents, password: 'x'.repeat(257) })).toMatch(/at most 256/);
    let response: unknown;
    try {
      parseExportSystemBackupBody({ ...contents, password: 'zq9' });
    } catch (e) {
      response = (e as BadRequestException).getResponse();
    }
    expect(JSON.stringify(response)).not.toContain('zq9');
  });

  it('applies the content rules (system level)', () => {
    expect(
      messageOf({ password: 'secret1', includeSecrets: false, includeAttachments: false, includeMedia: false, includeSystem: false }),
    ).toBe(BACKUP_CONTENT_MESSAGES.nothingSelected);
    expect(messageOf({ password: 'secret1', includeSecrets: false, includeSystem: true, includeAttachments: true })).toBe(
      BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets,
    );
    expect(
      parseExportSystemBackupBody({ password: 'secret1', includeSecrets: false, includeAttachments: false, includeSystem: true })
        .selection,
    ).toEqual({ includeSecrets: false, includeAttachments: false, includeVersions: false, includeMedia: false, includeSystem: true });
  });

  it('rejects non-boolean flags and a non-object body', () => {
    expect(messageOf({ ...contents, password: 'secret1', useScheduledPassword: 'yes' })).toBe(
      'useScheduledPassword must be a boolean',
    );
    expect(() => parseExportSystemBackupBody(undefined)).toThrow(BadRequestException);
  });
});
