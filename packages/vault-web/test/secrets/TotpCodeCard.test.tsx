import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils.js';
import { clipboardMock } from '../setup.js';
import { server } from '../mocks/server.js';
import { TotpCodeCard } from '../../src/secrets/ui/components/TotpCodeCard.js';
import { groupTotpCode } from '../../src/secrets/headless/useTotpCode.js';

const URL_PATH = '*/api/secrets/s1/totp';

function respondWith(codes: string[], periodMs = 30_000) {
  let calls = 0;
  server.use(
    http.post(URL_PATH, () => {
      const code = codes[Math.min(calls, codes.length - 1)];
      calls += 1;
      return HttpResponse.json({
        code,
        expiresAt: new Date(Date.now() + periodMs).toISOString(),
        period: periodMs / 1000,
      });
    }),
  );
  return () => calls;
}

describe('groupTotpCode', () => {
  it('groups 6 and 8 digit codes', () => {
    expect(groupTotpCode('123456')).toBe('123 456');
    expect(groupTotpCode('12345678')).toBe('1234 5678');
    expect(groupTotpCode('1234567')).toBe('1234 567');
  });
});

describe('TotpCodeCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests nothing until Show code is pressed', async () => {
    const calls = respondWith(['287082']);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TotpCodeCard secretId="s1" />);
    expect(calls()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Show code' }));
    expect(await screen.findByText('287 082')).toBeInTheDocument();
    expect(calls()).toBe(1);
  });

  it('counts down and refreshes when the period expires', async () => {
    const calls = respondWith(['287082', '359152'], 30_000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TotpCodeCard secretId="s1" />);
    await user.click(screen.getByRole('button', { name: 'Show code' }));
    await screen.findByText('287 082');
    expect(screen.getByText(/Expires in 30s/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText(/Expires in 20s/)).toBeInTheDocument();
    expect(calls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500);
    });
    expect(await screen.findByText('359 152')).toBeInTheDocument();
    expect(calls()).toBe(2);
  });

  it('does not refresh while the page is hidden, and catches up when visible', async () => {
    const calls = respondWith(['287082', '359152'], 30_000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TotpCodeCard secretId="s1" />);
    await user.click(screen.getByRole('button', { name: 'Show code' }));
    await screen.findByText('287 082');

    let state: DocumentVisibilityState = 'hidden';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(calls()).toBe(1);

    state = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(await screen.findByText('359 152')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('stops refreshing after Hide code', async () => {
    const calls = respondWith(['287082'], 30_000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TotpCodeCard secretId="s1" />);
    await user.click(screen.getByRole('button', { name: 'Show code' }));
    await screen.findByText('287 082');
    await user.click(screen.getByRole('button', { name: 'Hide code' }));
    expect(screen.queryByText('287 082')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls()).toBe(1);
    expect(screen.getByRole('button', { name: 'Show code' })).toBeInTheDocument();
  });

  it('copies the bare code without a space', async () => {
    respondWith(['287082']);
    render(<TotpCodeCard secretId="s1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    });
    await screen.findByText('287 082');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(clipboardMock.writeText).toHaveBeenCalledWith('287082');
  });

  it('shows a friendly message on 404', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ message: 'Not found' }, { status: 404 })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TotpCodeCard secretId="s1" />);
    await user.click(screen.getByRole('button', { name: 'Show code' }));
    expect(await screen.findByText(/no authenticator key/i)).toBeInTheDocument();
  });
});
