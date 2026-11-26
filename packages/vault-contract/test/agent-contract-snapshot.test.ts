// =============================================================================
// The agent contract may only change the way the stability promise allows (issue #196)
// =============================================================================
//
// `agent-contract/snapshot.json` is the last accepted description of `./agent` (field names,
// requiredness, enums of every public schema, plus AGENT_SCOPES, AGENT_ERROR_CODES and the other
// promised constants). The gate compares it with the code: an additive change passes; a breaking
// one fails until the contract moves to a new path version, the changelog says ACCEPT_BREAKING and
// the snapshot is refreshed. Refresh it (after an additive change, or an accepted breaking one) with
//
//   UPDATE_AGENT_CONTRACT_SNAPSHOT=1 npx vitest run test/agent-contract-snapshot.test.ts
//
// which refuses to write while the gate fails. The second half demonstrates both outcomes on
// modified copies of the real schemas.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as agent from '../src/agent/index.js';
import {
  SCHEMA_ROLES,
  checkAgentContract,
  describeAgentContract,
  parseChangelog,
  type ContractDescription,
} from './agent-contract/classify.js';

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_FILE = join(here, 'agent-contract', 'snapshot.json');
const GUIDE = readFileSync(join(here, '..', '..', '..', 'docs', 'agent-credential-api.md'), 'utf8');

const current = describeAgentContract(agent as unknown as Record<string, unknown>);
const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as ContractDescription;

/** The real exports with some replaced or removed: a "what if the code changed like this" copy. */
function variant(changes: Record<string, unknown>, remove: string[] = []): ContractDescription {
  const copy: Record<string, unknown> = { ...(agent as unknown as Record<string, unknown>), ...changes };
  for (const name of remove) delete copy[name];
  return describeAgentContract(copy);
}

