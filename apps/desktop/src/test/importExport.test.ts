import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../utils/filename";
import { URL_IMPORT_RATE_LIMIT_MS } from "../utils/constants";

describe("sanitizeFilename", () => {
  it("returns original name if valid", () => {
    expect(sanitizeFilename("my-template")).toBe("my-template");
  });

  it("replaces Windows forbidden characters with underscores", () => {
    expect(sanitizeFilename("my<template>")).toBe("my_template_");
    expect(sanitizeFilename('file:name')).toBe("file_name");
    expect(sanitizeFilename("path/to\\file")).toBe("path_to_file");
    expect(sanitizeFilename("what?")).toBe("what_");
    expect(sanitizeFilename("star*")).toBe("star_");
    expect(sanitizeFilename('quote"me')).toBe("quote_me");
    expect(sanitizeFilename("pipe|here")).toBe("pipe_here");
  });

  it("removes control characters", () => {
    expect(sanitizeFilename("hello\x00world")).toBe("helloworld");
    expect(sanitizeFilename("line\nbreak")).toBe("linebreak");
    expect(sanitizeFilename("tab\there")).toBe("tabhere");
  });

  it("removes leading dots", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("..double")).toBe("double");
    expect(sanitizeFilename("...triple")).toBe("triple");
  });

  it("collapses whitespace", () => {
    expect(sanitizeFilename("multiple   spaces")).toBe("multiple spaces");
    // Tabs are control characters (0x09) so they get removed, not converted to spaces
    expect(sanitizeFilename("tabs\t\there")).toBe("tabshere");
  });

  it("trims whitespace", () => {
    expect(sanitizeFilename("  padded  ")).toBe("padded");
  });

  it("returns 'template' for empty result", () => {
    expect(sanitizeFilename("")).toBe("template");
    expect(sanitizeFilename("   ")).toBe("template");
    expect(sanitizeFilename("...")).toBe("template");
  });

  it("handles combination of issues", () => {
    // After: Windows chars → ".._file__name_", collapse whitespace, trim, then remove leading dots
    expect(sanitizeFilename("  ..<file>:name?  ")).toBe("_file__name_");
  });

  it("preserves unicode characters", () => {
    expect(sanitizeFilename("模板名称")).toBe("模板名称");
    expect(sanitizeFilename("Plantilla España")).toBe("Plantilla España");
  });
});

describe("Rate limiting logic", () => {
  it("calculates correct wait time when under limit", () => {
    const lastImportTime = Date.now() - 500; // 500ms ago
    const now = Date.now();
    const timeSinceLastImport = now - lastImportTime;

    expect(timeSinceLastImport).toBeLessThan(URL_IMPORT_RATE_LIMIT_MS);

    const waitTime = Math.ceil((URL_IMPORT_RATE_LIMIT_MS - timeSinceLastImport) / 1000);
    expect(waitTime).toBeGreaterThanOrEqual(1);
    expect(waitTime).toBeLessThanOrEqual(2);
  });

  it("allows import after interval passes", () => {
    const lastImportTime = Date.now() - (URL_IMPORT_RATE_LIMIT_MS + 1000); // interval + 1s ago
    const now = Date.now();
    const timeSinceLastImport = now - lastImportTime;

    expect(timeSinceLastImport).toBeGreaterThanOrEqual(URL_IMPORT_RATE_LIMIT_MS);
  });
});
