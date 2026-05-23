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
