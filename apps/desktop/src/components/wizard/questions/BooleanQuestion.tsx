import type { WizardQuestion } from "../../../types/schema";
import { WIZARD_UI_STRINGS } from "../../../utils/wizardUtils";

interface BooleanQuestionProps {
  question: WizardQuestion;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  error?: string | null;
}

/**
 * Boolean question component - renders Yes/No as radio-style buttons.
 * Uses radiogroup semantics for proper accessibility.
 */
export const BooleanQuestion = ({ question, value, onChange, error }: BooleanQuestionProps) => {
  const questionId = `question-${question.id}`;
  const helpId = `${questionId}-help`;
  const errorId = `${questionId}-error`;

  // aria-checked should be undefined when no selection, not false
  const yesChecked = value === true ? "true" : value === false ? "false" : undefined;
  const noChecked = value === false ? "true" : value === true ? "false" : undefined;

  // Build aria-describedby from available descriptions
  const describedBy = [
    question.helpText ? helpId : null,
    error ? errorId : null,
  ].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset
      className="space-y-2"
      aria-describedby={describedBy}
      aria-invalid={!!error}
    >
      <legend className="text-mac-sm font-medium text-text-primary">
        {question.question}
        {question.validation?.required && (
          <span className="text-system-red ml-1" aria-hidden="true">*</span>
        )}
      </legend>
      {question.helpText && (
        <p id={helpId} className="text-mac-xs text-text-muted">{question.helpText}</p>
      )}
      <div className="flex gap-3" role="radiogroup" aria-label={question.question}>
        <button
          type="button"
          role="radio"
          onClick={() => onChange(true)}
          className={`flex-1 py-2.5 px-4 rounded-mac border text-mac-sm font-medium transition-colors ${
            value === true
              ? "bg-accent text-white border-accent"
              : "bg-card-bg border-border-muted text-text-secondary hover:border-accent"
          }`}
          aria-checked={yesChecked}
        >
          {WIZARD_UI_STRINGS.yes}
        </button>
        <button
          type="button"
          role="radio"
          onClick={() => onChange(false)}
          className={`flex-1 py-2.5 px-4 rounded-mac border text-mac-sm font-medium transition-colors ${
            value === false
              ? "bg-accent text-white border-accent"
              : "bg-card-bg border-border-muted text-text-secondary hover:border-accent"
          }`}
          aria-checked={noChecked}
        >
          {WIZARD_UI_STRINGS.no}
        </button>
      </div>
      {/* Error display - currently boolean questions always validate as true,
          but kept for future extensibility and API consistency */}
      {error && (
        <p id={errorId} className="text-mac-xs text-system-red" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
};
