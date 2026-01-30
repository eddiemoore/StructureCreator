import type { StateCreator } from "zustand";
import type { Variable, ValidationRule, ValidationError, VariableDefinition } from "../../types/schema";

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

  setVariables: (variables) => set({ variables }),

  updateVariable: (name, value) =>
    set((state) => {
      // Clean name for comparison (validation errors use clean names without % delimiters)
      const cleanName = name.replace(/^%|%$/g, "");
      return {
        variables: state.variables.map((v) =>
          v.name === name ? { ...v, value } : v
        ),
        // Clear validation errors when value changes
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

  addVariable: (name, value) =>
    set((state) => {
      // Ensure name has % wrapping
      const varName = name.startsWith("%") ? name : `%${name}%`;
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
      // Clean name for comparison (validation errors use clean names without % delimiters)
      const cleanName = name.replace(/^%|%$/g, "");
      return {
        variables: state.variables.filter((v) => v.name !== name),
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

  mergeDetectedVariables: (detectedVarNames, definitions) =>
    set((state) => {
      // Create a map of definitions by name (with % wrapper to match variable names)
      const defMap = new Map<string, VariableDefinition>();
      if (definitions) {
        for (const def of definitions) {
          // Variable names in state have % wrapper, definition names don't
          defMap.set(`%${def.name}%`, def);
        }
      }

      const existingNames = new Set(state.variables.map((v) => v.name));

      // Create new variables with definitions applied
      const newVariables = detectedVarNames
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
