/**
 * IndexedDB wrapper for web mode storage.
 * Provides template and settings storage similar to SQLite in Tauri.
 */

import type { Template } from "../../../types/schema";
import type {
  DatabaseAdapter,
  CreateTemplateInput,
  UpdateTemplateInput,
} from "../types";

const DB_NAME = "structure-creator";
const DB_VERSION = 1;
const TEMPLATES_STORE = "templates";
const SETTINGS_STORE = "settings";

/**
 * Open or create the IndexedDB database.
 */
const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open database: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create templates store
      if (!db.objectStoreNames.contains(TEMPLATES_STORE)) {
        const templatesStore = db.createObjectStore(TEMPLATES_STORE, {
          keyPath: "id",
        });
        templatesStore.createIndex("name", "name", { unique: false });
        templatesStore.createIndex("name_lower", "name_lower", { unique: true });
        templatesStore.createIndex("is_favorite", "is_favorite", {
          unique: false,
        });
        templatesStore.createIndex("use_count", "use_count", { unique: false });
        templatesStore.createIndex("updated_at", "updated_at", {
          unique: false,
        });
      }

      // Create settings store
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
  });
};

/**
 * Generate a UUID v4.
 */
const generateUUID = (): string => {
  return crypto.randomUUID();
};

/**
 * Get current timestamp in RFC3339 format.
 */
const now = (): string => {
  return new Date().toISOString();
};

/**
 * IndexedDB-based database adapter for web mode.
 */
export class IndexedDBAdapter implements DatabaseAdapter {
  private db: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    this.db = await openDatabase();
  }

  private getDb(): IDBDatabase {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  // ============================================================================
  // Template Operations
  // ============================================================================

  async listTemplates(): Promise<Template[]> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readonly");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const templates = request.result as Template[];
        // Sort: favorites first, then by use_count desc, then by updated_at desc
        templates.sort((a, b) => {
          if (a.is_favorite !== b.is_favorite) {
            return a.is_favorite ? -1 : 1;
          }
          if (a.use_count !== b.use_count) {
            return b.use_count - a.use_count;
          }
          return (
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });
        resolve(templates);
      };

      request.onerror = () => {
        reject(new Error(`Failed to list templates: ${request.error?.message}`));
      };
    });
  }

  async getTemplate(id: string): Promise<Template | null> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readonly");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result ?? null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get template: ${request.error?.message}`));
      };
    });
  }

  async getTemplateByName(name: string): Promise<Template | null> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readonly");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const index = store.index("name_lower");
      const request = index.get(name.toLowerCase());

      request.onsuccess = () => {
        resolve(request.result ?? null);
      };

      request.onerror = () => {
        reject(
          new Error(`Failed to get template by name: ${request.error?.message}`)
        );
      };
    });
  }

  async createTemplate(input: CreateTemplateInput): Promise<Template> {
    const db = this.getDb();
    const timestamp = now();

    const template: Template & { name_lower: string } = {
      id: generateUUID(),
      name: input.name,
      name_lower: input.name.toLowerCase(),
      description: input.description,
      schema_xml: input.schemaXml,
      variables: input.variables,
      variable_validation: input.variableValidation,
      icon_color: input.iconColor,
      is_favorite: false,
      use_count: 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.add(template);

      request.onsuccess = () => {
        // Return without the internal name_lower field
        const { name_lower, ...result } = template;
        resolve(result);
      };

      request.onerror = () => {
        if (request.error?.name === "ConstraintError") {
          reject(new Error(`Template with name "${input.name}" already exists`));
        } else {
          reject(
            new Error(`Failed to create template: ${request.error?.message}`)
          );
        }
      };
    });
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<void> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error(`Template with id "${id}" not found`);
    }

    const db = this.getDb();

    const updated = {
      ...existing,
      name_lower: (input.name ?? existing.name).toLowerCase(),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.iconColor !== undefined && { icon_color: input.iconColor }),
      updated_at: now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.put(updated);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(
          new Error(`Failed to update template: ${request.error?.message}`)
        );
      };
    });
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(
          new Error(`Failed to delete template: ${request.error?.message}`)
        );
      };
    });
  }

  async toggleFavorite(id: string): Promise<void> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error(`Template with id "${id}" not found`);
    }

    const db = this.getDb();

    const updated = {
      ...existing,
      name_lower: existing.name.toLowerCase(),
      is_favorite: !existing.is_favorite,
      updated_at: now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.put(updated);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(
          new Error(`Failed to toggle favorite: ${request.error?.message}`)
        );
      };
    });
  }

  async incrementUseCount(id: string): Promise<void> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error(`Template with id "${id}" not found`);
    }

    const db = this.getDb();

    const updated = {
      ...existing,
      name_lower: existing.name.toLowerCase(),
      use_count: existing.use_count + 1,
      updated_at: now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.put(updated);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(
          new Error(`Failed to increment use count: ${request.error?.message}`)
        );
      };
    });
  }

  // ============================================================================
  // Settings Operations
  // ============================================================================

  async getAllSettings(): Promise<Record<string, string>> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readonly");
      const store = transaction.objectStore(SETTINGS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const settings: Record<string, string> = {};
        for (const item of request.result) {
          settings[item.key] = item.value;
        }
        resolve(settings);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get settings: ${request.error?.message}`));
      };
    });
  }

  async getSetting(key: string): Promise<string | null> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readonly");
      const store = transaction.objectStore(SETTINGS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result?.value ?? null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get setting: ${request.error?.message}`));
      };
    });
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readwrite");
      const store = transaction.objectStore(SETTINGS_STORE);
      const request = store.put({ key, value });

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to set setting: ${request.error?.message}`));
      };
    });
  }
}
