import type { core } from 'zod';

/**
 * Zod 4 replacement for the Zod 3 `required_error` / `invalid_type_error`
 * params: one `error` function that answers with `required` when the value is
 * missing (`undefined`) and `invalid` for any other type mismatch.
 *
 * Other issue kinds (length, format, ...) return `undefined` so Zod keeps the
 * message given to the check itself.
 *
 * @stability experimental
 */
export function typeErrors(messages: {
  required?: string;
  invalid: string;
}): (issue: core.$ZodRawIssue) => string | undefined {
  return (issue) => {
    if (issue.code !== 'invalid_type') return undefined;
    return issue.input === undefined ? (messages.required ?? 'Required') : messages.invalid;
  };
}

/**
 * Paging fields shared by the list queries. `pageSize` is capped at 100.
 *
 * @stability experimental
 */
export const PAGE_SIZE_MAX = 100;
