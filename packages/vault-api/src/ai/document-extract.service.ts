import { Inject, Injectable, Optional } from '@nestjs/common';

import { type RequestUser } from '@marinoscar/platform-api/identity';
import {
  extractDocumentRequestSchema,
  SCANNABLE_DOCUMENT_TYPES,
  type ExtractDocumentResponse,
  type ScannableDocumentType,
} from '@marinoscar/vault-contract/secrets';

import { aiInvalidImage } from './ai.errors';
import { DocumentScanService } from './scan/document-scan.service';
import { createScanProfileRegistry, type ScanProfileRegistry } from './scan/scan-profile.registry';
import { VAULT_AI, VAULT_METRICS, type VaultAiPort, type VaultMetricsPort } from '../ports';

/**
 * Identity-document scanning (issue #210, IDOC-7): the passport and ID document
 * scan profiles over `DocumentScanService`, under the AI feature
 * `document_extract`.
 *
 * Validates the body (an invalid one is `AI_INVALID_IMAGE`, as for cards) and
 * runs the profile named by `documentType`. PERSISTS NOTHING: the images and the
 * extracted values exist only in the request and the response; the platform
 * writes the `ai_usage_events` row (token counts, never the input).
 *
 * @stability experimental
 */
@Injectable()
export class DocumentExtractService {
  /** The generic scan runner; optional so the service can be built outside Nest. */
  @Optional()
  @Inject(DocumentScanService)
  private readonly documentScan?: DocumentScanService;

  constructor(
    @Inject(VAULT_AI) private readonly ai: VaultAiPort,
    @Optional() @Inject(VAULT_METRICS) private readonly metrics?: VaultMetricsPort,
  ) {}

  async extract(body: unknown, user: RequestUser): Promise<ExtractDocumentResponse> {
    const parsed = extractDocumentRequestSchema.safeParse(body);
    if (!parsed.success) {
      const type = (body as { documentType?: unknown } | null)?.documentType;
      if ((SCANNABLE_DOCUMENT_TYPES as readonly unknown[]).includes(type)) {
        this.metrics?.documentExtracted(type as ScannableDocumentType, 'invalid_image');
      }
      // The issue paths are safe to echo (field names). The values are image bytes.
      throw aiInvalidImage(
        `Invalid image payload: ${parsed.error.issues.map((issue) => issue.path.join('.') || 'body').join(', ')}`,
      );
    }

    const { documentType, images, barcode } = parsed.data;
    // The decoded barcode only reaches the normalizer (a Driver License cross-check), never the model.
    return this.scanner().extract<ExtractDocumentResponse>(documentType, user, images, { barcode });
  }

  /** The injected runner, or (built outside Nest) one over the built-in profiles and these ports. */
  private scanner(): DocumentScanService {
    return this.documentScan ?? new DocumentScanService(this.ai, defaultRegistry(), this.metrics);
  }
}

let builtInRegistry: ScanProfileRegistry | undefined;

function defaultRegistry(): ScanProfileRegistry {
  return (builtInRegistry ??= createScanProfileRegistry());
}
