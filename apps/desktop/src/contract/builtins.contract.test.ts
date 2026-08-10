import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { completeVariableMap } from "@structure-creator/shared";

/**
 * Golden-vector contract (ADR-0002). The builtins fixtures pin the Built-in
 * Variable name set, their formats, and the user-override rule, consumed by
 * both this web TS suite and the Rust suite.
 *
 * `now` is a local wall-clock string with no offset, so both languages read
 * the same fields regardless of the machine's timezone.
 */
interface BuiltinsCase {
  name: string;
  now: string;
  projectName: string | null;
  variables: Record<string, string>;
  expected: Record<string, string>;
}

const fixturePath = resolve(process.cwd(), "../../fixtures/builtins.json");
const cases: BuiltinsCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("built-in variable golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$name", ({ now, projectName, variables, expected }) => {
    const completed = completeVariableMap(
      variables,
      projectName ?? undefined,
      new Date(now)
    );
    expect(completed).toEqual(expected);
  });
});
