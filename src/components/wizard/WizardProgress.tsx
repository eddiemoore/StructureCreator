import type { WizardStep } from "../../types/schema";

interface WizardProgressProps {
  steps: WizardStep[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

/**
 * WizardProgress - Displays step progress indicators for the wizard.
 *
 * Shows completed, current, and future steps with visual indicators.
 * Allows clicking on completed steps to navigate back.
 */
export const WizardProgress = ({ steps, currentStep, onStepClick }: WizardProgressProps) => {
  return (
    <nav aria-label="Wizard progress">
      <ol className="flex items-center justify-center gap-2">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isClickable = onStepClick && index < currentStep;

          return (
            <li key={`${step.id}-${index}`} className="flex items-center">
              {index > 0 && (
                <div
                  className={`w-8 h-0.5 mx-1 transition-colors ${
                    index <= currentStep ? "bg-accent" : "bg-border-muted"
                  }`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={isClickable ? () => onStepClick(index) : undefined}
                disabled={!isClickable}
                className={`
                  relative flex items-center justify-center w-8 h-8 rounded-full
                  text-mac-sm font-medium transition-colors
                  ${isCompleted
                    ? "bg-accent text-white"
                    : isCurrent
                    ? "bg-accent text-white ring-2 ring-accent ring-offset-2 ring-offset-card-bg"
                    : "bg-border-muted text-text-muted opacity-60"
                  }
                  ${isClickable
                    ? "cursor-pointer hover:ring-2 hover:ring-accent/50 hover:ring-offset-1"
                    : isCurrent
                    ? "cursor-default"
                    : "cursor-not-allowed"
                  }
                `}
                title={step.title}
                aria-label={`${step.title}${isCompleted ? " (completed)" : isCurrent ? " (current)" : " (upcoming)"}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
