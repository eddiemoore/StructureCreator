import type { WizardQuestion } from "../../../types/schema";
import { WIZARD_UI_STRINGS } from "../../../utils/wizardUtils";

interface SelectQuestionProps {
  question: WizardQuestion;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

/**
 * Select/dropdown question component.
 */
export const SelectQuestion = ({ question, value, onChange, error }: SelectQuestionProps) => {
  const choices = question.choices ?? [];
  const questionId = `question-${question.id}`;
  const selectId = `${questionId}-select`;
  const errorId = `${questionId}-error`;

  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="text-mac-sm font-medium text-text-primary block">
        {question.question}
        {question.validation?.required && (
          <span className="text-system-red ml-1" aria-hidden="true">*</span>
        )}
      </label>
      {question.helpText && (
        <p id={`${questionId}-help`} className="text-mac-xs text-text-muted">{question.helpText}</p>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`mac-input w-full appearance-none cursor-pointer pr-8 ${error ? "border-system-red" : ""}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={[
            question.helpText ? `${questionId}-help` : null,
            error ? errorId : null,
          ].filter(Boolean).join(" ") || undefined}
          aria-required={question.validation?.required}
        >
          <option value="">{WIZARD_UI_STRINGS.selectPlaceholder}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id} title={choice.description || undefined}>
              {choice.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-mac-xs text-system-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
