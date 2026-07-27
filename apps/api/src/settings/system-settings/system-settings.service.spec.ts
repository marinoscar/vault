import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SystemSettingsValue,
} from '../../common/types/settings.types';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;
  let mockPrisma: MockPrismaService;
  let mockCrypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;

  const mockUserId = 'user-123';
  const mockUser = {
    id: mockUserId,
    email: 'admin@example.com',
  };

  const mockSystemSettings = {
    id: 'settings-1',
    key: 'global',
    value: DEFAULT_SYSTEM_SETTINGS as any,
    version: 1,
    updatedAt: new Date(),
    updatedByUserId: mockUserId,
    updatedByUser: mockUser,
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockCrypto = {
      encrypt: jest.fn().mockReturnValue({
        ciphertext: 'mock-ciphertext',
        iv: 'mock-iv',
        authTag: 'mock-auth-tag',
      }),
      decrypt: jest.fn().mockReturnValue('sk-decrypted-key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<SystemSettingsService>(SystemSettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSettings', () => {
    it('should return current system settings with version', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        mockSystemSettings as any,
      );

      const result = await service.getSettings();

      expect(result).toMatchObject({
        ui: DEFAULT_SYSTEM_SETTINGS.ui,
        features: DEFAULT_SYSTEM_SETTINGS.features,
        version: 1,
      });
      expect(result.updatedAt).toBeDefined();
      expect(result.updatedBy).toEqual(mockUser);
      expect(mockPrisma.systemSettings.findUnique).toHaveBeenCalledWith({
        where: { key: 'global' },
        include: {
          updatedByUser: {
            select: { id: true, email: true },
          },
        },
      });
    });

    it('should create and return default settings when none exist', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(null);
      mockPrisma.systemSettings.create.mockResolvedValue({
        ...mockSystemSettings,
        updatedByUserId: null,
        updatedByUser: null,
      } as any);

      const result = await service.getSettings();

      expect(result).toMatchObject({
        ui: DEFAULT_SYSTEM_SETTINGS.ui,
        features: DEFAULT_SYSTEM_SETTINGS.features,
        version: 1,
      });
      expect(mockPrisma.systemSettings.create).toHaveBeenCalledWith({
        data: {
          key: 'global',
          value: DEFAULT_SYSTEM_SETTINGS as any,
        },
        include: {
          updatedByUser: {
            select: { id: true, email: true },
          },
        },
      });
    });
  });

  describe('replaceSettings (PUT)', () => {
    // replaceSettings now reads the current row before writing, so it can carry
    // the encrypted `ai` block across a PUT. Without this, Zod would strip the
    // unknown key and silently destroy the stored API key.
    beforeEach(() => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        mockSystemSettings as any,
      );
    });

    it('should replace entire settings', async () => {
      const newSettings: SystemSettingsValue = {
        ui: { allowUserThemeOverride: false },
        features: { newFeature: true },
      };

      mockPrisma.systemSettings.upsert.mockResolvedValue({
        ...mockSystemSettings,
        value: newSettings as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.replaceSettings(newSettings, mockUserId);

      expect(result).toMatchObject({
        ui: newSettings.ui,
        features: newSettings.features,
        version: 2,
      });
      // The persisted value carries the stored `ai` block through untouched --
      // a PUT must never be able to drop the encrypted API key.
      const persisted = {
        ...newSettings,
        ai: (mockSystemSettings.value as any).ai,
      };

      expect(mockPrisma.systemSettings.upsert).toHaveBeenCalledWith({
        where: { key: 'global' },
        update: {
          value: persisted as any,
          updatedByUserId: mockUserId,
          version: { increment: 1 },
        },
        create: {
          key: 'global',
          value: persisted as any,
          updatedByUserId: mockUserId,
        },
        include: {
          updatedByUser: {
            select: { id: true, email: true },
          },
        },
      });
    });

    it('should increment version on update', async () => {
      const newSettings: SystemSettingsValue = {
        ui: { allowUserThemeOverride: true },
        features: {},
      };

      mockPrisma.systemSettings.upsert.mockResolvedValue({
        ...mockSystemSettings,
        value: newSettings as any,
        version: 5,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.replaceSettings(newSettings, mockUserId);

      expect(result.version).toBe(5);
      expect(mockPrisma.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            version: { increment: 1 },
          }),
        }),
      );
    });

    it('should create audit event on replace', async () => {
      const newSettings: SystemSettingsValue = {
        ui: { allowUserThemeOverride: false },
        features: {},
      };

      mockPrisma.systemSettings.upsert.mockResolvedValue({
        ...mockSystemSettings,
        value: newSettings as any,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.replaceSettings(newSettings, mockUserId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actorUserId: mockUserId,
          action: 'system_settings:replace',
          targetType: 'system_settings',
          targetId: mockSystemSettings.id,
          meta: {
            newValue: {
              ...newSettings,
              // Redacted: the audit trail records that a key exists and whether
              // it changed, never the key itself or its ciphertext.
              ai: {
                enabled: false,
                model: 'gpt-4o-mini',
                maxCallsPerUserPerDay: 50,
                apiKeyChanged: false,
                apiKeyLast4: null,
              },
            },
          } as any,
        },
      });
    });

    it('should never write key material into the audit trail', async () => {
      const plaintextKey = 'sk-test-abcdefghijklmnopqrstuvwxyz';

      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ...(mockSystemSettings.value as any),
          ai: {
            enabled: true,
            provider: 'openai',
            model: 'gpt-4o-mini',
            maxCallsPerUserPerDay: 50,
            apiKey: {
              ciphertext: 'super-secret-ciphertext',
              iv: 'iv',
              authTag: 'tag',
              last4: 'wxyz',
              updatedAt: new Date().toISOString(),
            },
          },
        },
      } as any);

      mockPrisma.systemSettings.upsert.mockResolvedValue(
        mockSystemSettings as any,
      );
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.replaceSettings(
        { ui: { allowUserThemeOverride: false }, features: {} },
        mockUserId,
      );

      const auditArg = JSON.stringify(
        mockPrisma.auditEvent.create.mock.calls[0][0],
      );
      expect(auditArg).not.toContain(plaintextKey);
      expect(auditArg).not.toContain('super-secret-ciphertext');
      expect(auditArg).not.toContain('authTag');
    });
  });

  describe('patchSettings (PATCH)', () => {
    beforeEach(() => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        mockSystemSettings as any,
      );
    });

    it('should merge partial settings with existing settings', async () => {
      const partialUpdate = {
        ui: { allowUserThemeOverride: false },
      };

      mockPrisma.systemSettings.update.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ui: { allowUserThemeOverride: false },
          features: DEFAULT_SYSTEM_SETTINGS.features,
        } as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.patchSettings(partialUpdate, mockUserId);

      expect(result.ui.allowUserThemeOverride).toBe(false);
      expect(result.features).toEqual(DEFAULT_SYSTEM_SETTINGS.features);
    });

    it('should handle features object merge', async () => {
      const existingWithFeatures = {
        ...mockSystemSettings,
        value: {
          ...DEFAULT_SYSTEM_SETTINGS,
          features: { existingFeature: true },
        } as any,
      };

      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        existingWithFeatures as any,
      );

      const partialUpdate = {
        features: { newFeature: true },
      };

      mockPrisma.systemSettings.update.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ui: DEFAULT_SYSTEM_SETTINGS.ui,
          features: { existingFeature: true, newFeature: true },
        } as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.patchSettings(partialUpdate, mockUserId);

      expect(result.features).toEqual({
        existingFeature: true,
        newFeature: true,
      });
    });

    it('should throw ConflictException when If-Match version mismatch', async () => {
      const partialUpdate = {
        ui: { allowUserThemeOverride: false },
      };

      // Current version is 1, but expected version is 2
      await expect(
        service.patchSettings(partialUpdate, mockUserId, 2),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.patchSettings(partialUpdate, mockUserId, 2),
      ).rejects.toThrow(
        'Settings version mismatch. Expected 2, found 1',
      );

      // Should not call update when version mismatch
      expect(mockPrisma.systemSettings.update).not.toHaveBeenCalled();
    });

    it('should succeed when If-Match version matches', async () => {
      const partialUpdate = {
        ui: { allowUserThemeOverride: false },
      };

      mockPrisma.systemSettings.update.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ui: { allowUserThemeOverride: false },
          features: DEFAULT_SYSTEM_SETTINGS.features,
        } as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      // Current version is 1, expected version is 1
      const result = await service.patchSettings(
        partialUpdate,
        mockUserId,
        1,
      );

      expect(result).toBeDefined();
      expect(result.version).toBe(2);
      expect(mockPrisma.systemSettings.update).toHaveBeenCalled();
    });

    it('should increment version on patch', async () => {
      const partialUpdate = {
        ui: { allowUserThemeOverride: false },
      };

      mockPrisma.systemSettings.update.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ui: { allowUserThemeOverride: false },
          features: DEFAULT_SYSTEM_SETTINGS.features,
        } as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.patchSettings(partialUpdate, mockUserId);

      expect(result.version).toBe(2);
      expect(mockPrisma.systemSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        }),
      );
    });

    it('should create audit event on patch', async () => {
      const partialUpdate = {
        ui: { allowUserThemeOverride: false },
      };

      mockPrisma.systemSettings.update.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ui: { allowUserThemeOverride: false },
          features: DEFAULT_SYSTEM_SETTINGS.features,
        } as any,
        version: 2,
      } as any);

      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.patchSettings(partialUpdate, mockUserId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actorUserId: mockUserId,
          action: 'system_settings:patch',
          targetType: 'system_settings',
          targetId: mockSystemSettings.id,
          meta: expect.objectContaining({
            changes: partialUpdate,
            resultingValue: expect.any(Object),
          }) as any,
        },
      });
    });
  });

  describe('getSettingValue', () => {
    beforeEach(() => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        mockSystemSettings as any,
      );
    });

    it('should get nested setting value by path', async () => {
      const value = await service.getSettingValue<boolean>(
        'ui.allowUserThemeOverride',
      );

      expect(value).toBe(DEFAULT_SYSTEM_SETTINGS.ui.allowUserThemeOverride);
    });

    it('should return undefined for non-existent path', async () => {
      const value = await service.getSettingValue<any>('ui.nonExistent');

      expect(value).toBeUndefined();
    });
  });

  describe('isFeatureEnabled', () => {
    beforeEach(() => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        ...mockSystemSettings,
        value: {
          ...DEFAULT_SYSTEM_SETTINGS,
          features: { featureA: true, featureB: false },
        } as any,
      } as any);
    });

    it('should return true for enabled feature', async () => {
      const result = await service.isFeatureEnabled('featureA');

      expect(result).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const result = await service.isFeatureEnabled('featureB');

      expect(result).toBe(false);
    });

    it('should return false for non-existent feature', async () => {
      const result = await service.isFeatureEnabled('featureC');

      expect(result).toBe(false);
    });
  });
});
