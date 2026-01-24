/**
 * ZIP file utilities for web mode.
 * Handles ZIP scanning and Office document (DOCX, XLSX, PPTX) processing.
 */

import JSZip from "jszip";
import type { SchemaTree, SchemaNode } from "../../../types/schema";
import { isTextFile, MAX_SCHEMA_DEPTH, MAX_ZIP_ENTRIES, calculateSchemaStats } from "./constants";

/**
 * Scan a ZIP file and convert to SchemaTree.
 */
export const scanZipToSchema = async (
  data: Uint8Array,
  filename: string
): Promise<SchemaTree> => {
  const zip = await JSZip.loadAsync(data);

  // Build a tree from the ZIP contents
  const rootName = filename.replace(/\.zip$/i, "");
  const root = await buildSchemaFromZip(zip, rootName);

  // Calculate stats
  const stats = calculateSchemaStats(root);

  return {
    root,
    stats,
  };
};

/**
 * Build a SchemaNode tree from a JSZip object.
 */
const buildSchemaFromZip = async (
  zip: JSZip,
  rootName: string
): Promise<SchemaNode> => {
  // Create a tree structure from flat paths
  const root: SchemaNode = {
    type: "folder",
    name: rootName,
    children: [],
  };

  // Get all file paths and sort them
  const paths = Object.keys(zip.files);

  // Check entry count to prevent resource exhaustion
  if (paths.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP file has too many entries (${paths.length}). Maximum allowed is ${MAX_ZIP_ENTRIES}.`
    );
  }

  paths.sort();

  for (const path of paths) {
    const file = zip.files[path];

    // Skip the root entry if it exists
    if (path === "" || path === "/") continue;

    // Split path into parts
    const parts = path.split("/").filter(Boolean);

    // If ends with /, it's a directory
    if (file.dir) {
      ensurePath(root, parts);
    } else {
      // It's a file
      const fileName = parts.pop()!;
      const parentNode = ensurePath(root, parts);

      parentNode.children = parentNode.children || [];
      parentNode.children.push({
        type: "file",
        name: fileName,
      });
    }
  }

  // Sort children at each level
  sortChildren(root);

  return root;
};

/**
 * Ensure a path exists in the tree, creating folders as needed.
 * Returns the node at the end of the path.
 */
const ensurePath = (root: SchemaNode, parts: string[]): SchemaNode => {
  let current = root;

  for (const part of parts) {
    current.children = current.children || [];

    // Find or create the folder
    let found = current.children.find(
      (c) => c.type === "folder" && c.name === part
    );

    if (!found) {
      found = {
        type: "folder",
        name: part,
        children: [],
      };
      current.children.push(found);
    }

    current = found;
  }

  return current;
};

/**
 * Sort children: folders first, then files, alphabetically.
 * Includes depth limiting to prevent stack overflow.
 */
const sortChildren = (node: SchemaNode, depth: number = 0): void => {
  if (!node.children) return;

  // Stop recursion if depth exceeds limit
  if (depth >= MAX_SCHEMA_DEPTH) return;

  node.children.sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (a.type !== "folder" && b.type === "folder") return 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of node.children) {
    sortChildren(child, depth + 1);
  }
};

// ============================================================================
// Office Document Processing (DOCX, XLSX, PPTX)
// ============================================================================

/**
 * Office document types we can process.
 */
type OfficeDocType = "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp";

/**
 * Check if a file is an Office document we can process.
 */
export const isOfficeDocument = (filename: string): OfficeDocType | null => {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "docx":
      return "docx";
    case "xlsx":
      return "xlsx";
    case "pptx":
      return "pptx";
    case "odt":
      return "odt";
    case "ods":
      return "ods";
    case "odp":
      return "odp";
    default:
      return null;
  }
};

/**
 * Process an Office document, substituting variables in its XML content.
 */
export const processOfficeDocument = async (
  data: Uint8Array,
  docType: OfficeDocType,
  substituteVars: (text: string) => string
): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(data);

  // Get the XML files to process based on document type
  const xmlPaths = getXmlPathsForDocType(docType);

  // Process each XML file
  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (file) {
      try {
        const content = await file.async("string");
        const processed = substituteVarsInXml(content, substituteVars);
        zip.file(path, processed);
      } catch {
        // Skip files that can't be processed (binary or malformed)
      }
    }
  }

  // Also process any other XML files that might contain variables
  const allFiles = Object.keys(zip.files);
  for (const path of allFiles) {
    if (path.endsWith(".xml") && !xmlPaths.includes(path)) {
      const file = zip.file(path);
      if (file && !zip.files[path].dir) {
        try {
          const content = await file.async("string");
          // Only process if it contains variable markers
          if (content.includes("%")) {
            const processed = substituteVarsInXml(content, substituteVars);
            zip.file(path, processed);
          }
        } catch {
          // XML parsing failed - file may be binary or malformed
          // Continue processing other files in the archive
        }
      }
    }
  }

  // Generate the output ZIP
  const output = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return output;
};

/**
 * Get the main XML file paths for each Office document type.
 */
const getXmlPathsForDocType = (docType: OfficeDocType): string[] => {
  switch (docType) {
    case "docx":
      return [
        "word/document.xml",
        "word/header1.xml",
        "word/header2.xml",
        "word/header3.xml",
        "word/footer1.xml",
        "word/footer2.xml",
        "word/footer3.xml",
        "word/comments.xml",
        "word/footnotes.xml",
        "word/endnotes.xml",
        "docProps/core.xml",
        "docProps/custom.xml",
      ];
    case "xlsx":
      return [
        "xl/sharedStrings.xml",
        "xl/workbook.xml",
        "docProps/core.xml",
        "docProps/custom.xml",
      ];
    case "pptx":
      return [
        "docProps/core.xml",
        "docProps/custom.xml",
        // Slides are numbered, so we'll catch them in the general XML processing
      ];
    case "odt":
    case "ods":
    case "odp":
      return ["content.xml", "styles.xml", "meta.xml"];
    default:
      return [];
  }
};

/**
 * Substitute variables in XML content while preserving XML structure.
 * Handles cases where variables might be split across XML tags.
 */
const substituteVarsInXml = (
  xml: string,
  substituteVars: (text: string) => string
): string => {
  // First, try simple substitution for unsplit variables
  let result = substituteVars(xml);

  // For Office documents, variables might be split across runs (e.g., in Word)
  // Handle DOCX-style split variables: <w:t>%</w:t><w:t>NAME</w:t><w:t>%</w:t>
  result = reassembleAndSubstitute(result, substituteVars, /<w:t[^>]*>([^<]*)<\/w:t>/g);

  // Handle generic XML text content splits
  result = reassembleAndSubstitute(result, substituteVars, />([^<]+)</g);

  return result;
};

/**
 * Reassemble potentially split variables and substitute them.
 */
const reassembleAndSubstitute = (
  xml: string,
  substituteVars: (text: string) => string,
  pattern: RegExp
): string => {
  // Extract all text content
  const matches: { full: string; text: string; index: number }[] = [];
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    matches.push({
      full: match[0],
      text: match[1],
      index: match.index,
    });
  }

  if (matches.length === 0) return xml;

  // Look for split variable patterns
  // A variable starts with % and ends with %
  let result = xml;
  let offset = 0;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];

    // Check if this text contains an incomplete variable start
    if (current.text.includes("%") && !isCompleteVariable(current.text)) {
      // Try to find the rest of the variable in subsequent matches
      let combined = current.text;
      let endIndex = i;

      for (let j = i + 1; j < matches.length && j < i + 10; j++) {
        combined += matches[j].text;
        endIndex = j;

        if (isCompleteVariable(combined)) {
          // Found a complete variable, substitute it
          const substituted = substituteVars(combined);

          if (substituted !== combined) {
            // Rebuild the XML with the substituted value in the first element
            // and empty the subsequent elements
            const newXml = rebuildXmlWithSubstitution(
              result,
              matches.slice(i, endIndex + 1),
              substituted,
              offset
            );

            const lengthDiff = newXml.length - result.length;
            result = newXml;
            offset += lengthDiff;
          }
          // Skip past the matches we've already processed
          i = endIndex;
          break;
        }
      }
    }
  }

  return result;
};

/**
 * Check if text contains only complete variable(s) - all % signs are paired.
 * Returns true if there are no unpaired % signs that would indicate a split variable.
 */
const isCompleteVariable = (text: string): boolean => {
  // Remove all complete variables (%NAME% or %NAME:transform%)
  const withoutVars = text.replace(/%[A-Z_][A-Z0-9_]*(?::[^%]+)?%/gi, "");
  // If any % remains, we have an incomplete variable
  return !withoutVars.includes("%");
};

/**
 * Rebuild XML with a substituted value.
 */
const rebuildXmlWithSubstitution = (
  xml: string,
  matches: { full: string; text: string; index: number }[],
  substituted: string,
  offset: number
): string => {
  if (matches.length === 0) return xml;

  // Put the entire substituted value in the first match
  // and empty the content of subsequent matches
  let result = xml;
  let currentOffset = offset;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const newText = i === 0 ? substituted : "";
    const newFull = m.full.replace(m.text, newText);

    const start = m.index + currentOffset;
    const end = start + m.full.length;

    result = result.substring(0, start) + newFull + result.substring(end);
    currentOffset += newFull.length - m.full.length;
  }

  return result;
};

// ============================================================================
// EPUB Processing
// ============================================================================

/**
 * Check if a file is an EPUB.
 */
export const isEpub = (filename: string): boolean => {
  return filename.toLowerCase().endsWith(".epub");
};

/**
 * Process an EPUB file, substituting variables in its content.
 */
export const processEpub = async (
  data: Uint8Array,
  substituteVars: (text: string) => string
): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(data);

  // Process all XHTML, HTML, and XML files
  const allFiles = Object.keys(zip.files);

  for (const path of allFiles) {
    const file = zip.files[path];
    if (
      file &&
      !file.dir &&
      (path.endsWith(".xhtml") ||
        path.endsWith(".html") ||
        path.endsWith(".xml") ||
        path.endsWith(".opf") ||
        path.endsWith(".ncx"))
    ) {
      try {
        const content = await zip.file(path)!.async("string");
        if (content.includes("%")) {
          const processed = substituteVars(content);
          zip.file(path, processed);
        }
      } catch {
        // Skip files that can't be processed (binary or encoding issues)
      }
    }
  }

  // Generate the output
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};

// ============================================================================
// Generic ZIP with Variable Substitution
// ============================================================================

/**
 * Process a generic ZIP file, substituting variables in text files.
 */
export const processZipWithVariables = async (
  data: Uint8Array,
  substituteVars: (text: string) => string
): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(data);

  const allFiles = Object.keys(zip.files);

  for (const path of allFiles) {
    const file = zip.files[path];
    if (file && !file.dir) {
      const filename = path.split("/").pop() || path;
      if (isTextFile(filename)) {
        try {
          const content = await zip.file(path)!.async("string");
          if (content.includes("%")) {
            const processed = substituteVars(content);
            zip.file(path, processed);
          }
        } catch {
          // Binary file or encoding issue - expected for non-text content
          // Continue processing other files in the archive
        }
      }
    }
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};
