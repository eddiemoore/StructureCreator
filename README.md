# Structure Creator

A cross-platform desktop application and CLI tool that generates folder and file structures from XML schema definitions or existing folder templates.

## Features

- **Desktop GUI & CLI** - Use the graphical application or command-line interface for automation
- **XML Schema-Based Structure Generation** - Define project structures using XML schemas with nested folders and files
- **Folder Scanning** - Convert existing folder structures into reusable schemas
- **Variable Templating** - Use variables like `%PROJECT_NAME%` and `%DATE%` for dynamic customization
- **File Downloads** - Download files from URLs during structure creation
- **Template Library** - Save, organize, and reuse templates with favorites and usage tracking
- **Dry Run Mode** - Preview changes before applying them
- **CI/CD Integration** - Use the CLI for automated project scaffolding in pipelines
- **Theme Support** (GUI) - Dark/light mode with customizable accent colors

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

### Desktop Application

```bash
# Build the frontend
npm run build

# Build the complete Tauri application
npm run tauri build
```

The built application will be available in `src-tauri/target/release`.

### CLI Tool

```bash
# Build the CLI tool
cd src-tauri
cargo build --bin structure-creator-cli --release --no-default-features

# The binary will be at: src-tauri/target/release/structure-creator-cli
```

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
│   │   ├── LeftPanel.tsx         # Schema input, templates, variables
│   │   ├── TreePreview.tsx       # Visual tree display
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
- **File Downloads**: Add `url` attribute to download files during creation
- **Attributes**: Support for `exportpath`, `classpath`, and custom attributes

## Usage

### Desktop Application (GUI)

1. **Define a Schema**
   - Enter XML schema directly, or
   - Scan an existing folder structure

2. **Set Variables**
   - Define custom variables like `%PROJECT_NAME%`
   - Values are substituted during creation

3. **Choose Output Location**
   - Select destination folder
   - Enter project name

4. **Preview & Execute**
   - Use dry-run mode to preview changes
   - Execute to create the structure

5. **Save as Template**
   - Save frequently used schemas
   - Mark favorites for quick access

### Command-Line Interface (CLI)

The CLI tool provides powerful automation capabilities for CI/CD pipelines and scripting.

#### Create from Template

```bash
# Create a structure from a saved template
structure-creator-cli create --template "React App" --output ./my-app --var PROJECT_NAME=MyProject

# With multiple variables
structure-creator-cli create \
  --template "Full Stack App" \
  --output ./my-app \
  --var PROJECT_NAME=MyApp \
  --var AUTHOR="John Doe" \
  --var VERSION=1.0.0
```

#### Create from XML Schema File

```bash
# Create from an XML schema file
structure-creator-cli create --schema ./schema.xml --output ./my-project --var PROJECT_NAME=MyProject

# With dry-run to preview changes
structure-creator-cli create --schema ./schema.xml --output ./my-project --var PROJECT_NAME=MyProject --dry-run

# Overwrite existing files
structure-creator-cli create --schema ./schema.xml --output ./my-project --var PROJECT_NAME=MyProject --overwrite
```

#### Template Management

```bash
# List all available templates
structure-creator-cli template list

# List templates in JSON format
structure-creator-cli template list --format json

# Show template details
structure-creator-cli template show "React App"

# Show template as XML
structure-creator-cli template show "React App" --format xml

# Export template to XML file
structure-creator-cli template export "React App" --output react-app-schema.xml
```

#### CLI Options

**Create Command:**
- `-t, --template <NAME>` - Use a saved template by name or ID
- `-s, --schema <FILE>` - Use an XML schema file
- `-o, --output <PATH>` - Output directory (required)
- `-V, --var <KEY=VALUE>` - Set variables (can be used multiple times)
- `-d, --dry-run` - Preview without creating files
- `-f, --overwrite` - Overwrite existing files

**Template List:**
- `-f, --format <FORMAT>` - Output format: table (default) or json

**Template Show:**
- `-f, --format <FORMAT>` - Output format: text (default), json, or xml

#### Example: CI/CD Integration

```bash
# In your CI/CD pipeline script
#!/bin/bash
set -e

# Create project structure
structure-creator-cli create \
  --template "Microservice" \
  --output "./services/$SERVICE_NAME" \
  --var SERVICE_NAME="$SERVICE_NAME" \
  --var AUTHOR="$CI_COMMIT_AUTHOR" \
  --var VERSION="$CI_COMMIT_TAG"

# Continue with other build steps...
cd "./services/$SERVICE_NAME"
npm install
npm test
```

## Configuration

### Window Settings

Default window size: 1200x800 (minimum: 900x600)

### Theme Options

- Light/Dark mode (follows system preference by default)
- Accent colors: Blue, Purple, Green, Orange, Pink

## License

MIT
