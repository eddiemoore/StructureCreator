import { describe, it, expect } from "vitest";
import {
  processTemplate,
  extractTemplateVariables,
  processTemplateOrThrow,
} from "./templating";

function makeVars(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs);
}

// ============================================================================
// Truthiness Tests
// ============================================================================

describe("truthiness", () => {
  it("variable exists and is non-empty", () => {
    const vars = makeVars([["%FLAG%", "yes"]]);
    const result = processTemplate("{{if FLAG}}yes{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "yes" });
  });

  it("false string is falsy", () => {
    const vars = makeVars([["%FLAG%", "false"]]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });

  it("zero string is falsy", () => {
    const vars = makeVars([["%FLAG%", "0"]]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });

  it("empty string is falsy", () => {
    const vars = makeVars([["%FLAG%", ""]]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });

  it("whitespace only is falsy", () => {
    const vars = makeVars([["%FLAG%", "   "]]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });

  it("missing variable is falsy", () => {
    const vars = makeVars([]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });

  it("FALSE (uppercase) is falsy", () => {
    const vars = makeVars([["%FLAG%", "FALSE"]]);
    const result = processTemplate("{{if FLAG}}yes{{else}}no{{endif}}", vars);
    expect(result).toEqual({ ok: true, value: "no" });
  });
});

// ============================================================================
// If/Else Tests
// ============================================================================

describe("if conditionals", () => {
  it("simple if true", () => {
    const vars = makeVars([["%SHOW%", "true"]]);
    const content = "before\n{{if SHOW}}included{{endif}}\nafter";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "before\nincluded\nafter" });
  });

  it("simple if false", () => {
    const vars = makeVars([["%SHOW%", "false"]]);
    const content = "before\n{{if SHOW}}excluded{{endif}}\nafter";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "before\n\nafter" });
  });

  it("if else true", () => {
    const vars = makeVars([["%SHOW%", "yes"]]);
    const content = "{{if SHOW}}then-branch{{else}}else-branch{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "then-branch" });
  });

  it("if else false", () => {
    const vars = makeVars([["%SHOW%", "0"]]);
    const content = "{{if SHOW}}then-branch{{else}}else-branch{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "else-branch" });
  });

  it("nested if both true", () => {
    const vars = makeVars([
      ["%A%", "true"],
      ["%B%", "true"],
    ]);
    const content = "{{if A}}A{{if B}}B{{endif}}{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "AB" });
  });

  it("nested if inner false", () => {
    const vars = makeVars([
      ["%A%", "true"],
      ["%B%", "false"],
    ]);
    const content = "{{if A}}A{{if B}}B{{endif}}{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "A" });
  });

  it("unclosed if error", () => {
    const vars = makeVars([]);
    const content = "{{if SHOW}}no end";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UnclosedIf");
      expect(result.error.var).toBe("SHOW");
    }
  });

  it("unexpected endif error", () => {
    const vars = makeVars([]);
    const content = "random {{endif}}";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UnexpectedEndif");
    }
  });

  it("unexpected else error", () => {
    const vars = makeVars([]);
    const content = "random {{else}}";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UnexpectedElse");
    }
  });
});

// ============================================================================
// For Loop Tests
// ============================================================================

describe("for loops", () => {
  it("simple for loop", () => {
    const vars = makeVars([["%ITEMS%", "a,b,c"]]);
    const content = "{{for item in ITEMS}}[{{item}}]{{endfor}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "[a][b][c]" });
  });

  it("for loop empty list", () => {
    const vars = makeVars([["%ITEMS%", ""]]);
    const content = "before{{for item in ITEMS}}[{{item}}]{{endfor}}after";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "beforeafter" });
  });

  it("for loop missing variable", () => {
    const vars = makeVars([]);
    const content = "{{for x in MISSING}}[{{x}}]{{endfor}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "" });
  });

  it("for loop with whitespace items", () => {
    const vars = makeVars([["%ITEMS%", " a , b , c "]]);
    const content = "{{for item in ITEMS}}[{{item}}]{{endfor}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "[a][b][c]" });
  });

  it("nested for loops", () => {
    const vars = makeVars([
      ["%OUTER%", "1,2"],
      ["%INNER%", "a,b"],
    ]);
    const content = "{{for i in OUTER}}{{for j in INNER}}({{i}},{{j}}){{endfor}}{{endfor}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "(1,a)(1,b)(2,a)(2,b)" });
  });

  it("unclosed for error", () => {
    const vars = makeVars([]);
    const content = "{{for x in ITEMS}}no end";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UnclosedFor");
      expect(result.error.var).toBe("ITEMS");
      expect(result.error.item).toBe("x");
    }
  });

  it("unexpected endfor error", () => {
    const vars = makeVars([]);
    const content = "random {{endfor}}";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("UnexpectedEndfor");
    }
  });
});

