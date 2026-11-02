// =============================================================================
// The notifications slice's composition (issue #85, E7.1, epic #54)
// =============================================================================
//
// `NotificationsModule.forRoot` is GLOBAL and serves `/api/notifications/*`
// (inbox, SSE stream, Web Push subscriptions, `config`, `events`),
// `/api/admin/push-config/*` (`push:*`), the dispatcher (`NotificationsService`),
// the email, browser and push channels, the VAPID Doctor check, the
// `jobs.job_failed` / `nodes.node_offline` notifiers and the notification
// retention jobs. `BroadcastsModule` serves `/api/admin/broadcasts/*`
// (`broadcasts:*`, `org_broadcasts:*`) and the `admin.broadcast.start` /
// `admin.broadcast.chunk` job handlers.
//
// The registries (`./notification.manifest`) are filled BEFORE `forRoot`
// composes. Web Push is configured at RUNTIME (the private key lives in the
// credential store under purpose `push_vapid`); there is no environment variable.
//
// A module that needs `NotificationsService` imports nothing: the slice is global.
// =============================================================================

import { BroadcastsModule, NotificationsModule } from '@marinoscar/platform-api/notifications';

import './notification.manifest';
import { emailModule } from '../email/email.config';
import { NotificationsHostModule } from './notifications-host.module';

export const notificationsModule = NotificationsModule.forRoot({
  imports: [emailModule, NotificationsHostModule],
});

export { BroadcastsModule };
