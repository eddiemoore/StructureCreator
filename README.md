# Structure Creator

A cross-platform desktop application that generates folder and file structures from XML schema definitions or existing folder templates.

## Features

- **XML Schema-Based Structure Generation** - Define project structures using XML schemas with nested folders and files
- **Multiple Editing Modes** - Switch between Preview, Visual (drag-and-drop), and XML editor modes
- **Folder Scanning** - Convert existing folder structures into reusable schemas
- **Variable Templating** - Use variables like `%PROJECT_NAME%` and `%DATE%` for dynamic customization
- **File Downloads** - Download files from URLs during structure creation
- **Template Library** - Save, organize, and reuse templates with favorites and usage tracking
- **Dry Run Mode** - Preview changes before applying them
- **Theme Support** - Dark/light mode with customizable accent colors

## Tech Stack

**Frontend:**
- React 18.3 with TypeScript
- Vite for build tooling
- Tailwind CSS with macOS-inspired design system
- Zustand for state management

**Backend:**
- Tauri 2.0 (Rust)
- SQLite for template and settings persistence
- quick-xml for XML parsing

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [Rust](https://www.rust-lang.org/tools/install) toolchain
- [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) for your platform

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd structure-creator

# Install dependencies
npm install
```

## Development

```bash
# Start the development server
npm run dev
```

This starts the Vite dev server on port 1420 with hot module replacement.

To run the full Tauri application in development mode:

```bash
npm run tauri dev
```

## Building

```bash
# Build the frontend
npm run build

# Build the complete Tauri application
npm run tauri build
```

The built application will be available in `src-tauri/target/release`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with hot reload |
| `npm run build` | TypeScript check + Vite production build |
| `npm run preview` | Preview production build |
| `npm run tauri` | Access Tauri CLI directly |
| `npm run tauri dev` | Run Tauri app in development mode |
| `npm run tauri build` | Build production Tauri app |

## Project Structure

```
structure-creator/
├── src/                          # Frontend (React/TypeScript)
│   ├── App.tsx                   # Main app component
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Global styles and CSS variables
│   ├── components/               # React components
│   │   ├── LeftPanel.tsx         # File selection, templates, variables
│   │   ├── TreePreview.tsx       # Schema editor (Preview/Visual/XML modes)
│   │   ├── XmlSchemaEditor.tsx   # CodeMirror-based XML editor
│   │   ├── VisualSchemaEditor.tsx # Drag-and-drop tree editor
│   │   ├── RightPanel.tsx        # Execute & activity logs
│   │   ├── SettingsModal.tsx     # Theme/accent color settings
│   │   ├── Footer.tsx            # Status bar
│   │   └── Icons.tsx             # SVG icon components
│   ├── store/
│   │   └── appStore.ts           # Zustand state management
│   └── types/
│       └── schema.ts             # TypeScript interfaces
│
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs                # Main Tauri commands
│   │   ├── schema.rs             # XML parsing and schema logic
│   │   ├── database.rs           # SQLite operations
│   │   └── main.rs               # App entry point
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri app configuration
│
├── schema.xml                    # Example XML schema
├── package.json                  # Node dependencies & scripts
├── vite.config.ts                # Vite configuration
└── tailwind.config.js            # Tailwind CSS configuration
```

## XML Schema Format

Create project structures using XML:

```xml
<folder name="%PROJECT_NAME%">
  <folder name="src">
    <folder name="components" />
    <file name="App.tsx" />
    <file name="main.tsx" />
  </folder>
  <folder name="public">
    <file name="index.html" url="https://example.com/template.html" />
  </folder>
  <file name="package.json" />
  <file name="README.md" />
</folder>
```

### Schema Features

- **Variables**: Use `%VARIABLE_NAME%` syntax for dynamic values
- **Built-in Variables**: `%DATE%`, `%TIME%`, `%TIMESTAMP%`
- **Variable Helper Text**: Define descriptions, placeholders, and examples for variables
- **File Downloads**: Add `url` attribute to download files during creation
- **Attributes**: Support for `exportpath`, `classpath`, and custom attributes

### Variable Helper Text

Add a `<variables>` block to your schema to provide context for each variable:

```xml
<structure>
  <variables>
    <variable name="CLIENT_NAME"
              description="The client's company name"
              placeholder="Enter client name"
              example="Acme Corp"
              required="true" />
    <variable name="PROJECT_TYPE"
              description="Type of project (e.g., website, api)"
              placeholder="Enter project type"
              example="website"
              pattern="^[a-z-]+$"
              minLength="3"
              maxLength="30" />
  </variables>

  <folder name="%CLIENT_NAME%-%PROJECT_TYPE%">
    <file name="README.md" />
  </folder>
</structure>
```

**Supported attributes:**

| Attribute | Description |
|-----------|-------------|
| `name` | Variable name (without `%` delimiters) - **required** |
| `description` | Help text shown below the input field |
| `placeholder` | Placeholder text shown in the empty input |
| `example` | Example value displayed as "Example: value" |
| `required` | Whether the variable must have a value (`true`/`false`) |
| `pattern` | Regex pattern for validation |
| `minLength` | Minimum character length |
| `maxLength` | Maximum character length |

## Usage

1. **Define a Schema**
   - Load an XML schema file, or
   - Scan an existing folder structure, or
   - Create a new schema from scratch

2. **Edit Your Schema**
   - **Preview mode**: View the structure as a tree
   - **Visual mode**: Drag-and-drop editor for building structures
   - **XML mode**: Direct XML editing with syntax highlighting

3. **Set Variables**
   - Define custom variables like `%PROJECT_NAME%`
   - Values are substituted during creation

4. **Choose Output Location**
   - Select destination folder
   - Enter project name

5. **Preview & Execute**
   - Use dry-run mode to preview changes
   - Execute to create the structure

6. **Save as Template**
   - Save frequently used schemas
   - Mark favorites for quick access

## Configuration

### Window Settings

Default window size: 1200x800 (minimum: 900x600)

### Theme Options

- Light/Dark mode (follows system preference by default)
- Accent colors: Blue, Purple, Green, Orange, Pink

## License

MIT
