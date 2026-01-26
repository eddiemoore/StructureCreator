import type { WizardQuestion } from "../../../types/schema";

interface SingleChoiceQuestionProps {
  question: WizardQuestion;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

/**
 * Single choice question component - renders radio button options.
 */
export const SingleChoiceQuestion = ({ question, value, onChange, error }: SingleChoiceQuestionProps) => {
  const choices = question.choices ?? [];
  const questionId = `question-${question.id}`;
  const helpId = `${questionId}-help`;
  const errorId = `${questionId}-error`;

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
      aria-required={question.validation?.required}
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
      <div
        className={`space-y-2 ${error ? "ring-1 ring-system-red rounded-mac p-1 -m-1" : ""}`}
      >
        {choices.map((choice) => (
          <label
            key={choice.id}
            className={`flex items-start gap-3 p-3 rounded-mac border cursor-pointer transition-colors ${
              value === choice.id
                ? "bg-accent/10 border-accent"
                : "bg-card-bg border-border-muted hover:border-accent/50"
            }`}
          >
            <input
              type="radio"
              name={question.id}
              value={choice.id}
              checked={value === choice.id}
              onChange={() => onChange(choice.id)}
              className="mt-0.5 accent-accent"
            />
            <div className="flex-1">
              <div className="text-mac-sm font-medium text-text-primary">{choice.label}</div>
              {choice.description && (
                <p className="text-mac-xs text-text-muted mt-0.5">{choice.description}</p>
              )}
            </div>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-mac-xs text-system-red" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
};
