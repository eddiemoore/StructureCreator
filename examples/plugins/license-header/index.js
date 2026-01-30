/**
 * License Header Plugin
 *
 * Adds a copyright/license header to source files during structure creation.
 * Uses variables from the template context for dynamic values.
 *
 * Supported variables:
 *   %YEAR%   - Current year (built-in)
 *   %AUTHOR% - Author name (user-defined)
 *   %LICENSE% - License type (user-defined, defaults to "MIT")
 */

// Comment styles for different file types
const COMMENT_STYLES = {
  js: { start: '/**', middle: ' * ', end: ' */' },
  css: { start: '/**', middle: ' * ', end: ' */' },
};

// Map extensions to comment styles
const EXTENSION_MAP = {
  '.ts': 'js',
  '.tsx': 'js',
  '.js': 'js',
  '.jsx': 'js',
  '.css': 'css',
  '.scss': 'css',
};

/**
 * Generate the license header text
 */
function generateHeader(context) {
  const year = context.variables['%YEAR%'] || new Date().getFullYear();
  const author = context.variables['%AUTHOR%'] || 'Your Name';
  const license = context.variables['%LICENSE%'] || 'MIT';

  return [
    `Copyright (c) ${year} ${author}`,
    `Licensed under the ${license} License`,
    '',
    `File: ${context.filePath}`,
  ];
}

/**
 * Format header with appropriate comment style
 */
function formatHeader(lines, style) {
  const formatted = [style.start];
  for (const line of lines) {
    formatted.push(style.middle + line);
  }
  formatted.push(style.end);
  formatted.push(''); // Empty line after header
  return formatted.join('\n');
}

/**
 * Check if content already has a license header
 */
function hasExistingHeader(content) {
  const trimmed = content.trimStart();
  // Check for common header patterns
  return (
    trimmed.startsWith('/**') && trimmed.includes('Copyright') ||
    trimmed.startsWith('/*') && trimmed.includes('License') ||
    trimmed.startsWith('//') && trimmed.includes('Copyright')
  );
}

export default {
  name: 'license-header',
  fileTypes: ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss'],

  /**
   * Process file content by adding a license header
   *
   * @param {string} content - The original file content
   * @param {object} context - Processing context
   * @param {string} context.filePath - Relative file path
   * @param {string} context.extension - File extension (e.g., ".ts")
   * @param {object} context.variables - Variable values from template
   * @param {string} context.projectName - Project name
   * @returns {string} Content with license header prepended
   */
  process(content, context) {
    // Skip if file already has a header
    if (content && hasExistingHeader(content)) {
      return content;
    }

    // Get comment style for this file type
    const styleKey = EXTENSION_MAP[context.extension];
    if (!styleKey) {
      return content; // Unknown extension, skip
    }

    const style = COMMENT_STYLES[styleKey];
    const headerLines = generateHeader(context);
    const header = formatHeader(headerLines, style);

    return header + content;
  }
};
