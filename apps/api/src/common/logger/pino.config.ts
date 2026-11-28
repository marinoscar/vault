import pino from 'pino';

import { redactLogText } from '../../platform/log-redaction/redact';
import { resolveServiceName } from '../otel/telemetry-identity';

export const pinoConfig: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      service: resolveServiceName(),
    }),
  },
  // Masks query values and token-shaped strings in the message of every line.
  hooks: {
    logMethod(args, method) {
      const redacted = args.map((a) => (typeof a === 'string' ? redactLogText(a) : a));
      return method.apply(this, redacted as unknown as Parameters<typeof method>);
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
};

export const createLogger = () => pino(pinoConfig);
