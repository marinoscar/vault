/**
 * The conformance kit of the agent contract (`@marinoscar/vault-contract/agent-testing`, issue
 * #196), for the tests of an agent runtime that types Vault logins:
 *
 * - {@link createFakeVault}: a small in-memory `/api/agent/v1` built from the contract schemas,
 *   seeded with invented data, refusing to start with `NODE_ENV=production`. Not a secrets store.
 * - {@link seedCanaries}, {@link assertNoCanary}, {@link findCanaries}: canary values and the scan
 *   of a runtime's logs, traces, transcripts, screenshots and files.
 * - {@link AGENT_CONFORMANCE_SCENARIOS} (the list as data) and {@link runAgentConformance} /
 *   {@link assertAgentConformance}: the scenario suite, called with the runtime's own
 *   "sign in to this page" function.
 * - {@link createReferenceSignIn}: a minimal runtime that passes the suite, as a worked example.
 *
 * Node only (it uses `node:http`, `node:crypto`, `node:fs`); no test framework at run time. Passing
 * the kit shows the runtime follows the guide's rules against a Vault that behaves like Vault; it
 * does not prove the runtime keeps values out of places the kit cannot see (see the README).
 *
 * @stability beta
 * @packageDocumentation
 */

export * from './guard.js';
export * from './canary.js';
export * from './seed.js';
export * from './totp.js';
export * from './fake-vault.js';
export * from './scenarios.js';
export * from './reference-runtime.js';
export type { ConformanceEvent } from './recorder.js';
