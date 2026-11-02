import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render, mockUser, type MockUser } from '../utils/test-utils';
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

const WRITER: MockUser = {
  ...mockUser,
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'secrets:delete'],
};
const READER: MockUser = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] };

/** The page as a user who may edit, delete and manage attachments. */
function renderPage(user: MockUser = WRITER) {
  return render(<SecretDetailPage />, { wrapperOptions: { user } });
}

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
    values: { cardholder_name: 'PERSON A', number: '4242424242424242' },
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

  describe('layout', () => {
    it('splits Details and Attachments into tabs and keeps history in a drawer', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE, [cardFace('card_front', 'obj-front')])));
      const user = userEvent.setup();
      renderPage();

      await screen.findByRole('tab', { name: /Attachments/ });
      expect(screen.queryByRole('tab', { name: /Version/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Attachments/ }));
      expect(await screen.findByText('Card Images')).toBeInTheDocument();
      expect(screen.queryByText(/Cardholder Name/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Details' }));
      expect(await screen.findByText(/Cardholder Name/)).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'History' }));
      const drawer = await screen.findByRole('dialog', { name: 'Version history' });
      expect(within(drawer).getByText('v2')).toBeInTheDocument();
      expect(within(drawer).getByRole('button', { name: 'Compare version 1 with current' })).toBeInTheDocument();
    });

    it('renders no tabs for a type without attachments, and history still opens', async () => {
      server.use(...baseHandlers(secret(NOTE_TYPE)));
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByText('Body')).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'History' }));
      expect(await screen.findByRole('dialog', { name: 'Version history' })).toBeInTheDocument();
    });

    it('shows the type, name, version and last update in the header', async () => {
      server.use(...baseHandlers(secret(NOTE_TYPE)));
      renderPage();
      expect(await screen.findByRole('heading', { level: 1, name: 'My Card' })).toBeInTheDocument();
      expect(screen.getByText('Note')).toBeInTheDocument();
      expect(screen.getByText(/^Updated /)).toBeInTheDocument();
      expect(screen.getAllByText('v2').length).toBeGreaterThan(0);
    });
  });

  describe('values', () => {
    it('masks a sensitive field until revealed and offers copy on every field', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE)));
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByText('PERSON A')).toBeInTheDocument();
      expect(screen.queryByText('4242424242424242')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy Card Number' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy Cardholder Name' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Reveal Card Number' }));
      expect(screen.getByText('4242424242424242')).toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('edits through the edit route', async () => {
      server.use(...baseHandlers(secret(NOTE_TYPE)));
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      expect(mockNavigate).toHaveBeenCalledWith(`/secrets/${SECRET_ID}/edit`);
    });

    it('deletes the secret only after confirmation, then returns to the list', async () => {
      const deleted: string[] = [];
      server.use(
        ...baseHandlers(secret(NOTE_TYPE)),
        http.delete(`${API_BASE}/secrets/:id`, ({ params }) => {
          deleted.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete secret?' });
      expect(deleted).toHaveLength(0);
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleted).toEqual([SECRET_ID]));
      expect(mockNavigate).toHaveBeenCalledWith('/secrets');
    });

    it('keeps the page and reports the error when the delete fails', async () => {
      server.use(
        ...baseHandlers(secret(NOTE_TYPE)),
        http.delete(`${API_BASE}/secrets/:id`, () =>
          HttpResponse.json({ message: 'Delete refused' }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await user.click(within(await screen.findByRole('dialog', { name: 'Delete secret?' })).getByRole('button', { name: 'Delete' }));
      expect(await screen.findByText('Delete refused')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalledWith('/secrets');
    });

    it('hides edit, delete and restore from a read-only user', async () => {
      server.use(...baseHandlers(secret(NOTE_TYPE)));
      const user = userEvent.setup();
      renderPage(READER);
      await screen.findByRole('heading', { level: 1, name: 'My Card' });
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
    });

    it('links a card secret to the Cards renewal flow', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE)));
      const user = userEvent.setup();
      renderPage();
      expect(await screen.findByRole('link', { name: 'renew it with new photos' })).toHaveAttribute(
        'href',
        `/cards/${SECRET_ID}/renew`,
      );
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Renew card' }));
      expect(mockNavigate).toHaveBeenCalledWith(`/cards/${SECRET_ID}/renew`);
    });

    it('does not offer renewal for a non-card secret', async () => {
      server.use(...baseHandlers(secret(DOCUMENT_TYPE)));
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('heading', { level: 1, name: 'My Card' });
      expect(screen.queryByRole('link', { name: /renew/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(screen.queryByRole('menuitem', { name: 'Renew card' })).not.toBeInTheDocument();
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
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));

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
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));

      expect(await screen.findByText('No front image')).toBeInTheDocument();
      expect(screen.getByText('No back image')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Upload front/i })).toBeInTheDocument();
    });

    it('never renders a card face on the Details tab alongside the card number', async () => {
      server.use(...baseHandlers(secret(CARD_TYPE, [cardFace('card_front', 'obj-front')])));
      renderPage();

      expect(await screen.findByText(/Card Number/)).toBeInTheDocument();
      expect(screen.queryByText('Card Images')).not.toBeInTheDocument();
      expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
    });

    it('leaves a Document secret unaffected: generic list, no card slots', async () => {
      server.use(...baseHandlers(secret(DOCUMENT_TYPE, [GENERIC_ATTACHMENT])));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));

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
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));

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
            values: { cardholder_name: 'PERSON A', number: '4242424242424242' },
            attachments: [cardFace('card_front', 'obj-front-v1', 'att-v1')],
          }),
        ),
      );

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'History' }));
      await user.click(await screen.findByRole('button', { name: 'Compare version 1 with current' }));

      const dialog = await screen.findByRole('dialog', { name: 'Version 1' });
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
            values: { cardholder_name: 'PERSON A' },
            attachments: [],
          }),
        ),
      );

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'History' }));
      await user.click(await screen.findByRole('button', { name: 'Compare version 1 with current' }));

      const dialog = await screen.findByRole('dialog', { name: 'Version 1' });
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
            values: { cardholder_name: 'PERSON A' },
          }),
        ),
      );

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'History' }));
      await user.click(await screen.findByRole('button', { name: 'Compare version 1 with current' }));

      const dialog = await screen.findByRole('dialog', { name: 'Version 1' });
      await waitFor(() => expect(within(dialog).getByText('Version 1')).toBeInTheDocument());
      expect(within(dialog).getByText('No front image')).toBeInTheDocument();
    });
  });

  describe('attachment deletion', () => {
    /**
     * A Document secret, so `CardImages` is out of the tree entirely and the
     * only Delete affordance on screen belongs to the generic attachment list.
     *
     * `attachments` is mutable and the GET is counted: the original bug only
     * refetched, so a test that checks the list refreshed passes against a
     * handler that never deletes anything. The DELETE has to be observed
     * directly.
     */
    function deletionHandlers(deleteResponder: Parameters<typeof http.delete>[1]) {
      const state = { attachments: [GENERIC_ATTACHMENT] as SecretAttachment[], fetches: 0 };
      const handlers = [
        http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => {
          state.fetches += 1;
          return HttpResponse.json(secret(DOCUMENT_TYPE, state.attachments));
        }),
        http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json(VERSIONS)),
        http.delete(`${API_BASE}/secrets/:secretId/attachments/:attachmentId`, deleteResponder),
      ];
      return { state, handlers };
    }

    it('calls the unlink endpoint with the secret and attachment ids, then refetches', async () => {
      const deleted: { secretId: string; attachmentId: string }[] = [];
      const { state, handlers } = deletionHandlers(({ params }) => {
        deleted.push({
          secretId: params.secretId as string,
          attachmentId: params.attachmentId as string,
        });
        state.attachments = [];
        return new HttpResponse(null, { status: 204 });
      });
      server.use(...handlers);

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));
      expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
      const fetchesBefore = state.fetches;

      await user.click(screen.getByRole('button', { name: 'Delete attachment' }));

      // Opening the confirm must not itself delete anything.
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
      expect(deleted).toHaveLength(0);

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() =>
        expect(deleted).toEqual([{ secretId: SECRET_ID, attachmentId: GENERIC_ATTACHMENT.id }]),
      );
      await waitFor(() => expect(state.fetches).toBeGreaterThan(fetchesBefore));

      expect(await screen.findByText('No attachments yet.')).toBeInTheDocument();
      expect(screen.queryByText('contract.pdf')).not.toBeInTheDocument();
      expect(await screen.findByText('Attachment deleted')).toBeInTheDocument();
    });

    it('surfaces an error instead of looking like it succeeded when the unlink fails', async () => {
      const { state, handlers } = deletionHandlers(() =>
        HttpResponse.json({ message: 'Storage backend unavailable' }, { status: 500 }),
      );
      server.use(...handlers);

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));
      expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
      const fetchesBefore = state.fetches;

      await user.click(screen.getByRole('button', { name: 'Delete attachment' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
      );

      const message = await screen.findByText('Storage backend unavailable');
      expect(message.closest('.MuiAlert-root')).toHaveClass('MuiAlert-standard', 'MuiAlert-colorError');

      // The failure must not be dressed up as a success, and the file the user
      // still owns must still be listed.
      expect(screen.queryByText('Attachment deleted')).not.toBeInTheDocument();
      expect(screen.getByText('contract.pdf')).toBeInTheDocument();
      expect(state.fetches).toBe(fetchesBefore);
    });

    it('deletes nothing when the confirmation is cancelled', async () => {
      const deleted: string[] = [];
      const { state, handlers } = deletionHandlers(({ params }) => {
        deleted.push(params.attachmentId as string);
        return new HttpResponse(null, { status: 204 });
      });
      server.use(...handlers);

      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('tab', { name: /Attachments/ }));
      expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
      const fetchesBefore = state.fetches;

      await user.click(screen.getByRole('button', { name: 'Delete attachment' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(deleted).toHaveLength(0);
      expect(state.fetches).toBe(fetchesBefore);
      expect(screen.getByText('contract.pdf')).toBeInTheDocument();
    });
  });
});
