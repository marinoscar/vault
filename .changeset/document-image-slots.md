---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
'@marinoscar/vault-web': minor
---

Generic document image roles and slots (IDOC-5). `@marinoscar/vault-contract/secrets` appends the attachment roles `data_page`, `front` and `back`, and adds `DOCUMENT_IMAGE_SLOTS` (Card: `card_front`/`card_back`; Passport: `data_page`/`back`; ID Document: `front`/`back`), `imageSlotsFor`, `imageSlotFor`, `isDocumentImageRole`, `documentNoun`, `ID1_ASPECT_RATIO` and `ID3_ASPECT_RATIO`; the errors slice adds `422 ATTACHMENT_ROLE_NOT_ALLOWED`. `@marinoscar/vault-api` refuses a role that is not an image slot of the secret's type on link and renew, applies the image MIME/size/signature checks to every document image role, names the slot in a duplicate-role 409, and orders and titles document images in the export from the slots (card output unchanged). `@marinoscar/vault-web` adds `DocumentImages` (`supportsDocumentImages`, `documentImageSlotsFor`, `findDocumentImage`, `documentImagesTypeName`): images stay hidden until revealed and are hidden again after the 30 s reveal timeout, when the browser tab is hidden or when the attachment changes; `CardImages`, `supportsCardImages` and `findCardImage` remain as aliases.
