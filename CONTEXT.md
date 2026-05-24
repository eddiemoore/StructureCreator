# Structure Creator

Generates folder/file structures from XML schemas. This context covers the schema model and the variables substituted into it at creation time.

## Language

**Schema**:
An XML description of a folder/file tree to create.
_Avoid_: template (reserved for saved, reusable schemas), structure (reserved for the created result on disk).

**Variable**:
A named placeholder whose value the user supplies, substituted into the structure at creation time.

**Variable name**:
The canonical clean identifier of a Variable (e.g. `NAME`) — the in-app, internal form. Held everywhere in the frontend; carried as a branded `VariableName` type so a raw or delimited string cannot stand in for one.
_Avoid_: var, key, delimited name.

**Variable token**:
The delimited `%NAME%` form of a Variable name as it appears in schema text and on the Tauri IPC wire. Produced only at outbound edges from a Variable name; never the stored or internal form.
_Avoid_: variable placeholder, %-name, wrapped name.

**Target**:
A platform implementation that turns a Schema into a structure: the native target (Rust backend, via Tauri) and the web target (TypeScript, in-browser). Both are permanently supported.
_Avoid_: platform, mode, backend.

**Capability**:
A discrete feature a Target may or may not support (file downloads, binary processing, hooks, watch, robust XML lexing). When a Target lacks a Capability it fails loudly, never silently producing a different result.
_Avoid_: feature flag, permission.

## Relationships

- A **Schema** contains zero or more **Variable**s.
- A **Variable** has exactly one **Variable name** (clean, canonical).
- A **Variable token** is derived from a **Variable name** at an outbound edge (IPC to the Rust backend, or template-substitution scan); converting back (strip delimiters) is idempotent.
- Both **Target**s must produce identical results for the shared semantic core (substitution, transforms, templating, schema-structure semantics); they may differ only where one lacks a **Capability**, and there the lacking Target fails loudly.

## Example dialogue

> **Dev:** "The validation error came back keyed `NAME` but the panel variable is `%NAME%` — do they match?"
> **Domain expert:** "They should both be **Variable names** — clean. `%NAME%` is a **Variable token**; it only exists on the wire and in schema text. If a token reached the store, an inbound edge forgot to normalize it."

## Flagged ambiguities

- `%NAME%` vs `NAME` were used interchangeably as "the variable name" across the store, components, and validation — resolved: **Variable name** is clean and canonical; `%NAME%` is the **Variable token**, an edge-only form.
