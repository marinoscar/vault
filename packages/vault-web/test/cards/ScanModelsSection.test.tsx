/**
 * Vault's scanning models section on the packaged AI page (#88, generalised in #213):
 * two pickers (card, document) listing the models of every enabled provider that
 * declare what scanning needs, each saving its own setting through system settings,
 * read-only without `ai_config:write`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within, mockAdminUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import { AI_CONFIG_COMPATIBLE_KEYLESS } from '../mocks/aiConfig.js';
import {
  ScanModelsSection,
  scanModelCandidates,
} from '../../src/cards/ui/components/ScanModelsSection.js';
import { CardScanModelSection, cardScanCandidates } from '../../src/cards/ui/components/CardScanModelSection.js';
import type { AiModel } from '@marinoscar/platform-web/ai/headless';

const NEEDS = ['responses', 'structured_output', 'vision_input'];

function model(modelId: string, overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: `id-${overrides.provider ?? 'openai'}-${modelId}`,
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

const MODELS = [
  model('vision-model-a'),
  model('vision-model-b', { displayName: 'Model B' }),
  model('local-vision-model', { provider: 'openai-compatible', capabilitySource: 'admin_override' }),
  // Declared by an administrator without image input: not offered.
  model('local-text-model', {
    provider: 'openai-compatible',
    capabilities: { capabilities: ['responses', 'structured_output'], inputModalities: ['text'], outputModalities: ['text'] },
  }),
  // A provider the deployment has not enabled: not offered.
  model('other-vision-model', { provider: 'anthropic' }),
];

let lastModelsQuery: URLSearchParams | null = null;
let patchBodies: unknown[] = [];
let patchIfMatch: string | null = null;
let ai: Record<string, unknown> = {};

function useModels(items: AiModel[]) {
  server.use(
    http.get('*/api/admin/ai/models', ({ request }) => {
      lastModelsQuery = new URL(request.url).searchParams;
      return HttpResponse.json({ data: { items, total: items.length, page: 1, pageSize: 100 } });
    }),
    http.get('*/api/ai/config', () => HttpResponse.json({ data: AI_CONFIG_COMPATIBLE_KEYLESS })),
  );
}

function useSettings(initial: Record<string, unknown>) {
  ai = { enabled: true, ...initial };
  let version = 7;
  const body = () => ({
    data: { ui: { allowUserThemeOverride: true }, features: {}, ai, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: null, version },
  });
  server.use(
    http.get('*/api/system-settings', () => HttpResponse.json(body())),
    http.patch('*/api/system-settings', async ({ request }) => {
      const patch = (await request.json()) as { ai: Record<string, unknown> };
      patchBodies.push(patch);
      patchIfMatch = request.headers.get('If-Match');
      const next = { ...ai };
      for (const [key, value] of Object.entries(patch.ai)) {
        if (value === null) {
          delete next[key];
          if (key === 'documentExtractModel') delete next.documentExtractProvider;
        } else next[key] = value;
      }
      ai = next;
      version += 1;
      return HttpResponse.json(body());
    }),
  );
}

const cardSelect = () => screen.findByRole('combobox', { name: 'Card scanning model' });
const documentSelect = () => screen.findByRole('combobox', { name: 'Document scanning model' });

describe('scanModelCandidates', () => {
  it('keeps enabled, current models with every scan need, once per provider and model id', () => {
    const list = scanModelCandidates([
      model('ok'),
      model('ok'),
      model('ok', { id: 'other', provider: 'openai-compatible' }),
      model('off', { enabled: false }),
      model('old', { deprecatedAt: '2026-09-01T00:00:00.000Z' }),
      model('no-json', { capabilities: { capabilities: ['responses', 'vision_input'], inputModalities: [], outputModalities: [] } }),
      model('unclassified', { capabilities: null }),
    ]);
    expect(list.map((m) => `${m.provider}/${m.modelId}`)).toEqual(['openai/ok', 'openai-compatible/ok']);
  });

  it('keeps only the enabled providers when given', () => {
    const list = scanModelCandidates(MODELS, new Set(['openai-compatible']));
    expect(list.map((m) => m.modelId)).toEqual(['local-vision-model']);
  });

  it('keeps the deprecated aliases working', () => {
    expect(cardScanCandidates([model('ok')]).map((m) => m.modelId)).toEqual(['ok']);
    expect(CardScanModelSection).toBe(ScanModelsSection);
  });
});

