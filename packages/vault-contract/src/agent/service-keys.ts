import { z } from 'zod';

import { serviceKeyIdSchema } from '../secret-types/service-keys.js';

/**
 * Service keys on the agent API (contract 1.4, issue #241): `GET /api/agent/v1/service-keys/:service/:name`
 * returns the value of a `Service Key` secret the owner opened to agents, to the calling **server
 * process** only. It is not bound to a website: the caller names the `service` and the key's
 * `name`, chosen by its own configuration, never by a model or a page.
 *
 * Request and response shapes only. Behaviour (the per-secret opt-in, the kill switch, the
 * per-owner rate limit, audit) is the API's. The one secret field of the response is `value`.
 *
 * @packageDocumentation
 */

/** The path template of the route, under {@link AGENT_API_BASE_PATH}. @stability beta */
export const AGENT_SERVICE_KEYS_PATH = '/service-keys/:service/:name' as const;

/**
 * Releases of service keys per owner and service per minute (the `service_key` bucket). A constant,
 * like the MCP limit: a search is about one release and a host caches the value briefly.
 *
 * @stability beta
 */
export const AGENT_SERVICE_KEY_PER_MINUTE = 120;

/**
 * The purpose a service key release records in the audit row: a server-side call to the service.
 * The route takes no `purpose`; this one is implied.
 *
 * @stability beta
 */
export const AGENT_SERVICE_KEY_PURPOSE = 'service_call' as const;

/**
 * Path parameters of the route: `service` (`web_search`) and `name` (`provider_a`), each trimmed,
 * lower-cased and matched against `SERVICE_KEY_ID_PATTERN` of `@marinoscar/vault-contract/secret-types`.
 * An invalid one is a `400`.
 *
 * @stability beta
 */
export const agentServiceKeyParamsSchema = z.object({
  service: serviceKeyIdSchema,
  name: serviceKeyIdSchema,
});

/** @stability beta */
export type AgentServiceKeyParams = z.infer<typeof agentServiceKeyParamsSchema>;

/**
 * Response of the route: the key's value, for the calling server process. Never put it in a model's
 * context, a log, a span or a response of your own; hold it in memory for the call and wipe it.
 *
 * @stability beta
 */
export const agentServiceKeyResponseSchema = z.object({ data: z.object({ value: z.string() }) });

/** @stability beta */
export type AgentServiceKeyResponse = z.infer<typeof agentServiceKeyResponseSchema>;
