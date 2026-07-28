import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render, mockAdminUser } from '../../utils/test-utils';
import { AiSettings } from '../../../components/settings/AiSettings';

const API_BASE = '*/api';

const VALID_KEY = 'sk-test-0123456789abcdef';

type AiBlock = {
  enabled: boolean;
  provider: 'openai';
  model: string;
  maxCallsPerUserPerDay: number;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  apiKeyUpdatedAt: string | null;
};

const configuredAi: AiBlock = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
  apiKeyConfigured: true,
  apiKeyLast4: 'cdef',
  apiKeyUpdatedAt: '2026-03-04T10:00:00.000Z',
};

const unconfiguredAi: AiBlock = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
  apiKeyConfigured: false,
  apiKeyLast4: null,
  apiKeyUpdatedAt: null,
};

function settingsWith(ai: AiBlock | null) {
  return {
    ui: { allowUserThemeOverride: true },
    features: {},
    ai,
    updatedAt: '2026-03-04T10:00:00.000Z',
    updatedBy: null,
    version: 7,
  };
}

/** Serve GET /system-settings with the given ai block. */
function mockGet(ai: AiBlock | null) {
  server.use(
    http.get(`${API_BASE}/system-settings`, () =>
      HttpResponse.json({ data: settingsWith(ai) }),
    ),
  );
}

/**
 * Serve PATCH /system-settings and record what the UI actually put on the
 * wire. The recorded body is the subject of most assertions in this file -
 * the whole point of the AI settings UI is that it sends the right shape.
 */
function capturePatch(responseAi: AiBlock | null = configuredAi) {
  const calls: { body: any; ifMatch: string | null }[] = [];

  server.use(
    http.patch(`${API_BASE}/system-settings`, async ({ request }) => {
      calls.push({
        body: await request.json(),
        ifMatch: request.headers.get('If-Match'),
      });
      return HttpResponse.json({
        data: { ...settingsWith(responseAi), version: 8 },
      });
    }),
  );

  return calls;
}

const adminOptions = { wrapperOptions: { user: mockAdminUser } };

/** Wait past the loading spinner. */
async function renderLoaded(ui = <AiSettings />) {
  const result = render(ui, adminOptions);
  await screen.findByText('AI Card Recognition');
  return result;
}

