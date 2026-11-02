import { BadRequestException } from '@nestjs/common';

import { BACKUP_CONTENT_MESSAGES } from '../export/backup-contents';
import { parseExportSecretsBody } from './export-secrets.dto';

const PASSWORD = 'sunshine-6';

function errorOf(body: unknown): { message: string; details: Array<{ field: string; message: string }> } {
  try {
    parseExportSecretsBody(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as never;
  }
  throw new Error('expected a 400');
}

describe('parseExportSecretsBody content selection', () => {
  it('defaults to secrets with attachments, no versions, no media', () => {
    expect(parseExportSecretsBody({ password: PASSWORD })).toEqual({
      password: PASSWORD,
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
    });
  });

  it('keeps the legacy includeAttachments / includeVersions fields working', () => {
    expect(
      parseExportSecretsBody({ password: PASSWORD, includeAttachments: false, includeVersions: true }),
    ).toMatchObject({ includeSecrets: true, includeAttachments: false, includeVersions: true });
  });

  it('accepts media only, with attachments resolved off', () => {
    expect(parseExportSecretsBody({ password: PASSWORD, includeSecrets: false, includeMedia: true })).toEqual({
      password: PASSWORD,
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  it('400 "Choose at least one thing to back up" when nothing is selected', () => {
    const response = errorOf({ password: PASSWORD, includeSecrets: false });
    expect(response.message).toBe(BACKUP_CONTENT_MESSAGES.nothingSelected);
    expect(response.message).toBe('Choose at least one thing to back up');
  });

  it('400 for attachments or versions requested without secrets', () => {
    expect(
      errorOf({ password: PASSWORD, includeSecrets: false, includeMedia: true, includeAttachments: true }).message,
    ).toBe(BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets);
    expect(
      errorOf({ password: PASSWORD, includeSecrets: false, includeMedia: true, includeVersions: true }).details[0],
    ).toEqual({ field: 'includeVersions', message: BACKUP_CONTENT_MESSAGES.versionsWithoutSecrets });
  });

  it.each([true, false])('400 when includeSystem (%p) is sent at all', (includeSystem) => {
    const response = errorOf({ password: PASSWORD, includeSystem });
    expect(response.message).toBe(BACKUP_CONTENT_MESSAGES.systemNotOffered);
    expect(response.details[0].field).toBe('includeSystem');
  });

  it.each(['includeSecrets', 'includeMedia'])('400 for a non-boolean %s', (field) => {
    expect(errorOf({ password: PASSWORD, [field]: 'yes' }).message).toBe(`${field} must be a boolean`);
  });

  it('reports the password error first and never echoes it', () => {
    const response = errorOf({ password: 'abc', includeSecrets: false });
    expect(response.message).toMatch(/at least 6/);
    expect(JSON.stringify(response)).not.toContain('"abc"');
  });
});
