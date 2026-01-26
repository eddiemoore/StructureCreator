import { describe, it, expect } from "vitest";
import {
  parseWizardConfig,
  applyWizardModifiers,
  filterTreeByConditions,
  validateWizardStep,
  shouldShowQuestion,
  generateNodeId,
  getTreeSignature,
  sanitizeString,
  sanitizeVariableInput,
  isValidQuestionType,
  countTreeNodes,
  WIZARD_QUESTION_TYPES,
  VALIDATION_MESSAGES,
} from "./wizardUtils";
import type {
  WizardConfig,
  WizardStep,
  WizardQuestion,
  SchemaNode,
  SchemaTree,
} from "../types/schema";

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockWizardConfig = (): WizardConfig => ({
  title: "Test Wizard",
  description: "A test wizard",
  steps: [
    {
      id: "step1",
      title: "Step 1",
      description: "First step",
      questions: [
        {
          id: "q1",
          type: "boolean",
          question: "Enable feature?",
        },
        {
          id: "q2",
          type: "text",
          question: "Project name?",
          validation: { required: true, minLength: 3 },
        },
      ],
    },
  ],
  schemaModifiers: [
    {
      questionId: "q1",
      action: "include",
      nodeConditionVar: "FEATURE_ENABLED",
    },
    {
      questionId: "q2",
      action: "set_variable",
      variableName: "PROJECT_NAME",
    },
  ],
});

const createMockSchemaTree = (): SchemaTree => ({
  root: {
    type: "folder",
    name: "root",
    children: [
      { type: "file", name: "index.ts" },
      {
        type: "if",
        name: "conditional",
        condition_var: "FEATURE_ENABLED",
        children: [
          { type: "folder", name: "feature", children: [{ type: "file", name: "feature.ts" }] },
        ],
      },
      {
        type: "else",
        name: "else",
        children: [
          { type: "file", name: "no-feature.ts" },
        ],
      },
    ],
  },
  stats: { folders: 2, files: 3, downloads: 0 },
});

// ============================================================================
// sanitizeString Tests
// ============================================================================

describe("sanitizeString", () => {
  it("removes script tags", () => {
    expect(sanitizeString("<script>alert('xss')</script>test")).toBe("test");
    expect(sanitizeString("before<script>code</script>after")).toBe("beforeafter");
  });

  it("removes event handlers", () => {
    expect(sanitizeString('onclick="alert(1)"')).toBe('data-removed="alert(1)"');
    expect(sanitizeString("onmouseover=evil()")).toBe("data-removed=evil()");
  });

  it("removes javascript: protocol", () => {
    expect(sanitizeString("javascript:alert(1)")).toBe("removed:alert(1)");
  });

  it("preserves normal text", () => {
    expect(sanitizeString("Hello World")).toBe("Hello World");
    expect(sanitizeString("  trimmed  ")).toBe("trimmed");
  });
});

// ============================================================================
// sanitizeVariableInput Tests
// ============================================================================

describe("sanitizeVariableInput", () => {
  it("allows safe characters", () => {
    expect(sanitizeVariableInput("my-project")).toBe("my-project");
    expect(sanitizeVariableInput("my_project")).toBe("my_project");
    expect(sanitizeVariableInput("my.file")).toBe("my.file");
  });

  it("removes unsafe characters", () => {
    expect(sanitizeVariableInput("test<script>")).toBe("testscript");
    expect(sanitizeVariableInput("test/path")).toBe("testpath");
    expect(sanitizeVariableInput("test\\path")).toBe("testpath");
  });

  it("trims whitespace", () => {
    expect(sanitizeVariableInput("  test  ")).toBe("test");
  });
});

// ============================================================================
// isValidQuestionType Tests
// ============================================================================

describe("isValidQuestionType", () => {
  it("returns true for valid types", () => {
    for (const type of WIZARD_QUESTION_TYPES) {
      expect(isValidQuestionType(type)).toBe(true);
    }
  });

  it("returns false for invalid types", () => {
    expect(isValidQuestionType("invalid")).toBe(false);
    expect(isValidQuestionType(123)).toBe(false);
    expect(isValidQuestionType(null)).toBe(false);
    expect(isValidQuestionType(undefined)).toBe(false);
  });
});

// ============================================================================
// parseWizardConfig Tests
// ============================================================================

