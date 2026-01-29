/**
 * Tests for web mode variable extraction and transforms.
 */

import { describe, it, expect } from "vitest";
import { extractVariablesFromContent } from "./transforms";

describe("extractVariablesFromContent", () => {
  it("extracts uppercase variables from %VAR% patterns", () => {
    const content = `
      <folder name="%PROJECT_NAME%">
        <file name="%AUTHOR%-readme.md" />
        <file name="%VERSION%.txt" />
      </folder>
    `;

    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%AUTHOR%");
    expect(vars).toContain("%VERSION%");
  });

  it("excludes built-in variables", () => {
    const content = "%DATE% %YEAR% %MONTH% %DAY% %PROJECT_NAME% %CUSTOM_VAR%";
    const vars = extractVariablesFromContent(content);

    expect(vars).not.toContain("%DATE%");
    expect(vars).not.toContain("%YEAR%");
    expect(vars).not.toContain("%MONTH%");
    expect(vars).not.toContain("%DAY%");
    expect(vars).not.toContain("%PROJECT_NAME%");
    expect(vars).toContain("%CUSTOM_VAR%");
    expect(vars).toHaveLength(1);
  });

  it("ignores lowercase loop variables from repeat blocks", () => {
    const content = `
      <repeat count="3" var="i">
        <file name="%NAME%_%i%.txt" />
      </repeat>
      <repeat items="foo,bar" var="item">
        <folder name="%item%">
          <file name="%AUTHOR%.md" />
        </folder>
      </repeat>
    `;

    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%NAME%");
    expect(vars).toContain("%AUTHOR%");
    expect(vars).not.toContain("%i%");
    expect(vars).not.toContain("%item%");
    expect(vars).toHaveLength(2);
  });

  it("ignores mixed case variables", () => {
    const content = "%UserName% %userName% %USERNAME%";
    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%USERNAME%");
    expect(vars).not.toContain("%UserName%");
    expect(vars).not.toContain("%userName%");
    expect(vars).toHaveLength(1);
  });

  it("extracts variables from if/else condition attributes", () => {
    const content = `
      <folder name="%PROJECT_NAME%">
        <if var="INCLUDE_TESTS">
          <file name="test.spec.ts" />
        </if>
        <else var="SKIP_TESTS">
          <file name="no-tests.txt" />
        </else>
        <if var="ADD_README">
          <file name="README.md" />
        </if>
      </folder>
    `;

    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%INCLUDE_TESTS%");
    expect(vars).toContain("%SKIP_TESTS%");
    expect(vars).toContain("%ADD_README%");
    expect(vars).not.toContain("%PROJECT_NAME%");
    expect(vars).toHaveLength(3);
  });

  it("ignores lowercase condition variables", () => {
    const content = `<if var="debugMode"><file name="debug.log" /></if>`;
    const vars = extractVariablesFromContent(content);
    expect(vars).toHaveLength(0);
  });

  it("deduplicates variables with transformations", () => {
    const content = `
      <file name="%AUTHOR%.txt" />
      <file name="%AUTHOR:uppercase%.txt" />
      <file name="%AUTHOR:lowercase%.txt" />
    `;

    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%AUTHOR%");
    expect(vars.filter((v) => v === "%AUTHOR%")).toHaveLength(1);
  });

  it("returns empty array for content with no variables", () => {
    const vars = extractVariablesFromContent("no variables here");
    expect(vars).toHaveLength(0);
  });

  it("returns empty array for content with only built-in variables", () => {
    const content = "%DATE% %YEAR% %MONTH% %DAY% %PROJECT_NAME%";
    const vars = extractVariablesFromContent(content);
    expect(vars).toHaveLength(0);
  });

  it("handles single and double quotes in condition attributes", () => {
    const content = `
      <if var="VAR_ONE"><file name="a.txt" /></if>
      <if var='VAR_TWO'><file name="b.txt" /></if>
    `;

    const vars = extractVariablesFromContent(content);

    expect(vars).toContain("%VAR_ONE%");
    expect(vars).toContain("%VAR_TWO%");
    expect(vars).toHaveLength(2);
  });
});
