import type { DocumentSummaryItem, DocumentSummaryResponse } from '@marinoscar/vault-contract/secrets';

import { getDocumentSummary } from '../../core/headless/api.js';
import { useDashboardResource, type DashboardResource } from '../../core/headless/useDashboardResource.js';

export type { DocumentExpiryStatus, DocumentSummaryItem } from '@marinoscar/vault-contract/secrets';

/**
 * The caller's Passport and ID Document secrets with their expiry status (IDOC-9), from
 * `GET /secrets/documents/summary`: soonest expiry first, no expiry last. The server reads only the
 * kind and the expiry date; no number or date of birth reaches the browser through this hook.
 *
 * `enabled` is the `secrets:read` gate: a disabled hook issues no request.
 */
export function useDocumentSummary(enabled = true): DashboardResource<DocumentSummaryResponse> {
  return useDashboardResource(getDocumentSummary, enabled, 'Could not load your documents.');
}

/** Whether a document should be acted on: expired or within its kind's largest lead day. */
export function isDocumentNeedingAttention(item: Pick<DocumentSummaryItem, 'status'>): boolean {
  return item.status === 'expired' || item.status === 'expiring_soon';
}
