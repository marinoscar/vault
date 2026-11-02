import { MeterProvider, MetricReader, type MetricData } from '@opentelemetry/sdk-metrics';
import { appMetricRegistry, MetricsHostService } from '@marinoscar/platform-api/otel-core';
import type { AppMetricsService } from '@marinoscar/platform-api/host';

import '../../src/common/otel/app-metric.manifest';
import { VAULT_APP_METRICS, secretTypeKind } from '../../src/common/otel/vault-metrics';
import { VaultMetricsService } from '../../src/common/otel/vault-metrics.service';

// =============================================================================
// Vault's metric labels carry no personal data (issue #90, E9.2)
// =============================================================================
//
// A metric label becomes a column of an exported table that anyone with
// `telemetry:query` can read. Vault's labels are closed enums; this proves it
// three ways: by declaration (every attribute is an enum, no identifier-like
// key, no identifier-like value), by the type-kind mapping (a custom secret type
// name never becomes a label), and by recording (an identifier passed where a
// label goes is exported as `other`, an undeclared label key is dropped).
// =============================================================================

const UUID = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const EMAIL = 'person.a@example.test';
const SECRET_NAME = 'Org Alpha production database password';

/** Attribute keys that would name a person, an account, a secret or a file. */
const FORBIDDEN_KEY = /(^|_)(user|email|org|organization|owner|actor|secret_?(id|name)|name|title|id|key|file|path|url|ip|token)(_|$)/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

async function collect(reader: TestReader): Promise<MetricData[]> {
  const { resourceMetrics, errors } = await reader.collect();
  expect(errors).toEqual([]);
  return resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
}

function attributesOf(metric: MetricData | undefined): Record<string, unknown>[] {
  return (metric?.dataPoints ?? []).map((point) => ({ ...point.attributes }));
}

describe('Vault metric declarations', () => {
  it('registers every app.vault.* metric with the platform registry', () => {
    const registered = new Set(appMetricRegistry.ids());
    for (const def of VAULT_APP_METRICS) {
      expect(registered.has(def.key)).toBe(true);
      expect(def.name).toMatch(/^app\.vault\./);
    }
    expect(VAULT_APP_METRICS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(VAULT_APP_METRICS.map((def) => [def.name, def] as const))('%s: every attribute is a closed enum', (_name, def) => {
    for (const [key, attribute] of Object.entries(def.attributes ?? {})) {
      expect({ key, kind: attribute.kind }).toEqual({ key, kind: 'enum' });
    }
  });

  it.each(VAULT_APP_METRICS.map((def) => [def.name, def] as const))('%s: no attribute key or value can identify anyone', (_name, def) => {
    for (const [key, attribute] of Object.entries(def.attributes ?? {})) {
      expect({ key, forbidden: FORBIDDEN_KEY.test(key) }).toEqual({ key, forbidden: false });
      if (attribute.kind !== 'enum') continue;
      for (const value of attribute.values) {
        expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(value).not.toMatch(UUID_SHAPE);
        expect(value).not.toContain('@');
      }
    }
  });
});

describe('secretTypeKind', () => {
  it('maps a system type to its well-known kind', () => {
    expect(secretTypeKind({ isSystem: true, name: 'Credential' })).toBe('credential');
    expect(secretTypeKind({ isSystem: true, name: 'API Key' })).toBe('api_key');
    expect(secretTypeKind({ isSystem: true, name: 'Card' })).toBe('card');
  });

  it('never returns the name of a custom type, whatever it says', () => {
    for (const name of [SECRET_NAME, EMAIL, UUID, 'Card', 'Credential']) {
      expect(secretTypeKind({ isSystem: false, name })).toBe('custom');
    }
    expect(secretTypeKind(null)).toBe('custom');
  });

  it('maps an unknown system type to custom rather than echoing it', () => {
    expect(secretTypeKind({ isSystem: true, name: SECRET_NAME })).toBe('custom');
  });
});

describe('recorded Vault metrics', () => {
  async function setup() {
    const reader = new TestReader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter('app');
    const host = new MetricsHostService({ meter, gateOpen: () => true });
    // `AppMetricsService.add` / `.record` delegate to the host with the same signature.
    const metrics = new VaultMetricsService(host as unknown as AppMetricsService);
    return { reader, host, metrics };
  }

  it('records the typed emitters with their declared labels only', async () => {
    const { reader, metrics } = await setup();
    metrics.secretCreated('api_key');
    metrics.secretVersionCreated('rollback');
    metrics.backupFinished({ scope: 'user', trigger: 'manual', outcome: 'succeeded', durationMs: 2500 });
    metrics.cardExtracted('succeeded');

    const data = await collect(reader);
    const byName = Object.fromEntries(data.map((m) => [m.descriptor.name, m]));

    expect(attributesOf(byName['app.vault.secrets.created'])).toEqual([{ type_kind: 'api_key' }]);
    expect(attributesOf(byName['app.vault.secret_versions.created'])).toEqual([{ source: 'rollback' }]);
    expect(attributesOf(byName['app.vault.backups.runs'])).toEqual([{ scope: 'user', trigger: 'manual', outcome: 'succeeded' }]);
    expect(attributesOf(byName['app.vault.backups.duration'])).toEqual([{ scope: 'user', trigger: 'manual', outcome: 'succeeded' }]);
    expect(attributesOf(byName['app.vault.cards.extractions'])).toEqual([{ outcome: 'succeeded' }]);
  });

  it('exports an identifier passed as a label value as "other", never as itself', async () => {
    const { reader, host } = await setup();
    for (const leak of [UUID, EMAIL, SECRET_NAME]) {
      host.add('vaultSecretsCreated', 1, { type_kind: leak });
      host.add('vaultCardExtractions', 1, { outcome: leak });
    }

    const exported = JSON.stringify(await collect(reader).then((data) => data.flatMap((m) => attributesOf(m))));
    for (const leak of [UUID, EMAIL, SECRET_NAME]) {
      expect(exported).not.toContain(leak);
    }
    expect(exported).toContain('other');
  });

  it('drops an undeclared label key (a user or secret id cannot ride along)', async () => {
    const { reader, host } = await setup();
    host.add('vaultSecretsCreated', 1, { type_kind: 'note', user_id: UUID, secret_name: SECRET_NAME, email: EMAIL });

    const attributes = attributesOf((await collect(reader)).find((m) => m.descriptor.name === 'app.vault.secrets.created'));
    expect(attributes).toEqual([{ type_kind: 'note' }]);
  });
});
