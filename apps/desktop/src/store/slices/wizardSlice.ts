import type { StateCreator } from "zustand";
import type { Template, SchemaTree, WizardState } from "../../types/schema";

export interface WizardSlice {
  wizardState: WizardState | null;
  openWizard: (template: Template) => void;
  closeWizard: () => void;
  setWizardStep: (step: number) => void;
  updateWizardAnswer: (questionId: string, value: string | boolean | string[]) => void;
  setWizardPreviewTree: (tree: SchemaTree | null) => void;
}

export const createWizardSlice: StateCreator<WizardSlice, [], [], WizardSlice> = (set) => ({
  wizardState: null,

  openWizard: (template) => {
    set({
      wizardState: {
        isOpen: true,
        template,
        currentStep: 0,
        answers: {},
        previewTree: null,
      },
    });
  },

  closeWizard: () => {
    set({ wizardState: null });
  },

  setWizardStep: (step) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          currentStep: step,
        },
      };
    });
  },

  updateWizardAnswer: (questionId, value) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          answers: {
            ...state.wizardState.answers,
            [questionId]: value,
          },
        },
      };
    });
  },

  setWizardPreviewTree: (tree) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          previewTree: tree,
        },
      };
    });
  },
});
