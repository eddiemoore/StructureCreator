import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { parseSchema } from "../lib/adapters/web/schema-parser";

/**
 * Golden-vector parser parity contract (ADR-0002 / #96).
 *
 * The same XML schema fixture is parsed by both the web target (this test,
 * via DOMParser-backed `parseSchema`) and the Rust target (Rust contract
 * `test_schema_parse_matches_golden_contract`). Each serializes its parsed
 * tree to JSON and asserts equality against the committed `expected` tree
 * in the fixture, so parser divergence between the two implementations
 * fails CI.
 */
interface ParseCase {
  name: string;
  xml: string;
  expected: unknown;
}

const fixturePath = resolve(process.cwd(), "../../fixtures/schema-parse.json");
const cases: ParseCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

/**
 * Round-trip through JSON so the comparison ignores key order, function
 * properties, and any object identity differences the parsers might emit.
 */
const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("schema-parse golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$name", ({ xml, expected }) => {
    const tree = parseSchema(xml);
    expect(normalize(tree)).toEqual(expected);
  });
});
