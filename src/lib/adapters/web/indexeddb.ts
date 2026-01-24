/**
 * IndexedDB wrapper for web mode storage.
 * Provides template and settings storage similar to SQLite in Tauri.
 *
 * ## Database Migration Strategy
 *
 * IndexedDB uses version numbers to trigger migrations via `onupgradeneeded`.
 * When you need to modify the database schema:
 *
 * 1. Increment `DB_VERSION`
 * 2. Add migration logic in `onupgradeneeded` that checks `event.oldVersion`
 * 3. Migrations run automatically when users open the app with old data
 *
 * Example migration (if adding a new index in version 2):
 * ```
 * if (oldVersion < 2) {
 *   const transaction = (event.target as IDBOpenDBRequest).transaction!;
 *   const store = transaction.objectStore(TEMPLATES_STORE);
 *   store.createIndex("new_field", "new_field", { unique: false });
 * }
 * ```
 *
 * Note: IndexedDB migrations cannot modify existing records automatically.
 * For data migrations, you may need to read and rewrite records after open.
 */

import type { Template, RecentProject } from "../../../types/schema";
import type {
  DatabaseAdapter,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateRecentProjectInput,
} from "../types";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_TEMPLATE, TAG_REGEX } from "../../../constants/tags";

const DB_NAME = "structure-creator";
const DB_VERSION = 2;
const TEMPLATES_STORE = "templates";
const SETTINGS_STORE = "settings";
const RECENT_PROJECTS_STORE = "recent_projects";
const MAX_RECENT_PROJECTS = 20;

/**
 * Validate and sanitize a list of tags.
 * Returns sanitized tags (lowercase, trimmed, deduplicated).
 */
const validateTags = (tags: string[]): string[] => {
  if (tags.length > MAX_TAGS_PER_TEMPLATE) {
    console.warn(`Too many tags (max ${MAX_TAGS_PER_TEMPLATE}), truncating`);
    tags = tags.slice(0, MAX_TAGS_PER_TEMPLATE);
  }

  const seen = new Set<string>();
  const validated: string[] = [];

  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();

    if (normalized.length === 0) {
      continue; // Skip empty tags
    }

    if ([...normalized].length > MAX_TAG_LENGTH) {
      // Use spread to safely handle surrogate pairs in preview
      const preview = [...normalized].slice(0, 20).join("");
      console.warn(`Tag "${preview}..." exceeds max length, skipping`);
      continue;
    }

    if (!TAG_REGEX.test(normalized)) {
      console.warn(`Tag "${normalized}" is invalid, skipping`);
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      validated.push(normalized);
    }
  }

  return validated;
};

/**
 * Open or create the IndexedDB database.
 * Handles schema migrations via `onupgradeneeded`.
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
      const oldVersion = event.oldVersion;

      // Version 0 -> 1: Initial schema creation
      if (oldVersion < 1) {
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
      }

      // Version 1 -> 2: Add recent projects store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(RECENT_PROJECTS_STORE)) {
          const recentStore = db.createObjectStore(RECENT_PROJECTS_STORE, {
            keyPath: "id",
          });
          recentStore.createIndex("createdAt", "createdAt", { unique: false });
        }
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
 * Strip internal fields (like name_lower) from a template record.
 * Returns a clean Template object for external use.
 */
