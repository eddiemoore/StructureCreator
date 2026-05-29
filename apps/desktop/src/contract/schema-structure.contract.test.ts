import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { SchemaTree } from "@structure-creator/shared";
import { expandTreeToPaths } from "../lib/adapters/web/expand-tree";

/**
 * Golden-vector contract (ADR-0002). The schema-structure fixtures pin
 * structural semantics (variable substitution in names, repeat expansion,
 * condition evaluation) across targets, consumed by both this web TS suite
 * (via `expandTreeToPaths`) and the Rust suite (via `generate_diff_preview`).
 */
interface SchemaStructureCase {
  name: string;
  tree: SchemaTree;
  variables: Record<string, string>;
  expectedPaths: string[];
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
    ({ tree, variables, expectedPaths }) => {
      const got = [...expandTreeToPaths(tree, variables)].sort();
      const expected = [...expectedPaths].sort();
      expect(got).toEqual(expected);
    }
  );
});