describe("parseWizardConfig", () => {
  it("parses valid config", () => {
    const raw = {
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [{ id: "q1", type: "boolean", question: "Test?" }],
        },
      ],
      schemaModifiers: [],
    };
    const result = parseWizardConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("Test");
    expect(result?.steps).toHaveLength(1);
  });

  it("returns null for missing title", () => {
    const raw = {
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [{ id: "q1", type: "boolean", question: "Test?" }],
        },
      ],
      schemaModifiers: [],
    };
    expect(parseWizardConfig(raw)).toBeNull();
  });

  it("returns null for empty steps", () => {
    const raw = {
      title: "Test",
      steps: [],
      schemaModifiers: [],
    };
    expect(parseWizardConfig(raw)).toBeNull();
  });

  it("returns null for missing schemaModifiers", () => {
    const raw = {
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [{ id: "q1", type: "boolean", question: "Test?" }],
        },
      ],
    };
    expect(parseWizardConfig(raw)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseWizardConfig(null)).toBeNull();
    expect(parseWizardConfig(undefined)).toBeNull();
    expect(parseWizardConfig("string")).toBeNull();
    expect(parseWizardConfig(123)).toBeNull();
  });

  it("sanitizes string fields", () => {
    const raw = {
      title: "<script>evil</script>Test",
      description: "onclick=evil() description",
      steps: [
        {
          id: "s1",
          title: "Step <script>bad</script>",
          questions: [
            {
              id: "q1",
              type: "text",
              question: "Question?",
              helpText: "javascript:void(0) help",
            },
          ],
        },
      ],
      schemaModifiers: [],
    };
    const result = parseWizardConfig(raw);
    expect(result?.title).toBe("Test");
    expect(result?.description).toBe("data-removed=evil() description");
    expect(result?.steps[0].title).toBe("Step");
    expect(result?.steps[0].questions[0].helpText).toBe("removed:void(0) help");
  });

  it("filters invalid questions", () => {
    const raw = {
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [
            { id: "q1", type: "boolean", question: "Valid?" },
            { id: "q2", type: "invalid", question: "Invalid type" },
            { type: "boolean", question: "Missing id" },
          ],
        },
      ],
      schemaModifiers: [],
    };
    const result = parseWizardConfig(raw);
    expect(result?.steps[0].questions).toHaveLength(1);
    expect(result?.steps[0].questions[0].id).toBe("q1");
  });

  it("rejects choice-based questions without choices", () => {
    const raw = {
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [
            { id: "q1", type: "single", question: "Pick one?" }, // Missing choices
            { id: "q2", type: "multiple", question: "Pick many?" }, // Missing choices
            { id: "q3", type: "select", question: "Select?" }, // Missing choices
            { id: "q4", type: "text", question: "Enter text?" }, // Valid - no choices needed
            {
              id: "q5",
              type: "single",
              question: "Valid single?",
              choices: [{ id: "a", label: "Option A" }],
            }, // Valid - has choices
          ],
        },
      ],
      schemaModifiers: [],
    };
    const result = parseWizardConfig(raw);
    // Only text and valid single should pass
    expect(result?.steps[0].questions).toHaveLength(2);
    expect(result?.steps[0].questions.map(q => q.id)).toEqual(["q4", "q5"]);
  });

  it("validates showWhen value type", () => {
    const raw = {
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "Step 1",
          questions: [
            {
              id: "q1",
              type: "boolean",
              question: "Enable?",
            },
            {
              id: "q2",
              type: "text",
              question: "Name?",
              showWhen: { questionId: "q1", value: true }, // Valid boolean
            },
            {
              id: "q3",
              type: "text",
              question: "Description?",
              showWhen: { questionId: "q2", value: { invalid: "object" } }, // Invalid - object value
            },
          ],
        },
      ],
      schemaModifiers: [],
    };
    const result = parseWizardConfig(raw);
    // q1 and q2 should have showWhen, q3 should have it stripped (invalid value type)
    expect(result?.steps[0].questions[0].showWhen).toBeUndefined();
    expect(result?.steps[0].questions[1].showWhen).toEqual({ questionId: "q1", value: true });
    expect(result?.steps[0].questions[2].showWhen).toBeUndefined();
  });
});

// ============================================================================
// applyWizardModifiers Tests
// ============================================================================

