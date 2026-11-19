import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_IMAGE_SLOTS,
  ID1_ASPECT_RATIO,
  ID3_ASPECT_RATIO,
  attachmentRoleSchema,
  imageSlotFor,
  imageSlotsFor,
  documentNoun,
  isDocumentImageRole,
} from '../src/secrets/index.js';

describe('imageSlotsFor', () => {
  it('gives a Card its front and back, front required', () => {
    const slots = imageSlotsFor({ name: 'Card', isSystem: true });
    expect(slots.map((s) => [s.role, s.label, s.required])).toEqual([
      ['card_front', 'Front', true],
      ['card_back', 'Back', false],
    ]);
    expect(slots.every((s) => s.aspectRatio === ID1_ASPECT_RATIO)).toBe(true);
  });

  it('gives a Passport its data page first, then the other page', () => {
    const slots = imageSlotsFor({ name: 'Passport', isSystem: true });
    expect(slots.map((s) => [s.role, s.label, s.required])).toEqual([
      ['data_page', 'Data page', true],
      ['back', 'Other page', false],
    ]);
    expect(slots.every((s) => s.aspectRatio === ID3_ASPECT_RATIO)).toBe(true);
  });

  it('gives an ID Document a front and a back', () => {
    const slots = imageSlotsFor({ name: 'ID Document', isSystem: true });
    expect(slots.map((s) => [s.role, s.label, s.required])).toEqual([
      ['front', 'Front', true],
      ['back', 'Back', false],
    ]);
  });

  it('gives a custom type no slots, even one named like a system type', () => {
    expect(imageSlotsFor({ name: 'Library card', isSystem: false })).toEqual([]);
    expect(imageSlotsFor({ name: 'Card', isSystem: false })).toEqual([]);
    expect(imageSlotsFor({ name: 'toString' })).toEqual([]);
  });

  it('decides by name when isSystem is omitted', () => {
    expect(imageSlotsFor({ name: 'Passport' })).toHaveLength(2);
  });

  it('uses only roles the attachment role schema accepts', () => {
    for (const slots of Object.values(DOCUMENT_IMAGE_SLOTS)) {
      for (const slot of slots) expect(attachmentRoleSchema.safeParse(slot.role).success, slot.role).toBe(true);
    }
  });

  it('knows the document image roles and finds a slot by role', () => {
    expect(isDocumentImageRole('data_page')).toBe(true);
    expect(isDocumentImageRole('card_back')).toBe(true);
    expect(isDocumentImageRole(undefined)).toBe(false);
    expect(isDocumentImageRole('selfie')).toBe(false);
    expect(imageSlotFor({ name: 'Passport', isSystem: true }, 'data_page')?.label).toBe('Data page');
    expect(imageSlotFor({ name: 'Passport', isSystem: true }, 'card_front')).toBeUndefined();
  });

  it('keeps the ID-1 ratio equal to the card ratio the web used', () => {
    expect(ID1_ASPECT_RATIO).toBeCloseTo(1.5858, 3);
  });

  it('turns a type name into a noun for a sentence', () => {
    expect(documentNoun('Card')).toBe('card');
    expect(documentNoun('Passport')).toBe('passport');
    expect(documentNoun('ID Document')).toBe('ID document');
  });
});
