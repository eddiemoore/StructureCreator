import { describe, it, expect } from "vitest";
import { validateRepeatCount, MAX_REPEAT_COUNT } from "./validation";

describe("validation utilities", () => {
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
