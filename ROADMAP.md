# Structure Creator Roadmap

This document outlines potential features and enhancements for Structure Creator.

---

## High-Priority Features

These features would have the greatest impact on usability and adoption:

| Feature | Description |
|---------|-------------|
| **Visual Schema Editor** | Drag-and-drop tree editor instead of writing XML manually |
| **CLI Interface** | Command-line tool for automation and CI/CD integration |
| **Conditional Logic** | If/else syntax in schemas for reusable templates |
| **Template Import/Export** | Share templates as files; foundation for template hub |
| **Post-Creation Hooks** | Run commands after creation (npm install, git init, etc.) |

---

## Schema & Template Enhancements

### Conditional Logic in Schemas
Allow templates to adapt based on variable values:
```xml
<folder name="src">
  <if var="USE_TYPESCRIPT">
    <file name="index.ts" />
  </if>
  <else>
    <file name="index.js" />
  </else>
</folder>
```

### Repeater/Loop Syntax
Generate multiple similar structures dynamically:
```xml
<repeat count="%NUM_MODULES%" as="i">
  <folder name="module_%i%">
    <file name="index.ts" />
  </folder>
</repeat>
```

### Variable Types & Transformations
- Case transformations: `%NAME:uppercase%`, `%NAME:kebab-case%`, `%NAME:camelCase%`
- Date formatting: `%DATE:format(YYYY-MM-DD)%`
- Computed values: `%NAME:plural%`, `%NAME:length%`
- Validation rules: regex patterns, min/max length, required fields

### Template Inheritance
Allow templates to extend other templates:
```xml
<template extends="base-react-app">
  <folder name="additional-feature">
    <file name="feature.ts" />
  </folder>
</template>
```

---

## User Experience Improvements

### Visual Schema Editor
- Drag-and-drop interface to build folder structures
- Add/remove/rename nodes without writing XML
- Right-click context menus for common actions
- Double-click to edit names inline
- Visual indicators for files vs folders
- Undo/redo for tree modifications

### Diff Preview for Dry Run
- Visual comparison of planned vs existing files
- Color coding: green (new), red (overwrite), yellow (skip)
- Expandable tree view showing all changes
- Summary statistics at top

### Template Search & Tags
- Full-text search across template names and descriptions
- Tagging system (e.g., "react", "python", "monorepo", "backend")
- Filter templates by tags
- Sort by name, date, usage, favorites

### Recent Projects History
- Track last N created structures
- Quick re-create with same settings
- Edit variables and re-run
- Clear history option

### Keyboard Shortcuts
- `Cmd/Ctrl + Enter` - Create structure
- `Cmd/Ctrl + N` - New template
- `Cmd/Ctrl + O` - Open folder/file
- `Cmd/Ctrl + S` - Save current as template
- `Cmd/Ctrl + F` - Focus search
- `Escape` - Cancel/close modals
- Arrow keys - Navigate template list

---

## Workflow & Automation

### CLI Interface
```bash
# Create from template
structure-creator create --template "React App" --output ./my-app --var NAME=MyProject

# Create from XML file
structure-creator create --schema ./schema.xml --output ./project

# List templates
structure-creator templates list

# Export template
structure-creator templates export "React App" --output ./react-app.sct

# Dry run
structure-creator create --template "React App" --output ./my-app --dry-run
```

### Watch Mode
- Monitor schema file for changes
- Auto-recreate structure on save
- Useful for iterating on project templates
- Configurable debounce delay

### Post-Creation Hooks
```xml
<schema>
  <folder name="my-project">...</folder>
  <hooks>
    <post-create>npm install</post-create>
    <post-create>git init</post-create>
    <post-create>code .</post-create>
  </hooks>
</schema>
```

### Batch Operations
- Create same structure in multiple locations
- Apply multiple templates sequentially
- Variable sets for different configurations
- Progress tracking for batch jobs

### Template Wizards
Step-by-step guided creation:
1. Choose base template type
2. Answer configuration questions
3. Preview generated schema
4. Customize if needed
5. Create structure

---

## Collaboration & Sharing

### Template Import/Export
- Export templates as `.sct` files (structured JSON bundle)
- Import from local files
- Import from URLs
- Bulk import/export
- Include/exclude variables option

