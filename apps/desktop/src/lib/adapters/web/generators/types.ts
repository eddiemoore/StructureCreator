/**
 * Types for binary file generators in web mode.
 */

/**
 * Image format for generated images.
 */
export type ImageFormat = "png" | "jpeg";

/**
 * Configuration for image generation.
 */
export interface ImageConfig {
  width: number;
  height: number;
  background: string;
  format: ImageFormat;
}

/**
 * Default image configuration matching Rust implementation.
 */
export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  width: 100,
  height: 100,
  background: "#CCCCCC",
  format: "png",
};

/**
 * Context passed to generators.
 */
export interface GeneratorContext {
  variables: Record<string, string>;
  dryRun: boolean;
}

/**
 * Maximum image dimension (width or height) to prevent memory exhaustion.
 */
export const MAX_IMAGE_DIMENSION = 10000;
