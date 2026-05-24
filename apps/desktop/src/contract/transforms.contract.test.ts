import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { applyTransform } from "../lib/adapters/web/transforms";

/**
 * Golden-vector contract (ADR-0002). The transform fixtures are the single
 * cross-target spec, consumed by both this web TS suite and the Rust suite.
 * A divergence between the two implementations fails one of them in CI.
 */
interface TransformCase {
  transform: string;
  input: string;
  expected: string;
}

// vitest runs with cwd at the desktop package root (apps/desktop); the shared
// fixtures live at the repo root.
const fixturePath = resolve(process.cwd(), "../../fixtures/transforms.json");
const cases: TransformCase[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("transforms golden-vector contract", () => {
  it("loads cases from the shared fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "$transform on '$input' -> '$expected'",
    ({ transform, input, expected }) => {
      expect(applyTransform(input, transform)).toBe(expected);
    }
  );
});