### Template Hub / Registry
- Browse community-created templates
- Publish your templates publicly
- Version tracking and changelogs
- Ratings and reviews
- Download counts
- Categories and tags

### Team Template Libraries
- Shared template storage (local network or cloud)
- Organization-level template management
- Role-based access controls
- Sync across team members
- Audit logging

### Git Integration for Templates
- Store templates in Git repository
- Version history for templates
- Branch-based template variants
- Pull updates from remote

---

## Advanced File Operations

### File Content Templates
Full templating engine for file contents:
```xml
<file name="README.md"><![CDATA[
# %PROJECT_NAME%

Created on %DATE%

## Installation

{{if USE_NPM}}
npm install
{{else}}
yarn install
{{endif}}

## Features
{{for feature in FEATURES}}
- {{feature}}
{{endfor}}
]]></file>
```

### Smart File Detection
- Analyze folder structure to suggest template type
- Detect frameworks (React, Vue, Django, etc.)
- Suggest relevant variables
- Auto-populate common patterns

### Binary File Generation
- Generate placeholder images with custom dimensions/colors
- Create empty SQLite databases with defined schema
- Generate sample data files (JSON, CSV)
- Create stub binary files for testing

### Structure Comparison
- Compare two folder structures visually
- Compare two templates side-by-side
- Highlight differences
- Merge capabilities

---

## Developer Features

### Plugin System
Custom file processors and hooks:
```javascript
// plugins/license-header.js
export default {
  name: 'license-header',
  fileTypes: ['.ts', '.js'],
  process(content, variables, filePath) {
    const header = `// Copyright ${variables.YEAR} ${variables.AUTHOR}\n// Licensed under MIT\n\n`;
    return header + content;
  }
};
```

Plugin capabilities:
- Custom file processors
- Variable transformers
- Schema validators
- Post-creation hooks
- UI extensions

### API/SDK
Expose functionality for programmatic use:
```typescript
import { StructureCreator } from 'structure-creator';

const creator = new StructureCreator();
const tree = await creator.parseSchema(xmlContent);
await creator.create(tree, '/output/path', { variables: { NAME: 'MyProject' } });
```

### Schema Validation
- Validate XML syntax before creation
- Check for undefined variable references
- Warn about duplicate names
- Detect circular template inheritance
- Validate URLs before download attempts

### Debug Mode
- Verbose logging of all operations
- Step-by-step execution with pauses
- Variable substitution visualization
- Performance timing for each operation

---

## Quality of Life

### Undo/Redo Operations
- Revert last created structure
- Multi-level undo history
- Confirmation for destructive undos
- Session-based history

### Favorites Bar
- Pin most-used templates to top bar
- Quick access with single click
- Drag to reorder
- Customizable slots

### Template Previews
- Thumbnail/icon preview of template structure
- Quick-view popup on hover
- Full preview modal
- Generated file count and stats

### Statistics Dashboard
- Templates created over time
- Most-used templates chart
- Total structures generated
- Files/folders created totals
- Usage trends

### Multi-Language Support (i18n)
- English (default)
- Spanish
- French
- German
- Japanese
- Chinese
- Community translations

### Custom Themes
- Theme editor/creator
- Import/export themes
- Community theme gallery
- Per-template color coding
- Syntax highlighting themes for XML

---

## Integration Features

### IDE Extensions

**VS Code Extension:**
- Create structures from command palette
- Right-click folder to scan as template
- Template browser sidebar
- Schema syntax highlighting
- IntelliSense for variables

**JetBrains Plugin:**
- Similar functionality for IntelliJ, WebStorm, etc.
- Project template integration
- Tool window for template management

### GitHub/GitLab Integration
- Create repository + structure in one action
- Use GitHub repo as template source
- Sync templates with GitHub Gists
- GitHub Actions integration

### Cloud Storage Integration
- Create structures directly in:
  - Dropbox
  - Google Drive
  - OneDrive
  - iCloud Drive
- Sync templates across devices

### Webhook Support
- Trigger creation via HTTP webhook
- Integration with automation tools (Zapier, n8n)
- Slack/Discord notifications on creation
- CI/CD pipeline triggers

---

## Contributing

Have a feature idea? Open an issue or pull request on GitHub!
