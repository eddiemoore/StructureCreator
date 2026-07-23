/**
 * The variable-name convention (ADR-0001).
 *
 * A **Variable name** is the canonical clean identifier (e.g. `NAME`). A
 * **Variable token** is its delimited edge form (`%NAME%`) as it appears in
 * schema text and on the IPC wire. This module owns the conversion between the
 * two so callers never re-derive the `%` convention.
 */

/** A clean, canonical variable name. Constructed only via {@link asVariableName}. */
export type VariableName = string & { readonly __brand: "VariableName" };

/**
 * Normalize a raw string to a clean {@link VariableName}, stripping a single
 * surrounding `%` delimiter. Idempotent.
 */
export const asVariableName = (raw: string): VariableName =>
  raw.replace(/^%|%$/g, "") as VariableName;

/**
 * Produce the {@link VariableName}'s **Variable token** (`%NAME%`) for an
 * outbound edge (IPC to the native backend, or template-substitution scan).
 */
export const toToken = (name: VariableName): string => `%${name}%`;

/**
 * Rewrite a variable-name-keyed map to its **Variable token** keys (`%NAME%`),
 * for outbound IPC to the native backend whose lookups use the token form.
 * Idempotent on keys that are already tokens.
 */
export const toTokenKeys = <V>(map: Record<string, V>): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(map)) {
    out[toToken(asVariableName(key))] = value;
  }
  return out;
};

/**
 * Rewrite a map of unknown key form (clean, token, or mixed) to clean
 * {@link VariableName} keys. The inbound-edge counterpart of
 * {@link toTokenKeys}; idempotent.
 */
export const toNameKeys = <V>(map: Record<string, V>): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(map)) {
    out[asVariableName(key)] = value;
  }
  return out;
};

/**
 * Coerce raw user input (editor fields, wizard config) into a legal
 * {@link VariableName}: trim, strip `%`, drop anything outside
 * `[a-zA-Z0-9_]`, cap at 50 characters. May return an empty name if nothing
 * legal remains. Use {@link asVariableName} instead for trusted inbound data
 * that only needs delimiter-stripping.
 */
export const sanitizeVariableName = (raw: string): VariableName =>
  raw
    .trim()
    .replace(/%/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 50) as VariableName;

/**
 * Validate a name for use as a repeat iteration variable. Returns null if
 * valid, or an error message. Iteration names must not start with a digit
 * (matching the Plan modules' expansion-time rule); empty means "use the
 * default" and is valid. Condition variables deliberately skip this check —
 * the backend accepts any variable format for conditions.
 */
export const validateVariableName = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9]/.test(trimmed)) {
    return "Variable name cannot start with a digit";
  }
  return null;
};

/**
 * Whether the text contains a **Variable token** (`%NAME%`) reference,
 * e.g. a repeat count given as a variable instead of a literal integer.
 */
export const containsVariableToken = (text: string): boolean =>
  /%[A-Za-z_][A-Za-z0-9_]*%/.test(text);
