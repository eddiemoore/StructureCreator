import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { SchemaTree, Plan, PlanNode } from "@structure-creator/shared";
import { expand, toPaths } from "@structure-creator/shared";

/**
 * Golden-vector contract (ADR-0002, ADR-0004). The schema-structure fixtures
 * pin structural semantics (variable substitution in names and URLs, repeat
 * expansion, condition evaluation, loud-error edges) across targets, consumed
 * by both this web TS suite (via the shared production `expand` Plan module)
 * and the Rust suite.
 */
interface SchemaStructureCase {
  name: string;
  tree: SchemaTree;
  variables: Record<string, string>;
  expectedPaths: string[];
  expectedErrors?: number;
  expectedUrls?: Record<string, string>;
}

const fixturePath = resolve(
  process.cwd(),
  "../../fixtures/schema-structure.json"
);
const cases: SchemaStructureCase[] = JSON.parse(
  readFileSync(fixturePath, "utf-8")
);

const collectUrls = (plan: Plan): Record<string, string> => {
  const urls: Record<string, string> = {};
  const walk = (node: PlanNode, prefix: string): void => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.kind === "folder") {
      for (const child of node.children) walk(child, path);
    } else if (node.content.kind === "download") {
      urls[path] = node.content.url;
    }
  };
  for (const node of plan.nodes) walk(node, "");
  return urls;
};

describe("schema-structure golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "$name",
    ({ tree, variables, expectedPaths, expectedErrors, expectedUrls }) => {
      const plan = expand(tree, variables);
      const got = toPaths(plan);
      const expected = [...expectedPaths].sort();
      expect(got).toEqual(expected);
      expect(plan.errors.length).toBe(expectedErrors ?? 0);
      if (expectedUrls) {
        const urls = collectUrls(plan);
        for (const [path, url] of Object.entries(expectedUrls)) {
          expect(urls[path], `URL at ${path}`).toBe(url);
        }
      }
    }
  );
});