const stripInternalFields = (record: Template & { name_lower?: string }): Template => {
  const { name_lower, ...template } = record;
  return template;
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
        const rawTemplates = request.result as (Template & { name_lower?: string })[];
        // Strip internal fields and sort
        const templates = rawTemplates.map(stripInternalFields);
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
        const result = request.result;
        resolve(result ? stripInternalFields(result) : null);
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
        const result = request.result;
        resolve(result ? stripInternalFields(result) : null);
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
      tags: validateTags(input.tags ?? []),
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
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);

      // Read and write in same transaction to prevent race conditions
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error(`Template with id "${id}" not found`));
          return;
        }

        const updated = {
          ...existing,
          name_lower: (input.name ?? existing.name).toLowerCase(),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.iconColor !== undefined && { icon_color: input.iconColor }),
          updated_at: now(),
        };

        const putRequest = store.put(updated);

        putRequest.onsuccess = () => {
          resolve();
        };

        putRequest.onerror = () => {
          reject(
            new Error(`Failed to update template: ${putRequest.error?.message}`)
          );
        };
      };

      getRequest.onerror = () => {
        reject(
          new Error(`Failed to get template: ${getRequest.error?.message}`)
        );
      };
    });
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);

      // First check if the record exists
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          // Record doesn't exist
          resolve(false);
          return;
        }

        // Record exists, proceed with deletion
        const deleteRequest = store.delete(id);

        deleteRequest.onsuccess = () => {
          resolve(true);
        };

        deleteRequest.onerror = () => {
          reject(
            new Error(`Failed to delete template: ${deleteRequest.error?.message}`)
          );
        };
      };

      getRequest.onerror = () => {
        reject(
          new Error(`Failed to check template existence: ${getRequest.error?.message}`)
        );
      };
    });
  }

  async toggleFavorite(id: string): Promise<void> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);

      // Read and write in same transaction to prevent race conditions
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error(`Template with id "${id}" not found`));
          return;
        }

        const updated = {
          ...existing,
          name_lower: existing.name.toLowerCase(),
          is_favorite: !existing.is_favorite,
          updated_at: now(),
        };

        const putRequest = store.put(updated);

        putRequest.onsuccess = () => {
          resolve();
        };

        putRequest.onerror = () => {
          reject(
            new Error(`Failed to toggle favorite: ${putRequest.error?.message}`)
          );
        };
      };

      getRequest.onerror = () => {
        reject(
          new Error(`Failed to get template: ${getRequest.error?.message}`)
        );
      };
    });
  }

  async incrementUseCount(id: string): Promise<void> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);

      // Read and write in same transaction to prevent race conditions
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error(`Template with id "${id}" not found`));
          return;
        }

        const updated = {
          ...existing,
          name_lower: existing.name.toLowerCase(),
          use_count: existing.use_count + 1,
          updated_at: now(),
        };

        const putRequest = store.put(updated);

        putRequest.onsuccess = () => {
          resolve();
        };

        putRequest.onerror = () => {
          reject(
            new Error(`Failed to increment use count: ${putRequest.error?.message}`)
          );
        };
      };

      getRequest.onerror = () => {
        reject(
          new Error(`Failed to get template: ${getRequest.error?.message}`)
        );
      };
    });
  }

  // ============================================================================
  // Tag Operations
  // ============================================================================

  async getAllTags(): Promise<string[]> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readonly");
      const store = transaction.objectStore(TEMPLATES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const templates = request.result as (Template & { name_lower?: string })[];
        const tagSet = new Set<string>();
        for (const template of templates) {
          for (const tag of template.tags ?? []) {
            tagSet.add(tag);
          }
        }
        const sortedTags = Array.from(tagSet).sort();
        resolve(sortedTags);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get all tags: ${request.error?.message}`));
      };
    });
  }

  async updateTemplateTags(id: string, tags: string[]): Promise<void> {
    const db = this.getDb();
    const validatedTags = validateTags(tags);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATES_STORE, "readwrite");
      const store = transaction.objectStore(TEMPLATES_STORE);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          reject(new Error(`Template with id "${id}" not found`));
          return;
        }

        const updated = {
          ...existing,
          name_lower: existing.name.toLowerCase(),
          tags: validatedTags,
          updated_at: now(),
        };

        const putRequest = store.put(updated);

        putRequest.onsuccess = () => {
          resolve();
        };

        putRequest.onerror = () => {
          reject(
            new Error(`Failed to update template tags: ${putRequest.error?.message}`)
          );
        };
      };

      getRequest.onerror = () => {
        reject(
          new Error(`Failed to get template: ${getRequest.error?.message}`)
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

  // ============================================================================
  // Recent Projects Operations
  // ============================================================================

  async listRecentProjects(): Promise<RecentProject[]> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECENT_PROJECTS_STORE, "readonly");
      const store = transaction.objectStore(RECENT_PROJECTS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const projects = request.result as RecentProject[];
        // Sort by createdAt descending (newest first)
        projects.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        resolve(projects);
      };

      request.onerror = () => {
        reject(new Error(`Failed to list recent projects: ${request.error?.message}`));
      };
    });
  }

  async getRecentProject(id: string): Promise<RecentProject | null> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECENT_PROJECTS_STORE, "readonly");
      const store = transaction.objectStore(RECENT_PROJECTS_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result ?? null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get recent project: ${request.error?.message}`));
      };
    });
  }

  async addRecentProject(input: CreateRecentProjectInput): Promise<RecentProject> {
    const db = this.getDb();
    const timestamp = now();

    const project: RecentProject = {
      id: generateUUID(),
      projectName: input.projectName,
      outputPath: input.outputPath,
      schemaXml: input.schemaXml,
      variables: input.variables,
      variableValidation: input.variableValidation,
      templateId: input.templateId,
      templateName: input.templateName,
      foldersCreated: input.foldersCreated,
      filesCreated: input.filesCreated,
      createdAt: timestamp,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECENT_PROJECTS_STORE, "readwrite");
      const store = transaction.objectStore(RECENT_PROJECTS_STORE);
      const addRequest = store.add(project);

      addRequest.onsuccess = () => {
        // Auto-cleanup: get all and delete oldest if over limit
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
          const all = getAllRequest.result as RecentProject[];
          if (all.length > MAX_RECENT_PROJECTS) {
            // Sort by createdAt ascending to find oldest
            all.sort((a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
            // Delete oldest entries
            const toDelete = all.slice(0, all.length - MAX_RECENT_PROJECTS);
            for (const old of toDelete) {
              store.delete(old.id);
            }
          }
          resolve(project);
        };
        getAllRequest.onerror = () => {
          // Still resolve with the project even if cleanup fails
          resolve(project);
        };
      };

      addRequest.onerror = () => {
        reject(new Error(`Failed to add recent project: ${addRequest.error?.message}`));
      };
    });
  }

  async deleteRecentProject(id: string): Promise<boolean> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECENT_PROJECTS_STORE, "readwrite");
      const store = transaction.objectStore(RECENT_PROJECTS_STORE);

      // First check if record exists
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          resolve(false);
          return;
        }

        const deleteRequest = store.delete(id);
        deleteRequest.onsuccess = () => resolve(true);
        deleteRequest.onerror = () => {
          reject(new Error(`Failed to delete recent project: ${deleteRequest.error?.message}`));
        };
      };

      getRequest.onerror = () => {
        reject(new Error(`Failed to check recent project: ${getRequest.error?.message}`));
      };
    });
  }

  async clearRecentProjects(): Promise<number> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECENT_PROJECTS_STORE, "readwrite");
      const store = transaction.objectStore(RECENT_PROJECTS_STORE);

      // First count existing records
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const count = countRequest.result;

        const clearRequest = store.clear();
        clearRequest.onsuccess = () => resolve(count);
        clearRequest.onerror = () => {
          reject(new Error(`Failed to clear recent projects: ${clearRequest.error?.message}`));
        };
      };

      countRequest.onerror = () => {
        reject(new Error(`Failed to count recent projects: ${countRequest.error?.message}`));
      };
    });
  }
}
