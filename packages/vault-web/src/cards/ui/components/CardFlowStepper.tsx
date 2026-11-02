import { Step, StepLabel, Stepper, Typography } from '@mui/material';

/** The four steps every card flow walks (import and renew; E10.5, spec §8). */
export type CardFlowStep = 'capture' | 'crop' | 'review' | 'save';

export const CARD_FLOW_STEPS: readonly { id: CardFlowStep; label: string }[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'crop', label: 'Crop' },
  { id: 'review', label: 'Review' },
  { id: 'save', label: 'Save' },
];

interface CardFlowStepperProps {
  active: CardFlowStep;
  /**
   * Steps that were passed over (no photo taken, so nothing to crop). They are
   * still listed, so the flow reads the same every time, but say "Skipped".
   */
  skipped?: ReadonlySet<CardFlowStep>;
  /** True once the save went through: every step shows as done. */
  done?: boolean;
}

/**
 * Capture → Crop → Review → Save, the same four steps for scanning a new card
 * and renewing one. Labels sit under the icons (`alternativeLabel`) so the
 * four fit a 390px phone without wrapping. The active step is exposed to
 * assistive technology through `aria-current="step"`.
 */
export function CardFlowStepper({ active, skipped, done = false }: CardFlowStepperProps) {
  const activeIndex = done
    ? CARD_FLOW_STEPS.length
    : CARD_FLOW_STEPS.findIndex((step) => step.id === active);

  return (
    <Stepper
      activeStep={activeIndex}
      alternativeLabel
      aria-label="Progress"
      sx={{ my: { xs: 2, sm: 3 }, mx: { xs: -1, sm: 0 } }}
    >
      {CARD_FLOW_STEPS.map((step, index) => {
        const isSkipped = skipped?.has(step.id) && index < activeIndex;
        return (
          <Step
            key={step.id}
            completed={index < activeIndex && !isSkipped}
            aria-current={index === activeIndex ? 'step' : undefined}
          >
            <StepLabel
              optional={
                isSkipped ? (
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    Skipped
                  </Typography>
                ) : undefined
              }
            >
              {step.label}
            </StepLabel>
          </Step>
        );
      })}
    </Stepper>
  );
}
