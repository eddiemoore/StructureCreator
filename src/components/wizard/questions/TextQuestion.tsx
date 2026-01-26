import type { WizardQuestion } from "../../../types/schema";

interface TextQuestionProps {
  question: WizardQuestion;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

/**
 * Text input question component.
 * Supports validation rules (required, minLength, maxLength, pattern).
 */
export const TextQuestion = ({ question, value, onChange, error }: TextQuestionProps) => {
  const questionId = `question-${question.id}`;
  const inputId = `${questionId}-input`;
  const errorId = `${questionId}-error`;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-mac-sm font-medium text-text-primary block">
        {question.question}
        {question.validation?.required && (
          <span className="text-system-red ml-1" aria-hidden="true">*</span>
        )}
      </label>
      {question.helpText && (
        <p id={`${questionId}-help`} className="text-mac-xs text-text-muted">{question.helpText}</p>
      )}
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={question.placeholder}
        maxLength={question.validation?.maxLength}
        className={`mac-input w-full ${error ? "border-system-red" : ""}`}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[
          question.helpText ? `${questionId}-help` : null,
          error ? errorId : null,
        ].filter(Boolean).join(" ") || undefined}
        aria-required={question.validation?.required}
      />
      {error && (
        <p id={errorId} className="text-mac-xs text-system-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