describe("applyWizardModifiers", () => {
  const config = createMockWizardConfig();

  it("sets include variable to true when answer is truthy", () => {
    const result = applyWizardModifiers(config, { q1: true, q2: "test" }, {});
    expect(result["%FEATURE_ENABLED%"]).toBe("true");
  });

  it("sets include variable to empty when answer is falsy", () => {
    const result = applyWizardModifiers(config, { q1: false, q2: "test" }, {});
    expect(result["%FEATURE_ENABLED%"]).toBe("");
  });

  it("sets variable from text answer", () => {
    const result = applyWizardModifiers(config, { q2: "my-project" }, {});
    expect(result["%PROJECT_NAME%"]).toBe("my-project");
  });

  it("preserves existing variables", () => {
    const existing = { "%EXISTING%": "value" };
    const result = applyWizardModifiers(config, { q2: "test" }, existing);
    expect(result["%EXISTING%"]).toBe("value");
  });

  it("handles valueMap for single choice", () => {
    const configWithValueMap: WizardConfig = {
      ...config,
      schemaModifiers: [
        {
          questionId: "choice",
          action: "include",
          nodeConditionVar: "IS_SELECTED",
          valueMap: { yes: "true", no: "" },
        },
      ],
    };
    expect(applyWizardModifiers(configWithValueMap, { choice: "yes" }, {})["%IS_SELECTED%"]).toBe("true");
    expect(applyWizardModifiers(configWithValueMap, { choice: "no" }, {})["%IS_SELECTED%"]).toBe("");
  });

  it("handles array answers for include", () => {
    const result = applyWizardModifiers(config, { q1: ["a", "b"] }, {});
    expect(result["%FEATURE_ENABLED%"]).toBe("true");

    const emptyResult = applyWizardModifiers(config, { q1: [] }, {});
    expect(emptyResult["%FEATURE_ENABLED%"]).toBe("");
  });

  it("converts boolean to string for set_variable", () => {
    const configWithBool: WizardConfig = {
      ...config,
      schemaModifiers: [
        { questionId: "bool", action: "set_variable", variableName: "BOOL_VAR" },
      ],
    };
    expect(applyWizardModifiers(configWithBool, { bool: true }, {})["%BOOL_VAR%"]).toBe("true");
    expect(applyWizardModifiers(configWithBool, { bool: false }, {})["%BOOL_VAR%"]).toBe("false");
  });

  it("joins array for set_variable", () => {
    const configWithArray: WizardConfig = {
      ...config,
      schemaModifiers: [
        { questionId: "arr", action: "set_variable", variableName: "ARR_VAR" },
      ],
    };
    expect(applyWizardModifiers(configWithArray, { arr: ["a", "b", "c"] }, {})["%ARR_VAR%"]).toBe("a,b,c");
  });
});

// ============================================================================
// filterTreeByConditions Tests
// ============================================================================

describe("filterTreeByConditions", () => {
  it("includes nodes when condition is true", () => {
    const tree = createMockSchemaTree();
    const result = filterTreeByConditions(tree, { "%FEATURE_ENABLED%": "true" });

    // Should have root folder, index.ts, and feature folder with feature.ts
    expect(result.stats.files).toBe(2); // index.ts and feature.ts
    expect(result.stats.folders).toBe(2); // root and feature
  });

  it("excludes nodes when condition is false", () => {
    const tree = createMockSchemaTree();
    const result = filterTreeByConditions(tree, { "%FEATURE_ENABLED%": "" });

    // Should have root folder, index.ts, and no-feature.ts (from else branch)
    expect(result.stats.files).toBe(2); // index.ts and no-feature.ts
    expect(result.stats.folders).toBe(1); // just root
  });

  it("handles missing condition variables", () => {
    const tree = createMockSchemaTree();
    const result = filterTreeByConditions(tree, {});

    // Condition not met (falsy), should use else branch
    expect(result.stats.files).toBe(2);
  });

  it("handles empty tree", () => {
    const tree: SchemaTree = {
      root: { type: "folder", name: "empty" },
      stats: { folders: 1, files: 0, downloads: 0 },
    };
    const result = filterTreeByConditions(tree, {});
    expect(result.root.name).toBe("empty");
  });
});

// ============================================================================
// countTreeNodes Tests
// ============================================================================

describe("countTreeNodes", () => {
  it("counts folders and files correctly", () => {
    const node: SchemaNode = {
      type: "folder",
      name: "root",
      children: [
        { type: "file", name: "a.ts" },
        { type: "file", name: "b.ts", url: "http://example.com" },
        { type: "folder", name: "sub", children: [{ type: "file", name: "c.ts" }] },
      ],
    };
    const result = countTreeNodes(node);
    expect(result.folders).toBe(2);
    expect(result.files).toBe(3);
    expect(result.downloads).toBe(1);
  });

  it("handles empty node", () => {
    const node: SchemaNode = { type: "folder", name: "empty" };
    const result = countTreeNodes(node);
    expect(result.folders).toBe(1);
    expect(result.files).toBe(0);
    expect(result.downloads).toBe(0);
  });
});

