/**
 * File System Access API wrapper for web mode.
 * Provides file operations using the browser's File System Access API.
 *
 * Note: The web File System Access API works with handles, not paths.
 * This adapter maintains a handle registry to map "virtual paths" to handles.
 */

/// <reference path="./file-system-api.d.ts" />

import type { FileSystemAdapter, FileFilter } from "../types";

/**
 * Maximum number of handles to keep in each registry map.
 * Prevents unbounded memory growth during long sessions.
 */
const MAX_HANDLES_PER_TYPE = 1000;

/**
 * Registry to map virtual paths to File System handles.
 * This allows us to maintain a path-like interface while using handles internally.
 * Implements LRU-style eviction to prevent memory bloat during long sessions.
 */
class HandleRegistry {
  private fileHandles: Map<string, FileSystemFileHandle> = new Map();
  private directoryHandles: Map<string, FileSystemDirectoryHandle> = new Map();
  private rootHandle: FileSystemDirectoryHandle | null = null;

  /**
   * Evict oldest entries if a map exceeds the maximum size.
   * Map iteration order is insertion order, so we delete from the beginning.
   */
  private evictIfNeeded<T>(map: Map<string, T>, maxSize: number): void {
    if (map.size >= maxSize) {
      // Delete oldest 10% of entries to avoid frequent evictions
      const deleteCount = Math.max(1, Math.floor(maxSize * 0.1));
      const iterator = map.keys();
      for (let i = 0; i < deleteCount; i++) {
        const key = iterator.next().value;
        if (key !== undefined) {
          map.delete(key);
        }
      }
    }
  }

  /**
   * Register a file handle and return a virtual path.
   */
  registerFileHandle(handle: FileSystemFileHandle, basePath?: string): string {
    const path = basePath ? `${basePath}/${handle.name}` : handle.name;
    this.evictIfNeeded(this.fileHandles, MAX_HANDLES_PER_TYPE);
    this.fileHandles.set(path, handle);
    return path;
  }

  /**
   * Register a directory handle and return a virtual path.
   */
  registerDirectoryHandle(
    handle: FileSystemDirectoryHandle,
    basePath?: string
  ): string {
    const path = basePath ? `${basePath}/${handle.name}` : handle.name;
    this.evictIfNeeded(this.directoryHandles, MAX_HANDLES_PER_TYPE);
    this.directoryHandles.set(path, handle);
    return path;
  }

  /**
   * Set the root directory handle (for output operations).
   */
  setRootHandle(handle: FileSystemDirectoryHandle, path: string): void {
    this.rootHandle = handle;
    this.evictIfNeeded(this.directoryHandles, MAX_HANDLES_PER_TYPE);
    this.directoryHandles.set(path, handle);
  }

  /**
   * Get a file handle by path.
   */
  getFileHandle(path: string): FileSystemFileHandle | undefined {
    return this.fileHandles.get(path);
  }

  /**
   * Get a directory handle by path.
   */
  getDirectoryHandle(path: string): FileSystemDirectoryHandle | undefined {
    return this.directoryHandles.get(path);
  }

  /**
   * Get the root directory handle.
   */
  getRootHandle(): FileSystemDirectoryHandle | null {
    return this.rootHandle;
  }

  /**
   * Clear all registered handles.
   */
  clear(): void {
    this.fileHandles.clear();
    this.directoryHandles.clear();
    this.rootHandle = null;
  }
}

// Global handle registry instance
const handleRegistry = new HandleRegistry();

/**
 * Get the handle registry for external access.
 */
export const getHandleRegistry = (): HandleRegistry => handleRegistry;

/**
 * Convert FileFilter to File System Access API accept types.
 */
const filtersToAcceptTypes = (filters?: FileFilter[]): FilePickerAcceptType[] => {
  if (!filters || filters.length === 0) return [];

  return filters.map((filter) => ({
    description: filter.name,
    accept: {
      "*/*": filter.extensions.map((ext) => `.${ext}`),
    },
  }));
};