describe('AiSettings', () => {
  beforeEach(() => {
    mockGet(configuredAi);
  });

  describe('Data egress disclosure', () => {
    it('warns that enabling sends card images to OpenAI', async () => {
      await renderLoaded();

      expect(
        screen.getByText(/this sends card images to openai/i),
      ).toBeInTheDocument();
    });

    it('states the warning applies to every user of the instance', async () => {
      await renderLoaded();

      expect(
        screen.getByText(/every user of this instance/i),
      ).toBeInTheDocument();
    });

    it('states the feature is off by default', async () => {
      await renderLoaded();

      expect(screen.getByText(/off by\s*default/i)).toBeInTheDocument();
    });
  });

  describe('Key state display', () => {
    it('shows the masked key and update date when configured', async () => {
      await renderLoaded();

      const mask = screen.getByTestId('ai-api-key-mask');
      expect(mask).toHaveTextContent('cdef');
      expect(mask.textContent).toContain('••••');
    });

    it('never renders anything resembling a full key', async () => {
      await renderLoaded();

      // The API only ever sends the last 4; assert we are not inventing more.
      expect(screen.queryByText(/sk-/)).not.toBeInTheDocument();
    });

    it('shows the update date when configured', async () => {
      await renderLoaded();

      expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    });

    it('says plainly when no key is configured', async () => {
      mockGet(unconfiguredAi);
      await renderLoaded();

      expect(
        screen.getByText(/no api key is configured/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('ai-api-key-mask')).not.toBeInTheDocument();
    });

    it('treats a null ai block as unconfigured rather than crashing', async () => {
      mockGet(null);
      await renderLoaded();

      expect(
        screen.getByText(/no api key is configured/i),
      ).toBeInTheDocument();
    });

    it('labels the key field "Set API key" when there is no key', async () => {
      mockGet(unconfiguredAi);
      await renderLoaded();

      expect(screen.getByLabelText(/set api key/i)).toBeInTheDocument();
    });

    it('labels the key field "Replace API key" when a key exists', async () => {
      await renderLoaded();

      expect(screen.getByLabelText(/replace api key/i)).toBeInTheDocument();
    });

    it('masks the key input by default', async () => {
      await renderLoaded();

      expect(screen.getByLabelText(/replace api key/i)).toHaveAttribute(
        'type',
        'password',
      );
    });
  });

  describe('Setting a key', () => {
    it('sends the entered key as apiKey, and not null', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      const calls = capturePatch();
      await renderLoaded();

      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai.apiKey).toBe(VALID_KEY);
      expect(calls[0].body.ai.apiKey).not.toBeNull();
    });

    it('sends only apiKey, without dragging along unrelated fields', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      const calls = capturePatch();
      await renderLoaded();

      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(Object.keys(calls[0].body.ai)).toEqual(['apiKey']);
    });

    it('sends the If-Match version for optimistic concurrency', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      const calls = capturePatch();
      await renderLoaded();

      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].ifMatch).toBe('7');
    });

    it('clears the plaintext field after a successful save', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      capturePatch();
      await renderLoaded();

      const field = screen.getByLabelText(/set api key/i);
      await user.type(field, VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      await waitFor(() => expect(field).toHaveValue(''));
    });

    it('disables the save button until a plausible key is entered', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      await renderLoaded();

      const saveKey = screen.getByRole('button', { name: /save key/i });
      expect(saveKey).toBeDisabled();

      await user.type(screen.getByLabelText(/set api key/i), 'too-short');
      expect(saveKey).toBeDisabled();

      await user.clear(screen.getByLabelText(/set api key/i));
      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      expect(saveKey).not.toBeDisabled();
    });

    it('surfaces a save failure instead of silently swallowing it', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      server.use(
        http.patch(`${API_BASE}/system-settings`, () =>
          HttpResponse.json(
            { message: 'Encryption key unavailable' },
            { status: 503 },
          ),
        ),
      );
      await renderLoaded();

      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      expect(
        await screen.findByText(/encryption key unavailable/i),
      ).toBeInTheDocument();
    });

    it('reports a 409 as a friendly "updated elsewhere" message', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      server.use(
        http.patch(`${API_BASE}/system-settings`, () =>
          HttpResponse.json({ message: 'Conflict' }, { status: 409 }),
        ),
      );
      await renderLoaded();

      await user.type(screen.getByLabelText(/set api key/i), VALID_KEY);
      await user.click(screen.getByRole('button', { name: /save key/i }));

      expect(
        await screen.findByText(/updated elsewhere/i),
      ).toBeInTheDocument();
    });
  });

  describe('Saving unrelated fields', () => {
    // The most important guarantee in this component: editing anything other
    // than the credential must leave `apiKey` off the wire entirely. Sending
    // `apiKey: null` here would clear a working key for the whole instance.
    it('omits apiKey entirely when toggling enabled', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      await user.click(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      );
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai).not.toHaveProperty('apiKey');
      expect(JSON.stringify(calls[0].body)).not.toContain('apiKey');
    });

    it('omits apiKey when changing the model', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      const modelField = screen.getByLabelText(/^model$/i);
      await user.clear(modelField);
      await user.type(modelField, 'gpt-4o');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai).not.toHaveProperty('apiKey');
      expect(calls[0].body.ai.model).toBe('gpt-4o');
    });

    it('omits apiKey when changing the daily call cap', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      const capField = screen.getByLabelText(/max calls per user per day/i);
      await user.clear(capField);
      await user.type(capField, '250');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai).not.toHaveProperty('apiKey');
      expect(calls[0].body.ai.maxCallsPerUserPerDay).toBe(250);
    });

    it('omits apiKey even when the admin typed a key but did not save it', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      // Key typed into the field but "Replace key" never pressed.
      await user.type(screen.getByLabelText(/replace api key/i), VALID_KEY);

      await user.click(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      );
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai).not.toHaveProperty('apiKey');
    });

    it('sends the toggled enabled value', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      await user.click(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      );
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.ai.enabled).toBe(true);
    });

    it('disables the save button until something changes', async () => {
      const user = userEvent.setup();
      await renderLoaded();

      const save = screen.getByRole('button', { name: /save changes/i });
      expect(save).toBeDisabled();

      await user.click(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      );
      expect(save).not.toBeDisabled();
    });

    it('blocks saving an out-of-range call cap', async () => {
      const user = userEvent.setup();
      await renderLoaded();

      const capField = screen.getByLabelText(/max calls per user per day/i);
      await user.clear(capField);
      await user.type(capField, '99999');

      expect(
        screen.getByRole('button', { name: /save changes/i }),
      ).toBeDisabled();
    });
  });

  describe('Removing the key', () => {
    it('asks for confirmation before removing', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: /remove key/i }));

      expect(
        screen.getByRole('dialog', { name: /remove the openai api key/i }),
      ).toBeInTheDocument();
      expect(calls).toHaveLength(0);
    });

    it('sends an explicit null apiKey once confirmed', async () => {
      const user = userEvent.setup();
      const calls = capturePatch(unconfiguredAi);
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: /remove key/i }));

      const dialog = screen.getByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: /remove key/i }),
      );

      await waitFor(() => expect(calls).toHaveLength(1));

      expect(calls[0].body.ai).toHaveProperty('apiKey');
      expect(calls[0].body.ai.apiKey).toBeNull();
    });

    it('also turns the feature off so it is never enabled without a key', async () => {
      const user = userEvent.setup();
      const calls = capturePatch(unconfiguredAi);
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: /remove key/i }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: /remove key/i,
        }),
      );

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.ai.enabled).toBe(false);
    });

    it('sends nothing when the confirmation is cancelled', async () => {
      const user = userEvent.setup();
      const calls = capturePatch();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: /remove key/i }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: /cancel/i,
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(calls).toHaveLength(0);
    });

    it('offers no remove action when there is no key to remove', async () => {
      mockGet(unconfiguredAi);
      await renderLoaded();

      expect(
        screen.queryByRole('button', { name: /remove key/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Enable toggle gating', () => {
    it('is disabled when no key is configured', async () => {
      mockGet(unconfiguredAi);
      await renderLoaded();

      expect(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      ).toBeDisabled();
    });

    it('is enabled once a key is configured', async () => {
      await renderLoaded();

      expect(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      ).not.toBeDisabled();
    });

    it('explains via tooltip why it is disabled without a key', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      await renderLoaded();

      // Hover the wrapper, since disabled controls swallow pointer events.
      await user.hover(screen.getByTestId('ai-enable-toggle-wrapper'));

      expect(
        await screen.findByText(/enabling this without a key does nothing/i),
      ).toBeInTheDocument();
    });

    it('reflects the stored enabled value', async () => {
      mockGet({ ...configuredAi, enabled: true });
      await renderLoaded();

      expect(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      ).toBeChecked();
    });
  });

  describe('Test connection', () => {
    const VERIFY_PATH = `${API_BASE}/system-settings/ai/verify`;

    /**
     * Serve POST /system-settings/ai/verify and count invocations.
     *
     * The count is the point of several tests below: the endpoint makes a
     * real, paid call upstream, so anything that fires it without a click is
     * a bug that bills the operator on every render.
     */
    function mockVerify(body: unknown, init?: { status?: number }) {
      const state = { count: 0 };

      server.use(
        http.post(VERIFY_PATH, () => {
          state.count += 1;
          return HttpResponse.json({ data: body }, init);
        }),
      );

      return state;
    }

    const okBody = {
      ok: true,
      model: 'gpt-4o-mini',
      imageSupport: true,
      durationMs: 1234,
      adaptedParameters: [],
    };

    /** Failure body in the shape the API actually sends. */
    function failureBody(reason: string, message: string, model = 'gpt-4o-mini') {
      return {
        ok: false,
        reason,
        message,
        model,
        durationMs: 210,
        adaptedParameters: [],
      };
    }

    it('confirms the key works AND that the model accepts images', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      const alert = await screen.findByTestId('ai-verify-result');
      expect(alert).toHaveTextContent(/connection works/i);
      // Both halves must be confirmed - a working key against a text-only
      // model is still a broken card import.
      expect(alert).toHaveTextContent(/accepted an image/i);
    });

    it('names the model that was tested on success', async () => {
      const user = userEvent.setup();
      mockVerify({ ...okBody, model: 'gpt-4o' });
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(await screen.findByTestId('ai-verify-result')).toHaveTextContent(
        'gpt-4o',
      );
    });

    // Each reason sends an admin somewhere different - the provider dashboard,
    // the model field, the billing page - so each must read differently.
    const failureCases = [
      { reason: 'invalid_key', expected: /api key was rejected/i },
      { reason: 'model_not_found', expected: /model not found/i },
      { reason: 'model_no_image_support', expected: /does not accept images/i },
      {
        reason: 'model_no_structured_output',
        expected: /does not support structured output/i,
      },
      { reason: 'quota', expected: /quota or rate limits/i },
      { reason: 'network', expected: /could not reach openai/i },
      { reason: 'unknown', expected: /connection test failed/i },
    ] as const;

    for (const { reason, expected } of failureCases) {
      it(`renders its own message for ${reason}`, async () => {
        const user = userEvent.setup();
        mockVerify(failureBody(reason, `server detail for ${reason}`));
        await renderLoaded();

        await user.click(
          screen.getByRole('button', { name: /test connection/i }),
        );

        const alert = await screen.findByTestId('ai-verify-result');
        expect(alert).toHaveTextContent(expected);
        expect(alert).not.toHaveTextContent(/connection works/i);
      });
    }

    it('names the offending model when the model is not found', async () => {
      const user = userEvent.setup();
      mockVerify(
        failureBody(
          'model_not_found',
          'The provider does not recognise this model name',
          'gpt-4o-minii',
        ),
      );
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(await screen.findByTestId('ai-verify-result')).toHaveTextContent(
        'gpt-4o-minii',
      );
    });

    it('falls back to the stored model name when none is echoed back', async () => {
      const user = userEvent.setup();
      mockVerify({ ok: false, reason: 'model_no_image_support', message: '' });
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(await screen.findByTestId('ai-verify-result')).toHaveTextContent(
        'gpt-4o-mini',
      );
    });

    it('warns when the model made the API drop request parameters', async () => {
      const user = userEvent.setup();
      mockVerify({ ...okBody, adaptedParameters: ['temperature'] });
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(
        await screen.findByTestId('ai-verify-adapted-parameters'),
      ).toHaveTextContent(/temperature/);
    });

    it('says nothing about parameters when none were dropped', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await screen.findByTestId('ai-verify-result');

      expect(
        screen.queryByTestId('ai-verify-adapted-parameters'),
      ).not.toBeInTheDocument();
    });

    it('surfaces the server message rather than swallowing it', async () => {
      const user = userEvent.setup();
      mockVerify(failureBody('invalid_key', 'The provider rejected the stored API key'));
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(
        await screen.findByTestId('ai-verify-server-message'),
      ).toHaveTextContent(/provider rejected the stored api key/i);
    });

    it('treats an unreachable API as a network problem, not a bad key', async () => {
      const user = userEvent.setup();
      server.use(http.post(VERIFY_PATH, () => HttpResponse.error()));
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      const alert = await screen.findByTestId('ai-verify-result');
      expect(alert).toHaveTextContent(/could not reach openai/i);
      expect(alert).not.toHaveTextContent(/api key was rejected/i);
    });

    it('does not silently swallow a 5xx from the endpoint', async () => {
      const user = userEvent.setup();
      server.use(
        http.post(VERIFY_PATH, () =>
          HttpResponse.json({ message: 'Upstream exploded' }, { status: 500 }),
        ),
      );
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      expect(await screen.findByTestId('ai-verify-result')).toHaveTextContent(
        /upstream exploded/i,
      );
    });

    // Our own API answering 503 means the browser reached it. Reporting that
    // as "could not reach OpenAI" would send an admin to debug egress over a
    // key their own server cannot decrypt.
    it('does not blame the network when our API reports its own failure', async () => {
      const user = userEvent.setup();
      server.use(
        http.post(VERIFY_PATH, () =>
          HttpResponse.json(
            { message: 'The stored OpenAI API key could not be decrypted.' },
            { status: 503 },
          ),
        ),
      );
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );

      const alert = await screen.findByTestId('ai-verify-result');
      expect(alert).toHaveTextContent(/could not be decrypted/i);
      expect(alert).not.toHaveTextContent(/could not reach openai/i);
    });

    it('is disabled when there is no key to test', async () => {
      mockGet(unconfiguredAi);
      await renderLoaded();

      expect(
        screen.getByRole('button', { name: /test connection/i }),
      ).toBeDisabled();
    });

    it('explains via tooltip why it is disabled without a key', async () => {
      const user = userEvent.setup();
      mockGet(unconfiguredAi);
      await renderLoaded();

      await user.hover(screen.getByTestId('ai-test-connection-wrapper'));

      expect(
        await screen.findByText(/there is nothing to test yet/i),
      ).toBeInTheDocument();
    });

    it('is disabled for read-only access', async () => {
      await renderLoaded(<AiSettings disabled />);

      expect(
        screen.getByRole('button', { name: /test connection/i }),
      ).toBeDisabled();
    });

    it('shows a loading state while the call is in flight', async () => {
      const user = userEvent.setup();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = () => resolve();
      });

      server.use(
        http.post(VERIFY_PATH, async () => {
          await gate;
          return HttpResponse.json({ data: okBody });
        }),
      );
      await renderLoaded();

      const button = screen.getByRole('button', { name: /test connection/i });
      await user.click(button);

      await waitFor(() => expect(button).toBeDisabled());
      expect(screen.getByTestId('ai-verify-pending')).toBeInTheDocument();

      release?.();

      expect(
        await screen.findByTestId('ai-verify-result'),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByTestId('ai-verify-pending')).not.toBeInTheDocument(),
      );
    });

    // The endpoint costs money on every call. Rendering, typing, blurring and
    // saving must all leave it untouched.
    it('never calls the endpoint without an explicit click', async () => {
      const user = userEvent.setup();
      const verify = mockVerify(okBody);
      const patches = capturePatch();
      await renderLoaded();

      const modelField = screen.getByLabelText(/^model$/i);
      await user.clear(modelField);
      await user.type(modelField, 'gpt-4o');
      await user.tab();
      await user.type(screen.getByLabelText(/replace api key/i), VALID_KEY);
      await user.tab();
      await user.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(patches).toHaveLength(1));

      expect(verify.count).toBe(0);

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await waitFor(() => expect(verify.count).toBe(1));
    });

    it('clears a stale result when the model is edited', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await screen.findByTestId('ai-verify-result');

      // A green tick next to a model nobody has tested is the failure mode
      // this clears.
      await user.type(screen.getByLabelText(/^model$/i), 'x');

      await waitFor(() =>
        expect(screen.queryByTestId('ai-verify-result')).not.toBeInTheDocument(),
      );
    });

    it('clears a stale result when a replacement key is typed', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await screen.findByTestId('ai-verify-result');

      await user.type(screen.getByLabelText(/replace api key/i), 'sk-new');

      await waitFor(() =>
        expect(screen.queryByTestId('ai-verify-result')).not.toBeInTheDocument(),
      );
    });

    it('clears a stale result when the settings are saved', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      capturePatch();
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await screen.findByTestId('ai-verify-result');

      await user.click(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      );
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() =>
        expect(screen.queryByTestId('ai-verify-result')).not.toBeInTheDocument(),
      );
    });

    it('never renders the API key itself', async () => {
      const user = userEvent.setup();
      mockVerify(okBody);
      await renderLoaded();

      await user.click(
        screen.getByRole('button', { name: /test connection/i }),
      );
      await screen.findByTestId('ai-verify-result');

      expect(screen.queryByText(/sk-/)).not.toBeInTheDocument();
    });
  });

  describe('Read-only access', () => {
    it('disables every write control when disabled is set', async () => {
      await renderLoaded(<AiSettings disabled />);

      expect(screen.getByLabelText(/replace api key/i)).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /replace key/i }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /remove key/i }),
      ).toBeDisabled();
      expect(
        screen.getByRole('checkbox', { name: /enable ai card recognition/i }),
      ).toBeDisabled();
      expect(screen.getByLabelText(/^model$/i)).toBeDisabled();
    });
  });
});
