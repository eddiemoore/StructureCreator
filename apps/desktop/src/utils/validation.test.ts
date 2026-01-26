import { describe, it, expect } from "vitest";
import {
  sanitizeVariableName,
  validateVariableName,
  validateRepeatCount,
  MAX_REPEAT_COUNT,
} from "./validation";

describe("validation utilities", () => {
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

  describe("validateRepeatCount", () => {
    it("returns null for valid positive integers", () => {
      expect(validateRepeatCount("0")).toBeNull();
      expect(validateRepeatCount("1")).toBeNull();
      expect(validateRepeatCount("100")).toBeNull();
      expect(validateRepeatCount("9999")).toBeNull();
    });

    it("returns null for MAX_REPEAT_COUNT exactly", () => {
      expect(validateRepeatCount(MAX_REPEAT_COUNT.toString())).toBeNull();
    });

    it("returns null for empty string (uses default)", () => {
      expect(validateRepeatCount("")).toBeNull();
      expect(validateRepeatCount("   ")).toBeNull();
    });

    it("returns null for valid variable references", () => {
      expect(validateRepeatCount("%NUM%")).toBeNull();
      expect(validateRepeatCount("%COUNT%")).toBeNull();
      expect(validateRepeatCount("%my_var%")).toBeNull();
      expect(validateRepeatCount("%_private%")).toBeNull();
      expect(validateRepeatCount("%a1%")).toBeNull();
    });

    it("returns error for non-integer strings", () => {
      expect(validateRepeatCount("abc")).toBe("Must be a positive integer or variable reference");
      expect(validateRepeatCount("1.5")).toBe("Must be a positive integer or variable reference");
      expect(validateRepeatCount("1e5")).toBe("Must be a positive integer or variable reference");
    });

    it("returns error for negative numbers", () => {
      // Note: parseInt("-1") returns -1 which passes the integer check,
      // so negative numbers get the specific "cannot be negative" error
      expect(validateRepeatCount("-1")).toBe("Count cannot be negative");
      expect(validateRepeatCount("-100")).toBe("Count cannot be negative");
    });

    it("returns error for count exceeding maximum", () => {
      expect(validateRepeatCount("10001")).toBe(`Count cannot exceed ${MAX_REPEAT_COUNT}`);
      expect(validateRepeatCount("99999")).toBe(`Count cannot exceed ${MAX_REPEAT_COUNT}`);
    });

    it("rejects numbers with leading zeros", () => {
      expect(validateRepeatCount("01")).toBe("Must be a positive integer or variable reference");
      expect(validateRepeatCount("007")).toBe("Must be a positive integer or variable reference");
    });

    it("rejects numbers with plus sign", () => {
      expect(validateRepeatCount("+5")).toBe("Must be a positive integer or variable reference");
    });

    it("rejects invalid variable references", () => {
      // Variable starting with digit
      expect(validateRepeatCount("%1num%")).toBe("Must be a positive integer or variable reference");
      // Empty variable
      expect(validateRepeatCount("%%")).toBe("Must be a positive integer or variable reference");
      // Unclosed variable
      expect(validateRepeatCount("%NUM")).toBe("Must be a positive integer or variable reference");
    });
  });
});