/**
 * Web File System Access API adapter.
 */
export class WebFileSystemAdapter implements FileSystemAdapter {
  /**
   * Check if File System Access API is available.
   */
  private checkSupport(): void {
    if (
      !window.showOpenFilePicker ||
      !window.showDirectoryPicker ||
      !window.showSaveFilePicker
    ) {
      throw new Error(
        "File System Access API is not supported in this browser. " +
          "Please use a Chromium-based browser (Chrome, Edge, etc.)."
      );
    }
  }

  async openFilePicker(options: {
    multiple?: boolean;
    filters?: FileFilter[];
  }): Promise<string | null> {
    this.checkSupport();

    try {
      const handles = await window.showOpenFilePicker!({
        multiple: options.multiple ?? false,
        types: filtersToAcceptTypes(options.filters),
      });

      if (handles.length === 0) return null;

      const handle = handles[0];
      const path = handleRegistry.registerFileHandle(handle);
      return path;
    } catch (e) {
      // User cancelled the picker
      if (e instanceof DOMException && e.name === "AbortError") {
        return null;
      }
      throw e;
    }
  }

  async openDirectoryPicker(): Promise<string | null> {
    this.checkSupport();

    try {
      const handle = await window.showDirectoryPicker!({
        mode: "readwrite",
      });

      const path = handle.name;
      handleRegistry.setRootHandle(handle, path);
      return path;
    } catch (e) {
      // User cancelled the picker
      if (e instanceof DOMException && e.name === "AbortError") {
        return null;
      }
      throw e;
    }
  }

