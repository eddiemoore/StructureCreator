import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { SchemaTree } from "@structure-creator/shared";
import { expandTree } from "../lib/adapters/web/expand-tree";

/**
 * Golden-vector contract (ADR-0002, ADR-0004). The schema-structure fixtures
 * pin structural semantics (variable substitution in names, repeat expansion,
 * condition evaluation, loud-error edges) across targets, consumed by both
 * this web TS suite (via `expandTree`) and the Rust suite (via
 * `generate_diff_preview`).
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
      const { paths, errors } = expandTree(tree, variables);
      const got = [...paths].sort();
      const expected = [...expectedPaths].sort();
      expect(got).toEqual(expected);
      expect(errors.length).toBe(expectedErrors ?? 0);
    }
  );
});
