import { z } from 'zod';

/**
 * The version of the agent contract (issue #196): `<path major>.<minor>`. The major is the `v` of
 * the base path (`/api/agent/v1` is major 1) and changes only with a new path; the minor grows
 * with every additive change listed under "Changes" in `docs/agent-credential-api.md`.
 *
 * - `1.0`: logins (lookup, fill, totp, create, rotate) and `whoami`.
 * - `1.1`: cards and identity (ADR-0003).
 * - `1.2`: `whoami.contract`, the stability promise, the conformance kit.
 * - `1.3`: the purpose `save_login` and the feature id `save_login`.
 * - `1.4`: service keys (`/service-keys/:service/:name`, scope `vault:service_keys_read`) and the feature id `service_keys`.
 *
 * @stability beta
 */
export const AGENT_CONTRACT_VERSION = '1.4' as const;

/**
 * The feature ids `whoami` can report in `contract.features`. A runtime must ignore an id it does
 * not know: a newer Vault may report more.
 *
 * - `logins`: the login routes (`/credentials`, fill, create, rotate).
 * - `totp`: one-time codes of logins (`/credentials/:id/totp`).
 * - `save_login`: the purpose `save_login`, for saving a login the owner already uses (`POST /credentials`).
 * - `service_keys`: service keys for a server process (`/service-keys/:service/:name`, contract 1.4).
 * - `cards`: card release (`/cards`); only while `agentAccess.cards.enabled` is on.
 * - `identity`: identity release (`/identity`); only while `agentAccess.identity.enabled` is on.
 *
 * @stability beta
 */
export const AGENT_CONTRACT_FEATURES = {
  LOGINS: 'logins',
  TOTP: 'totp',
  SAVE_LOGIN: 'save_login',
  SERVICE_KEYS: 'service_keys',
  CARDS: 'cards',
  IDENTITY: 'identity',
} as const;

/** @stability beta */
export type AgentContractFeature = (typeof AGENT_CONTRACT_FEATURES)[keyof typeof AGENT_CONTRACT_FEATURES];

/**
 * `whoami`'s `contract` block: the contract version this Vault speaks and the features it offers
 * now. `features` is plain strings, not an enum, so a runtime keeps parsing a newer Vault's answer.
 *
 * @stability beta
 */
export const agentContractInfoSchema = z.object({
  version: z.string(),
  features: z.array(z.string()),
});

/** @stability beta */
export type AgentContractInfo = z.infer<typeof agentContractInfoSchema>;

/**
 * The `contract` block a Vault with these switches reports. Logins, codes, `save_login` and `service_keys` are on
 * whenever the agent API answers at all; cards and identity follow their own switches.
 *
 * @stability beta
 */
export function agentContractInfoFor(switches: {
  cards: { enabled: boolean };
  identity: { enabled: boolean };
}): AgentContractInfo {
  const features: string[] = [
    AGENT_CONTRACT_FEATURES.LOGINS,
    AGENT_CONTRACT_FEATURES.TOTP,
    AGENT_CONTRACT_FEATURES.SAVE_LOGIN,
    AGENT_CONTRACT_FEATURES.SERVICE_KEYS,
  ];
  if (switches.cards.enabled) features.push(AGENT_CONTRACT_FEATURES.CARDS);
  if (switches.identity.enabled) features.push(AGENT_CONTRACT_FEATURES.IDENTITY);
  return { version: AGENT_CONTRACT_VERSION, features };
}
