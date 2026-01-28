/**
 * Image generator for web mode.
 * Creates solid-color placeholder images using the HTML Canvas API.
 */

import type { SchemaNode } from "../../../../types/schema";
import { substituteVariables } from "../transforms";
import {
  type ImageConfig,
  type ImageFormat,
  type GeneratorContext,
  DEFAULT_IMAGE_CONFIG,
  MAX_IMAGE_DIMENSION,
} from "./types";

// Regex patterns matching Rust implementation for attribute parsing
const RE_WIDTH = /width\s*=\s*["']?([^"'\s]+)["']?/;
const RE_HEIGHT = /height\s*=\s*["']?([^"'\s]+)["']?/;
const RE_BACKGROUND = /background\s*=\s*["']?([^"'\s]+)["']?/;
const RE_FORMAT = /format\s*=\s*["']?([^"'\s]+)["']?/;

/**
 * Parse a hex color string to RGB values.
 * Supports both short (#RGB) and full (#RRGGBB) forms.
 */
export const parseHexColor = (hex: string): [number, number, number] | null => {
  const cleaned = hex.replace(/^#/, "");

  if (cleaned.length === 3) {
    // Short form: #RGB -> #RRGGBB
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }

  if (cleaned.length === 6) {
    // Full form: #RRGGBB
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }

  return null;
};

/**
 * Parse image attributes from a string containing width/height/background/format.
 * Matches the Rust implementation's regex-based parsing.
 */
const parseImageAttributes = (
  input: string,
  variables: Record<string, string>,
  config: ImageConfig
): ImageConfig => {
  const result = { ...config };

  const widthMatch = input.match(RE_WIDTH);
  if (widthMatch) {
    const value = substituteVariables(widthMatch[1], variables);
    const w = parseInt(value.trim(), 10);
    if (!isNaN(w)) {
      result.width = Math.max(1, Math.min(w, MAX_IMAGE_DIMENSION));
    }
  }

  const heightMatch = input.match(RE_HEIGHT);
  if (heightMatch) {
    const value = substituteVariables(heightMatch[1], variables);
    const h = parseInt(value.trim(), 10);
    if (!isNaN(h)) {
      result.height = Math.max(1, Math.min(h, MAX_IMAGE_DIMENSION));
    }
  }

  const backgroundMatch = input.match(RE_BACKGROUND);
  if (backgroundMatch) {
    const value = substituteVariables(backgroundMatch[1], variables);
    result.background = value.trim();
  }

  const formatMatch = input.match(RE_FORMAT);
  if (formatMatch) {
    const value = formatMatch[1].toLowerCase();
    if (value === "jpeg" || value === "jpg") {
      result.format = "jpeg";
    } else if (value === "png") {
      result.format = "png";
    }
  }

  return result;
};

/**
 * Parse image configuration from a schema node.
 * Matches the Rust parse_image_config() function.
 */
export const parseImageConfig = (
  node: SchemaNode,
  variables: Record<string, string>
): ImageConfig => {
  let config: ImageConfig = { ...DEFAULT_IMAGE_CONFIG };

  // Determine format from file extension
  const name = node.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    config.format = "jpeg";
  }

  // Parse configuration from generateConfig if present
  if (node.generateConfig) {
    config = parseImageAttributes(node.generateConfig, variables, config);
  }

  // Also check content field which may have attributes embedded
  if (node.content) {
    config = parseImageAttributes(node.content, variables, config);
  }

  return config;
};

/**
 * Generate a placeholder image as a Uint8Array.
 * Returns null for dry run mode.
 */
export const generateImage = async (
  node: SchemaNode,
  context: GeneratorContext
): Promise<Uint8Array | null> => {
  if (context.dryRun) {
    return null;
  }

  const config = parseImageConfig(node, context.variables);

  // Create canvas element
  const canvas = document.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas 2D context");
  }

  // Parse background color
  const rgb = parseHexColor(config.background);
  if (rgb) {
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  } else {
    // Fallback to CSS color string (may not work for all formats)
    ctx.fillStyle = config.background;
  }

  // Fill the entire canvas
  ctx.fillRect(0, 0, config.width, config.height);

  // Convert to blob and then to Uint8Array
  const mimeType: `image/${ImageFormat}` =
    config.format === "jpeg" ? "image/jpeg" : "image/png";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to generate image blob"));
          return;
        }

        try {
          const arrayBuffer = await blob.arrayBuffer();
          resolve(new Uint8Array(arrayBuffer));
        } catch (e) {
          reject(e);
        }
      },
      mimeType,
      config.format === "jpeg" ? 0.9 : undefined // JPEG quality
    );
  });
};
