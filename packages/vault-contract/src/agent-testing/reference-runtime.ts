import type { AgentCredentialSummary } from '../agent/index.js';
import type { AgentTokens } from './fake-vault.js';
import type {
  ConformanceField,
  ConformancePage,
  ConformanceSignIn,
  ConformanceVaultAccess,
  SignInResult,
} from './scenarios.js';

/**
 * A minimal runtime that follows the guide (`docs/agent-credential-api.md`, sections 4 and 5). Vault
 * runs the scenario list with it against the fake and against the real API; a runtime author can
 * read it as a worked example. It is not a product: no browser, no model, one page at a time.
 */

/** Thrown inside the reference runtime to end a sign-in with a result. */
class Stop extends Error {
  constructor(readonly result: SignInResult) {
    super(result.status);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The reference runtime's `signIn`. It keeps one access token between pages (tokens are not
 * values), and nothing else: every page starts with a fresh lookup.
 *
 * @stability beta
 */
export function createReferenceSignIn(): ConformanceSignIn {
  let tokens: AgentTokens | null = null;

  return async (page: ConformancePage, vault: ConformanceVaultAccess): Promise<SignInResult> => {
    /** One agent API call: reconnects once on 401, waits out a 429, stops on any other refusal. */
    const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> => {
      let reconnected = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!tokens) tokens = await vault.connect();
        const res = await fetch(`${vault.apiBaseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${tokens.accessToken}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: unknown; code?: string };
        if (res.ok) return json.data;
        if (res.status === 401 && !reconnected) {
          // A revoked grant: the person reconnects once. Never retry the dead token.
          tokens = null;
          reconnected = true;
          continue;
        }
        if (res.status === 429) {
          const seconds = Number(res.headers.get('retry-after') ?? '1');
          await sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 1) * 1000);
          continue;
        }
        if (res.status === 404) throw new Stop({ status: 'no_login' });
        // ORIGIN_MISMATCH, the kill switches, a missing scope: stop and tell the person. No retry.
        throw new Stop({ status: 'stopped', ...(json.code ? { code: json.code } : {}), message: `Vault refused (${res.status})` });
      }
      throw new Stop({ status: 'stopped', message: 'Vault kept refusing' });
    };

    /** Fills ONE field: the page's origin read right before, the value typed at once, the buffer zeroed. */
    const fillAndType = async (id: string, field: 'username' | 'password', target: ConformanceField) => {
      const origin = page.origin;
      const data = (await call('POST', `/credentials/${id}/fill`, { field, origin, purpose: 'login' })) as { value: string };
      if (page.origin !== origin) throw new Stop({ status: 'stopped', message: 'The page navigated' });
      const buffer = new TextEncoder().encode(data.value);
      try {
        await page.type(target, buffer);
      } finally {
        buffer.fill(0);
      }
    };

    try {
      const origin = page.origin;
      const found = (await call('GET', `/credentials?origin=${encodeURIComponent(origin)}`)) as AgentCredentialSummary[];
      const exact = found.filter((c) => c.matchKind === 'exact');
      if (exact.length === 0) return { status: 'no_login' };
      let chosen = exact[0]!;
      if (exact.length > 1) {
        const id = await page.askPerson(
          'Which login should be used?',
          exact.map((c) => ({ id: c.id, label: `${c.name} (${c.username ?? 'no username'})` })),
        );
        const pick = exact.find((c) => c.id === id);
        if (!pick) return { status: 'no_login', message: 'The person chose none' };
        chosen = pick;
      }
      await fillAndType(chosen.id, 'username', 'username');
      await fillAndType(chosen.id, 'password', 'password');
      if (page.asksForCode && chosen.hasTotp) {
        // Fetched right before typing: a code lives for its period only.
        const codeOrigin = page.origin;
        const data = (await call('POST', `/credentials/${chosen.id}/totp`, { origin: codeOrigin, purpose: 'mfa' })) as { code: string };
        const buffer = new TextEncoder().encode(data.code);
        try {
          await page.type('code', buffer);
        } finally {
          buffer.fill(0);
        }
      }
      return { status: 'signed_in' };
    } catch (error) {
      if (error instanceof Stop) return error.result;
      return { status: 'stopped', message: 'The runtime failed' };
    }
  };
}

