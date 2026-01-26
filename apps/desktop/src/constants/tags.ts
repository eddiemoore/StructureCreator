/**
 * Tag validation constants.
 * IMPORTANT: Keep in sync with src-tauri/src/database.rs
 */

/** Maximum length for a single tag */
export const MAX_TAG_LENGTH = 50;

/** Maximum number of tags per template */
export const MAX_TAGS_PER_TEMPLATE = 20;

/** Regex pattern for valid tags: starts with alphanumeric, contains only lowercase alphanumeric, hyphens, underscores */
export const TAG_REGEX = /^[a-z0-9][a-z0-9-_]*$/;
