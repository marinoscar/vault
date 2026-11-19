/**
 * The card names of the document image component, kept for the import sites
 * that predate Passport and ID Document: `CardImages` is `DocumentImages`
 * (with no `type`, it shows the Card slots), `supportsCardImages` is
 * `supportsDocumentImages` and `findCardImage` is `findDocumentImage`.
 */
export {
  DocumentImages as CardImages,
  supportsDocumentImages as supportsCardImages,
  findDocumentImage as findCardImage,
} from './DocumentImages.js';
export type { DocumentImagesProps as CardImagesProps } from './DocumentImages.js';