describe('ScanModelsSection', () => {
  beforeEach(() => {
    lastModelsQuery = null;
    patchBodies = [];
    patchIfMatch = null;
  });

  it('lists the models of both enabled providers that can scan, with their provider', async () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'vision-model-a' });
    const user = userEvent.setup();
    render(<ScanModelsSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await cardSelect()).toHaveTextContent('vision-model-a · OpenAI');
    expect(lastModelsQuery?.get('enabled')).toBe('true');
    expect(lastModelsQuery?.get('capability')).toBe('vision_input');

    await user.click(await cardSelect());
    const options = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'vision-model-a · OpenAI',
      'Model B (vision-model-b) · OpenAI',
      'local-vision-model · OpenAI-compatible',
    ]);
  });

  it('saves the card model with its provider (If-Match)', async () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'vision-model-a' });
    const user = userEvent.setup();
    render(<ScanModelsSection />, { wrapperOptions: { user: mockAdminUser } });

    const save = await screen.findByRole('button', { name: 'Save card scanning model' });
    expect(save).toBeDisabled();
    await user.click(await cardSelect());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'local-vision-model · OpenAI-compatible' }));
    await user.click(save);

    await waitFor(() =>
      expect(patchBodies).toEqual([
        { ai: { cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' } },
      ]),
    );
    expect(patchIfMatch).toBe('7');
    expect(await screen.findByText('Card scanning model saved')).toBeInTheDocument();
  });

  it('saves the document model, and "Same as card scanning" clears it', async () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'vision-model-a' });
    const user = userEvent.setup();
    render(<ScanModelsSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await documentSelect()).toHaveTextContent('Same as card scanning');
    await user.click(await documentSelect());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'local-vision-model · OpenAI-compatible' }));
    await user.click(screen.getByRole('button', { name: 'Save document scanning model' }));
    await waitFor(() =>
      expect(patchBodies).toEqual([
        { ai: { documentExtractModel: 'local-vision-model', documentExtractProvider: 'openai-compatible' } },
      ]),
    );
    expect(await screen.findByText('Document scanning model saved')).toBeInTheDocument();
    await waitFor(async () => expect(await documentSelect()).toHaveTextContent('local-vision-model · OpenAI-compatible'));

    await user.click(await documentSelect());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Same as card scanning' }));
    await user.click(screen.getByRole('button', { name: 'Save document scanning model' }));
    await waitFor(() => expect(patchBodies[1]).toEqual({ ai: { documentExtractModel: null } }));
    expect(patchIfMatch).toBe('8');
  });

  it('flags a saved model the platform no longer offers', async () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'retired-model' });
    render(<ScanModelsSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByText(/The saved model, retired-model \(OpenAI\), is not an enabled model/)).toBeInTheDocument();
    expect(await cardSelect()).toHaveTextContent('retired-model · OpenAI (not available)');
  });

  it('says so when no enabled model can scan', async () => {
    useModels([]);
    useSettings({ cardExtractModel: 'vision-model-a' });
    render(<ScanModelsSection />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByText(/No enabled model can scan yet/)).toBeInTheDocument();
  });

  it('is read-only without ai_config:write', async () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'vision-model-a' });
    render(<ScanModelsSection />, {
      wrapperOptions: {
        user: { ...mockAdminUser, permissions: ['system_settings:read', 'system_settings:write', 'ai_config:read'] },
      },
    });

    expect(await screen.findByText(/needs ai_config:write/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save card scanning model' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save document scanning model' })).toBeDisabled();
  });

  it('renders nothing without system_settings:read', () => {
    useModels(MODELS);
    useSettings({ cardExtractModel: 'vision-model-a' });
    const { container } = render(<ScanModelsSection />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['ai_config:read'] } },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
