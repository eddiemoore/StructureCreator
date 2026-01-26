import { Component, type ReactNode, createRef } from "react";
import { XIcon } from "../Icons";
import { WIZARD_UI_STRINGS } from "../../utils/wizardUtils";

interface WizardErrorBoundaryProps {
  children: ReactNode;
  onClose: () => void;
}

interface WizardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * Error boundary for wizard components.
 * Catches render errors and displays a graceful fallback UI instead of crashing the app.
 * Provides both "Try Again" and "Close" options.
 */
export class WizardErrorBoundary extends Component<WizardErrorBoundaryProps, WizardErrorBoundaryState> {
  private modalRef = createRef<HTMLDivElement>();

  constructor(props: WizardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<WizardErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("Wizard error:", error, errorInfo);
    // Store component stack for display in technical details
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.props.onClose();
      return;
    }

    // Focus trap for Tab key
    if (e.key === "Tab" && this.modalRef.current) {
      const focusableElements = this.modalRef.current.querySelectorAll<HTMLElement>(
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

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wizard-error-title"
          onKeyDown={this.handleKeyDown}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={this.props.onClose}
            aria-hidden="true"
          />
          <div
            ref={this.modalRef}
            className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-full max-w-md mx-4 p-6 border border-border-muted"
          >
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-system-red/10 flex items-center justify-center">
                <XIcon size={24} className="text-system-red" aria-hidden="true" />
              </div>
              <h2
                id="wizard-error-title"
                className="text-mac-lg font-semibold text-text-primary mb-2"
              >
                Something went wrong
              </h2>
              <p className="text-mac-sm text-text-muted mb-4">
                An error occurred while loading the wizard. Please try again or close the wizard.
              </p>
              {this.state.error && (
                <details className="text-left mb-4">
                  <summary className="text-mac-xs text-text-muted cursor-pointer hover:text-text-secondary">
                    Technical details
                  </summary>
                  <pre className="mt-2 p-2 bg-mac-bg rounded-mac text-mac-xs text-text-muted overflow-auto max-h-48 whitespace-pre-wrap">
                    {this.state.error.message}
                    {this.state.componentStack && (
                      <>
                        {"\n\nComponent Stack:"}
                        {this.state.componentStack}
                      </>
                    )}
                  </pre>
                </details>
              )}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={this.handleReset}
                  className="mac-button-secondary px-4 py-2"
                  autoFocus
                >
                  Try Again
                </button>
                <button
                  onClick={this.props.onClose}
                  className="mac-button-primary px-4 py-2"
                >
                  {WIZARD_UI_STRINGS.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
