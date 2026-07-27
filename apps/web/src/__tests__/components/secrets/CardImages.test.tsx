import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  CardImages,
  findCardImage,
  supportsCardImages,
} from '../../../components/secrets/CardImages';
import type { SecretAttachment, SecretType } from '../../../types';

const API_BASE = '*/api';
const SECRET_ID = 'secret-1';

function attachment(overrides: Partial<SecretAttachment> = {}): SecretAttachment {
  return {
    id: 'att-front',
    label: 'front.jpg',
    role: 'card_front',
    storageObject: {
      id: 'obj-front',
      name: 'front.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const FRONT = attachment();
const BACK = attachment({
  id: 'att-back',
  label: 'back.jpg',
  role: 'card_back',
  storageObject: { id: 'obj-back', name: 'back.jpg', mimeType: 'image/jpeg', size: 2048 },
});

const CARD_TYPE: SecretType = {
  id: 'card-type',
  name: 'Card',
  description: null,
  icon: 'CreditCard',
  fields: [],
  allowAttachments: true,
  isSystem: true,
  createdAt: new Date().toISOString(),
};

const DOCUMENT_TYPE: SecretType = {
  ...CARD_TYPE,
  id: 'doc-type',
  name: 'Document',
  icon: null,
};

const NOTE_TYPE: SecretType = {
  ...CARD_TYPE,
  id: 'note-type',
  name: 'Note',
  allowAttachments: false,
};

/** Signed-URL handler that succeeds for every storage object. */
function downloadHandler(urlFor: (id: string) => string = (id) => `https://signed.example/${id}`) {
  return http.get(`${API_BASE}/storage/objects/:objectId/download`, ({ params }) =>
    HttpResponse.json({ url: urlFor(params.objectId as string), expiresIn: 300 }),
  );
}

function imageFile(name = 'front.jpg', type = 'image/jpeg', size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('supportsCardImages', () => {
  it('is true for the system Card type even with no attachments', () => {
    expect(supportsCardImages(CARD_TYPE, [])).toBe(true);
  });

  it('is false for a Document type whose attachments are all role-less', () => {
    expect(supportsCardImages(DOCUMENT_TYPE, [attachment({ role: null })])).toBe(false);
  });

  it('is false for a type that forbids attachments entirely', () => {
    expect(supportsCardImages(NOTE_TYPE, [])).toBe(false);
  });

  it('is true for a non-Card type that already holds a role-bearing attachment', () => {
    expect(supportsCardImages(DOCUMENT_TYPE, [FRONT])).toBe(true);
  });
});

describe('findCardImage', () => {
  it('selects the attachment matching the requested role', () => {
    expect(findCardImage([FRONT, BACK], 'card_back')).toBe(BACK);
    expect(findCardImage([FRONT], 'card_back')).toBeUndefined();
  });
});

describe('CardImages', () => {
  beforeEach(() => {
    server.use(downloadHandler());
  });

  it('keeps both faces concealed until revealed, then renders them from signed URLs', async () => {
    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT, BACK]} />);

    // Nothing is rendered in the clear on load.
    expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Back of card')).not.toBeInTheDocument();
    expect(screen.getByText('Front image hidden')).toBeInTheDocument();
    expect(screen.getByText('Back image hidden')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    const front = await screen.findByAltText('Front of card');
    expect(front).toHaveAttribute('src', 'https://signed.example/obj-front');

    // Revealing the front must not also uncover the back.
    expect(screen.queryByAltText('Back of card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal back image' }));
    const back = await screen.findByAltText('Back of card');
    expect(back).toHaveAttribute('src', 'https://signed.example/obj-back');
  });

  it('requests no signed URL at all until the reveal gesture', async () => {
    const requested: string[] = [];
    server.use(
      http.get(`${API_BASE}/storage/objects/:objectId/download`, ({ params }) => {
        requested.push(params.objectId as string);
        return HttpResponse.json({ url: 'https://signed.example/x', expiresIn: 300 });
      }),
    );

    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT, BACK]} />);

    // Give any stray on-mount fetch a chance to land before asserting.
    await waitFor(() => expect(screen.getByText('Front image hidden')).toBeInTheDocument());
    expect(requested).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    await screen.findByAltText('Front of card');
    expect(requested).toEqual(['obj-front']);
  });

  it('can re-conceal a revealed image', async () => {
    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} />);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    await screen.findByAltText('Front of card');

    await user.click(screen.getByRole('button', { name: 'Hide front image' }));
    expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
    expect(screen.getByText('Front image hidden')).toBeInTheDocument();
  });

  it('offers an upload control on both empty slots', () => {
    render(<CardImages secretId={SECRET_ID} attachments={[]} />);

    expect(screen.getByText('No front image')).toBeInTheDocument();
    expect(screen.getByText('No back image')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload front/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload back/i })).toBeInTheDocument();
    // Nothing to reveal or remove when there is no image.
    expect(screen.queryByRole('button', { name: /Reveal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });

  it('uploads then links, in that order, with the slot role', async () => {
    const calls: string[] = [];
    let linkBody: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE}/storage/objects`, () => {
        calls.push('upload');
        return HttpResponse.json({
          id: 'new-object',
          name: 'back.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
        });
      }),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        calls.push('link');
        linkBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(BACK);
      }),
    );

    const onChange = vi.fn();
    render(<CardImages secretId={SECRET_ID} attachments={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Back image file'), {
      target: { files: [imageFile('back.jpg')] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls).toEqual(['upload', 'link']);
    expect(linkBody).toMatchObject({
      storageObjectId: 'new-object',
      label: 'back.jpg',
      role: 'card_back',
    });
  });

  it('frees the role by unlinking before linking when replacing an image', async () => {
    const calls: string[] = [];
    server.use(
      http.post(`${API_BASE}/storage/objects`, () => {
        calls.push('upload');
        return HttpResponse.json({
          id: 'new-object',
          name: 'front.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
        });
      }),
      http.delete(`${API_BASE}/secrets/:id/attachments/:attachmentId`, ({ params }) => {
        calls.push(`unlink:${params.attachmentId}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${API_BASE}/secrets/:id/attachments`, () => {
        calls.push('link');
        return HttpResponse.json(FRONT);
      }),
    );

    const onChange = vi.fn();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Front image file'), {
      target: { files: [imageFile()] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls).toEqual(['upload', 'unlink:att-front', 'link']);
  });

  it('removes an image by unlinking the attachment', async () => {
    const seen: string[] = [];
    server.use(
      http.delete(`${API_BASE}/secrets/:id/attachments/:attachmentId`, ({ params }) => {
        seen.push(params.attachmentId as string);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Remove front/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(seen).toEqual(['att-front']);
  });

  it('rejects a non-image file before uploading it', async () => {
    const uploads = vi.fn();
    server.use(
      http.post(`${API_BASE}/storage/objects`, () => {
        uploads();
        return HttpResponse.json({ id: 'x', name: 'x', mimeType: 'text/plain', size: 1 });
      }),
    );

    render(<CardImages secretId={SECRET_ID} attachments={[]} />);

    fireEvent.change(screen.getByLabelText('Front image file'), {
      target: { files: [imageFile('notes.txt', 'text/plain')] },
    });

    expect(
      await screen.findByText('Card images must be a JPEG, PNG, WebP, or HEIC image.'),
    ).toBeInTheDocument();
    expect(uploads).not.toHaveBeenCalled();
  });

  it('rejects an oversized image before uploading it', async () => {
    render(<CardImages secretId={SECRET_ID} attachments={[]} />);

    fireEvent.change(screen.getByLabelText('Front image file'), {
      target: { files: [imageFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024)] },
    });

    expect(await screen.findByText('Card images must be 5 MB or smaller.')).toBeInTheDocument();
  });

  it('shows an error state, not a broken image, when the signed URL fetch fails', async () => {
    server.use(
      http.get(`${API_BASE}/storage/objects/:objectId/download`, () =>
        HttpResponse.json({ message: 'Object not found' }, { status: 404 }),
      ),
    );

    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} />);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));

    expect(await screen.findByText('Object not found')).toBeInTheDocument();
    expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('recovers when a failed signed-URL fetch is retried', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API_BASE}/storage/objects/:objectId/download`, () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ message: 'Temporarily unavailable' }, { status: 503 });
        }
        return HttpResponse.json({ url: 'https://signed.example/obj-front', expiresIn: 300 });
      }),
    );

    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} />);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    await screen.findByText('Temporarily unavailable');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const img = await screen.findByAltText('Front of card');
    expect(img).toHaveAttribute('src', 'https://signed.example/obj-front');
  });

  it('shows an error state when the blob behind a valid URL cannot be displayed', async () => {
    const user = userEvent.setup();
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} />);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    const img = await screen.findByAltText('Front of card');

    // jsdom never loads images, so the failure is simulated directly.
    fireEvent.error(img);

    expect(
      await screen.findByText('This image could not be displayed. The file may be missing.'),
    ).toBeInTheDocument();
    expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();
  });

  it('hides all mutation controls when read-only', () => {
    render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} readOnly />);

    expect(screen.getByRole('button', { name: 'Reveal front image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });

  it('renders empty slots for a card that predates attachments', () => {
    render(<CardImages secretId={SECRET_ID} attachments={[]} readOnly />);

    expect(screen.getByText('No front image')).toBeInTheDocument();
    expect(screen.getByText('No back image')).toBeInTheDocument();
  });

  it('re-conceals and re-fetches when the attachment it points at changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CardImages secretId={SECRET_ID} attachments={[FRONT]} />);

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    expect(await screen.findByAltText('Front of card')).toHaveAttribute(
      'src',
      'https://signed.example/obj-front',
    );

    const replaced = attachment({
      id: 'att-front-2',
      storageObject: { id: 'obj-front-2', name: 'new.jpg', mimeType: 'image/jpeg', size: 999 },
    });
    rerender(<CardImages secretId={SECRET_ID} attachments={[replaced]} />);

    // A stale signed URL would still be showing the previous card face here.
    expect(screen.queryByAltText('Front of card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal front image' }));
    expect(await screen.findByAltText('Front of card')).toHaveAttribute(
      'src',
      'https://signed.example/obj-front-2',
    );
  });
});
