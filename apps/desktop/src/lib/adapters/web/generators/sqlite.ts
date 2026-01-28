/**
 * SQLite generator for web mode.
 * Creates SQLite databases using sql.js (WASM-based SQLite).
 *
 * SECURITY NOTE: SQL statements from the schema are executed directly.
 * Variable substitution occurs before execution, so ensure variable values
 * come from trusted sources. Do not use untrusted user input as variable
 * values when generating databases, as this could lead to SQL injection.
 *
 * DEPENDENCY NOTE: This module loads sql.js from jsDelivr CDN on first use.
 * An internet connection is required for the initial load. The WASM module
 * is cached by the browser after first load.
 */

import type { SchemaNode } from "../../../../types/schema";
import { substituteVariables } from "../transforms";
import type { GeneratorContext } from "./types";

// sql.js types
interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}

interface SqlJsDatabase {
  run(sql: string): void;
  export(): Uint8Array;
  close(): void;
}

// Type for window with initSqlJs
interface WindowWithSqlJs {
  initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;
}

// Cached sql.js initialization promise
let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/**
 * Reset the cached sql.js initialization promise.
 * Used for testing to allow re-initialization with mocks.
 * @internal
 */
export const _resetSqlJsCache = (): void => {
  sqlJsPromise = null;
};

/**
 * CDN URL for sql.js WASM.
 * Using jsDelivr for reliability and caching.
 * Pinned to specific version for supply chain security.
 * Note: Keep this in sync with the sql.js version in package.json.
 */
const SQL_JS_CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist";

/**
 * Initialize sql.js by loading from CDN.
 * Caches the initialization promise to avoid multiple loads.
 * On failure, clears the cache to allow retries.
 */
const initSqlJs = async (): Promise<SqlJsStatic> => {
  if (sqlJsPromise) {
    return sqlJsPromise;
  }

  const promise = (async () => {
    const windowWithSql = window as unknown as WindowWithSqlJs;

    // Check if already loaded
    if (typeof windowWithSql.initSqlJs === "function") {
      return windowWithSql.initSqlJs({
        locateFile: (file: string) => `${SQL_JS_CDN}/${file}`,
      });
    }

    // Dynamically load sql.js from CDN
    const scriptUrl = `${SQL_JS_CDN}/sql-wasm.js`;

    // Load the script
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        reject(new Error(
          "Failed to load SQLite library from CDN. " +
          "Please check your internet connection and try again."
        ));
      };
      document.head.appendChild(script);
    });

    // Re-access window to get the newly loaded initSqlJs function
    // (TypeScript's control flow analysis doesn't know the script added it)
    const loadedWindow = window as unknown as WindowWithSqlJs;
    const initFn = loadedWindow.initSqlJs;
    if (!initFn) {
      throw new Error(
        "SQLite library failed to initialize. " +
        "The script loaded but initSqlJs is not available."
      );
    }

    // Initialize sql.js with WASM location
    try {
      return await initFn({
        locateFile: (file: string) => `${SQL_JS_CDN}/${file}`,
      });
    } catch (e) {
      throw new Error(
        `Failed to initialize SQLite WASM module: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  })();

  // Cache the promise
  sqlJsPromise = promise;

  // On failure, clear the cached promise to allow retries
  promise.catch(() => {
    sqlJsPromise = null;
  });

  return promise;
};

/**
 * Extract SQL statements from node content.
 * Handles both raw SQL and <sql> element wrappers.
 */
const extractSql = (
  node: SchemaNode,
  variables: Record<string, string>
): string[] => {
  const statements: string[] = [];

  // Extract SQL from generateConfig (schema definitions)
  if (node.generateConfig) {
    // Check for <sql> elements
    const sqlMatches = node.generateConfig.matchAll(/<sql[^>]*>([\s\S]*?)<\/sql>/gi);
    for (const match of sqlMatches) {
      const sql = substituteVariables(match[1].trim(), variables);
      if (sql) {
        statements.push(sql);
      }
    }

    // If no <sql> elements found, treat the whole content as SQL
    if (statements.length === 0) {
      const sql = substituteVariables(node.generateConfig.trim(), variables);
      if (sql && !sql.startsWith("<")) {
        statements.push(sql);
      }
    }
  }

  // Extract SQL from content field (additional SQL, inserts, etc.)
  if (node.content) {
    // Check for <sql> elements
    const sqlMatches = node.content.matchAll(/<sql[^>]*>([\s\S]*?)<\/sql>/gi);
    for (const match of sqlMatches) {
      const sql = substituteVariables(match[1].trim(), variables);
      if (sql) {
        statements.push(sql);
      }
    }

    // If no <sql> elements and content doesn't look like XML, treat as raw SQL
    if (statements.length === 0 || !node.content.includes("<sql")) {
      const content = node.content.trim();
      if (content && !content.startsWith("<")) {
        const sql = substituteVariables(content, variables);
        if (sql) {
          statements.push(sql);
        }
      }
    }
  }

  return statements;
};

/**
 * Generate a SQLite database as a Uint8Array.
 * Returns null for dry run mode.
 */
export const generateSqlite = async (
  node: SchemaNode,
  context: GeneratorContext
): Promise<Uint8Array | null> => {
  if (context.dryRun) {
    return null;
  }

  // Initialize sql.js
  const SQL = await initSqlJs();

  // Create a new database
  const db = new SQL.Database();

  try {
    // Extract and execute SQL statements
    const statements = extractSql(node, context.variables);

    for (const sql of statements) {
      // Split by semicolons but preserve them within quotes
      const parts = splitSqlStatements(sql);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
          db.run(trimmed);
        }
      }
    }

    // Export the database as Uint8Array
    return db.export();
  } finally {
    db.close();
  }
};

/**
 * Split SQL into individual statements.
 * Handles semicolons within quoted strings.
 */
const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const prev = i > 0 ? sql[i - 1] : "";

    // Handle escape sequences
    if (prev === "\\") {
      current += char;
      i++;
      continue;
    }

    // Track quote state
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }

    // Split on semicolon only when not in quotes
    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
    } else {
      current += char;
    }

    i++;
  }

  // Add final statement if any
  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
};
