import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { breakableEmail } from '../../utils/breakableEmail';

describe('breakableEmail', () => {
  it('keeps the text and offers a break right after the @', () => {
    const { container } = render(<span>{breakableEmail('person.a@example.test')}</span>);
    expect(container.textContent).toBe('person.a@example.test');
    expect(container.querySelector('span')!.innerHTML).toBe('person.a@<wbr>example.test');
  });

  it('returns a string with no @ unchanged', () => {
    expect(breakableEmail('not-an-email')).toBe('not-an-email');
  });
});
