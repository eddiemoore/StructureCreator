import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { SchemaTree } from "@structure-creator/shared";
import { expand, toPaths } from "@structure-creator/shared";

/**
 * Golden-vector contract (ADR-0002, ADR-0004). The schema-structure fixtures
 * pin structural semantics (variable substitution in names, repeat expansion,
 * condition evaluation, loud-error edges) across targets, consumed by both
 * this web TS suite (via the shared production `expand` Plan module) and the
 * Rust suite.
 */
interface SchemaStructureCase {
  name: string;
  tree: SchemaTree;
  variables: Record<string, string>;
  expectedPaths: string[];
  expectedErrors?: number;
}

const fixturePath = resolve(
  process.cwd(),
  "../../fixtures/schema-structure.json"
);
const cases: SchemaStructureCase[] = JSON.parse(
  readFileSync(fixturePath, "utf-8")
);

describe("schema-structure golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "$name",
    ({ tree, variables, expectedPaths, expectedErrors }) => {
      const plan = expand(tree, variables);
      const got = toPaths(plan);
      const expected = [...expectedPaths].sort();
      expect(got).toEqual(expected);
      expect(plan.errors.length).toBe(expectedErrors ?? 0);
    }
  );
});
