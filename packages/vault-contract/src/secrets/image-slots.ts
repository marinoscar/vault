import type { AttachmentRole } from './index.js';

/**
 * One stored document image of a secret type: the attachment role it is
 * stored under, the label people see, whether the document is expected to
 * carry it, and the width-to-height ratio of the physical document.
 *
 * @stability experimental
 */
export interface DocumentImageSlot {
  /** The attachment role the image is stored under (unique per version). */
  readonly role: AttachmentRole;
  /** The label shown in the UI, the export and conflict messages ("Front", "Data page"). */
  readonly label: string;
  /** Whether the document is expected to have this image (the first slot). */
  readonly required: boolean;
  /** Width divided by height of the physical document (landscape). */
  readonly aspectRatio: number;
}

/**
 * Aspect ratio of an ISO/IEC 7810 ID-1 document (payment cards, ID cards,
 * driving licences): 85.60 x 53.98 mm.
 *
 * @stability experimental
 */
export const ID1_ASPECT_RATIO = 85.6 / 53.98;

/**
 * Aspect ratio of an ISO/IEC 7810 ID-3 document (a passport data page):
 * 125 x 88 mm.
 *
 * @stability experimental
 */
export const ID3_ASPECT_RATIO = 125 / 88;

/**
 * The image slots of each system secret type that stores document photos,
 * keyed by the system type name, in display and export order. A type absent
 * here (every custom type) accepts no role-bearing attachment.
 *
 * @stability experimental
 */
export const DOCUMENT_IMAGE_SLOTS: Readonly<Record<string, readonly DocumentImageSlot[]>> = Object.freeze({
  Card: Object.freeze([
    { role: 'card_front', label: 'Front', required: true, aspectRatio: ID1_ASPECT_RATIO },
    { role: 'card_back', label: 'Back', required: false, aspectRatio: ID1_ASPECT_RATIO },
  ] as const satisfies readonly DocumentImageSlot[]),
  Passport: Object.freeze([
    { role: 'data_page', label: 'Data page', required: true, aspectRatio: ID3_ASPECT_RATIO },
    { role: 'back', label: 'Other page', required: false, aspectRatio: ID3_ASPECT_RATIO },
  ] as const satisfies readonly DocumentImageSlot[]),
  'ID Document': Object.freeze([
    { role: 'front', label: 'Front', required: true, aspectRatio: ID1_ASPECT_RATIO },
    { role: 'back', label: 'Back', required: false, aspectRatio: ID1_ASPECT_RATIO },
  ] as const satisfies readonly DocumentImageSlot[]),
});

/**
 * The image slots a secret type accepts: those of {@link DOCUMENT_IMAGE_SLOTS}
 * for a system type of that name, and none for a custom type (a custom type
 * named "Card" gets no slots). When `isSystem` is omitted the name alone
 * decides.
 *
 * @param type - The secret type (its name, and whether it is a system type).
 * @returns The slots in display order; empty when the type stores no document images.
 * @stability experimental
 */
export function imageSlotsFor(type: { name: string; isSystem?: boolean }): readonly DocumentImageSlot[] {
  if (type.isSystem === false) return [];
  return Object.prototype.hasOwnProperty.call(DOCUMENT_IMAGE_SLOTS, type.name) ? DOCUMENT_IMAGE_SLOTS[type.name] : [];
}

/**
 * Whether a role belongs to any document image slot (of any type).
 *
 * @param role - An attachment role, or nothing for a generic attachment.
 * @stability experimental
 */
export function isDocumentImageRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return Object.values(DOCUMENT_IMAGE_SLOTS).some((slots) => slots.some((slot) => slot.role === role));
}

/**
 * The slot of a role on a type, or undefined when the type has no such slot.
 *
 * @param type - The secret type.
 * @param role - The attachment role.
 * @stability experimental
 */
export function imageSlotFor(
  type: { name: string; isSystem?: boolean },
  role: string | null | undefined,
): DocumentImageSlot | undefined {
  if (!role) return undefined;
  return imageSlotsFor(type).find((slot) => slot.role === role);
}

/**
 * A type name as a noun inside a sentence: lower case, except an all-capital
 * word ("Card" reads "card", "ID Document" reads "ID document").
 *
 * @param typeName - The secret type name.
 * @stability experimental
 */
export function documentNoun(typeName: string): string {
  return typeName
    .split(' ')
    .map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}
