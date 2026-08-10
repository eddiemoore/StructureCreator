# Structure Creator

Generates folder/file structures from XML schemas. This context covers the schema model and the variables substituted into it at creation time.

## Language

**Schema**:
An XML description of a folder/file tree to create.
_Avoid_: template (reserved for saved, reusable schemas), structure (reserved for the created result on disk).

**Variable**:
A named placeholder whose value the user supplies, substituted into the structure at creation time.

**Variable name**:
The canonical clean identifier of a Variable (e.g. `NAME`) — the in-app, internal form. Held everywhere in the frontend; carried as a branded `VariableName` type so a raw or delimited string cannot stand in for one. Every string operation on a name — normalize (strip delimiters), tokenize, sanitize raw editor input, validate for iteration use — lives in the shared variable-name module; callers never touch `%` or name-shaped regex directly.
_Avoid_: var, key, delimited name.

**Variable token**:
The delimited `%NAME%` form of a Variable name as it appears in schema text and on the Tauri IPC wire. Produced only at outbound edges from a Variable name; never the stored or internal form.
_Avoid_: variable placeholder, %-name, wrapped name.

**Built-in Variable**:
A Variable the app supplies itself rather than the user: `DATE`, `YEAR`, `MONTH`, `DAY`, `PROJECT_NAME`. Each Target owns one list of them and one completion step that adds them to the user's Variable map before expansion; a user-defined Variable of the same name wins. Built-in Variables are excluded from auto-detection (they never appear as a row in the variable panel) and from undefined-variable warnings.
_Avoid_: system variable, magic variable, automatic variable.

**Schema intake**:
The frontend sequence that turns a schema source — a template, an XML file, a zip, a scanned folder, a wizard completion, a recent project, or a watched file change — into a loaded Schema plus its Variables: read or scan, resolve template inheritance, parse, merge detected Variables, and report progress. Stateless — the result is returned to the caller; the store holds it. Picking a file or folder happens at the call site, not inside intake.
_Avoid_: schema load, load flow, open schema.

**Plan**:
The tree of resolved nodes a Target produces by expanding a Schema with a complete Variable map (built-ins included): resolved names, rendered inline content, with IO-dependent content deferred as instructions (download, generate). Pure and deterministic — the unit the golden-vector contract pins. Creating a structure executes a Plan; diff preview compares a Plan against disk.
_Avoid_: preview tree, expanded tree, diff tree.

**Creation run**:
The frontend sequence that turns user inputs into a structure: validate (schema, then Variables), optionally preview (compare the Plan against disk), execute the creation, record history, and optionally undo. Stateless — results are returned to the caller; the store holds them.
_Avoid_: create flow, execution flow, creation session.

**Target**:
A platform implementation that turns a Schema into a structure: the native target (Rust backend, via Tauri) and the web target (TypeScript, in-browser). Both are permanently supported.
_Avoid_: platform, mode, backend.

**Capability**:
A discrete feature a Target may or may not support (file downloads, binary processing, hooks, watch, robust XML lexing). When a Target lacks a Capability it fails loudly, never silently producing a different result. Failing loudly takes one of two declared forms: refusing the operation (a typed `CapabilityError`), or — where partial results are meaningful, as with post-create hooks — completing with an explicit warning. The per-Target support matrix lives in one frontend module, the Capability registry; adapters and UI gating both consult it.
_Avoid_: feature flag, permission.

## Relationships

- A **Schema** contains zero or more **Variable**s.
- A **Variable** has exactly one **Variable name** (clean, canonical).
- A **Variable token** is derived from a **Variable name** at an outbound edge (IPC to the Rust backend, or template-substitution scan); converting back (strip delimiters) is idempotent.
- A **Target** expands a **Schema** plus complete **Variable** values into a **Plan**; execution (create) and diff preview are thin consumers of the Plan.
- A **Variable** map is *complete* when every **Built-in Variable** has a value and every key is a **Variable token**. Expansion requires a complete map; completing one is the Target's edge step, never part of expansion, so expansion stays pure.
- **Schema intake** produces the Schema and Variables a **Creation run** later consumes; the two are separate sequences and neither calls the other.
- A **Creation run** sequences validation, Plan preview, execution, history recording, and undo through the active **Target**; watch auto-create and the keyboard shortcut are ordinary callers of it.
- Both **Target**s must produce identical results for the shared semantic core (substitution, transforms, templating, schema-structure semantics); they may differ only where one lacks a **Capability**, and there the lacking Target fails loudly.

## Example dialogue

> **Dev:** "The validation error came back keyed `NAME` but the panel variable is `%NAME%` — do they match?"
> **Domain expert:** "They should both be **Variable names** — clean. `%NAME%` is a **Variable token**; it only exists on the wire and in schema text. If a token reached the store, an inbound edge forgot to normalize it."

## Flagged ambiguities

- `%NAME%` vs `NAME` were used interchangeably as "the variable name" across the store, components, and validation — resolved: **Variable name** is clean and canonical; `%NAME%` is the **Variable token**, an edge-only form.
