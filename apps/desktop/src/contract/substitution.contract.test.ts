import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { substituteVariables } from "../lib/adapters/web/transforms";

/**
 * Golden-vector contract (ADR-0002). The substitution fixtures pin both
 * variable substitution and the `%NAME%` Variable-token convention, consumed
 * by both this web TS suite and the Rust suite.
 */
interface SubstitutionCase {
  template: string;
  variables: Record<string, string>;
  expected: string;
}

const fixturePath = resolve(process.cwd(), "../../fixtures/substitution.json");
const cases: SubstitutionCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("substitution golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "$template -> $expected",
    ({ template, variables, expected }) => {
      expect(substituteVariables(template, variables)).toBe(expected);
    }
  );
});
