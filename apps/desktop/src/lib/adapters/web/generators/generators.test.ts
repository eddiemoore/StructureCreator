/**
 * Tests for web mode binary file generators.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseHexColor, parseImageConfig, generateImage } from "./image";
import { generateSqlite, _resetSqlJsCache } from "./sqlite";
import type { SchemaNode } from "../../../../types/schema";

describe("parseHexColor", () => {
  it("parses full hex colors", () => {
    expect(parseHexColor("#FF0000")).toEqual([255, 0, 0]);
    expect(parseHexColor("#00FF00")).toEqual([0, 255, 0]);
    expect(parseHexColor("#0000FF")).toEqual([0, 0, 255]);
    expect(parseHexColor("#3B82F6")).toEqual([59, 130, 246]);
    expect(parseHexColor("CCCCCC")).toEqual([204, 204, 204]); // Without #
  });

  it("parses short hex colors", () => {
    expect(parseHexColor("#F00")).toEqual([255, 0, 0]);
    expect(parseHexColor("#0F0")).toEqual([0, 255, 0]);
    expect(parseHexColor("#00F")).toEqual([0, 0, 255]);
    expect(parseHexColor("CCC")).toEqual([204, 204, 204]); // Without #
  });

  it("returns null for invalid colors", () => {
    expect(parseHexColor("#GGG")).toBeNull();
    expect(parseHexColor("#12")).toBeNull();
    expect(parseHexColor("#1234567")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});

describe("parseImageConfig", () => {
  const emptyVars: Record<string, string> = {};

  it("uses default values when no config provided", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
    };

    const config = parseImageConfig(node, emptyVars);
    expect(config.width).toBe(100);
    expect(config.height).toBe(100);
    expect(config.background).toBe("#CCCCCC");
    expect(config.format).toBe("png");
  });

  it("determines format from file extension", () => {
    const pngNode: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
    };
    expect(parseImageConfig(pngNode, emptyVars).format).toBe("png");

    const jpgNode: SchemaNode = {
      type: "file",
      name: "test.jpg",
      generate: "image",
    };
    expect(parseImageConfig(jpgNode, emptyVars).format).toBe("jpeg");

    const jpegNode: SchemaNode = {
      type: "file",
      name: "test.jpeg",
      generate: "image",
    };
    expect(parseImageConfig(jpegNode, emptyVars).format).toBe("jpeg");
  });

  it("parses config from generateConfig attribute", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="800" height="600" background="#FF0000"',
    };

    const config = parseImageConfig(node, emptyVars);
    expect(config.width).toBe(800);
    expect(config.height).toBe(600);
    expect(config.background).toBe("#FF0000");
  });

  it("parses config with variable substitution", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="%SIZE%" height="%SIZE%" background="%COLOR%"',
    };

    const vars = {
      "%SIZE%": "256",
      "%COLOR%": "#00FF00",
    };

    const config = parseImageConfig(node, vars);
    expect(config.width).toBe(256);
    expect(config.height).toBe(256);
    expect(config.background).toBe("#00FF00");
  });

  it("clamps dimensions to max value", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="99999" height="99999"',
    };

    const config = parseImageConfig(node, emptyVars);
    expect(config.width).toBe(10000);
    expect(config.height).toBe(10000);
  });

  it("ensures minimum dimension of 1", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="0" height="-5"',
    };

    const config = parseImageConfig(node, emptyVars);
    expect(config.width).toBe(1);
    expect(config.height).toBe(1);
  });

  it("parses config from content field as fallback", () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      content: 'width="200" height="150"',
    };

    const config = parseImageConfig(node, emptyVars);
    expect(config.width).toBe(200);
    expect(config.height).toBe(150);
  });
});

describe("generateImage", () => {
  // Mock canvas API
  let mockCanvas: {
    width: number;
    height: number;
    getContext: ReturnType<typeof vi.fn>;
    toBlob: ReturnType<typeof vi.fn>;
  };
  let mockContext: {
    fillStyle: string;
    fillRect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockContext = {
      fillStyle: "",
      fillRect: vi.fn(),
    };

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext),
      toBlob: vi.fn((callback, mimeType) => {
        // Create a mock blob with arrayBuffer method
        const mockData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
        const mockBlob = {
          type: mimeType,
          size: mockData.length,
          arrayBuffer: () => Promise.resolve(mockData.buffer),
        };
        setTimeout(() => callback(mockBlob), 0);
      }),
    };

    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return mockCanvas as unknown as HTMLCanvasElement;
      }
      return document.createElement(tagName);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for dry run", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
    };

    const result = await generateImage(node, {
      variables: {},
      dryRun: true,
    });

    expect(result).toBeNull();
  });

  it("creates canvas with correct dimensions", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="200" height="150"',
    };

    await generateImage(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockCanvas.width).toBe(200);
    expect(mockCanvas.height).toBe(150);
  });

  it("fills canvas with background color", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
      generateConfig: 'width="100" height="100" background="#FF0000"',
    };

    await generateImage(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockContext.fillStyle).toBe("rgb(255, 0, 0)");
    expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
  });

  it("uses correct MIME type for JPEG", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.jpg",
      generate: "image",
    };

    await generateImage(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.9
    );
  });

  it("uses correct MIME type for PNG", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
    };

    await generateImage(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
      undefined
    );
  });

  it("returns Uint8Array on success", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.png",
      generate: "image",
    };

    const result = await generateImage(node, {
      variables: {},
      dryRun: false,
    });

    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe("generateSqlite", () => {
  // Mock sql.js
  let mockDatabase: {
    run: ReturnType<typeof vi.fn>;
    export: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset the cached sql.js promise before each test
    _resetSqlJsCache();

    mockDatabase = {
      run: vi.fn(),
      export: vi.fn(() => new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65])), // "SQLite" bytes
      close: vi.fn(),
    };

    // Create a mock Database class
    const MockDatabase = function() {
      return mockDatabase;
    } as unknown as new () => typeof mockDatabase;

    // Mock window.initSqlJs
    const mockInitSqlJs = vi.fn().mockResolvedValue({
      Database: MockDatabase,
    });

    (window as unknown as { initSqlJs: typeof mockInitSqlJs }).initSqlJs = mockInitSqlJs;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { initSqlJs?: unknown }).initSqlJs;
    // Reset the cache after each test as well
    _resetSqlJsCache();
  });

  it("returns null for dry run", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "CREATE TABLE test (id INTEGER);",
    };

    const result = await generateSqlite(node, {
      variables: {},
      dryRun: true,
    });

    expect(result).toBeNull();
    // Database should not be created in dry run
    expect(mockDatabase.run).not.toHaveBeenCalled();
  });

  it("executes SQL from content field", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
    };

    await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockDatabase.run).toHaveBeenCalledWith(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"
    );
    expect(mockDatabase.close).toHaveBeenCalled();
  });

  it("executes SQL from generateConfig with <sql> element", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      generateConfig: "<sql>CREATE TABLE config (key TEXT, value TEXT);</sql>",
    };

    await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockDatabase.run).toHaveBeenCalledWith(
      "CREATE TABLE config (key TEXT, value TEXT)"
    );
  });

  it("substitutes variables in SQL", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "INSERT INTO config VALUES ('%KEY%', '%VALUE%');",
    };

    await generateSqlite(node, {
      variables: {
        "%KEY%": "version",
        "%VALUE%": "1.0.0",
      },
      dryRun: false,
    });

    expect(mockDatabase.run).toHaveBeenCalledWith(
      "INSERT INTO config VALUES ('version', '1.0.0')"
    );
  });

  it("splits multiple SQL statements", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER);",
    };

    await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    expect(mockDatabase.run).toHaveBeenCalledTimes(2);
    expect(mockDatabase.run).toHaveBeenNthCalledWith(1, "CREATE TABLE a (id INTEGER)");
    expect(mockDatabase.run).toHaveBeenNthCalledWith(2, "CREATE TABLE b (id INTEGER)");
  });

  it("handles semicolons within quoted strings", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "INSERT INTO test VALUES ('hello; world');",
    };

    await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    // Should be a single statement, not split
    expect(mockDatabase.run).toHaveBeenCalledTimes(1);
    expect(mockDatabase.run).toHaveBeenCalledWith(
      "INSERT INTO test VALUES ('hello; world')"
    );
  });

  it("returns Uint8Array on success", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "CREATE TABLE test (id INTEGER);",
    };

    const result = await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("closes database even on error", async () => {
    // Reset cache to use the new error mock
    _resetSqlJsCache();

    // Create a fresh mock that throws
    const errorDatabase = {
      run: vi.fn(() => {
        throw new Error("SQL error");
      }),
      export: vi.fn(),
      close: vi.fn(),
    };

    const ErrorDatabase = function() {
      return errorDatabase;
    } as unknown as new () => typeof errorDatabase;

    const errorInitSqlJs = vi.fn().mockResolvedValue({
      Database: ErrorDatabase,
    });

    (window as unknown as { initSqlJs: typeof errorInitSqlJs }).initSqlJs = errorInitSqlJs;

    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      content: "INVALID SQL;",
    };

    await expect(
      generateSqlite(node, {
        variables: {},
        dryRun: false,
      })
    ).rejects.toThrow("SQL error");

    // Database should still be closed
    expect(errorDatabase.close).toHaveBeenCalled();
  });

  it("executes generateConfig before content", async () => {
    const node: SchemaNode = {
      type: "file",
      name: "test.db",
      generate: "sqlite",
      generateConfig: "<sql>CREATE TABLE test (id INTEGER);</sql>",
      content: "INSERT INTO test VALUES (1);",
    };

    const callOrder: string[] = [];
    mockDatabase.run.mockImplementation((sql: string) => {
      callOrder.push(sql);
    });

    await generateSqlite(node, {
      variables: {},
      dryRun: false,
    });

    expect(callOrder).toEqual([
      "CREATE TABLE test (id INTEGER)",
      "INSERT INTO test VALUES (1)",
    ]);
  });
});
