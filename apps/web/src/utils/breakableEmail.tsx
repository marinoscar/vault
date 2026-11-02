import type { ReactNode } from 'react';

/**
 * An email address with a line-break opportunity after the `@`, so a narrow
 * table cell wraps it as `person.a@` / `example.test` instead of at an
 * arbitrary character. The text content is unchanged.
 */
export function breakableEmail(email: string): ReactNode {
  const at = email.indexOf('@');
  if (at < 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}
