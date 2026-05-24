---
status: accepted
---

# Variable names are canonical in clean form, with `%NAME%` as an edge-only token

## Context

A **Variable name** existed in two forms with no module owning the convention: the delimited `%NAME%` form (stored in `Variable.name`, used as IPC map keys) and the clean `NAME` form (validation-error keys, schema-internal references, Rust lookups). Conversion logic — `.replace(/^%|%$/g, "")`, `` `%${name}%` ``, Rust `format!("%{}%")` — was duplicated across ~15 sites in the store, components, web adapter, and backend. The fault line caused a real bug: `updateVariable`/`removeVariable` cleared validation errors keyed clean while searching for delimited names, so a form mismatch silently failed to clear errors.

## Decision

The **Variable name** is canonical in its clean form (`NAME`). The delimited `%NAME%` form is a **Variable token** — an edge-only representation, produced solely at outbound edges (the Tauri IPC boundary, where Rust's `format!("%{}%")` lookup demands it, and the template-substitution scan). See `CONTEXT.md` for the vocabulary.

A single TS frontend module owns the convention:

- A branded `VariableName` type carried by `Variable.name`, `ValidationError.variable_name`, and `VariableDefinition.name`. The compiler refuses a raw or delimited string where a name is expected, making the illegal (delimited-in-store) state unrepresentable.
- `asVariableName(raw)` — the single inbound normalizer. Strips delimiters; idempotent (`%NAME%` → `NAME`, `NAME` → `NAME`). Every inbound edge funnels through it: `extractVariables` results, recent-project keys loaded from the database, template/wizard loads, and validation results returned from Rust.
- `toToken(name)` / `toTokenKeys(map)` — the outbound wrapper producing the `%NAME%` form. `RightPanel.buildVariableMaps` produces a clean-keyed map; each adapter tokenizes at its own entry boundary.

**Refinement (discovered during implementation, issue #98):** the original wording said the wrap lives only in the Tauri adapter and "the web adapter wraps nothing." In practice the web adapter's creation engine is token-internal end-to-end (built-in variable injection, substitution lookup, repeat-loop iteration variables, and the image/sqlite generators all key on `%NAME%`). Converting that engine to clean would be a large, risky rewrite disproportionate to the goal. So the decision is refined: **the store and `buildVariableMaps` are clean; both adapters tokenize the variable map at their entry boundary** (the Tauri adapter for Rust's IPC lookup, the web adapter for its token-internal engine). Clean-canonical applies to the Variable-list/store domain — where the validation-clear bug lived — not to each engine's internal substitution keys.

The variable panel displays the clean `NAME`.

## Considered options

- **Delimited (`%NAME%`) canonical, status quo storage.** Rejected: keeps the fault line, only relocating the wrap/strip scatter into one module instead of removing it. Clean is what the schema model, Rust internals, and validation errors already think in; delimited is genuinely a wire/lookup form.
- **Plain `string` + module functions, no brand.** Rejected: leaves the clean-vs-delimited mix-up enforceable only by discipline and tests. The brand makes the mistake a compile error.
- **Showing `%NAME%` in the panel.** Rejected: chose clean `NAME` to avoid a display-wrap edge. (Trade-off accepted: the panel label no longer mirrors the `%NAME%` token as authored in schema text.)
- **Extending the brand to `SchemaNode.condition_var` and repeat iteration vars.** Rejected for now: those fields live on the Rust-mirrored, serde-synced `SchemaNode`, and branding them would pull cross-language type sync into scope. The brand is bounded to the frontend variable-list domain.

## Consequences

- Scope is the **TS frontend only**. The Rust backend keeps its own `format!("%{}%")` sites; cross-language drift of the convention is not addressed here and remains open (a separate cross-language-contract decision).
- No database migration: `asVariableName` is idempotent, so existing delimited keys in stored recent-project snapshots normalize on load.
- The web adapter's "try both forms" lookup guesswork (`web/transforms.ts`) is deleted — maps and lookups are uniformly clean within the frontend.
- The convention becomes unit-testable in one ~30-line module (idempotency, `toToken` round-trip, the validation-clear bug as a plain slice test), plus a type-level guarantee enforced by `tsc`.
