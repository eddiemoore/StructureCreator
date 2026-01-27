import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(parseMarkdown("")).toBe("");
    expect(parseMarkdown(undefined as unknown as string)).toBe("");
  });

  it("escapes HTML special characters", () => {
    expect(parseMarkdown("<script>alert('xss')</script>")).toContain("&lt;script&gt;");
    expect(parseMarkdown("a & b")).toContain("&amp;");
    expect(parseMarkdown('"quoted"')).toContain("&quot;");
  });

  it("parses bold text", () => {
    expect(parseMarkdown("**bold**")).toBe("<strong>bold</strong>");
    expect(parseMarkdown("__bold__")).toBe("<strong>bold</strong>");
    expect(parseMarkdown("text **bold** text")).toContain("<strong>bold</strong>");
  });

  it("parses italic text", () => {
    expect(parseMarkdown("*italic*")).toBe("<em>italic</em>");
    expect(parseMarkdown("_italic_")).toBe("<em>italic</em>");
  });

  it("parses inline code", () => {
    const result = parseMarkdown("`code`");
    expect(result).toContain("<code");
    expect(result).toContain("code</code>");
  });

  it("parses links", () => {
    const result = parseMarkdown("[text](https://example.com)");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain(">text</a>");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("parses headers", () => {
    expect(parseMarkdown("# Header")).toContain("<strong");
    expect(parseMarkdown("## Header")).toContain("<strong");
    expect(parseMarkdown("### Header")).toContain("<strong");
  });

  it("parses bullet lists", () => {
    const result = parseMarkdown("- item 1\n- item 2");
    expect(result).toContain("<ul");
    expect(result).toContain("<li");
    expect(result).toContain("item 1");
    expect(result).toContain("item 2");
  });

  it("parses asterisk bullet lists", () => {
    const result = parseMarkdown("* item 1\n* item 2");
    expect(result).toContain("<ul");
    expect(result).toContain("<li");
  });

  it("handles complex markdown", () => {
    const input = `## What's New

- **Feature**: Added auto-update
- Fixed bug in \`parser\`
- See [docs](https://example.com)`;

    const result = parseMarkdown(input);
    expect(result).toContain("<strong");
    expect(result).toContain("<code");
    expect(result).toContain("<a href");
    expect(result).toContain("<ul");
  });
});
