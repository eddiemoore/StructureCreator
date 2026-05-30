import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { processTemplateOrThrow } from "@structure-creator/shared";

/**
 * Golden-vector contract (ADR-0002). The templating fixtures pin the
 * `{{if}}` / `{{for}}` directives across targets, consumed by both this
 * web TS suite (via the shared templating engine) and the Rust suite.
 */
interface TemplatingCase {
  template: string;
  variables: Record<string, string>;
  expected: string;
}

const fixturePath = resolve(process.cwd(), "../../fixtures/templating.json");
const cases: TemplatingCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("templating golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "$template -> $expected",
    ({ template, variables, expected }) => {
      expect(processTemplateOrThrow(template, variables)).toBe(expected);
    }
  );
});
