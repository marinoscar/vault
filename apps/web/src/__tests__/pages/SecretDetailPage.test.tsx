import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
import SecretDetailPage from '../../pages/SecretDetailPage';
import type { SecretAttachment, SecretType } from '../../types';

const API_BASE = '*/api';
const SECRET_ID = 'secret-1';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'secret-1' }),
  };
});

const CARD_TYPE: SecretType = {
  id: 'card-type',
  name: 'Card',
  description: 'Credit or debit card',
  icon: 'CreditCard',
  isSystem: true,
  allowAttachments: true,
  createdAt: new Date().toISOString(),
  fields: [
    { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
    { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
  ],
};

const DOCUMENT_TYPE: SecretType = {
  id: 'doc-type',
  name: 'Document',
  description: 'A document',
  icon: null,
  isSystem: true,
  allowAttachments: true,
  createdAt: new Date().toISOString(),
  fields: [{ name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false }],
};

const NOTE_TYPE: SecretType = {
  id: 'note-type',
  name: 'Note',
  description: 'A note',
  icon: null,
  isSystem: true,
  allowAttachments: false,
  createdAt: new Date().toISOString(),
  fields: [{ name: 'body', label: 'Body', type: 'string', required: false, sensitive: false }],
};

function cardFace(
  role: 'card_front' | 'card_back',
  objectId: string,
  id = `att-${objectId}`,
): SecretAttachment {
  return {
    id,
    label: `${role}.jpg`,
    role,
    storageObject: { id: objectId, name: `${role}.jpg`, mimeType: 'image/jpeg', size: 1024 },
    createdAt: new Date().toISOString(),
  };
}

const GENERIC_ATTACHMENT: SecretAttachment = {
  id: 'att-doc',
  label: 'contract.pdf',
  role: null,
  storageObject: { id: 'obj-doc', name: 'contract.pdf', mimeType: 'application/pdf', size: 4096 },
  createdAt: new Date().toISOString(),
};

function secret(type: SecretType, attachments: SecretAttachment[] = []) {
  return {
    id: SECRET_ID,
    name: 'My Card',
    description: null,
    type,
    currentVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    values: { cardholder_name: 'ADA LOVELACE', number: '4242424242424242' },
    createdBy: { id: 'u1', email: 'owner@example.com' },
    attachments,
  };
}

const VERSIONS = [
  { id: 'v2-id', version: 2, createdAt: new Date().toISOString(), createdBy: null, isCurrent: true },
  { id: 'v1-id', version: 1, createdAt: new Date().toISOString(), createdBy: null, isCurrent: false },
];

function baseHandlers(detail: ReturnType<typeof secret>) {
  return [
    http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => HttpResponse.json(detail)),
    http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json(VERSIONS)),
    http.get(`${API_BASE}/storage/objects/:objectId/download`, ({ params }) =>
      HttpResponse.json({ url: `https://signed.example/${params.objectId}`, expiresIn: 300 }),
    ),
  ];
}

