# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Start Vite dev server (frontend only, port 1420)
npm run dev

# Run full Tauri app in development mode
npm run tauri dev

# Build production frontend
npm run build

# Build complete Tauri application
npm run tauri build
```

No test framework is currently configured.

## Architecture Overview

Structure Creator is a Tauri 2.0 desktop application that generates folder/file structures from XML schemas.

### Frontend (React/TypeScript)

- **Entry**: `src/main.tsx` → `src/App.tsx`
- **State Management**: Zustand store in `src/store/appStore.ts` - single store with all app state (schema, variables, templates, settings, progress)
- **Types**: All TypeScript interfaces in `src/types/schema.ts` (SchemaNode, SchemaTree, Template, Settings, AppState)
- **Layout**: Three-panel layout with LeftPanel (schema input/templates), TreePreview (visual tree), RightPanel (execution/logs)

### Backend (Rust)

- **Tauri Commands**: `src-tauri/src/lib.rs` - all IPC commands prefixed with `cmd_` (e.g., `cmd_parse_schema`, `cmd_create_structure`)
- **XML Parsing**: `src-tauri/src/schema.rs` - `parse_xml_schema()` parses XML to SchemaTree, `scan_folder_to_schema()` converts folders to schemas
- **Database**: `src-tauri/src/database.rs` - SQLite for templates and settings (stored in app data dir as `structure-creator.db`)

### Data Flow

1. User provides XML schema or scans existing folder
2. Frontend calls `cmd_parse_schema` or `cmd_scan_folder` via Tauri invoke
3. Rust parses to `SchemaTree` (root SchemaNode + stats)
4. Frontend displays tree preview
5. User sets variables (%NAME% format) and output path
6. Frontend calls `cmd_create_structure` or `cmd_create_structure_from_tree`
7. Rust creates folders/files, downloads URLs, returns CreateResult with logs

### Key Patterns

- **Variable Substitution**: Variables use `%NAME%` format, substituted at structure creation time
- **Tauri IPC**: Frontend uses `@tauri-apps/api` invoke() to call Rust commands
- **File Downloads**: XML files can have `url` attribute; Rust downloads content using ureq
- **Dry Run Mode**: Preview changes without creating files (handled in Rust)