// ============================================================================
// shouldShowQuestion Tests
// ============================================================================

describe("shouldShowQuestion", () => {
  it("returns true when no showWhen condition", () => {
    const question: WizardQuestion = { id: "q1", type: "text", question: "Test?" };
    expect(shouldShowQuestion(question, {})).toBe(true);
  });

  it("returns true when condition matches", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: "yes" },
    };
    expect(shouldShowQuestion(question, { q1: "yes" })).toBe(true);
  });

  it("returns false when condition does not match", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: "yes" },
    };
    expect(shouldShowQuestion(question, { q1: "no" })).toBe(false);
  });

  it("returns false when dependent answer is missing", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: "yes" },
    };
    expect(shouldShowQuestion(question, {})).toBe(false);
  });

  it("handles array expected values", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: ["a", "b"] },
    };
    expect(shouldShowQuestion(question, { q1: "a" })).toBe(true);
    expect(shouldShowQuestion(question, { q1: "c" })).toBe(false);
  });

  it("handles array actual values", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: "a" },
    };
    expect(shouldShowQuestion(question, { q1: ["a", "b"] })).toBe(true);
    expect(shouldShowQuestion(question, { q1: ["c", "d"] })).toBe(false);
  });

  it("handles empty expected array as 'show when any value'", () => {
    const question: WizardQuestion = {
      id: "q2",
      type: "text",
      question: "Test?",
      showWhen: { questionId: "q1", value: [] },
    };
    // Empty array means "show when any value is selected"
    expect(shouldShowQuestion(question, { q1: "anything" })).toBe(true);
    expect(shouldShowQuestion(question, { q1: ["a", "b"] })).toBe(true);
    expect(shouldShowQuestion(question, { q1: [] })).toBe(false);
    expect(shouldShowQuestion(question, { q1: "" })).toBe(false);
    expect(shouldShowQuestion(question, { q1: false })).toBe(false);
    expect(shouldShowQuestion(question, { q1: true })).toBe(true);
  });
});

// ============================================================================
// validateWizardStep Tests
// ============================================================================

describe("validateWizardStep", () => {
  it("validates required text field", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "text", question: "Name?", validation: { required: true } },
      ],
    };

    const invalidResult = validateWizardStep(step, { q1: "" });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.required);

    const validResult = validateWizardStep(step, { q1: "test" });
    expect(validResult.isValid).toBe(true);
  });

  it("validates minLength", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "text", question: "Name?", validation: { minLength: 3 } },
      ],
    };

    const invalidResult = validateWizardStep(step, { q1: "ab" });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.minLength(3));

    const validResult = validateWizardStep(step, { q1: "abc" });
    expect(validResult.isValid).toBe(true);
  });

  it("validates maxLength", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "text", question: "Name?", validation: { maxLength: 5 } },
      ],
    };

    const invalidResult = validateWizardStep(step, { q1: "toolong" });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.maxLength(5));
  });

  it("validates pattern", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "text", question: "Name?", validation: { pattern: "^[a-z]+$" } },
      ],
    };

    const invalidResult = validateWizardStep(step, { q1: "ABC123" });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.invalidFormat);

    const validResult = validateWizardStep(step, { q1: "abc" });
    expect(validResult.isValid).toBe(true);
  });

  it("validates required single choice", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "single",
          question: "Choice?",
          choices: [{ id: "a", label: "A" }],
          validation: { required: true },
        },
      ],
    };

    const invalidResult = validateWizardStep(step, {});
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.selectOption);

    const validResult = validateWizardStep(step, { q1: "a" });
    expect(validResult.isValid).toBe(true);
  });

  it("validates required multiple choice", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "multiple",
          question: "Choices?",
          choices: [{ id: "a", label: "A" }],
          validation: { required: true },
        },
      ],
    };

    const invalidResult = validateWizardStep(step, { q1: [] });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].error).toBe(VALIDATION_MESSAGES.selectAtLeastOne);

    const validResult = validateWizardStep(step, { q1: ["a"] });
    expect(validResult.isValid).toBe(true);
  });

  it("always passes boolean questions", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "boolean", question: "Enable?" },
      ],
    };

    expect(validateWizardStep(step, {}).isValid).toBe(true);
    expect(validateWizardStep(step, { q1: true }).isValid).toBe(true);
    expect(validateWizardStep(step, { q1: false }).isValid).toBe(true);
  });

  it("uses default value for validation", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          defaultValue: "default",
          validation: { required: true },
        },
      ],
    };

    // Should pass because default value satisfies required
    const result = validateWizardStep(step, {});
    expect(result.isValid).toBe(true);
  });

  it("only validates visible questions", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        { id: "q1", type: "boolean", question: "Enable?" },
        {
          id: "q2",
          type: "text",
          question: "Name?",
          validation: { required: true },
          showWhen: { questionId: "q1", value: true },
        },
      ],
    };

    // q2 is hidden because q1 is not true, so it shouldn't be validated
    const result = validateWizardStep(step, { q1: false });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(1); // Only q1 was validated
  });
});

