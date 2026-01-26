import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { api } from "../../lib/api";
import type { Variable, WizardConfig } from "../../types/schema";
import { WizardProgress } from "./WizardProgress";
import { WizardStep } from "./WizardStep";
import { WizardPreview } from "./WizardPreview";
import { WizardErrorBoundary } from "./WizardErrorBoundary";
import { XIcon, LoaderIcon } from "../Icons";
import {
  parseWizardConfig,
  applyWizardModifiers,
  filterTreeByConditions,
  validateWizardStep,
  PREVIEW_DEBOUNCE_MS,
  WIZARD_UI_STRINGS,
  type StepValidationResult,
} from "../../utils/wizardUtils";

/**
 * TemplateWizard - A modal wizard for guided template configuration.
 *
 * Design decisions to avoid useEffect issues:
 * - wizardConfig is derived via useMemo (no effect needed)
 * - stepValidation is derived via useMemo (no effect needed)
 * - Preview updates are triggered by answer changes via debounced callback
 * - Only necessary effects: keyboard handlers, initial focus, cleanup
 */
export const TemplateWizard = () => {
  const {
    wizardState,
    closeWizard,
    setWizardStep,
    updateWizardAnswer,
    setWizardPreviewTree,
    setSchemaPath,
    setSchemaContent,
    setSchemaTree,
    setVariables,
    addLog,
  } = useAppStore();

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedPreviewRef = useRef(false);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const hasStoredPreviousElementRef = useRef(false);

  // Local state for loading and errors
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionStatus, setCompletionStatus] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Extract wizard state values
  const template = wizardState?.template ?? null;
  const currentStep = wizardState?.currentStep ?? 0;
  const answers = wizardState?.answers ?? {};
  const previewTree = wizardState?.previewTree ?? null;
  const isOpen = wizardState?.isOpen ?? false;

  // Derive wizard config from template (memoized, pure - no side effects)
  const wizardConfig = useMemo((): WizardConfig | null => {
    if (!template?.wizard_config) return null;
    return parseWizardConfig(template.wizard_config);
  }, [template?.wizard_config]);

  // Derive config error state (config exists but failed to parse)
  const configError = template?.wizard_config && !wizardConfig
    ? "Invalid wizard configuration. The template may be corrupted."
    : null;

  const steps = wizardConfig?.steps ?? [];
  const totalSteps = steps.length;
  const currentStepConfig = steps[currentStep];

  // Derive validation state (memoized, no effect needed)
  const stepValidation = useMemo((): StepValidationResult => {
    if (!currentStepConfig) {
      return { isValid: true, errors: [] };
    }
    return validateWizardStep(currentStepConfig, answers);
  }, [currentStepConfig, answers]);

  // Cancel any pending preview updates
  const cancelPendingUpdates = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setIsPreviewLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingUpdates();
    };
  }, [cancelPendingUpdates]);

  // Update preview with debouncing and cancellation
  const updatePreview = useCallback(async () => {
    if (!template || !wizardConfig) return;

    // Cancel any in-flight request
    cancelPendingUpdates();

    abortControllerRef.current = new AbortController();
    const controller = abortControllerRef.current;

    // Debounce the actual API call - loading state is set inside timeout
    // to avoid flicker when typing quickly
    debounceTimerRef.current = setTimeout(async () => {
      if (controller.signal.aborted) return;

      setIsPreviewLoading(true);

      try {
        const result = await api.schema.parseSchemaWithInheritance(template.schema_xml);

        if (controller.signal.aborted) return;

        const conditionVariables = applyWizardModifiers(
          wizardConfig,
          answers,
          { ...result.mergedVariables, ...template.variables }
        );

        const filteredTree = filterTreeByConditions(result.tree, conditionVariables);
        setWizardPreviewTree(filteredTree);
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error("Failed to update wizard preview:", e);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPreviewLoading(false);
        }
      }
    }, PREVIEW_DEBOUNCE_MS);
  }, [template, wizardConfig, answers, setWizardPreviewTree, cancelPendingUpdates]);

  // Focus trap and escape key handling
  useEffect(() => {
    if (!isOpen) {
      // Reset initialization flags when wizard closes
      hasInitializedPreviewRef.current = false;
      hasStoredPreviousElementRef.current = false;

      // Restore focus to the element that opened the wizard
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
        previousActiveElementRef.current = null;
      }
      return;
    }

    // Store the currently focused element and set initial focus only once when wizard first opens
    // This prevents overwriting on subsequent effect runs (e.g., when answers change)
    // and prevents stealing focus from text inputs while the user is typing
    if (!hasStoredPreviousElementRef.current) {
      hasStoredPreviousElementRef.current = true;
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      // Initial focus - only on first open
      closeButtonRef.current?.focus();
    }

    // Initial preview - only on first open, not on every dependency change
    if (!hasInitializedPreviewRef.current) {
      hasInitializedPreviewRef.current = true;
      updatePreview();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isCompleting) {
        closeWizard();
      }

      // Focus trap
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), details, summary'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelPendingUpdates();
    };
  }, [isOpen, isCompleting, closeWizard, updatePreview, cancelPendingUpdates]);

  // Handle answer changes and trigger preview update
  // Note: Input sanitization is handled by the backend during structure creation
  // and by parseWizardConfig for config values. User input is stored as-is for flexibility.
  const handleAnswerChange = useCallback(
    (questionId: string, value: string | boolean | string[]) => {
      updateWizardAnswer(questionId, value);
      updatePreview();
    },
    [updateWizardAnswer, updatePreview]
  );

  // Handle navigation - cancel pending updates to avoid stale previews
  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      cancelPendingUpdates();
      setWizardStep(currentStep - 1);
    }
  }, [currentStep, setWizardStep, cancelPendingUpdates]);

  const handleNext = useCallback(() => {
    if (!stepValidation.isValid) {
      return;
    }

    if (currentStep < totalSteps - 1) {
      cancelPendingUpdates();
      setWizardStep(currentStep + 1);
    }
  }, [stepValidation.isValid, currentStep, totalSteps, setWizardStep, cancelPendingUpdates]);

  // Handle wizard completion
  const handleComplete = useCallback(async () => {
    if (!template || !wizardConfig) return;

    if (!stepValidation.isValid) {
      return;
    }

    setIsCompleting(true);
    setCompletionStatus("Loading schema...");
    setCompletionError(null);

    try {
      // Increment use count (fire-and-forget, non-critical telemetry)
      api.database.incrementUseCount(template.id).catch(() => {
        // Silently ignore - use count is non-critical
      });

      // Load the schema
      setSchemaPath(`template:${template.name}`);
      setSchemaContent(template.schema_xml);

      // Parse with inheritance
      setCompletionStatus("Parsing schema...");
      const result = await api.schema.parseSchemaWithInheritance(template.schema_xml);
      setSchemaTree(result.tree);

      // Merge all variables: inherited -> template -> wizard
      setCompletionStatus("Applying configuration...");
      const finalVariables = applyWizardModifiers(
        wizardConfig,
        answers,
        { ...result.mergedVariables, ...template.variables }
      );

      // Merge validation rules
      const mergedValidation = {
        ...result.mergedVariableValidation,
        ...template.variable_validation,
      };

      // Convert to Variable array format for the store
      const loadedVariables: Variable[] = Object.entries(finalVariables).map(([name, value]) => ({
        name,
        value,
        validation: mergedValidation[name],
      }));

      setVariables(loadedVariables);

      addLog({
        type: "success",
        message: `Template "${template.name}" loaded with wizard configuration`,
      });

      closeWizard();
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setCompletionError(errorMessage);
      addLog({
        type: "error",
        message: "Failed to complete wizard",
        details: errorMessage,
      });
    } finally {
      setIsCompleting(false);
      setCompletionStatus(null);
    }
  }, [
    template,
    wizardConfig,
    stepValidation.isValid,
    answers,
    setSchemaPath,
    setSchemaContent,
    setSchemaTree,
    setVariables,
    addLog,
    closeWizard,
  ]);

  // Handle step click from progress - cancel pending updates to avoid stale previews
  const handleStepClick = useCallback(
    (step: number) => {
      // Only allow going back, not forward (to prevent skipping validation)
      if (step < currentStep) {
        cancelPendingUpdates();
        setWizardStep(step);
      }
    },
    [currentStep, setWizardStep, cancelPendingUpdates]
  );

  // Don't render if not open
  if (!isOpen || !template) {
    return null;
  }

  // Show error if config is invalid
  if (configError) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-error-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            closeWizard();
          }
          // Focus trap - only one focusable element (Close button) so just prevent Tab from leaving
          if (e.key === "Tab") {
            e.preventDefault();
          }
        }}
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={closeWizard}
          aria-hidden="true"
        />
        <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-full max-w-md mx-4 p-6 border border-border-muted">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-system-red/10 flex items-center justify-center">
              <XIcon size={24} className="text-system-red" aria-hidden="true" />
            </div>
            <h2
              id="wizard-error-title"
              className="text-mac-lg font-semibold text-text-primary mb-2"
            >
              Invalid Wizard Configuration
            </h2>
            <p className="text-mac-sm text-text-muted mb-4">{configError}</p>
            <button
              onClick={closeWizard}
              className="mac-button-primary px-4 py-2"
              autoFocus
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!wizardConfig) {
    return null;
  }

  const canProceed = stepValidation.isValid;

  return (
    <WizardErrorBoundary onClose={closeWizard}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={isCompleting ? undefined : closeWizard}
          aria-hidden="true"
        />

        {/* Modal */}
        <div
          ref={modalRef}
          className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-full max-w-[900px] mx-4 max-h-[85vh] overflow-hidden border border-border-muted flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted shrink-0">
            <div>
              <h2
                id="wizard-title"
                className="text-mac-lg font-semibold text-text-primary"
              >
                {wizardConfig.title}
              </h2>
              {wizardConfig.description && (
                <p className="text-mac-sm text-text-muted mt-0.5">
                  {wizardConfig.description}
                </p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              onClick={closeWizard}
              className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
              aria-label={WIZARD_UI_STRINGS.close}
              disabled={isCompleting}
            >
              <XIcon size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Progress */}
          {totalSteps > 1 && (
            <div className="px-5 py-3 border-b border-border-muted bg-mac-bg-secondary">
              <WizardProgress
                steps={steps}
                currentStep={currentStep}
                onStepClick={handleStepClick}
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Questions Panel */}
            <div className="flex-1 overflow-y-auto mac-scroll p-5">
              {currentStepConfig && (
                <div>
                  <h3 className="text-mac-base font-semibold text-text-primary mb-4">
                    {currentStepConfig.title}
                  </h3>
                  <WizardStep
                    step={currentStepConfig}
                    answers={answers}
                    onAnswerChange={handleAnswerChange}
                    validationErrors={stepValidation.errors}
                  />
                </div>
              )}
            </div>

            {/* Preview Panel */}
            <div className="w-[320px] min-w-[250px] border-l border-border-muted bg-mac-bg flex flex-col">
              <div className="px-4 py-3 border-b border-border-muted">
                <h4 className="text-mac-sm font-medium text-text-primary">
                  {WIZARD_UI_STRINGS.previewTitle}
                </h4>
              </div>
              <div className="flex-1 overflow-hidden">
                <WizardPreview tree={previewTree} isLoading={isPreviewLoading} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-border-muted shrink-0">
            <div className="text-mac-sm">
              {completionError ? (
                <span className="text-system-red" role="alert">{completionError}</span>
              ) : (
                <span className="text-text-muted">
                  {completionStatus ?? WIZARD_UI_STRINGS.stepOf(currentStep + 1, totalSteps)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {currentStep > 0 && (
                <button
                  onClick={handlePrevious}
                  className="mac-button-secondary px-4 py-2"
                  disabled={isCompleting}
                >
                  {WIZARD_UI_STRINGS.back}
                </button>
              )}
              {currentStep < totalSteps - 1 ? (
                <button
                  onClick={handleNext}
                  className="mac-button-primary px-4 py-2"
                  disabled={isCompleting || !canProceed}
                  title={!canProceed ? WIZARD_UI_STRINGS.completeRequiredFields : undefined}
                >
                  {WIZARD_UI_STRINGS.next}
                </button>
              ) : (
                <button
                  onClick={handleComplete}
                  className="mac-button-primary px-4 py-2 min-w-[80px]"
                  disabled={isCompleting || !canProceed}
                  title={!canProceed ? WIZARD_UI_STRINGS.completeRequiredFields : undefined}
                >
                  {isCompleting ? (
                    <LoaderIcon size={16} className="animate-spin mx-auto" aria-hidden="true" />
                  ) : (
                    WIZARD_UI_STRINGS.create
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </WizardErrorBoundary>
  );
};
