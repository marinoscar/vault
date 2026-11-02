import { escapeHtml, formatBytes, renderSecretsHtml } from './secrets-export-html.renderer';
import { renderReadme } from './secrets-export-readme.renderer';
import { SecretsExportManifest } from './secrets-export.types';

const XSS_SCRIPT = '<script>alert(1)</script>';
const XSS_IMG = '"><img src=x onerror=alert(2)>';

function manifest(overrides: Partial<SecretsExportManifest> = {}): SecretsExportManifest {
  return {
    formatVersion: 1,
    exportedAt: '2026-01-02T03:04:05.000Z',
    app: 'vault',
    owner: { id: 'u1', email: 'person.a@example.test' },
    options: { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: false },
    counts: { secrets: 0, attachments: 0 },
    warnings: [],
    secrets: [],
    ...overrides,
  };
}

function hostileManifest(): SecretsExportManifest {
  const version = {
    versionId: 'v1',
    versionNumber: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    data: { user: XSS_SCRIPT, note: XSS_IMG },
    attachments: [
      {
        file: 'attachments/0001-01.jpg',
        role: 'card_front',
        label: XSS_IMG,
        originalName: XSS_SCRIPT,
        mimeType: 'image/jpeg',
        size: 2048,
      },
    ],
  };
  return manifest({
    counts: { secrets: 1, attachments: 1 },
    warnings: [XSS_SCRIPT],
    secrets: [
      {
        id: 's1',
        name: XSS_SCRIPT,
        description: XSS_IMG,
        type: {
          id: 't1',
          name: XSS_IMG,
          fields: [
            { name: 'user', label: XSS_SCRIPT, type: 'string' },
            { name: 'note', label: XSS_IMG, type: 'string' },
          ],
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        current: version,
        versions: [{ ...version, versionId: 'v0', versionNumber: 0 }, version],
      },
    ],
  });
}

describe('escapeHtml', () => {
  it('escapes the five HTML specials and the backtick', () => {
    expect(escapeHtml(`<a href="x" title='y'>&\``)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;',
    );
  });

  it('handles null, undefined and non-strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('does not double-escape in a single pass', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('formatBytes', () => {
  it('formats units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('renderSecretsHtml', () => {
  it('escapes hostile names, descriptions, values, labels and warnings', () => {
    const html = renderSecretsHtml(hostileManifest());

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/onerror=alert\(2\)>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
  });

  it('only emits <img> tags for the attachment, with escaped attributes', () => {
    const html = renderSecretsHtml(hostileManifest());
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const tag of imgs) {
      expect(tag).toContain('src="attachments/0001-01.jpg"');
      // Attribute names outside quoted values: only src, alt and loading.
      const names = [...tag.matchAll(/\s([a-z-]+)="[^"]*"/g)].map((m) => m[1]);
      expect(names).toEqual(['src', 'alt', 'loading']);
    }
  });

  it('includes a CSP meta that forbids scripts and has no external resources', () => {
    const html = renderSecretsHtml(hostileManifest());
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="script-src 'none'/,
    );
    expect(html).not.toMatch(/(src|href)="https?:/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  it('puts old versions in a collapsed details element only when present', () => {
    const withVersions = renderSecretsHtml(hostileManifest());
    expect(withVersions).toContain('<details>');
    expect(withVersions).toContain('Previous versions (1)');

    const m = hostileManifest();
    delete m.secrets[0].versions;
    expect(renderSecretsHtml(m)).not.toContain('<details>');
  });

  it('shows a fallback for an empty backup', () => {
    expect(renderSecretsHtml(manifest())).toContain('This backup contains no secrets.');
  });

  it('notes attachments that were not included', () => {
    const m = hostileManifest();
    m.secrets[0].current!.attachments[0].file = null;
    const html = renderSecretsHtml(m);
    expect(html).toContain('Not included');
  });

  it('shows values of fields no longer in the type under their raw key', () => {
    const m = hostileManifest();
    m.secrets[0].current!.data = { gone: 'old value' };
    const html = renderSecretsHtml(m);
    expect(html).toContain('<th scope="row">gone</th><td>old value</td>');
  });
});

describe('renderReadme', () => {
  it('describes the archive and how to open it', () => {
    const text = renderReadme(
      manifest({ counts: { secrets: 3, attachments: 2 } }),
    );
    expect(text).toContain('7-Zip');
    expect(text).toContain('Keka');
    expect(text).toContain('Secrets:       3');
    expect(text).toContain('Attachments:   2');
    expect(text).toContain('person.a@example.test');
    expect(text).toContain('2026-01-02T03:04:05.000Z');
    expect(text).toContain('None.');
    expect(text).toContain('current versions only');
    expect(text).toContain('attachments/');
    expect(text).toContain('\r\n');
  });

  it('lists warnings', () => {
    const text = renderReadme(manifest({ warnings: ['one problem', 'another'] }));
    expect(text).toContain('- one problem');
    expect(text).toContain('- another');
    expect(text).not.toContain('None.');
  });

  it('reflects excluded attachments and all versions', () => {
    const text = renderReadme(
      manifest({ options: { includeSecrets: true, includeAttachments: false, includeVersions: true, includeMedia: false } }),
    );
    expect(text).toContain('(attachments were excluded)');
    expect(text).toContain('all versions');
    expect(text).not.toContain('attachments/   Attached files');
  });
});
