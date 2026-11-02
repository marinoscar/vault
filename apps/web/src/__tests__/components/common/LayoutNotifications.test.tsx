/**
 * The platform notification centre in Vault's shell (E7.2): the
 * `NotificationProvider` wraps the layout and the `NotificationBell` sits in
 * the app bar at every width, with the unread count in its accessible name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { Layout } from '../../../components/common/Layout';
import { server } from '../../mocks/server';
import { mockUser, render, screen, within } from '../../utils/test-utils';
import { restoreViewport, setViewportWidth } from '../../utils/viewport';

const SLOW = { timeout: 5000 };

function renderShell() {
  return render(
    <Routes>
      <Route element={<Layout />}>
        <Route path="*" element={<p>Page body</p>} />
      </Route>
    </Routes>,
    { wrapperOptions: { route: '/', user: mockUser } },
  );
}

function withInbox(unreadCount: number) {
  server.use(
    http.get('*/api/notifications/unread-count', () => HttpResponse.json({ data: { unreadCount } })),
    http.get('*/api/notifications', () =>
      HttpResponse.json({
        data: {
          items: [
            {
              id: 'n-1',
              eventKey: 'jobs.job_failed',
              title: 'A scheduled backup failed',
              body: 'Placeholder body for the test.',
              link: '/admin/settings/backups',
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
      }),
    ),
  );
}

afterEach(() => {
  restoreViewport();
});

describe.each([1440, 390])('the notification bell at %ipx', (width) => {
  it('shows the unread count in the app bar and opens the inbox', async () => {
    setViewportWidth(width);
    withInbox(3);
    renderShell();

    const banner = screen.getByRole('banner');
    const bell = await within(banner).findByRole('button', { name: 'Notifications, 3 unread' }, SLOW);
    expect(within(bell).getByText('3')).toBeInTheDocument();

    await userEvent.click(bell);
    const inbox = await screen.findByRole('dialog', { name: 'Notifications' }, SLOW);
    expect(await within(inbox).findByText('A scheduled backup failed', {}, SLOW)).toBeInTheDocument();
    expect(within(inbox).getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
  });
});

describe('the notification bell with an empty inbox', () => {
  it('says none unread', async () => {
    setViewportWidth(1440);
    renderShell();

    expect(
      await within(screen.getByRole('banner')).findByRole('button', { name: 'Notifications, none unread' }, SLOW),
    ).toBeInTheDocument();
  });
});
