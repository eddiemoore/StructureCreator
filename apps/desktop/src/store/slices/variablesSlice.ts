import type { StateCreator } from "zustand";
import type { Variable, ValidationRule, ValidationError, VariableDefinition } from "../../types/schema";
import { asVariableName } from "@structure-creator/shared";

export interface VariablesSlice {
  variables: Variable[];
  validationErrors: ValidationError[];
  setVariables: (variables: Variable[]) => void;
  updateVariable: (name: string, value: string) => void;
  addVariable: (name: string, value: string) => void;
  removeVariable: (name: string) => void;
  mergeDetectedVariables: (detectedVarNames: string[], definitions?: VariableDefinition[]) => void;
  updateVariableValidation: (name: string, validation: ValidationRule | undefined) => void;
  setValidationErrors: (errors: ValidationError[]) => void;
}

export const createVariablesSlice: StateCreator<VariablesSlice, [], [], VariablesSlice> = (set) => ({
  variables: [],
  validationErrors: [],

  setVariables: (variables) =>
    set({
      // Normalize to clean canonical names on entry (ADR-0001); idempotent,
      // so delimited names loaded from persisted data are accepted.
      variables: variables.map((v) => ({ ...v, name: asVariableName(v.name) })),
    }),

  updateVariable: (name, value) =>
    set((state) => {
      // Variable names are canonical in clean form (ADR-0001); normalize the
      // incoming name so a token or clean name both match.
      const cleanName = asVariableName(name);
      return {
        variables: state.variables.map((v) =>
          v.name === cleanName ? { ...v, value } : v
        ),
        // Clear validation errors when value changes
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

  addVariable: (name, value) =>
    set((state) => {
      const varName = asVariableName(name);
      // Check if variable already exists
      if (state.variables.some((v) => v.name === varName)) {
        return state;
      }
      return {
        variables: [...state.variables, { name: varName, value }],
      };
    }),

  removeVariable: (name) =>
    set((state) => {
      const cleanName = asVariableName(name);
      return {
        variables: state.variables.filter((v) => v.name !== cleanName),
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

  mergeDetectedVariables: (detectedVarNames, definitions) =>
    set((state) => {
      // Definitions and detected names are keyed by clean canonical name.
      const defMap = new Map<string, VariableDefinition>();
      if (definitions) {
        for (const def of definitions) {
          defMap.set(asVariableName(def.name), def);
        }
      }

      const existingNames = new Set(state.variables.map((v) => v.name));

      // Create new variables with definitions applied
      const newVariables = detectedVarNames
        .map((name) => asVariableName(name))
        .filter((name) => !existingNames.has(name))
        .map((name) => {
          const def = defMap.get(name);
          const variable: Variable = { name, value: "" };

          if (def) {
            // Apply helper text from definition
            if (def.description) variable.description = def.description;
            if (def.placeholder) variable.placeholder = def.placeholder;
            if (def.example) variable.example = def.example;

            // Apply validation rules from definition
            if (def.required || def.pattern || def.minLength !== undefined || def.maxLength !== undefined) {
              variable.validation = {
                required: def.required,
                pattern: def.pattern,
                minLength: def.minLength,
                maxLength: def.maxLength,
              };
            }
          }

          return variable;
        });

      // Also update existing variables with definitions if they don't have them yet
      let hasUpdates = false;
      const updatedVariables = state.variables.map((v) => {
        const def = defMap.get(v.name);
        if (!def) return v;

        // Check if any fields need to be applied
        const needsDescription = !v.description && def.description;
        const needsPlaceholder = !v.placeholder && def.placeholder;
        const needsExample = !v.example && def.example;
        const needsValidation = def.required || def.pattern || def.minLength !== undefined || def.maxLength !== undefined;

        // Only create a new object if we actually need to update something
        if (!needsDescription && !needsPlaceholder && !needsExample && !needsValidation) {
          return v;
        }

        hasUpdates = true;
        const updated: Variable = { ...v };
        if (needsDescription) updated.description = def.description;
        if (needsPlaceholder) updated.placeholder = def.placeholder;
        if (needsExample) updated.example = def.example;

        // Merge validation rules
        if (needsValidation) {
          updated.validation = {
            ...v.validation,
            required: v.validation?.required ?? def.required,
            pattern: v.validation?.pattern ?? def.pattern,
            minLength: v.validation?.minLength ?? def.minLength,
            maxLength: v.validation?.maxLength ?? def.maxLength,
          };
        }

        return updated;
      });

      if (newVariables.length === 0 && !hasUpdates) {
        return state;
      }

      return { variables: [...updatedVariables, ...newVariables] };
    }),

  updateVariableValidation: (name, validation) =>
    set((state) => ({
      variables: state.variables.map((v) =>
        v.name === name ? { ...v, validation } : v
      ),
    })),

  setValidationErrors: (validationErrors) =>
    set({ validationErrors }),
});
