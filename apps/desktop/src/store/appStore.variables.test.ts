import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";
import type { Variable, VariableDefinition } from "../types/schema";

describe("appStore variable handling", () => {
  beforeEach(() => {
    // Reset the store before each test
    useAppStore.getState().reset();
    useAppStore.getState().setVariables([]);
  });

  describe("mergeDetectedVariables without definitions", () => {
    it("adds new variables from detected names", () => {
      useAppStore.getState().mergeDetectedVariables(["%CLIENT_NAME%", "%PROJECT_TYPE%"]);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(2);
      expect(state.variables[0].name).toBe("%CLIENT_NAME%");
      expect(state.variables[0].value).toBe("");
      expect(state.variables[1].name).toBe("%PROJECT_TYPE%");
      expect(state.variables[1].value).toBe("");
    });

    it("does not duplicate existing variables", () => {
      const existing: Variable[] = [{ name: "%CLIENT_NAME%", value: "Existing Value" }];
      useAppStore.getState().setVariables(existing);

      useAppStore.getState().mergeDetectedVariables(["%CLIENT_NAME%", "%NEW_VAR%"]);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(2);
      expect(state.variables[0].value).toBe("Existing Value"); // Preserved
      expect(state.variables[1].name).toBe("%NEW_VAR%");
    });
  });

  describe("mergeDetectedVariables with definitions", () => {
    it("applies helper text from definitions to new variables", () => {
      const definitions: VariableDefinition[] = [
        {
          name: "CLIENT_NAME",
          description: "The client company name",
          placeholder: "Enter client name...",
          example: "Acme Corp",
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%CLIENT_NAME%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(1);
      expect(state.variables[0].name).toBe("%CLIENT_NAME%");
      expect(state.variables[0].description).toBe("The client company name");
      expect(state.variables[0].placeholder).toBe("Enter client name...");
      expect(state.variables[0].example).toBe("Acme Corp");
    });

    it("applies validation rules from definitions to new variables", () => {
      const definitions: VariableDefinition[] = [
        {
          name: "PROJECT_NAME",
          required: true,
          pattern: "^[a-z-]+$",
          minLength: 3,
          maxLength: 50,
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%PROJECT_NAME%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(1);
      expect(state.variables[0].validation).toBeDefined();
      expect(state.variables[0].validation?.required).toBe(true);
      expect(state.variables[0].validation?.pattern).toBe("^[a-z-]+$");
      expect(state.variables[0].validation?.minLength).toBe(3);
      expect(state.variables[0].validation?.maxLength).toBe(50);
    });

    it("applies helper text to existing variables without overwriting", () => {
      // Set up existing variable without helper text
      const existing: Variable[] = [{ name: "%CLIENT_NAME%", value: "My Client" }];
      useAppStore.getState().setVariables(existing);

      const definitions: VariableDefinition[] = [
        {
          name: "CLIENT_NAME",
          description: "The client company name",
          placeholder: "Enter client name...",
          example: "Acme Corp",
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%CLIENT_NAME%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(1);
      expect(state.variables[0].value).toBe("My Client"); // Preserved
      expect(state.variables[0].description).toBe("The client company name"); // Applied
      expect(state.variables[0].placeholder).toBe("Enter client name..."); // Applied
      expect(state.variables[0].example).toBe("Acme Corp"); // Applied
    });

    it("does not overwrite existing helper text on variables", () => {
      // Set up existing variable with helper text
      const existing: Variable[] = [
        {
          name: "%CLIENT_NAME%",
          value: "My Client",
          description: "Custom description",
          placeholder: "Custom placeholder",
        },
      ];
      useAppStore.getState().setVariables(existing);

      const definitions: VariableDefinition[] = [
        {
          name: "CLIENT_NAME",
          description: "Definition description",
          placeholder: "Definition placeholder",
          example: "Acme Corp",
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%CLIENT_NAME%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(1);
      expect(state.variables[0].description).toBe("Custom description"); // Not overwritten
      expect(state.variables[0].placeholder).toBe("Custom placeholder"); // Not overwritten
      expect(state.variables[0].example).toBe("Acme Corp"); // Applied (was undefined)
    });

    it("merges validation rules without overwriting existing rules", () => {
      // Set up existing variable with some validation
      const existing: Variable[] = [
        {
          name: "%PROJECT_NAME%",
          value: "test",
          validation: {
            required: true,
          },
        },
      ];
      useAppStore.getState().setVariables(existing);

      const definitions: VariableDefinition[] = [
        {
          name: "PROJECT_NAME",
          required: false, // Should not overwrite
          pattern: "^[a-z]+$",
          minLength: 3,
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%PROJECT_NAME%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables[0].validation?.required).toBe(true); // Existing preserved
      expect(state.variables[0].validation?.pattern).toBe("^[a-z]+$"); // Applied
      expect(state.variables[0].validation?.minLength).toBe(3); // Applied
    });

    it("handles variables without matching definitions", () => {
      const definitions: VariableDefinition[] = [
        {
          name: "OTHER_VAR",
          description: "Some other variable",
        },
      ];

      useAppStore.getState().mergeDetectedVariables(["%UNMATCHED_VAR%"], definitions);

      const state = useAppStore.getState();
      expect(state.variables).toHaveLength(1);
      expect(state.variables[0].name).toBe("%UNMATCHED_VAR%");
      expect(state.variables[0].description).toBeUndefined();
    });
  });
});
