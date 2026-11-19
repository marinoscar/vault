import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AiConfigContext } from '@marinoscar/platform-web/ai/headless';
import type { UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';

import { useAiStatus } from '../../src/core/headless/useAiStatus.js';
import { server } from '../mocks/server.js';
import {
  AI_CONFIG_CARD_SCAN_ON,
  AI_CONFIG_COMPATIBLE_KEYLESS,
  AI_CONFIG_ON_NO_KEY,
  SCAN_TARGETS_COMPATIBLE,
  SCAN_TARGETS_OPENAI,
} from '../mocks/aiConfig.js';
import { render, screen, waitFor, mockUser } from '../utils/test-utils.js';

const SCANNER = { ...mockUser, permissions: [...mockUser.permissions, 'ai:use'] };

function Probe() {
  const { cardExtractEnabled, documentScanEnabled, isLoading, canUseAi } = useAiStatus();
  return (
    <div data-testid="probe">
      {isLoading ? 'loading' : `scan:${String(cardExtractEnabled)} ai:${String(canUseAi)} doc:${String(documentScanEnabled)}`}
    </div>
  );
}

let configRequests = 0;
let targetsRequests = 0;

describe('useAiStatus', () => {
  beforeEach(() => {
    configRequests = 0;
    targetsRequests = 0;
    server.events.removeAllListeners('request:start');
    server.events.on('request:start', ({ request }) => {
      const path = new URL(request.url).pathname;
      if (path === '/api/ai/config') configRequests += 1;
      if (path === '/api/secrets/scan/targets') targetsRequests += 1;
    });
  });

  it('fetches GET /api/ai/config itself when no shared copy is mounted', async () => {
    render(<Probe />, { wrapperOptions: { user: SCANNER } });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true'));
    expect(configRequests).toBe(1);
  });

  it('says no when card scanning is not set up', async () => {
    server.use(http.get('*/api/ai/config', () => HttpResponse.json({ data: AI_CONFIG_ON_NO_KEY })));
    render(<Probe />, { wrapperOptions: { user: SCANNER } });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:false ai:true'));
  });

  it('says no to a viewer without ai:use, even with card scanning available', async () => {
    render(<Probe />, { wrapperOptions: { user: mockUser } });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:false ai:false'));
  });

  it('fails closed when the config call errors', async () => {
    server.use(http.get('*/api/ai/config', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    render(<Probe />, { wrapperOptions: { user: SCANNER } });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:false ai:true'));
  });

  it("reuses the host's shared AiConfigContext instead of issuing a second request", async () => {
    const shared: UseAiConfigReturn = {
      config: AI_CONFIG_CARD_SCAN_ON,
      isLoading: false,
      error: null,
      refresh: async () => {},
    };
    render(
      <AiConfigContext.Provider value={shared}>
        <Probe />
      </AiConfigContext.Provider>,
      { wrapperOptions: { user: SCANNER } },
    );

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true'));
    // Give a stray fetch time to start: none may.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(configRequests).toBe(0);
  });

  it('reports both flags from the shared rule over the config and the scan targets', async () => {
    render(<Probe />, { wrapperOptions: { user: SCANNER } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true doc:true'));
    expect(targetsRequests).toBe(1);
  });

  it('turns both on for a keyless openai-compatible vision model', async () => {
    server.use(
      http.get('*/api/ai/config', () => HttpResponse.json({ data: AI_CONFIG_COMPATIBLE_KEYLESS })),
      http.get('*/api/secrets/scan/targets', () => HttpResponse.json({ data: SCAN_TARGETS_COMPATIBLE })),
    );
    render(<Probe />, { wrapperOptions: { user: SCANNER } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true doc:true'));
  });

  it('answers per feature: a document model that cannot read images turns only documents off', async () => {
    server.use(
      http.get('*/api/secrets/scan/targets', () =>
        HttpResponse.json({
          data: {
            ...SCAN_TARGETS_OPENAI,
            document_extract: { provider: 'openai', model: 'text-model', capabilities: ['responses', 'structured_output'] },
          },
        }),
      ),
    );
    render(<Probe />, { wrapperOptions: { user: SCANNER } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true doc:false'));
  });

  it('fails closed when the scan targets call errors', async () => {
    server.use(http.get('*/api/secrets/scan/targets', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    render(<Probe />, { wrapperOptions: { user: SCANNER } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:false ai:true doc:false'));
  });

  it('does not ask for the scan targets without ai:use', async () => {
    render(<Probe />, { wrapperOptions: { user: mockUser } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('scan:false ai:false doc:false'));
    expect(targetsRequests).toBe(0);
  });
});
