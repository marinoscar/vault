/**
 * Vault's `Card scanning model` section on the packaged AI page (E8.2, #88):
 * lists the models the platform offers (enabled, image-capable), PATCHes
 * `ai.cardExtractModel` through system settings, and is read-only without
 * `system_settings:write`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within, mockAdminUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import {
  CardScanModelSection,
  cardScanCandidates,
} from '../../src/cards/ui/components/CardScanModelSection.js';
import type { AiModel } from '@marinoscar/platform-web/ai/headless';

const NEEDS = ['responses', 'structured_output', 'vision_input'];

function model(modelId: string, overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: `id-${modelId}`,
    provider: 'openai',
    modelId,
    displayName: null,
    capabilities: { capabilities: NEEDS, inputModalities: ['text', 'image'], outputModalities: ['text'] },
    capabilitySource: 'catalog',
    enabled: true,
    contextWindow: null,
    maxOutputTokens: null,
    discoveredAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-01T00:00:00.000Z',
    deprecatedAt: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    updatedByUserId: null,
    ...overrides,
  };
}

const MODELS = [model('vision-model-a'), model('vision-model-b', { displayName: 'Model B' })];

let lastModelsQuery: URLSearchParams | null = null;
let patchBody: unknown = null;
let patchIfMatch: string | null = null;

function useModels(items: AiModel[]) {
  server.use(
    http.get('*/api/admin/ai/models', ({ request }) => {
      lastModelsQuery = new URL(request.url).searchParams;
      return HttpResponse.json({ data: { items, total: items.length, page: 1, pageSize: 100 } });
    }),
  );
}

function useSettings(cardExtractModel: string) {
  server.use(
    http.get('*/api/system-settings', () =>
      HttpResponse.json({
        data: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: { enabled: true, cardExtractModel },
          updatedAt: '2026-10-01T00:00:00.000Z',
          updatedBy: null,
          version: 7,
        },
      }),
    ),
    http.patch('*/api/system-settings', async ({ request }) => {
      patchBody = await request.json();
      patchIfMatch = request.headers.get('If-Match');
      const next = (patchBody as { ai: { cardExtractModel: string } }).ai.cardExtractModel;
      return HttpResponse.json({
        data: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: { enabled: true, cardExtractModel: next },
          updatedAt: '2026-10-02T00:00:00.000Z',
          updatedBy: null,
          version: 8,
        },
      });
    }),
  );
}

describe('cardScanCandidates', () => {
  it('keeps enabled, non-deprecated models that have every capability card_extract needs, once per model id', () => {
    const list = cardScanCandidates([
      model('ok'),
      model('ok', { id: 'dup', provider: 'other' }),
      model('off', { enabled: false }),
      model('old', { deprecatedAt: '2026-09-01T00:00:00.000Z' }),
      model('no-json', { capabilities: { capabilities: ['responses', 'vision_input'], inputModalities: [], outputModalities: [] } }),
      model('unclassified', { capabilities: null }),
    ]);
    expect(list.map((m) => m.modelId)).toEqual(['ok']);
  });
});

describe('CardScanModelSection', () => {
  beforeEach(() => {
    lastModelsQuery = null;
    patchBody = null;
    patchIfMatch = null;
  });

  it('asks the platform for enabled, image-capable models and shows the saved one', async () => {
    useModels(MODELS);
    useSettings('vision-model-a');
    render(<CardScanModelSection />, { wrapperOptions: { user: mockAdminUser } });

    const select = await screen.findByRole('combobox', { name: 'Model' });
    expect(select).toHaveTextContent('vision-model-a');
    expect(lastModelsQuery?.get('enabled')).toBe('true');
    expect(lastModelsQuery?.get('capability')).toBe('vision_input');
  });

  it('PATCHes ai.cardExtractModel with If-Match and confirms', async () => {
    useModels(MODELS);
    useSettings('vision-model-a');
    const user = userEvent.setup();
    render(<CardScanModelSection />, { wrapperOptions: { user: mockAdminUser } });

    const save = await screen.findByRole('button', { name: 'Save model' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Model B (vision-model-b)' }));
    await user.click(save);

    await waitFor(() => expect(patchBody).toEqual({ ai: { cardExtractModel: 'vision-model-b' } }));
    expect(patchIfMatch).toBe('7');
    expect(await screen.findByText('Card scanning model saved')).toBeInTheDocument();
  });

  it('flags a saved model the platform no longer offers', async () => {
    useModels(MODELS);
    useSettings('retired-model');
    render(<CardScanModelSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByText(/The saved model, retired-model, is not an enabled model/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('retired-model (not available)');
  });

  it('says so when no enabled model accepts images', async () => {
    useModels([]);
    useSettings('vision-model-a');
    render(<CardScanModelSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByText(/No enabled model accepts images yet/)).toBeInTheDocument();
  });

  it('is read-only without system_settings:write', async () => {
    useModels(MODELS);
    useSettings('vision-model-a');
    render(<CardScanModelSection />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['system_settings:read', 'ai_config:read'] } },
    });

    expect(await screen.findByText(/needs system_settings:write/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save model' })).toBeDisabled();
  });

  it('renders nothing without system_settings:read', () => {
    useModels(MODELS);
    useSettings('vision-model-a');
    const { container } = render(<CardScanModelSection />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['ai_config:read'] } },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
