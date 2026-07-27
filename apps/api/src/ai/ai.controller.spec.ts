import { AiConfigService } from './ai-config.service';
import { AiController } from './ai.controller';

// Constructed directly rather than through Test.createTestingModule: the
// @Auth() decorator pulls in the whole JwtAuthGuard dependency graph, which
// says nothing about the behaviour under test here.
describe('AiController', () => {
  let controller: AiController;
  let aiConfig: jest.Mocked<Pick<AiConfigService, 'isReady'>>;

  beforeEach(() => {
    aiConfig = { isReady: jest.fn() } as any;
    controller = new AiController(aiConfig as unknown as AiConfigService);
  });

  it('reports the feature as available when it is ready', async () => {
    aiConfig.isReady.mockResolvedValue(true);

    await expect(controller.status()).resolves.toEqual({
      data: { enabled: true, features: { cardExtract: true } },
    });
  });

  it('reports unavailable when disabled, unconfigured or undecryptable', async () => {
    aiConfig.isReady.mockResolvedValue(false);

    await expect(controller.status()).resolves.toEqual({
      data: { enabled: false, features: { cardExtract: false } },
    });
  });

  it('leaks no model name or key metadata to the caller', async () => {
    aiConfig.isReady.mockResolvedValue(true);

    const response = await controller.status();
    const body = JSON.stringify(response);

    for (const forbidden of [
      'model',
      'gpt',
      'apiKey',
      'last4',
      'provider',
      'maxCalls',
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(response.data).sort()).toEqual(['enabled', 'features']);
  });
});