  async saveFilePicker(options: {
    filters?: FileFilter[];
    defaultPath?: string;
  }): Promise<string | null> {
    this.checkSupport();

    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: options.defaultPath?.split("/").pop(),
        types: filtersToAcceptTypes(options.filters),
      });

      const path = handleRegistry.registerFileHandle(handle);
      return path;
    } catch (e) {
      // User cancelled the picker
      if (e instanceof DOMException && e.name === "AbortError") {
        return null;
      }
      throw e;
    }
  }

  async readTextFile(path: string): Promise<string> {
    const handle = handleRegistry.getFileHandle(path);
    if (!handle) {
      throw new Error(`File handle not found for path: "${path}"`);
    }

    const file = await handle.getFile();
    return file.text();
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const handle = handleRegistry.getFileHandle(path);
    if (!handle) {
      throw new Error(`File handle not found for path: "${path}"`);
    }

    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    let handle = handleRegistry.getFileHandle(path);

    // If we don't have a handle, try to create the file in the output directory
    if (!handle) {
      handle = await this.createFileHandle(path);
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    let handle = handleRegistry.getFileHandle(path);

    // If we don't have a handle, try to create the file in the output directory
    if (!handle) {
      handle = await this.createFileHandle(path);
    }

    const writable = await handle.createWritable();
    try {
      // Convert to ArrayBuffer for type compatibility with File System API
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      await writable.write(buffer);
    } finally {
      await writable.close();
    }
  }

  /**
   * Create a file handle for a path within the output directory.
   */
  private async createFileHandle(path: string): Promise<FileSystemFileHandle> {
    const rootHandle = handleRegistry.getRootHandle();
    if (!rootHandle) {
      throw new Error(
        "No output directory selected. Please select an output folder first."
      );
    }

    // Parse the path to get directory parts and filename
    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      throw new Error(`Invalid file path: "${path}"`);
    }

    // Navigate/create directory structure, tracking the full path
    let currentDir = rootHandle;
    let currentPath = "";
    for (const dirName of parts) {
      currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
      currentDir = await currentDir.getDirectoryHandle(dirName, {
        create: true,
      });
      handleRegistry.registerDirectoryHandle(currentDir, currentPath);
    }

    // Create the file
    const fileHandle = await currentDir.getFileHandle(fileName, {
      create: true,
    });
    handleRegistry.registerFileHandle(fileHandle, path);
    return fileHandle;
  }

  async createDirectory(path: string): Promise<void> {
    const rootHandle = handleRegistry.getRootHandle();
    if (!rootHandle) {
      throw new Error(
        "No output directory selected. Please select an output folder first."
      );
    }

    // Parse the path to get directory parts
    const parts = path.split("/").filter(Boolean);

    // Navigate/create directory structure
    let currentDir = rootHandle;
    let currentPath = "";
    for (const dirName of parts) {
      currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
      currentDir = await currentDir.getDirectoryHandle(dirName, {
        create: true,
      });
      handleRegistry.registerDirectoryHandle(currentDir, currentPath);
    }
  }

  async exists(path: string): Promise<boolean> {
    // Check in our handle registry first
    if (handleRegistry.getFileHandle(path) || handleRegistry.getDirectoryHandle(path)) {
      return true;
    }

    // Try to find it in the root directory
    const rootHandle = handleRegistry.getRootHandle();
    if (!rootHandle) {
      return false;
    }

    try {
      const parts = path.split("/").filter(Boolean);

      // Empty path means root directory, which exists if we have a root handle
      if (parts.length === 0) {
        return true;
      }

      let currentDir = rootHandle;

      for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i]);
      }

      const lastName = parts[parts.length - 1];
      // Try as file first
      try {
        await currentDir.getFileHandle(lastName);
        return true;
      } catch (e) {
        // Only treat NotFoundError as "doesn't exist", rethrow others
        if (e instanceof DOMException && e.name === "NotFoundError") {
          // Try as directory
          try {
            await currentDir.getDirectoryHandle(lastName);
            return true;
          } catch (e2) {
            if (e2 instanceof DOMException && e2.name === "NotFoundError") {
              return false;
            }
            throw e2;
          }
        }
        // TypeMismatchError means it exists but is a directory
        if (e instanceof DOMException && e.name === "TypeMismatchError") {
          return true;
        }
        throw e;
      }
    } catch (e) {
      // NotFoundError in directory traversal means path doesn't exist
      if (e instanceof DOMException && e.name === "NotFoundError") {
        return false;
      }
      throw e;
    }
  }

  async isFile(path: string): Promise<boolean> {
    if (handleRegistry.getFileHandle(path)) {
      return true;
    }

    const rootHandle = handleRegistry.getRootHandle();
    if (!rootHandle) {
      return false;
    }

    try {
      const parts = path.split("/").filter(Boolean);

      // Empty path is the root directory, not a file
      if (parts.length === 0) {
        return false;
      }

      let currentDir = rootHandle;

      for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i]);
      }

      const lastName = parts[parts.length - 1];
      await currentDir.getFileHandle(lastName);
      return true;
    } catch (e) {
      // NotFoundError or TypeMismatchError means it's not a file
      if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) {
        return false;
      }
      throw e;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    if (handleRegistry.getDirectoryHandle(path)) {
      return true;
    }

    const rootHandle = handleRegistry.getRootHandle();
    if (!rootHandle) {
      return false;
    }

    try {
      const parts = path.split("/").filter(Boolean);
      let currentDir = rootHandle;

      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part);
      }
      return true;
    } catch (e) {
      // NotFoundError or TypeMismatchError means it's not a directory
      if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) {
        return false;
      }
      throw e;
    }
  }

  async readDirectory(
    path: string
  ): Promise<{ name: string; isDirectory: boolean }[]> {
    let handle = handleRegistry.getDirectoryHandle(path);

    if (!handle) {
      const rootHandle = handleRegistry.getRootHandle();
      if (!rootHandle) {
        throw new Error(`Directory handle not found for path: "${path}"`);
      }

      // Navigate to the directory
      const parts = path.split("/").filter(Boolean);
      let currentDir = rootHandle;
      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part);
      }
      handle = currentDir;
    }

    const entries: { name: string; isDirectory: boolean }[] = [];

    for await (const entry of handle.values()) {
      entries.push({
        name: entry.name,
        isDirectory: entry.kind === "directory",
      });
    }

    return entries;
  }
}
