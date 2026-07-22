import { describe, it, expect } from "vitest";
import {
  expand,
  toPaths,
  MAX_REPEAT_COUNT,
  MAX_SCHEMA_DEPTH,
} from "./plan";
import type { Plan, PlanFile, PlanFolder } from "./plan";
import type { SchemaNode, SchemaTree } from "./types";

const tree = (root: SchemaNode): SchemaTree => ({
  root,
  stats: { folders: 0, files: 0, downloads: 0, generated: 0 },
});

const folder = (name: string, children: SchemaNode[] = []): SchemaNode => ({
  type: "folder",
  name,
  children,
});

const file = (name: string, extra: Partial<SchemaNode> = {}): SchemaNode => ({
  type: "file",
  name,
  ...extra,
});

const firstFile = (plan: Plan): PlanFile => {
  const root = plan.nodes[0] as PlanFolder;
  return root.children[0] as PlanFile;
};

describe("expand", () => {
  it("resolves names via variable substitution", () => {
    const plan = expand(
      tree(folder("%NAME%", [file("%NAME%.txt")])),
      { "%NAME%": "demo" }
    );

    expect(plan.errors).toEqual([]);
    const root = plan.nodes[0] as PlanFolder;
    expect(root.kind).toBe("folder");
    expect(root.name).toBe("demo");
    expect(root.children).toHaveLength(1);
    expect((root.children[0] as PlanFile).name).toBe("demo.txt");
  });

  it("renders inline content with variable substitution", () => {
    const plan = expand(
      tree(folder("root", [file("a.txt", { content: "hello %NAME%" })])),
      { "%NAME%": "world" }
    );

    expect(firstFile(plan).content).toEqual({
      kind: "inline",
      text: "hello world",
    });
  });

  it("renders templated content with templating THEN substitution", () => {
    const plan = expand(
      tree(
        folder("root", [
          file("a.txt", {
            content: "{{if FLAG}}yes %NAME%{{else}}no{{endif}}",
            template: true,
          }),
        ])
      ),
      { "%FLAG%": "on", "%NAME%": "world" }
    );

    expect(firstFile(plan).content).toEqual({
      kind: "inline",
      text: "yes world",
    });
    expect(plan.warnings).toEqual([]);
  });

  it("falls back to substituted raw content on template error, with a warning", () => {
    const plan = expand(
      tree(
        folder("root", [
          file("a.txt", {
            content: "{{if FLAG}}unclosed %NAME%",
            template: true,
          }),
        ])
      ),
      { "%FLAG%": "on", "%NAME%": "world" }
    );

    expect(firstFile(plan).content).toEqual({
      kind: "inline",
      text: "{{if FLAG}}unclosed world",
    });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].message).toContain("Template error in a.txt");
    expect(plan.warnings[0].path).toBe("root/a.txt");
    expect(plan.errors).toEqual([]);
  });

  it("renders empty inline content for files without content", () => {
    const plan = expand(tree(folder("root", [file("empty.txt")])), {});
    expect(firstFile(plan).content).toEqual({ kind: "inline", text: "" });
  });

  it("defers url files as download instructions with substituted url", () => {
    const plan = expand(
      tree(
        folder("root", [
          file("a.txt", { url: "https://example.com/%NAME%.txt" }),
        ])
      ),
      { "%NAME%": "demo" }
    );

    const content = firstFile(plan).content;
    expect(content.kind).toBe("download");
    if (content.kind === "download") {
      expect(content.url).toBe("https://example.com/demo.txt");
      expect(content.variables).toEqual({ "%NAME%": "demo" });
    }
  });

  it("defers generator files as generate instructions carrying the spec", () => {
    const spec = file("db.sqlite", {
      generate: "sqlite" as const,
      content: "CREATE TABLE t (id INTEGER);",
    });
    const plan = expand(tree(folder("root", [spec])), { "%X%": "1" });

    const content = firstFile(plan).content;
    expect(content.kind).toBe("generate");
    if (content.kind === "generate") {
      expect(content.generator).toBe("sqlite");
      expect(content.spec).toBe(spec);
      expect(content.variables).toEqual({ "%X%": "1" });
    }
  });

  describe("if / else", () => {
    const ifElseTree = tree(
      folder("root", [
        {
          type: "if",
          name: "",
          condition_var: "FLAG",
          children: [file("yes.txt")],
        },
        { type: "else", name: "", children: [file("no.txt")] },
      ])
    );

    it("emits if-children when the condition is truthy", () => {
      const plan = expand(ifElseTree, { "%FLAG%": "on" });
      expect(toPaths(plan)).toEqual(["root", "root/yes.txt"]);
    });

    it.each(["", "  ", "false", "FALSE", "0", " 0 "])(
      "treats %j as falsy and takes the else branch",
      (value) => {
        const plan = expand(ifElseTree, { "%FLAG%": value });
        expect(toPaths(plan)).toEqual(["root", "root/no.txt"]);
      }
    );

    it("treats a missing condition variable as falsy", () => {
      const plan = expand(ifElseTree, {});
      expect(toPaths(plan)).toEqual(["root", "root/no.txt"]);
    });

    it("annotates emitted nodes with branch provenance", () => {
      const taken = expand(ifElseTree, { "%FLAG%": "on" });
      expect(firstFile(taken).provenance).toEqual({
        branch: "if",
        conditionVar: "FLAG",
      });

      const notTaken = expand(ifElseTree, {});
      expect(firstFile(notTaken).provenance).toEqual({ branch: "else" });
    });

    it("pairs else with the immediately preceding if only", () => {
      const plan = expand(
        tree(
          folder("root", [
            {
              type: "if",
              name: "",
              condition_var: "FLAG",
              children: [file("yes.txt")],
            },
            file("between.txt"),
            { type: "else", name: "", children: [file("no.txt")] },
          ])
        ),
        {}
      );
      // The intervening node clears if-state, so the orphan else is inert.
      expect(toPaths(plan)).toEqual(["root", "root/between.txt"]);
    });
  });

  describe("repeat", () => {
    const repeatTree = (extra: Partial<SchemaNode>): SchemaTree =>
      tree(
        folder("root", [
          {
            type: "repeat",
            name: "",
            children: [file("item-%i%.txt")],
            ...extra,
          },
        ])
      );

    it("expands children count times with 0- and 1-indexed variables", () => {
      const plan = expand(
        tree(
          folder("root", [
            {
              type: "repeat",
              name: "",
              repeat_count: "2",
              repeat_as: "n",
              children: [file("item-%n%-of-%n_1%.txt")],
            },
          ])
        ),
        {}
      );
      expect(toPaths(plan)).toEqual([
        "root",
        "root/item-0-of-1.txt",
        "root/item-1-of-2.txt",
      ]);
      expect(plan.errors).toEqual([]);
    });

    it("resolves the count from a variable", () => {
      const plan = expand(
        repeatTree({ repeat_count: "%COUNT%", repeat_as: "i" }),
        { "%COUNT%": "2" }
      );
      expect(toPaths(plan)).toEqual([
        "root",
        "root/item-0.txt",
        "root/item-1.txt",
      ]);
    });

    it("defaults a missing count to one iteration", () => {
      const plan = expand(repeatTree({ repeat_as: "i" }), {});
      expect(toPaths(plan)).toEqual(["root", "root/item-0.txt"]);
      expect(plan.errors).toEqual([]);
    });

    it("annotates emitted nodes with the iteration index", () => {
      const plan = expand(
        repeatTree({ repeat_count: "2", repeat_as: "i" }),
        {}
      );
      const root = plan.nodes[0] as PlanFolder;
      expect(root.children.map((c) => c.provenance)).toEqual([
        { repeatIndex: 0 },
        { repeatIndex: 1 },
      ]);
    });

    it.each([
      ["negative count", { repeat_count: "-2" }],
      ["non-numeric count", { repeat_count: "banana" }],
      ["count above maximum", { repeat_count: String(MAX_REPEAT_COUNT + 1) }],
      ["invalid iteration variable name", { repeat_count: "2", repeat_as: "1bad" }],
      ["empty iteration variable name", { repeat_count: "2", repeat_as: "" }],
    ])("errors loudly and skips the block on %s", (_name, extra) => {
      const plan = expand(repeatTree({ repeat_as: "i", ...extra }), {});
      expect(toPaths(plan)).toEqual(["root"]);
      expect(plan.errors).toHaveLength(1);
      expect(plan.errors[0].path).toBe("root");
    });

    it("resets if-state per iteration and scopes iteration variables", () => {
      const plan = expand(
        tree(
          folder("root", [
            {
              type: "repeat",
              name: "",
              repeat_count: "2",
              repeat_as: "i",
              children: [
                folder("f-%i%", [file("body-%i%.txt", { content: "n=%i_1%" })]),
              ],
            },
          ])
        ),
        {}
      );
      expect(toPaths(plan)).toEqual([
        "root",
        "root/f-0",
        "root/f-0/body-0.txt",
        "root/f-1",
        "root/f-1/body-1.txt",
      ]);
      const root = plan.nodes[0] as PlanFolder;
      const inner = (root.children[1] as PlanFolder).children[0] as PlanFile;
      expect(inner.content).toEqual({ kind: "inline", text: "n=2" });
    });
  });

  it("errors loudly past the maximum schema depth", () => {
    let node: SchemaNode = file("leaf.txt");
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 5; i++) {
      node = folder(`d${i}`, [node]);
    }
    const plan = expand(tree(node), {});
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors[0].message).toContain("Maximum schema depth");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const input = tree(
      folder("%NAME%", [
        {
          type: "repeat",
          name: "",
          repeat_count: "2",
          repeat_as: "i",
          children: [file("f-%i%.txt")],
        },
      ])
    );
    const variables = { "%NAME%": "demo" };
    const snapshot = JSON.parse(JSON.stringify(input));

    const a = expand(input, variables);
    const b = expand(input, variables);

    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
    expect(variables).toEqual({ "%NAME%": "demo" });
  });
});

describe("toPaths", () => {
  it("flattens a plan into a sorted path list", () => {
    const plan = expand(
      tree(folder("root", [folder("b", [file("z.txt")]), file("a.txt")])),
      {}
    );
    expect(toPaths(plan)).toEqual([
      "root",
      "root/a.txt",
      "root/b",
      "root/b/z.txt",
    ]);
  });
});