// ============================================================================
// generateNodeId Tests
// ============================================================================

describe("generateNodeId", () => {
  it("returns node.id if present", () => {
    const node: SchemaNode = { id: "custom-id", type: "file", name: "test.ts" };
    expect(generateNodeId(node, 0)).toBe("custom-id");
  });

  it("generates id from type, name, and index", () => {
    const node: SchemaNode = { type: "folder", name: "src" };
    expect(generateNodeId(node, 5)).toBe("folder-src-5");
  });
});

// ============================================================================
// getTreeSignature Tests
// ============================================================================

describe("getTreeSignature", () => {
  it("returns empty string for null tree", () => {
    expect(getTreeSignature(null)).toBe("");
  });

  it("generates consistent signature", () => {
    const tree = createMockSchemaTree();
    const sig1 = getTreeSignature(tree);
    const sig2 = getTreeSignature(tree);
    expect(sig1).toBe(sig2);
  });

  it("different trees have different signatures", () => {
    const tree1 = createMockSchemaTree();
    const tree2: SchemaTree = {
      root: { type: "folder", name: "different" },
      stats: { folders: 1, files: 0, downloads: 0 },
    };
    expect(getTreeSignature(tree1)).not.toBe(getTreeSignature(tree2));
  });
});

// ============================================================================
// validateWizardStep Pattern Validation Tests (ReDoS Protection)
// ============================================================================

describe("validateWizardStep pattern validation", () => {
  it("rejects overly long patterns", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "a".repeat(600) }, // Exceeds MAX_PATTERN_LENGTH
        },
      ],
    };

    // Should pass because overly long patterns are skipped
    const result = validateWizardStep(step, { q1: "test" });
    expect(result.isValid).toBe(true);
  });

  it("handles invalid regex patterns gracefully", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "[invalid(" }, // Invalid regex
        },
      ],
    };

    // Should pass because invalid patterns are skipped
    const result = validateWizardStep(step, { q1: "test" });
    expect(result.isValid).toBe(true);
  });

  it("validates normal patterns correctly", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "^[a-z]+$" },
        },
      ],
    };

    expect(validateWizardStep(step, { q1: "valid" }).isValid).toBe(true);
    expect(validateWizardStep(step, { q1: "INVALID" }).isValid).toBe(false);
  });

  it("rejects patterns with nested quantifiers (ReDoS risk)", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "(a+)+" }, // Nested quantifiers - ReDoS risk
        },
      ],
    };

    // Should pass because dangerous patterns are skipped
    const result = validateWizardStep(step, { q1: "aaaaaaa" });
    expect(result.isValid).toBe(true);
  });

  it("rejects patterns with quantified wildcards in groups (ReDoS risk)", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "(.*a)+" }, // Quantified wildcard in group
        },
      ],
    };

    // Should pass because dangerous patterns are skipped
    const result = validateWizardStep(step, { q1: "test" });
    expect(result.isValid).toBe(true);
  });

  it("rejects patterns with overlapping alternation prefix (ReDoS risk)", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: "(a|aa)+" }, // Overlapping alternation
        },
      ],
    };

    // Should pass because dangerous patterns are skipped
    const result = validateWizardStep(step, { q1: "aaaa" });
    expect(result.isValid).toBe(true);
  });

  it("rejects patterns with wildcard followed by quantified overlap (ReDoS risk)", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: ".+a+" }, // Wildcard followed by overlapping quantifier
        },
      ],
    };

    // Should pass because dangerous patterns are skipped
    const result = validateWizardStep(step, { q1: "testaaa" });
    expect(result.isValid).toBe(true);
  });

  it("rejects patterns with .* followed by quantified content (ReDoS risk)", () => {
    const step: WizardStep = {
      id: "s1",
      title: "Step 1",
      questions: [
        {
          id: "q1",
          type: "text",
          question: "Name?",
          validation: { pattern: ".*x+" }, // .* followed by quantified content
        },
      ],
    };

    // Should pass because dangerous patterns are skipped
    const result = validateWizardStep(step, { q1: "testxxx" });
    expect(result.isValid).toBe(true);
  });
});
