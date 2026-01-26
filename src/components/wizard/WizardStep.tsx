import type { WizardStep as WizardStepType, WizardQuestion, WizardAnswers } from "../../types/schema";
import { shouldShowQuestion, type QuestionValidationResult } from "../../utils/wizardUtils";
import {
  BooleanQuestion,
  SingleChoiceQuestion,
  MultipleChoiceQuestion,
  TextQuestion,
  SelectQuestion,
} from "./questions";

interface WizardStepProps {
  step: WizardStepType;
  answers: WizardAnswers;
  onAnswerChange: (questionId: string, value: string | boolean | string[]) => void;
  validationErrors: QuestionValidationResult[];
}

/**
 * Get the current value for a question, with proper type handling and validation.
 * Ensures the returned value matches the expected type for the question.
 */
const getQuestionValue = (question: WizardQuestion, answers: WizardAnswers): string | boolean | string[] | undefined => {
  const value = answers[question.id];
  const effectiveValue = value ?? question.defaultValue;

  if (effectiveValue === undefined) return undefined;

  // Validate type matches question type to prevent runtime errors
  switch (question.type) {
    case "boolean":
      return typeof effectiveValue === "boolean" ? effectiveValue : undefined;
    case "multiple":
      return Array.isArray(effectiveValue) ? effectiveValue : undefined;
    case "text":
    case "single":
    case "select":
      return typeof effectiveValue === "string" ? effectiveValue : undefined;
    default:
      return undefined;
  }
};

/**
 * Get the error message for a specific question
 */
const getQuestionError = (
  questionId: string,
  validationErrors: QuestionValidationResult[]
): string | null => {
  const result = validationErrors.find(e => e.questionId === questionId);
  return result?.error ?? null;
};

export const WizardStep = ({ step, answers, onAnswerChange, validationErrors }: WizardStepProps) => {
  const visibleQuestions = step.questions.filter((q) => shouldShowQuestion(q, answers));

  return (
    <div className="space-y-6" role="group" aria-label={step.title}>
      {step.description && (
        <p className="text-mac-sm text-text-muted">{step.description}</p>
      )}

      {visibleQuestions.map((question) => {
        const value = getQuestionValue(question, answers);
        const error = getQuestionError(question.id, validationErrors);

        // Render appropriate question component based on type
        // Type casts are needed because TypeScript can't narrow the union type
        // from getQuestionValue based on question.type in this context
        switch (question.type) {
          case "boolean":
            return (
              <BooleanQuestion
                key={question.id}
                question={question}
                value={value as boolean | undefined}
                onChange={(v) => onAnswerChange(question.id, v)}
                error={error}
              />
            );
          case "single":
            return (
              <SingleChoiceQuestion
                key={question.id}
                question={question}
                value={(value as string | undefined) ?? ""}
                onChange={(v) => onAnswerChange(question.id, v)}
                error={error}
              />
            );
          case "multiple":
            return (
              <MultipleChoiceQuestion
                key={question.id}
                question={question}
                value={(value as string[] | undefined) ?? []}
                onChange={(v) => onAnswerChange(question.id, v)}
                error={error}
              />
            );
          case "text":
            return (
              <TextQuestion
                key={question.id}
                question={question}
                value={(value as string | undefined) ?? ""}
                onChange={(v) => onAnswerChange(question.id, v)}
                error={error}
              />
            );
          case "select":
            return (
              <SelectQuestion
                key={question.id}
                question={question}
                value={(value as string | undefined) ?? ""}
                onChange={(v) => onAnswerChange(question.id, v)}
                error={error}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
};