// ============================================================================
// Combined If/For Tests
// ============================================================================

describe("combined if/for", () => {
  it("if inside for", () => {
    const vars = makeVars([
      ["%ITEMS%", "a,b,c"],
      ["%SHOW_B%", "true"],
    ]);
    const content = "{{for item in ITEMS}}{{if SHOW_B}}[{{item}}]{{endif}}{{endfor}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "[a][b][c]" });
  });

  it("for inside if true", () => {
    const vars = makeVars([
      ["%SHOW%", "true"],
      ["%ITEMS%", "x,y"],
    ]);
    const content = "{{if SHOW}}{{for i in ITEMS}}{{i}}{{endfor}}{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "xy" });
  });

  it("for inside if false", () => {
    const vars = makeVars([
      ["%SHOW%", "false"],
      ["%ITEMS%", "x,y"],
    ]);
    const content = "{{if SHOW}}{{for i in ITEMS}}{{i}}{{endfor}}{{endif}}";
    const result = processTemplate(content, vars);
    expect(result).toEqual({ ok: true, value: "" });
  });
});

// ============================================================================
// Variable Extraction Tests
// ============================================================================

describe("extractTemplateVariables", () => {
  it("extracts if variable", () => {
    const content = "{{if USE_FEATURE}}feature{{endif}}";
    const vars = extractTemplateVariables(content);
    expect(vars).toContain("%USE_FEATURE%");
  });

  it("extracts for variable", () => {
    const content = "{{for item in ITEMS}}{{item}}{{endfor}}";
    const vars = extractTemplateVariables(content);
    expect(vars).toContain("%ITEMS%");
  });

  it("ignores lowercase variables", () => {
    const content = "{{if lowercase}}test{{endif}}";
    const vars = extractTemplateVariables(content);
    expect(vars).toHaveLength(0);
  });

  it("extracts multiple variables", () => {
    const content = "{{if A}}a{{endif}}{{if B}}b{{endif}}{{for x in C}}{{x}}{{endfor}}";
    const vars = extractTemplateVariables(content);
    expect(vars).toContain("%A%");
    expect(vars).toContain("%B%");
    expect(vars).toContain("%C%");
  });
});

// ============================================================================
// Real-World Examples
// ============================================================================

describe("real-world examples", () => {
  it("readme example", () => {
    const vars = makeVars([
      ["%USE_NPM%", "false"],
      ["%FEATURES%", "auth,api,ui"],
    ]);
    const content = `# Project

{{if USE_NPM}}
npm install
{{else}}
yarn install
{{endif}}

## Features
{{for feature in FEATURES}}
- {{feature}}
{{endfor}}
`;
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("yarn install");
      expect(result.value).not.toContain("npm install");
      expect(result.value).toContain("- auth");
      expect(result.value).toContain("- api");
      expect(result.value).toContain("- ui");
    }
  });

  it("preserves handlebars syntax", () => {
    const vars = makeVars([["%SHOW%", "true"]]);
    const content = "{{> header}}{{if SHOW}}included{{endif}}{{> footer}}";
    const result = processTemplate(content, vars);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("{{> header}}");
      expect(result.value).toContain("{{> footer}}");
      expect(result.value).toContain("included");
    }
  });

  it("no template directives", () => {
    const vars = makeVars([]);
    const content = "This is {{just}} some text with {curly} braces";
    const result = processTemplate(content, vars);
    expect(result).toEqual({
      ok: true,
      value: "This is {{just}} some text with {curly} braces",
    });
  });
});

// ============================================================================
// processTemplateOrThrow Tests
// ============================================================================

describe("processTemplateOrThrow", () => {
  it("returns string on success", () => {
    const vars = makeVars([["%SHOW%", "true"]]);
    const result = processTemplateOrThrow("{{if SHOW}}yes{{endif}}", vars);
    expect(result).toBe("yes");
  });

  it("throws on error", () => {
    const vars = makeVars([]);
    expect(() => processTemplateOrThrow("{{if SHOW}}no end", vars)).toThrow(
      "Unclosed {{if SHOW}} block"
    );
  });
});
