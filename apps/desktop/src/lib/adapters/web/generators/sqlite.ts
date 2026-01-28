/**
 * SQLite generator for web mode.
 * Creates SQLite databases using sql.js (WASM-based SQLite).
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

// Cached sql.js initialization promise
let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/**
 * CDN URL for sql.js WASM.
 * Using jsDelivr for reliability and caching.
 */
const SQL_JS_CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist";

/**
 * Initialize sql.js by loading from CDN.
 * Caches the initialization promise to avoid multiple loads.
 */
const initSqlJs = async (): Promise<SqlJsStatic> => {
  if (sqlJsPromise) {
    return sqlJsPromise;
  }

  sqlJsPromise = (async () => {
    // Dynamically load sql.js from CDN
    const scriptUrl = `${SQL_JS_CDN}/sql-wasm.js`;

    // Check if already loaded
    if (typeof (window as unknown as { initSqlJs?: unknown }).initSqlJs === "function") {
      return (window as unknown as { initSqlJs: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic> }).initSqlJs({
        locateFile: (file: string) => `${SQL_JS_CDN}/${file}`,
      });
    }

    // Load the script
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load sql.js from CDN"));
      document.head.appendChild(script);
    });

    // Initialize sql.js with WASM location
    const initFn = (window as unknown as { initSqlJs: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic> }).initSqlJs;
    if (typeof initFn !== "function") {
      throw new Error("sql.js failed to initialize");
    }

    return initFn({
      locateFile: (file: string) => `${SQL_JS_CDN}/${file}`,
    });
  })();

  return sqlJsPromise;
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
