import type { NotificationsService } from '@marinoscar/platform-api/notifications';

/**
 * VAULT_NOTIFY: the notification dispatcher (email, bell, Web Push).
 *
 * `notify` runs AFTER the triggering write commits, outside any `$transaction`. Event keys, channel
 * ids and template names are persisted: never rename one. The events themselves are registered by
 * the host (`registerNotification`).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_NOTIFY = Symbol.for('@marinoscar/vault/VAULT_NOTIFY');

/** The dispatcher methods the slices use. */
export type VaultNotifyPort = Pick<NotificationsService, 'notify' | 'notifyNow' | 'notifyPermissionHolders'>;
