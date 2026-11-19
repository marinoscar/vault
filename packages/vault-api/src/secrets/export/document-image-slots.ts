import { DOCUMENT_IMAGE_SLOTS, type DocumentImageSlot } from '@marinoscar/vault-contract/secrets';

/** A document image slot together with its index in the type's slot list and the type it came from. */
export interface ResolvedImageSlot {
  slot: DocumentImageSlot;
  /** Position in the type's slot list: the export order. */
  index: number;
  /** The system type name whose slot list holds it ("Card", "Passport"). */
  typeName: string;
}

/**
 * The slot an attachment role fills, for the export's order and titles.
 *
 * The secret's own type is tried first. A role the type has no slot for (a
 * row written before roles were checked against the type) falls back to the
 * first type that has it, so an old `card_front` row still reads "Card front".
 * The export manifest carries the type name only, so the name decides here.
 */
export function resolveImageSlot(
  typeName: string,
  role: string | null | undefined,
): ResolvedImageSlot | undefined {
  if (!role) return undefined;
  const own = Object.prototype.hasOwnProperty.call(DOCUMENT_IMAGE_SLOTS, typeName)
    ? DOCUMENT_IMAGE_SLOTS[typeName]
    : undefined;
  const ownIndex = own ? own.findIndex((slot) => slot.role === role) : -1;
  if (own && ownIndex >= 0) return { slot: own[ownIndex], index: ownIndex, typeName };
  for (const [name, slots] of Object.entries(DOCUMENT_IMAGE_SLOTS)) {
    const index = slots.findIndex((slot) => slot.role === role);
    if (index >= 0) return { slot: slots[index], index, typeName: name };
  }
  return undefined;
}

/**
 * Sort rank of an attachment: document images in slot order first, then any
 * other role-bearing file, then generic attachments.
 */
export function attachmentRank(typeName: string, role: string | null | undefined): number {
  if (!role) return Number.MAX_SAFE_INTEGER;
  const resolved = resolveImageSlot(typeName, role);
  return resolved ? resolved.index : Number.MAX_SAFE_INTEGER - 1;
}

/**
 * The title prefix of a document image ("Card front", "Passport data page"):
 * the type name and the slot label in lower case.
 */
export function imageSlotTitle(typeName: string, role: string | null | undefined): string | undefined {
  const resolved = resolveImageSlot(typeName, role);
  return resolved ? `${resolved.typeName} ${resolved.slot.label.toLowerCase()}` : undefined;
}