describe('SecretDetailPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  describe('tab dispatch', () => {
    it('routes each tab correctly when the Attachments tab is present', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE, [cardFace('card_front', 'obj-front')])));
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await screen.findByRole('tab', { name: 'Attachments' });

      await user.click(screen.getByRole('tab', { name: 'Version History' }));
      expect(await screen.findByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Attachments' }));
      expect(await screen.findByText('Card Images')).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Version' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Details' }));
      expect(await screen.findByText(/Cardholder Name/)).toBeInTheDocument();
    });

    it('routes Version History correctly when the Attachments tab is absent', async () => {
      server.use(...baseHandlers(secret(NOTE_TYPE)));
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await screen.findByRole('tab', { name: 'Details' });
      expect(screen.queryByRole('tab', { name: 'Attachments' })).not.toBeInTheDocument();

      // The trap: with index-based dispatch a missing third tab shifts the
      // panels. Version History must still render the version table.
      await user.click(screen.getByRole('tab', { name: 'Version History' }));
      expect(await screen.findByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();
    });
  });

  describe('card images', () => {
    it('renders front and back slots on the Attachments tab, concealed by default', async () => {
      server.use(
        ...baseHandlers(
          secret(CARD_TYPE, [
            cardFace('card_front', 'obj-front'),
            cardFace('card_back', 'obj-back'),
          ]),
        ),
      );
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Attachments' }));

      expect(await screen.findByText('Card Images')).toBeInTheDocument();
      expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
      expect(await screen.findByAltText('Front of card')).toHaveAttribute(
        'src',
        'https://signed.example/obj-front',
      );
    });

    it('shows empty slots for a card created before attachments existed', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE, [])));
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Attachments' }));

      expect(await screen.findByText('No front image')).toBeInTheDocument();
      expect(screen.getByText('No back image')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Upload front/i })).toBeInTheDocument();
    });

    it('never renders a card face on the Details tab alongside the card number', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE, [cardFace('card_front', 'obj-front')])));
      render(<SecretDetailPage />);

      expect(await screen.findByText(/Card Number/)).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();
      expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
    });

    it('leaves a Document secret unaffected: generic list, no card slots', async () => {
      server.use(...baseHandlers(secret(DOCUMENT_TYPE, [GENERIC_ATTACHMENT])));
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Attachments' }));

      expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();
      expect(screen.queryByText('No front image')).not.toBeInTheDocument();
    });

    it('does not repeat a card face in the generic attachment list', async () => {
      server.use(
        ...baseHandlers(
          secret(CARD_TYPE, [cardFace('card_front', 'obj-front'), GENERIC_ATTACHMENT]),
        ),
      );
      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Attachments' }));

      expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
      expect(screen.queryByText('card_front.jpg')).not.toBeInTheDocument();
    });
  });

  describe('version history', () => {
    it("shows the selected version's own images, not the current version's", async () => {
      // The secret currently holds v2's photo; v1 holds a different one.
      server.use(
        ...baseHandlers(secret(CARD_TYPE, [cardFace('card_front', 'obj-front-v2', 'att-v2')])),
        http.get(`${API_BASE}/secrets/${SECRET_ID}/versions/:versionId`, () =>
          HttpResponse.json({
            id: 'v1-id',
            version: 1,
            isCurrent: false,
            createdAt: new Date().toISOString(),
            createdBy: null,
            values: { cardholder_name: 'ADA LOVELACE', number: '4242424242424242' },
            attachments: [cardFace('card_front', 'obj-front-v1', 'att-v1')],
          }),
        ),
      );

      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Version History' }));
      await waitFor(() => expect(screen.getAllByText('v1').length).toBeGreaterThan(0));
      // 'v1' appears twice per row (the version cell and the status chip); the
      // first is the cell inside the clickable row.
      await user.click(screen.getAllByText('v1')[0]);

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Card Images (v1)')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Reveal front image' }));

      const img = await within(dialog).findByAltText('Front of card');
      expect(img).toHaveAttribute('src', 'https://signed.example/obj-front-v1');
      expect(img).not.toHaveAttribute('src', 'https://signed.example/obj-front-v2');
    });

    it('renders a version with no attachments without card slots', async () => {
      server.use(
        ...baseHandlers(secret(CARD_TYPE, [])),
        http.get(`${API_BASE}/secrets/${SECRET_ID}/versions/:versionId`, () =>
          HttpResponse.json({
            id: 'v1-id',
            version: 1,
            isCurrent: false,
            createdAt: new Date().toISOString(),
            createdBy: null,
            values: { cardholder_name: 'ADA LOVELACE' },
            attachments: [],
          }),
        ),
      );

      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Version History' }));
      await waitFor(() => expect(screen.getAllByText('v1').length).toBeGreaterThan(0));
      // 'v1' appears twice per row (the version cell and the status chip); the
      // first is the cell inside the clickable row.
      await user.click(screen.getAllByText('v1')[0]);

      const dialog = await screen.findByRole('dialog');
      // A Card type always offers slots, but they must render empty, not broken.
      expect(await within(dialog).findByText('Card Images (v1)')).toBeInTheDocument();
      expect(within(dialog).getByText('No front image')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /Upload/i })).not.toBeInTheDocument();
    });

    it('tolerates a version payload with no attachments field at all', async () => {
      server.use(
        ...baseHandlers(secret(CARD_TYPE, [])),
        http.get(`${API_BASE}/secrets/${SECRET_ID}/versions/:versionId`, () =>
          HttpResponse.json({
            id: 'v1-id',
            version: 1,
            isCurrent: false,
            createdAt: new Date().toISOString(),
            createdBy: null,
            values: { cardholder_name: 'ADA LOVELACE' },
          }),
        ),
      );

      const user = userEvent.setup();
      render(<SecretDetailPage />);

      await user.click(await screen.findByRole('tab', { name: 'Version History' }));
      await waitFor(() => expect(screen.getAllByText('v1').length).toBeGreaterThan(0));
      // 'v1' appears twice per row (the version cell and the status chip); the
      // first is the cell inside the clickable row.
      await user.click(screen.getAllByText('v1')[0]);

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getByText('Version 1')).toBeInTheDocument());
      expect(within(dialog).getByText('No front image')).toBeInTheDocument();
    });
  });
});
