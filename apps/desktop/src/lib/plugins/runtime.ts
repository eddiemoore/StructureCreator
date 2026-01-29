/**
 * Plugin Runtime
 *
 * Loads and executes file processor plugins in the frontend.
 * Plugins are JavaScript modules that export a default object with a process function.
 *
 * Example plugin:
 * ```javascript
 * export default {
 *   name: 'license-header',
 *   fileTypes: ['.ts', '.js'],
 *   process(content, context) {
 *     const header = `// Copyright ${context.variables.YEAR} ${context.variables.AUTHOR}\n`;
 *     return header + content;
 *   }
 * };
 * ```
 */

import type { Plugin, SchemaTree, SchemaNode } from "../../types/schema";

/**
 * Context passed to plugin processors.
 */
export interface ProcessorContext {
  /** Current file path (relative) */
  filePath: string;
  /** File extension (e.g., ".ts") */
  extension: string;
  /** Variable values */
  variables: Record<string, string>;
  /** Project name */
  projectName?: string;
}

/**
 * A loaded plugin module.
 */
interface LoadedPlugin {
  plugin: Plugin;
  module: PluginModule;
}

/**
 * Plugin module interface - what a plugin.js exports.
 */
interface PluginModule {
  name: string;
  fileTypes?: string[];
  process: (content: string, context: ProcessorContext) => string | Promise<string>;
}

/**
 * Plugin runtime manages loading and executing plugins.
 */
export class PluginRuntime {
  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private loadErrors: Map<string, string> = new Map();

  /**
   * Load a plugin from the filesystem.
   * In Tauri, we use dynamic import with file:// URLs.
   */
  async loadPlugin(plugin: Plugin): Promise<void> {
    if (this.loadedPlugins.has(plugin.id)) {
      return; // Already loaded
    }

    try {
      // Construct the path to the main file
      const mainPath = `${plugin.path}/index.js`;

      // Use dynamic import with file:// URL
      // Note: This requires appropriate CSP settings in Tauri
      const fileUrl = `file://${mainPath}`;

      // Dynamic import of ES module
      const module = await import(/* @vite-ignore */ fileUrl);
      const pluginModule = module.default as PluginModule;

      // Validate the module has required exports
      if (!pluginModule || typeof pluginModule.process !== "function") {
        throw new Error("Plugin must export default object with process function");
      }

      this.loadedPlugins.set(plugin.id, {
        plugin,
        module: pluginModule,
      });

      // Clear any previous error
      this.loadErrors.delete(plugin.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load plugin ${plugin.name}:`, message);
      this.loadErrors.set(plugin.id, message);
    }
  }

  /**
   * Load multiple plugins.
   */
  async loadPlugins(plugins: Plugin[]): Promise<void> {
    // Only load enabled file-processor plugins
    const fileProcessors = plugins.filter(
      (p) => p.isEnabled && p.capabilities.includes("file-processor")
    );

    await Promise.all(fileProcessors.map((p) => this.loadPlugin(p)));
  }

  /**
   * Unload a plugin.
   */
  unloadPlugin(pluginId: string): void {
    this.loadedPlugins.delete(pluginId);
    this.loadErrors.delete(pluginId);
  }

  /**
   * Unload all plugins.
   */
  unloadAll(): void {
    this.loadedPlugins.clear();
    this.loadErrors.clear();
  }

  /**
   * Get plugins that can process a given file extension.
   */
  getProcessorsForExtension(extension: string): LoadedPlugin[] {
    const processors: LoadedPlugin[] = [];

    for (const loaded of this.loadedPlugins.values()) {
      // Check if plugin handles this extension
      const fileTypes = loaded.module.fileTypes || loaded.plugin.fileTypes;
      if (fileTypes.some((ft) => ft === extension || ft === `*`)) {
        processors.push(loaded);
      }
    }

    // Sort by load order
    processors.sort((a, b) => a.plugin.loadOrder - b.plugin.loadOrder);

    return processors;
  }

  /**
   * Process file content through matching plugins.
   */
  async processFile(
    content: string,
    context: ProcessorContext
  ): Promise<string> {
    const processors = this.getProcessorsForExtension(context.extension);

    if (processors.length === 0) {
      return content; // No processors for this file type
    }

    let result = content;

    for (const { plugin, module } of processors) {
      try {
        const processed = await module.process(result, context);
        if (typeof processed === "string") {
          result = processed;
        } else {
          console.warn(`Plugin ${plugin.name} returned non-string, skipping`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Plugin ${plugin.name} error processing ${context.filePath}:`, message);
        // Continue with other plugins, don't fail the whole file
      }
    }

    return result;
  }

  /**
   * Check if any processors are loaded.
   */
  hasProcessors(): boolean {
    return this.loadedPlugins.size > 0;
  }

  /**
   * Get load errors for display.
   */
  getLoadErrors(): Map<string, string> {
    return new Map(this.loadErrors);
  }
}

/**
 * Get file extension from a path.
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filePath.length - 1) {
    return "";
  }
  return filePath.substring(lastDot).toLowerCase();
}

/**
 * Process a schema tree's file contents through plugins.
 * This modifies file content in-place before structure creation.
 *
 * @param tree - The schema tree to process
 * @param runtime - The plugin runtime with loaded plugins
 * @param variables - Variable values for substitution
 * @param projectName - Project name for context
 * @returns The processed tree (same reference, modified in place)
 */
export async function processTreeContent(
  tree: SchemaTree,
  runtime: PluginRuntime,
  variables: Record<string, string>,
  projectName?: string
): Promise<SchemaTree> {
  if (!runtime.hasProcessors()) {
    return tree; // No processors loaded, return as-is
  }

  // Deep clone the tree to avoid mutating the original
  const processedTree: SchemaTree = JSON.parse(JSON.stringify(tree));

  // Process all file nodes recursively
  await processNode(processedTree.root, "", runtime, variables, projectName);

  return processedTree;
}

/**
 * Recursively process a node and its children.
 */
async function processNode(
  node: SchemaNode,
  parentPath: string,
  runtime: PluginRuntime,
  variables: Record<string, string>,
  projectName?: string
): Promise<void> {
  const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;

  // If this is a file with inline content, process it
  if (node.type === "file" && node.content && !node.url && !node.generate) {
    const extension = getExtension(node.name);

    if (extension) {
      const context: ProcessorContext = {
        filePath: currentPath,
        extension,
        variables,
        projectName,
      };

      node.content = await runtime.processFile(node.content, context);
    }
  }

  // Process children recursively
  if (node.children) {
    await Promise.all(
      node.children.map((child) =>
        processNode(child, currentPath, runtime, variables, projectName)
      )
    );
  }
}

// Singleton runtime instance
let runtimeInstance: PluginRuntime | null = null;

/**
 * Get or create the plugin runtime instance.
 */
export function getPluginRuntime(): PluginRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new PluginRuntime();
  }
  return runtimeInstance;
}

/**
 * Reset the runtime (for testing or cleanup).
 */
export function resetPluginRuntime(): void {
  if (runtimeInstance) {
    runtimeInstance.unloadAll();
  }
  runtimeInstance = null;
}
