import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../utils/test-utils.js';
import { CardFlowStepper } from '../../src/cards/ui/components/CardFlowStepper.js';

function current(): string | null {
  return document.querySelector('[aria-current="step"]')?.textContent ?? null;
}

describe('CardFlowStepper', () => {
  it('lists Capture, Crop, Review and Save in order', () => {
    const { container } = render(<CardFlowStepper active="capture" />);
    const labels = [...container.querySelectorAll('.MuiStepLabel-label')].map((el) => el.textContent);
    expect(labels).toEqual(['Capture', 'Crop', 'Review', 'Save']);
  });

  it.each(['capture', 'crop', 'review', 'save'] as const)('marks %s as the current step', (step) => {
    render(<CardFlowStepper active={step} />);
    // The step icon renders its number before the label.
    expect(current()?.toLowerCase()).toMatch(new RegExp(`${step}$`));
  });

  it('says a passed-over step was skipped, and does not tick it', () => {
    const { container } = render(<CardFlowStepper active="review" skipped={new Set(['crop'])} />);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    const steps = container.querySelectorAll('.MuiStep-root');
    expect(steps[0]).toHaveClass('Mui-completed');
    expect(steps[1]).not.toHaveClass('Mui-completed');
  });

  it('does not show "Skipped" for a step not yet reached', () => {
    render(<CardFlowStepper active="capture" skipped={new Set(['crop'])} />);
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
  });

  it('ticks every step once done', () => {
    const { container } = render(<CardFlowStepper active="save" done />);
    expect(container.querySelectorAll('.MuiStep-root.Mui-completed')).toHaveLength(4);
    expect(current()).toBeNull();
  });
});
