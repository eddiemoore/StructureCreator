export type SchemaNode = { id?: string | null; type?: string; name?: string; url?: string | null; content?: string | null; children?: SchemaNode[] | null; condition_var?: string | null; 
/**
 * For repeat nodes: the count expression (variable like "%NUM%" or literal "3")
 */
repeat_count?: string | null; 
/**
 * For repeat nodes: the iteration variable name (e.g., "i" creates %i%)
 */
repeat_as?: string | null; 
/**
 * Generator type: "image" or "sqlite"
 */
generate?: string | null; 
/**
 * Generator configuration (child XML as string for parsing)
 */
generateConfig?: string | null; 
/**
 * If true, process {{if}}/{{for}} template directives in file content.
 * When false/None, {{...}} syntax is preserved as-is.
 */
template?: boolean | null; 
/**
 * Unrecognized XML attributes captured verbatim so they survive a
 * parse -> edit -> export round-trip. Keys exclude attributes already
 * mapped to dedicated fields above (name, url, var, count, as, generate,
 * template, and generator config attrs). Sorted for deterministic export.
 */
attributes?: { [key in string]: string } | null }