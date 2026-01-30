# Example Plugins

This directory contains example plugins for Structure Creator.

## Installation

To install a plugin, copy its folder to your plugins directory:

```bash
# macOS/Linux
cp -r examples/plugins/license-header ~/.structure-creator/plugins/

# Windows
xcopy examples\plugins\license-header %USERPROFILE%\.structure-creator\plugins\license-header /E /I
```

Or use the "Install Plugin" button in Settings > Plugins and select the plugin folder.

## Available Examples

### license-header

Adds a copyright/license header to source files during structure creation.

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.scss`

**Variables used:**
- `%YEAR%` - Current year (built-in, auto-populated)
- `%AUTHOR%` - Author name (add to your template variables)
- `%LICENSE%` - License type (defaults to "MIT")

**Example output:**
```typescript
/**
 * Copyright (c) 2024 John Doe
 * Licensed under the MIT License
 *
 * File: src/utils/helper.ts
 */

export function helper() {
  // ...
}
```

## Creating Your Own Plugin

1. Create a folder with your plugin name
2. Add a `plugin.json` manifest:
   ```json
   {
     "name": "my-plugin",
     "version": "1.0.0",
     "description": "What my plugin does",
     "capabilities": ["file-processor"],
     "fileTypes": [".ts", ".js"],
     "main": "index.js"
   }
   ```
3. Add an `index.js` with your plugin code:
   ```javascript
   export default {
     name: 'my-plugin',
     fileTypes: ['.ts', '.js'],
     process(content, context) {
       // Transform content here
       return content;
     }
   };
   ```

### Plugin Context

The `process` function receives a context object with:
- `filePath` - Relative path of the file being created
- `extension` - File extension (e.g., ".ts")
- `variables` - All template variables (e.g., `{ "%NAME%": "value" }`)
- `projectName` - The project name entered by the user
