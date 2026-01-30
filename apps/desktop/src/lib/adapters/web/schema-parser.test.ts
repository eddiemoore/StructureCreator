/**
 * Tests for web mode schema parsing.
 */

import { describe, it, expect } from "vitest";
import { parseSchema, exportSchemaXml } from "./schema-parser";

describe("parseSchema", () => {
  describe("basic parsing", () => {
    it("parses a simple folder structure", () => {
      const xml = `
        <folder name="project">
          <file name="README.md" />
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.root.type).toBe("folder");
      expect(tree.root.name).toBe("project");
      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children![0].name).toBe("README.md");
    });

    it("parses nested folder structures", () => {
      const xml = `
        <folder name="project">
          <folder name="src">
            <file name="index.ts" />
          </folder>
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children![0].type).toBe("folder");
      expect(tree.root.children![0].name).toBe("src");
      expect(tree.root.children![0].children).toHaveLength(1);
    });

    it("calculates stats correctly", () => {
      const xml = `
        <folder name="project">
          <folder name="src">
            <file name="a.ts" />
            <file name="b.ts" />
          </folder>
          <file name="README.md" />
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.stats.folders).toBe(2);
      expect(tree.stats.files).toBe(3);
    });
  });

  describe("variable definitions parsing", () => {
    it("parses variable definitions with all attributes", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="CLIENT_NAME"
                      description="The client's company name"
                      placeholder="Enter client name"
                      example="Acme Corp"
                      required="true" />
            <variable name="PROJECT_TYPE"
                      description="Type of project"
                      example="website"
                      pattern="^[a-z-]+$"
                      minLength="3"
                      maxLength="50" />
          </variables>
          <folder name="%CLIENT_NAME%">
            <file name="README.md" />
          </folder>
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toBeDefined();
      expect(tree.variableDefinitions).toHaveLength(2);

      // Check first definition
      const clientDef = tree.variableDefinitions![0];
      expect(clientDef.name).toBe("CLIENT_NAME");
      expect(clientDef.description).toBe("The client's company name");
      expect(clientDef.placeholder).toBe("Enter client name");
      expect(clientDef.example).toBe("Acme Corp");
      expect(clientDef.required).toBe(true);

      // Check second definition
      const projectDef = tree.variableDefinitions![1];
      expect(projectDef.name).toBe("PROJECT_TYPE");
      expect(projectDef.description).toBe("Type of project");
      expect(projectDef.example).toBe("website");
      expect(projectDef.pattern).toBe("^[a-z-]+$");
      expect(projectDef.minLength).toBe(3);
      expect(projectDef.maxLength).toBe(50);
    });

    it("supports kebab-case attribute names", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="TEST_VAR" min-length="5" max-length="100" />
          </variables>
          <file name="test.txt" />
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toHaveLength(1);
      expect(tree.variableDefinitions![0].minLength).toBe(5);
      expect(tree.variableDefinitions![0].maxLength).toBe(100);
    });

    it("handles partial variable definitions", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="SIMPLE_VAR" />
            <variable name="WITH_DESC" description="Just a description" />
          </variables>
          <file name="test.txt" />
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toHaveLength(2);

      expect(tree.variableDefinitions![0].name).toBe("SIMPLE_VAR");
      expect(tree.variableDefinitions![0].description).toBeUndefined();

      expect(tree.variableDefinitions![1].name).toBe("WITH_DESC");
      expect(tree.variableDefinitions![1].description).toBe("Just a description");
    });

    it("skips variables without a name attribute", () => {
      const xml = `
        <structure>
          <variables>
            <variable description="No name" />
            <variable name="VALID_VAR" description="Has name" />
            <variable name="" description="Empty name" />
          </variables>
          <file name="test.txt" />
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toHaveLength(1);
      expect(tree.variableDefinitions![0].name).toBe("VALID_VAR");
    });

    it("returns undefined for schema without variables block", () => {
      const xml = `
        <folder name="project">
          <file name="README.md" />
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toBeUndefined();
    });

    it("returns undefined for empty variables block", () => {
      const xml = `
        <structure>
          <variables />
          <folder name="project" />
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toBeUndefined();
    });

    it("does not include variables block as a child node", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="TEST" />
          </variables>
          <folder name="src" />
          <file name="README.md" />
        </structure>
      `;

      const tree = parseSchema(xml);

      // Root should only have folder and file children, not variables
      expect(tree.root.children).toHaveLength(2);
      expect(tree.root.children![0].name).toBe("src");
      expect(tree.root.children![1].name).toBe("README.md");
    });

    it("parses required as boolean correctly", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="REQ_TRUE" required="true" />
            <variable name="REQ_TRUE_UPPER" required="TRUE" />
            <variable name="REQ_FALSE" required="false" />
            <variable name="REQ_OTHER" required="yes" />
          </variables>
          <file name="test.txt" />
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions![0].required).toBe(true);
      expect(tree.variableDefinitions![1].required).toBe(true);
      expect(tree.variableDefinitions![2].required).toBe(false);
      expect(tree.variableDefinitions![3].required).toBe(false); // "yes" !== "true"
    });

    it("handles invalid minLength/maxLength values", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="BAD_LENGTH" minLength="abc" maxLength="xyz" />
          </variables>
          <file name="test.txt" />
        </structure>
      `;

      const tree = parseSchema(xml);

      // Invalid values are ignored (undefined rather than NaN)
      expect(tree.variableDefinitions![0].minLength).toBeUndefined();
      expect(tree.variableDefinitions![0].maxLength).toBeUndefined();
    });
  });

  describe("hooks parsing", () => {
    it("parses hooks from schema", () => {
      const xml = `
        <folder name="project">
          <hooks>
            <post_create>npm install</post_create>
            <post_create>git init</post_create>
          </hooks>
          <file name="package.json" />
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.hooks).toBeDefined();
      expect(tree.hooks!.post_create).toHaveLength(2);
      expect(tree.hooks!.post_create[0]).toBe("npm install");
      expect(tree.hooks!.post_create[1]).toBe("git init");
    });

    it("does not include hooks as a child node", () => {
      const xml = `
        <folder name="project">
          <hooks>
            <post_create>npm install</post_create>
          </hooks>
          <file name="README.md" />
        </folder>
      `;

      const tree = parseSchema(xml);

      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children![0].name).toBe("README.md");
    });
  });

  describe("combined features", () => {
    it("parses schema with both variables and hooks", () => {
      const xml = `
        <structure>
          <variables>
            <variable name="PROJECT" description="Project name" />
          </variables>
          <hooks>
            <post_create>echo "Done"</post_create>
          </hooks>
          <folder name="%PROJECT%">
            <file name="README.md" />
          </folder>
        </structure>
      `;

      const tree = parseSchema(xml);

      expect(tree.variableDefinitions).toHaveLength(1);
      expect(tree.variableDefinitions![0].name).toBe("PROJECT");

      expect(tree.hooks).toBeDefined();
      expect(tree.hooks!.post_create).toHaveLength(1);

      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children![0].name).toBe("%PROJECT%");
    });
  });
});

describe("exportSchemaXml", () => {
  it("exports a simple schema to XML", () => {
    const tree = parseSchema(`
      <folder name="project">
        <file name="README.md" />
      </folder>
    `);

    const xml = exportSchemaXml(tree);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('name="project"');
    expect(xml).toContain('name="README.md"');
  });

  it("round-trips a schema correctly", () => {
    const originalXml = `
      <folder name="project">
        <folder name="src">
          <file name="index.ts" />
        </folder>
        <file name="README.md" />
      </folder>
    `;

    const tree = parseSchema(originalXml);
    const exportedXml = exportSchemaXml(tree);
    const reimportedTree = parseSchema(exportedXml);

    expect(reimportedTree.root.name).toBe(tree.root.name);
    expect(reimportedTree.stats.folders).toBe(tree.stats.folders);
    expect(reimportedTree.stats.files).toBe(tree.stats.files);
  });
});
