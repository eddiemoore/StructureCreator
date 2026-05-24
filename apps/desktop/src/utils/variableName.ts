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