describe('agent contract snapshot (the promise, enforced)', () => {
  it('the code matches the committed snapshot, or differs only additively', () => {
    const result = checkAgentContract(snapshot, current, GUIDE);
    if (process.env.UPDATE_AGENT_CONTRACT_SNAPSHOT === '1') {
      expect(result.problems).toEqual([]);
      writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    expect(result.problems).toEqual([]);
    expect(result.breaking).toEqual([]);
  });

  it('the snapshot is at the current contract version (refresh it after an additive change)', () => {
    expect(snapshot.version).toBe(agent.AGENT_CONTRACT_VERSION);
    expect(current).toEqual(snapshot);
  });

  it('covers every public schema of ./agent and the promised constants', () => {
    const exported = Object.keys(current.schemas).sort();
    expect(exported.length).toBeGreaterThan(40);
    expect(exported.filter((name) => !(name in SCHEMA_ROLES))).toEqual([]);
    expect(Object.keys(SCHEMA_ROLES).filter((name) => !exported.includes(name))).toEqual([]);
    expect(Object.keys(current.constants).sort()).toEqual(
      ['AGENT_API_BASE_PATH', 'AGENT_CONTRACT_FEATURES', 'AGENT_ERROR_CODES', 'AGENT_IDENTITY_FIELDS', 'AGENT_SCOPES'].sort(),
    );
    expect(current.schemas.agentFillRequestSchema!.shape).toEqual({
      type: 'object',
      fields: {
        field: { required: true, nullable: false, shape: { type: 'enum', values: ['username', 'password'] } },
        origin: { required: true, nullable: false, shape: { type: 'primitive', name: 'string' } },
        purpose: { required: true, nullable: false, shape: { type: 'enum', values: ['login', 'signup', 'password_change', 'mfa', 'save_login'] } },
      },
    });
  });

  it('the changelog lists every contract version, newest first, each marked additive or breaking', () => {
    const entries = parseChangelog(GUIDE);
    expect(entries.map((e) => e.version)).toEqual(['1.4', '1.3', '1.2', '1.1', '1.0']);
    expect(entries.every((e) => e.kind === 'additive')).toBe(true);
    expect(entries[0]!.body).toMatch(/service-keys/);
    expect(entries[1]!.body).toMatch(/save_login/);
    expect(entries[3]!.body).toMatch(/cards/i);
  });
});

describe('agent contract classifier: additive passes, breaking fails (demonstration)', () => {
  const additiveCases: Array<[string, ContractDescription]> = [
    ['a new optional request field', variant({ agentFillRequestSchema: agent.agentFillRequestSchema.extend({ hint: z.string().optional() }) })],
    [
      'a new response field',
      variant({ agentCredentialSummarySchema: agent.agentCredentialSummarySchema.extend({ favicon: z.string().nullable() }) }),
    ],
    ['a new scope', variant({ AGENT_SCOPES: { ...agent.AGENT_SCOPES, NOTES_READ: 'vault:notes_read' } })],
    ['a new error code', variant({ AGENT_ERROR_CODES: { ...agent.AGENT_ERROR_CODES, NOTE_ACCESS_DISABLED: 'NOTE_ACCESS_DISABLED' } })],
    ['a new enum value in a request', variant({ agentPurposeSchema: z.enum(['login', 'signup', 'password_change', 'mfa', 'save_login', 'recovery']) })],
    ['a new feature id', variant({ AGENT_CONTRACT_FEATURES: { ...agent.AGENT_CONTRACT_FEATURES, NOTES: 'notes' } })],
  ];

  it('the real 1.1 -> 1.2 change (whoami gains contract) is additive', () => {
    const v11 = variant(
      {
        AGENT_CONTRACT_VERSION: '1.1',
        agentWhoamiResponseSchema: z.object({ data: z.object({ userId: z.string(), scopes: z.array(z.string()), clientId: z.string().nullable() }) }),
      },
      ['agentContractInfoSchema', 'AGENT_CONTRACT_FEATURES'],
    );
    const result = checkAgentContract(v11, current, GUIDE);
    expect(result.breaking).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.additive.map((c) => c.path)).toEqual(
      expect.arrayContaining(['agentWhoamiResponseSchema.data.contract', 'agentContractInfoSchema', 'AGENT_CONTRACT_FEATURES']),
    );
  });

  it.each(additiveCases)('%s is additive and passes the gate', (_label, changed) => {
    const result = checkAgentContract(snapshot, changed, GUIDE);
    expect(result.additive.length).toBeGreaterThan(0);
    expect(result.breaking).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  const breakingCases: Array<[string, ContractDescription, RegExp]> = [
    ['a removed request field', variant({ agentTotpRequestSchema: agent.agentTotpRequestSchema.omit({ purpose: true }) }), /agentTotpRequestSchema\.purpose \(field removed/],
    [
      'a renamed response field',
      variant({ agentTotpResponseSchema: z.object({ data: z.object({ otp: z.string(), expiresAt: z.string() }) }) }),
      /agentTotpResponseSchema\.data\.code \(field removed or renamed\)/,
    ],
    [
      'an optional request field made required',
      variant({ agentCardFillRequestSchema: agent.agentCardFillRequestSchema.extend({ frameOrigin: z.string() }) }),
      /agentCardFillRequestSchema\.frameOrigin \(became required\)/,
    ],
    ['a new required request field', variant({ agentFillRequestSchema: agent.agentFillRequestSchema.extend({ nonce: z.string() }) }), /new required field/],
    ['a removed enum value', variant({ agentPurposeSchema: z.enum(['login', 'signup', 'password_change']) }), /enum value 'mfa' removed/],
    [
      'a response field made optional',
      variant({ agentCredentialSummarySchema: agent.agentCredentialSummarySchema.extend({ hasTotp: z.boolean().optional() }) }),
      /hasTotp \(became optional\)/,
    ],
    ['a removed scope', variant({ AGENT_SCOPES: Object.fromEntries(Object.entries(agent.AGENT_SCOPES).filter(([key]) => key !== 'ITEMS_WRITE')) }), /AGENT_SCOPES\.ITEMS_WRITE/],
    [
      'a renamed error code',
      variant({ AGENT_ERROR_CODES: { ...agent.AGENT_ERROR_CODES, ORIGIN_MISMATCH: 'WRONG_ORIGIN' } }),
      /AGENT_ERROR_CODES\.ORIGIN_MISMATCH \(value changed/,
    ],
    ['a removed schema', variant({}, ['agentWhoamiResponseSchema']), /agentWhoamiResponseSchema \(schema removed/],
    ['a moved base path', variant({ AGENT_API_BASE_PATH: '/api/agents/v1' }), /AGENT_API_BASE_PATH/],
  ];

  it.each(breakingCases)('%s is breaking and fails the gate', (_label, changed, message) => {
    const result = checkAgentContract(snapshot, changed, GUIDE);
    expect(result.breaking.length).toBeGreaterThan(0);
    expect(result.problems.join('\n')).toMatch(message);
  });

  it('a breaking change passes only with a new path version, a new major and an ACCEPT_BREAKING changelog entry', () => {
    const base = { agentPurposeSchema: z.enum(['login', 'signup', 'password_change']) };
    const v2Entry = '## 8. Changes\n\n### 2.0 (breaking) ACCEPT_BREAKING\n\n- `mfa` purpose removed.\n\n### 1.4 (additive)\n\n- service keys.\n\n### 1.3 (additive)\n\n- save_login purpose.\n';

    // Changelog says so, but the path is still v1: refused (a breaking change is /api/agent/v2).
    const sameRoute = checkAgentContract(snapshot, variant({ ...base, AGENT_CONTRACT_VERSION: '2.0' }), v2Entry);
    expect(sameRoute.problems.join('\n')).toMatch(/breaking change/);

    // A "(breaking)" entry without the marker: refused.
    const noMarker = checkAgentContract(
      snapshot,
      variant({ ...base, AGENT_CONTRACT_VERSION: '2.0', AGENT_API_BASE_PATH: '/api/agent/v2' }),
      v2Entry.replace(' ACCEPT_BREAKING', ''),
    );
    expect(noMarker.problems.join('\n')).toMatch(/does not say ACCEPT_BREAKING/);

    // All three: accepted (the path change itself is part of the accepted break).
    const accepted = checkAgentContract(
      snapshot,
      variant({ ...base, AGENT_CONTRACT_VERSION: '2.0', AGENT_API_BASE_PATH: '/api/agent/v2' }),
      v2Entry,
    );
    expect(accepted.breaking.length).toBeGreaterThan(0);
    expect(accepted.problems).toEqual([]);
  });

  it('an additive change with a version the changelog does not list fails until the entry is written', () => {
    const changed = variant({
      AGENT_CONTRACT_VERSION: '1.5',
      agentFillRequestSchema: agent.agentFillRequestSchema.extend({ hint: z.string().optional() }),
    });
    expect(checkAgentContract(snapshot, changed, GUIDE).problems.join('\n')).toMatch(/no entry for contract 1\.5/);
    const withEntry = GUIDE.replace('### 1.4 (additive)', '### 1.5 (additive)\n\n- fill takes an optional hint.\n\n### 1.4 (additive)');
    expect(checkAgentContract(snapshot, changed, withEntry).problems).toEqual([]);
  });
});
