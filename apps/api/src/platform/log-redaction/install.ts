import { Logger } from '@nestjs/common';

import { redactLogArg } from './redact';

const INSTALLED = Symbol.for('vault.logRedaction.installed');
const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

/**
 * Wraps the Nest `Logger` facade so every string handed to it is redacted
 * before it reaches whichever sink is configured (the platform filter and
 * request logger both log through it). Idempotent. Host glue for the stop-gap
 * in docs/platform-adoption/local-exceptions.md; remove when the platform
 * logs paths without query values.
 */
export function installLogRedaction(): void {
  const proto = Logger.prototype as unknown as Record<string | symbol, unknown>;
  if (proto[INSTALLED]) return;
  for (const level of LEVELS) {
    const original = proto[level] as (...args: unknown[]) => unknown;
    proto[level] = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, args.map(redactLogArg));
    };
  }
  proto[INSTALLED] = true;
}

installLogRedaction();
