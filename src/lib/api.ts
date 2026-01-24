/**
 * Unified API Layer
 *
 * This module provides a single interface for all platform operations.
 * It automatically selects the appropriate adapter (Tauri or Web) based on
 * the runtime environment.
 *
 * Usage:
 *   import { api } from '../lib/api';
 *
 *   // Initialize once at app start
 *   await api.initialize();
 *
 *   // Use the API
 *   const templates = await api.database.listTemplates();
 */

import { isTauri, getCapabilities, type PlatformCapabilities } from "./platform";
import type { PlatformAdapter } from "./adapters/types";

// Re-export types for convenience
export type {
  FileFilter,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateStructureOptions,
  PlatformAdapter,
  FileSystemAdapter,
  DatabaseAdapter,
  SchemaAdapter,
  StructureCreatorAdapter,
  ValidationAdapter,
  TemplateImportExportAdapter,
} from "./adapters/types";

// Global adapter instance
let adapter: PlatformAdapter | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Get the platform capabilities.
 */
export const capabilities = (): PlatformCapabilities => {
  return getCapabilities();
};

/**
 * Check if the API has been initialized.
 */
export const isInitialized = (): boolean => {
  return adapter !== null;
};

/**
 * Initialize the API with the appropriate adapter.
 * This should be called once at app start.
 */
export const initialize = async (): Promise<void> => {
  // Prevent double initialization
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (adapter) {
      return;
    }

    if (isTauri()) {
      // Dynamically import Tauri adapter to avoid loading Tauri APIs in web mode
      const { createTauriAdapter } = await import("./adapters/tauri");
      adapter = createTauriAdapter();
    } else {
      // Dynamically import Web adapter
      const { createWebAdapter } = await import("./adapters/web");
      adapter = createWebAdapter();
    }

    await adapter.initialize();
  })();

  return initPromise;
};

/**
 * Get the current adapter.
 * Throws if not initialized.
 */
const getAdapter = (): PlatformAdapter => {
  if (!adapter) {
    throw new Error(
      "API not initialized. Call api.initialize() before using the API."
    );
  }
  return adapter;
};

/**
 * The main API object.
 * Provides access to all platform adapters.
 */
export const api = {
  /**
   * Initialize the API.
   */
  initialize,

  /**
   * Check if initialized.
   */
  isInitialized,

  /**
   * Get platform capabilities.
   */
  capabilities,

  /**
   * Check if running in Tauri.
   */
  isTauri,

  /**
   * File system operations.
   */
  get fileSystem() {
    return getAdapter().fileSystem;
  },

  /**
   * Database operations (templates, settings).
   */
  get database() {
    return getAdapter().database;
  },

  /**
   * Schema parsing and manipulation.
   */
  get schema() {
    return getAdapter().schema;
  },

  /**
   * Structure creation operations.
   */
  get structureCreator() {
    return getAdapter().structureCreator;
  },

  /**
   * Variable validation.
   */
  get validation() {
    return getAdapter().validation;
  },

  /**
   * Template import/export.
   */
  get templateImportExport() {
    return getAdapter().templateImportExport;
  },
};

export default api;
