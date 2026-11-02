import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AiConfigContext } from '@marinoscar/platform-web/ai/headless';
import type { UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';

import { useAiStatus } from '../../src/core/headless/useAiStatus.js';
import { server } from '../mocks/server.js';
import { AI_CONFIG_CARD_SCAN_ON, AI_CONFIG_ON_NO_KEY } from '../mocks/aiConfig.js';
import { render, screen, waitFor, mockUser } from '../utils/test-utils.js';

const SCANNER = { ...mockUser, permissions: [...mockUser.permissions, 'ai:use'] };

function Probe() {
  const { cardExtractEnabled, isLoading, canUseAi } = useAiStatus();
  return (
    <div data-testid="probe">
      {isLoading ? 'loading' : `scan:${String(cardExtractEnabled)} ai:${String(canUseAi)}`}
    </div>
  );
}

let configRequests = 0;

describe('useAiStatus', () => {
  beforeEach(() => {
    configRequests = 0;
    server.events.removeAllListeners('request:start');
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname === '/api/ai/config') configRequests += 1;
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

    expect(screen.getByTestId('probe')).toHaveTextContent('scan:true ai:true');
    // Give a stray fetch time to start: none may.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(configRequests).toBe(0);
  });
});
