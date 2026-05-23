import { describe, it, expect } from "vitest";
import { asVariableName, toToken, type VariableName } from "./variableName";

describe("variableName", () => {
  describe("asVariableName", () => {
    it("strips surrounding % delimiters", () => {
      expect(asVariableName("%NAME%")).toBe("NAME");
    });

    it("is idempotent on an already-clean name", () => {
      expect(asVariableName("NAME")).toBe("NAME");
      expect(asVariableName(asVariableName("%NAME%"))).toBe("NAME");
    });
  });

  describe("toToken", () => {
    it("wraps a clean name in % delimiters", () => {
      expect(toToken(asVariableName("NAME"))).toBe("%NAME%");
    });

    it("round-trips with asVariableName", () => {
      const name = asVariableName("NAME");
      expect(asVariableName(toToken(name))).toBe(name);
    });
  });

  it("rejects a raw string where a VariableName is expected (compile-time)", () => {
    // @ts-expect-error - a plain string is not assignable to VariableName
    const name: VariableName = "NAME";
    expect(typeof name).toBe("string");
  });
});
