import { Box, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import { AssignmentInd as IdDocumentIcon, TravelExplore as PassportIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import type { DocumentSummaryItem } from '@marinoscar/vault-contract/secrets';
import { DocumentExpiryBadge } from '../../../documents/ui/components/DocumentExpiryBadge.js';
import { isDocumentNeedingAttention } from '../../../documents/headless/useDocumentSummary.js';
import type { DashboardResourceStatus } from '../../../core/headless/useDashboardResource.js';
import { DashboardPanel, PanelError } from './DashboardPanel.js';
import { HOME_LINKS } from '../../headless/homeLinks.js';

/** Rows shown on Home. */
export const EXPIRING_DOCUMENTS_LIMIT = 5;

/** A row's secondary line: `Passport · Exp 2027-07-10`, or the kind of an ID Document. */
export function documentMetaLine(item: Pick<DocumentSummaryItem, 'typeName' | 'documentKind' | 'expiryDate'>): string {
  const label = item.typeName === 'Passport' ? 'Passport' : (item.documentKind ?? 'ID Document');
  return `${label} · Exp ${item.expiryDate ?? '—'}`;
}

export interface ExpiringDocumentsPanelProps {
  status: Exclude<DashboardResourceStatus, 'idle'>;
  /** The caller's documents, soonest expiry first (as the summary returns them). */
  documents: DocumentSummaryItem[];
  error: string | null;
  onRetry: () => void;
  phoneOrder?: number;
}

/**
 * Passports and ID documents that are expired or inside their kind's reminder window (IDOC-9).
 * HIDDEN when there is nothing to act on (and while loading, so a vault without documents never
 * flashes an empty panel); an error still shows, with a retry. Rows link to the secret. Never a
 * number: rows show the name, the kind and the expiry date.
 */
export function ExpiringDocumentsPanel({ status, documents, error, onRetry, phoneOrder }: ExpiringDocumentsPanelProps) {
  const attention = documents.filter(isDocumentNeedingAttention);
  if (status === 'loading' || (status === 'ready' && attention.length === 0)) return null;
  const shown = attention.slice(0, EXPIRING_DOCUMENTS_LIMIT);
  const hidden = attention.length - shown.length;

  return (
    <DashboardPanel
      title="Documents needing attention"
      subtitle="Expired or due for renewal"
      phoneOrder={phoneOrder}
      testId="home-expiring-documents"
    >
      {status === 'error' && <PanelError message={error ?? 'Could not load your documents.'} onRetry={onRetry} />}

      {status === 'ready' && (
        <>
          <List disablePadding aria-label="Documents needing attention">
            {shown.map((item) => {
              const Icon = item.typeName === 'Passport' ? PassportIcon : IdDocumentIcon;
              return (
                <ListItem key={item.id} disablePadding>
                  <ListItemButton
                    component={RouterLink}
                    to={HOME_LINKS.secretDetail(item.id)}
                    sx={{ borderRadius: 1, px: 1, mx: -1, gap: 1.5, minHeight: 48 }}
                  >
                    <Icon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                    <ListItemText
                      primary={item.name}
                      secondary={documentMetaLine(item)}
                      sx={{ my: 0.5, minWidth: 0 }}
                      slotProps={{
                        primary: { noWrap: true, variant: 'body2', sx: { fontWeight: 500 } },
                        secondary: { noWrap: true, variant: 'caption' },
                      }}
                    />
                    <Box sx={{ flexShrink: 0 }}>
                      <DocumentExpiryBadge status={item.status} expiryDate={item.expiryDate} />
                    </Box>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
          {hidden > 0 && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              {`+${hidden} more`}
            </Typography>
          )}
        </>
      )}
    </DashboardPanel>
  );
}
