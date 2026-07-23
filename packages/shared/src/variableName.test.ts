import { describe, it, expect } from "vitest";
import {
  type VariableName,
  asVariableName,
  toToken,
  toTokenKeys,
  toNameKeys,
  sanitizeVariableName,
  validateVariableName,
  containsVariableToken,
} from "./variableName";

describe("variableName module (ADR-0001)", () => {
  describe("asVariableName", () => {
    it("strips a surrounding % delimiter", () => {
      expect(asVariableName("%NAME%")).toBe("NAME");
    });

    it("is idempotent", () => {
      expect(asVariableName(asVariableName("%NAME%"))).toBe("NAME");
      expect(asVariableName("NAME")).toBe("NAME");
    });

    it("leaves interior % alone", () => {
      expect(asVariableName("A%B")).toBe("A%B");
    });
  });

  describe("toToken", () => {
    it("round-trips with asVariableName", () => {
      const name = asVariableName("%NAME%");
      expect(toToken(name)).toBe("%NAME%");
      expect(asVariableName(toToken(name))).toBe(name);
    });
  });

  describe("toTokenKeys / toNameKeys", () => {
    it("toTokenKeys tokenizes clean, token, and mixed keys", () => {
      expect(toTokenKeys({ A: "1", "%B%": "2" })).toEqual({ "%A%": "1", "%B%": "2" });
    });

    it("toNameKeys cleans clean, token, and mixed keys", () => {
      expect(toNameKeys({ A: "1", "%B%": "2" })).toEqual({ A: "1", B: "2" });
    });

    it("are mutually idempotent inverses on keys", () => {
      const map = { "%A%": "1", B: "2" };
      expect(toNameKeys(toTokenKeys(map))).toEqual({ A: "1", B: "2" });
    });
  });

  describe("sanitizeVariableName", () => {
    it("returns trimmed value for valid input", () => {
      expect(sanitizeVariableName("myVar")).toBe("myVar");
      expect(sanitizeVariableName("  myVar  ")).toBe("myVar");
    });

    it("strips percent signs", () => {
      expect(sanitizeVariableName("%myVar%")).toBe("myVar");
      expect(sanitizeVariableName("%%test%%")).toBe("test");
    });

    it("removes special characters", () => {
      expect(sanitizeVariableName("my-var")).toBe("myvar");
      expect(sanitizeVariableName("my.var")).toBe("myvar");
      expect(sanitizeVariableName("my var")).toBe("myvar");
      expect(sanitizeVariableName("my@var!")).toBe("myvar");
    });

    it("allows alphanumeric and underscore", () => {
      expect(sanitizeVariableName("my_var_123")).toBe("my_var_123");
      expect(sanitizeVariableName("_private")).toBe("_private");
      expect(sanitizeVariableName("123")).toBe("123");
    });

    it("truncates to 50 characters", () => {
      const longName = "a".repeat(60);
      expect(sanitizeVariableName(longName)).toBe("a".repeat(50));
    });

    it("returns empty string for empty input", () => {
      expect(sanitizeVariableName("")).toBe("");
      expect(sanitizeVariableName("   ")).toBe("");
    });
  });

  describe("validateVariableName", () => {
    it("returns null for valid names starting with letter", () => {
      expect(validateVariableName("i")).toBeNull();
      expect(validateVariableName("myVar")).toBeNull();
      expect(validateVariableName("Index")).toBeNull();
    });

    it("returns null for valid names starting with underscore", () => {
      expect(validateVariableName("_i")).toBeNull();
      expect(validateVariableName("_private")).toBeNull();
      expect(validateVariableName("__double")).toBeNull();
    });

    it("returns null for empty string (uses default)", () => {
      expect(validateVariableName("")).toBeNull();
      expect(validateVariableName("   ")).toBeNull();
    });

    it("returns error for names starting with digit", () => {
      expect(validateVariableName("1")).toBe("Variable name cannot start with a digit");
      expect(validateVariableName("123")).toBe("Variable name cannot start with a digit");
      expect(validateVariableName("1abc")).toBe("Variable name cannot start with a digit");
      expect(validateVariableName("0_index")).toBe("Variable name cannot start with a digit");
    });

    it("allows digits after first character", () => {
      expect(validateVariableName("var1")).toBeNull();
      expect(validateVariableName("a123")).toBeNull();
      expect(validateVariableName("_1")).toBeNull();
    });
  });

  it("rejects a raw string where a VariableName is expected (compile-time)", () => {
    // @ts-expect-error - a plain string is not assignable to VariableName
    const name: VariableName = "NAME";
    expect(typeof name).toBe("string");
  });

  describe("containsVariableToken", () => {
    it("matches token references", () => {
      expect(containsVariableToken("%NUM%")).toBe(true);
      expect(containsVariableToken("%_private%")).toBe(true);
      expect(containsVariableToken("prefix %COUNT% suffix")).toBe(true);
    });

    it("rejects non-tokens", () => {
      expect(containsVariableToken("%1num%")).toBe(false);
      expect(containsVariableToken("%%")).toBe(false);
      expect(containsVariableToken("%NUM")).toBe(false);
      expect(containsVariableToken("plain")).toBe(false);
    });
  });
});
