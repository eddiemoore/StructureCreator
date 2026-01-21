#!/bin/bash

# Script to create GitHub issues for Structure Creator roadmap items
# Repository: eddiemoore/StructureCreator

set -e

REPO_OWNER="eddiemoore"
REPO_NAME="StructureCreator"

echo "Creating GitHub issues for Structure Creator roadmap..."
echo "Repository: $REPO_OWNER/$REPO_NAME"
echo ""

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed."
    echo "Please install it from: https://cli.github.com/"
    echo "Or run: sudo apt install gh"
    exit 1
fi

# Check authentication
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub."
    echo "Please run: gh auth login"
    exit 1
fi

# Ensure 'feature' label exists
echo "Checking for 'feature' label..."
if ! gh label list --repo "$REPO_OWNER/$REPO_NAME" | grep -q "^feature"; then
    echo "Creating 'feature' label..."
    gh label create feature --description "New feature or enhancement" --color "0E8A16" --repo "$REPO_OWNER/$REPO_NAME" || true
fi

echo ""
echo "Creating issues..."
echo ""

# High-Priority Features

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Visual Schema Editor" \
    --label "feature" \
    --body "## Description
Implement a drag-and-drop tree editor to build folder structures visually instead of writing XML manually.

## Features
- Drag-and-drop interface to build folder structures
- Add/remove/rename nodes without writing XML
- Right-click context menus for common actions
- Double-click to edit names inline
- Visual indicators for files vs folders
- Undo/redo for tree modifications

## Benefits
- Greatly improves usability for non-technical users
- Reduces errors from manual XML editing
- Speeds up template creation workflow

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Visual Schema Editor"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "CLI Interface" \
    --label "feature" \
    --body "## Description
Create a command-line interface for Structure Creator to enable automation and CI/CD integration.

## Features
\`\`\`bash
# Create from template
structure-creator create --template \"React App\" --output ./my-app --var NAME=MyProject

# Create from XML file
structure-creator create --schema ./schema.xml --output ./project

# List templates
structure-creator templates list

# Export template
structure-creator templates export \"React App\" --output ./react-app.sct

# Dry run
structure-creator create --template \"React App\" --output ./my-app --dry-run
\`\`\`

## Benefits
- Enables automation and scripting
- CI/CD pipeline integration
- Batch operations support
- Headless server usage

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"

echo "✓ Created: CLI Interface"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Conditional Logic in Schemas" \
    --label "feature" \
    --body "## Description
Add if/else syntax to schemas for creating reusable templates that adapt based on variable values.

## Example
\`\`\`xml
<folder name=\"src\">
  <if var=\"USE_TYPESCRIPT\">
    <file name=\"index.ts\" />
  </if>
  <else>
    <file name=\"index.js\" />
  </else>
</folder>
\`\`\`

## Benefits
- More flexible and reusable templates
- Single template can handle multiple configurations
- Reduces template duplication

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Conditional Logic in Schemas"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Import/Export" \
    --label "feature" \
    --body "## Description
Enable sharing templates as portable files, providing the foundation for a future template hub.

## Features
- Export templates as .sct files (structured JSON bundle)
- Import from local files
- Import from URLs
- Bulk import/export
- Include/exclude variables option

## Benefits
- Easy template sharing between users and teams
- Backup and restore templates
- Foundation for community template hub
- Version control for templates

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Template Import/Export"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Post-Creation Hooks" \
    --label "feature" \
    --body "## Description
Allow running commands automatically after structure creation (e.g., npm install, git init, code .).

## Example
\`\`\`xml
<schema>
  <folder name=\"my-project\">...</folder>
  <hooks>
    <post-create>npm install</post-create>
    <post-create>git init</post-create>
    <post-create>code .</post-create>
  </hooks>
</schema>
\`\`\`

## Benefits
- Automates common setup tasks
- Reduces manual steps after creation
- Improves workflow efficiency
- Consistent project initialization

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Post-Creation Hooks"

# Schema & Template Enhancements

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Repeater/Loop Syntax" \
    --label "feature" \
    --body "## Description
Add loop/repeat functionality to generate multiple similar structures dynamically.

## Example
\`\`\`xml
<repeat count=\"%NUM_MODULES%\" as=\"i\">
  <folder name=\"module_%i%\">
    <file name=\"index.ts\" />
  </folder>
</repeat>
\`\`\`

## Benefits
- Generate multiple similar structures efficiently
- Dynamic structure creation based on variables
- Reduces repetitive XML writing

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Repeater/Loop Syntax"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Variable Types & Transformations" \
    --label "feature" \
    --body "## Description
Add support for variable transformations, types, and validation.

## Features
- Case transformations: \`%NAME:uppercase%\`, \`%NAME:kebab-case%\`, \`%NAME:camelCase%\`
- Date formatting: \`%DATE:format(YYYY-MM-DD)%\`
- Computed values: \`%NAME:plural%\`, \`%NAME:length%\`
- Validation rules: regex patterns, min/max length, required fields

## Benefits
- More powerful variable system
- Automatic name formatting
- Input validation
- Reduces manual text manipulation

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Variable Types & Transformations"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Inheritance" \
    --label "feature" \
    --body "## Description
Allow templates to extend other templates for better code reuse and modularity.

## Example
\`\`\`xml
<template extends=\"base-react-app\">
  <folder name=\"additional-feature\">
    <file name=\"feature.ts\" />
  </folder>
</template>
\`\`\`

## Benefits
- Better template organization
- Reduced duplication
- Easier maintenance
- Modular template design

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Template Inheritance"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "File Content Templates" \
    --label "feature" \
    --body "## Description
Implement a full templating engine for file contents with conditional logic and loops.

## Example
\`\`\`xml
<file name=\"README.md\"><![CDATA[
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
\`\`\`

## Benefits
- Dynamic file content generation
- Complex template logic in files
- Reduces need for post-processing
- More powerful file generation

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"

echo "✓ Created: File Content Templates"

# User Experience Improvements

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Diff Preview for Dry Run" \
    --label "feature" \
    --body "## Description
Enhance dry run mode with visual comparison of planned changes vs existing files.

## Features
- Visual comparison of planned vs existing files
- Color coding: green (new), red (overwrite), yellow (skip)
- Expandable tree view showing all changes
- Summary statistics at top

## Benefits
- Better understanding of what will change
- Prevents accidental overwrites
- More confidence before execution
- Clear visualization of impact

## Category
User Experience

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Diff Preview for Dry Run"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Search & Tags" \
    --label "feature" \
    --body "## Description
Add comprehensive template search and tagging system.

## Features
- Full-text search across template names and descriptions
- Tagging system (e.g., \"react\", \"python\", \"monorepo\", \"backend\")
- Filter templates by tags
- Sort by name, date, usage, favorites

## Benefits
- Easy template discovery
- Better organization
- Quick finding of relevant templates
- Improved template management

## Category
User Experience

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Template Search & Tags"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Recent Projects History" \
    --label "feature" \
    --body "## Description
Track recently created structures for quick re-creation with modifications.

## Features
- Track last N created structures
- Quick re-create with same settings
- Edit variables and re-run
- Clear history option

## Benefits
- Faster iteration on templates
- Easy recreation of similar projects
- Improves workflow efficiency
- Reduces repetitive data entry

## Category
User Experience

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Recent Projects History"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Keyboard Shortcuts" \
    --label "feature" \
    --body "## Description
Add comprehensive keyboard shortcuts for common operations.

## Shortcuts
- \`Cmd/Ctrl + Enter\` - Create structure
- \`Cmd/Ctrl + N\` - New template
- \`Cmd/Ctrl + O\` - Open folder/file
- \`Cmd/Ctrl + S\` - Save current as template
- \`Cmd/Ctrl + F\` - Focus search
- \`Escape\` - Cancel/close modals
- Arrow keys - Navigate template list

## Benefits
- Faster workflow for power users
- Reduced mouse usage
- More efficient navigation
- Better accessibility

## Category
User Experience

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Keyboard Shortcuts"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Previews" \
    --label "feature" \
    --body "## Description
Add visual previews of templates before use.

## Features
- Thumbnail/icon preview of template structure
- Quick-view popup on hover
- Full preview modal
- Generated file count and stats

## Benefits
- Better understanding of templates before use
- Visual template browsing
- Faster template selection
- Improved user experience

## Category
User Experience

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Template Previews"

# Workflow & Automation

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Watch Mode" \
    --label "feature" \
    --body "## Description
Monitor schema files for changes and auto-recreate structures on save.

## Features
- Monitor schema file for changes
- Auto-recreate structure on save
- Useful for iterating on project templates
- Configurable debounce delay

## Benefits
- Faster template development iteration
- Real-time preview of changes
- Improved development workflow
- Reduced manual re-execution

## Category
Workflow & Automation

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Watch Mode"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Batch Operations" \
    --label "feature" \
    --body "## Description
Enable batch creation operations for multiple structures or locations.

## Features
- Create same structure in multiple locations
- Apply multiple templates sequentially
- Variable sets for different configurations
- Progress tracking for batch jobs

## Benefits
- Bulk project setup
- Consistent structure across multiple locations
- Time savings for large operations
- Better support for monorepos

## Category
Workflow & Automation

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Batch Operations"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Wizards" \
    --label "feature" \
    --body "## Description
Step-by-step guided template creation and configuration.

## Workflow
1. Choose base template type
2. Answer configuration questions
3. Preview generated schema
4. Customize if needed
5. Create structure

## Benefits
- Easier for new users
- Guided template selection
- Reduces errors
- Better onboarding experience

## Category
Workflow & Automation

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Template Wizards"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Schema Validation" \
    --label "feature" \
    --body "## Description
Comprehensive validation of schemas before execution.

## Features
- Validate XML syntax before creation
- Check for undefined variable references
- Warn about duplicate names
- Detect circular template inheritance
- Validate URLs before download attempts

## Benefits
- Catch errors early
- Better error messages
- Prevents failed executions
- Improved reliability

## Category
Workflow & Automation

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Schema Validation"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Debug Mode" \
    --label "feature" \
    --body "## Description
Add comprehensive debugging capabilities for troubleshooting.

## Features
- Verbose logging of all operations
- Step-by-step execution with pauses
- Variable substitution visualization
- Performance timing for each operation

## Benefits
- Easier troubleshooting
- Better understanding of execution
- Performance analysis
- Development debugging

## Category
Workflow & Automation

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Debug Mode"

# Collaboration & Sharing

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Template Hub / Registry" \
    --label "feature" \
    --body "## Description
Create a community hub for browsing and sharing templates.

## Features
- Browse community-created templates
- Publish templates publicly
- Version tracking and changelogs
- Ratings and reviews
- Download counts
- Categories and tags

## Benefits
- Community template ecosystem
- Easy template discovery
- Shared knowledge base
- Reduced duplicate work

## Category
Collaboration & Sharing

## Related
See ROADMAP.md for additional context
**Requires**: Template Import/Export feature"

echo "✓ Created: Template Hub / Registry"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Team Template Libraries" \
    --label "feature" \
    --body "## Description
Enable teams to share and manage templates collectively.

## Features
- Shared template storage (local network or cloud)
- Organization-level template management
- Role-based access controls
- Sync across team members
- Audit logging

## Benefits
- Team standardization
- Centralized template management
- Better collaboration
- Consistent project structures

## Category
Collaboration & Sharing

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Team Template Libraries"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Git Integration for Templates" \
    --label "feature" \
    --body "## Description
Store and version templates in Git repositories.

## Features
- Store templates in Git repository
- Version history for templates
- Branch-based template variants
- Pull updates from remote

## Benefits
- Version control for templates
- Easy collaboration through Git
- Backup and history
- Standard Git workflows

## Category
Collaboration & Sharing

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Git Integration for Templates"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "GitHub/GitLab Integration" \
    --label "feature" \
    --body "## Description
Deep integration with GitHub and GitLab platforms.

## Features
- Create repository + structure in one action
- Use GitHub repo as template source
- Sync templates with GitHub Gists
- GitHub Actions integration

## Benefits
- Streamlined repository creation
- Template hosting on GitHub
- Automated workflows
- Better developer experience

## Category
Collaboration & Sharing

## Related
See ROADMAP.md for additional context"

echo "✓ Created: GitHub/GitLab Integration"

# Advanced File Operations

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Smart File Detection" \
    --label "feature" \
    --body "## Description
Analyze folder structures to suggest template types and relevant variables.

## Features
- Analyze folder structure to suggest template type
- Detect frameworks (React, Vue, Django, etc.)
- Suggest relevant variables
- Auto-populate common patterns

## Benefits
- Intelligent template suggestions
- Faster template creation
- Framework-aware recommendations
- Reduced manual configuration

## Category
Advanced File Operations

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Smart File Detection"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Binary File Generation" \
    --label "feature" \
    --body "## Description
Generate various types of binary and data files.

## Features
- Generate placeholder images with custom dimensions/colors
- Create empty SQLite databases with defined schema
- Generate sample data files (JSON, CSV)
- Create stub binary files for testing

## Benefits
- Complete project scaffolding
- Test data generation
- Placeholder assets
- Full project setup automation

## Category
Advanced File Operations

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Binary File Generation"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Structure Comparison" \
    --label "feature" \
    --body "## Description
Compare folder structures and templates visually.

## Features
- Compare two folder structures visually
- Compare two templates side-by-side
- Highlight differences
- Merge capabilities

## Benefits
- Easy structure analysis
- Template comparison
- Migration planning
- Better understanding of changes

## Category
Advanced File Operations

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Structure Comparison"

# Developer Features

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Plugin System" \
    --label "feature" \
    --body "## Description
Create an extensible plugin system for custom functionality.

## Example
\`\`\`javascript
// plugins/license-header.js
export default {
  name: 'license-header',
  fileTypes: ['.ts', '.js'],
  process(content, variables, filePath) {
    const header = \`// Copyright \${variables.YEAR} \${variables.AUTHOR}\\n// Licensed under MIT\\n\\n\`;
    return header + content;
  }
};
\`\`\`

## Plugin Capabilities
- Custom file processors
- Variable transformers
- Schema validators
- Post-creation hooks
- UI extensions

## Benefits
- Extensible architecture
- Community plugins
- Custom workflows
- Integration possibilities

## Category
Developer Features

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Plugin System"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "API/SDK" \
    --label "feature" \
    --body "## Description
Expose Structure Creator functionality as a library/SDK.

## Example
\`\`\`typescript
import { StructureCreator } from 'structure-creator';

const creator = new StructureCreator();
const tree = await creator.parseSchema(xmlContent);
await creator.create(tree, '/output/path', {
  variables: { NAME: 'MyProject' }
});
\`\`\`

## Benefits
- Programmatic usage
- Integration into other tools
- Custom automation
- Library ecosystem

## Category
Developer Features

## Related
See ROADMAP.md for additional context"

echo "✓ Created: API/SDK"

# Quality of Life

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Undo/Redo Operations" \
    --label "feature" \
    --body "## Description
Add ability to undo/redo structure creation operations.

## Features
- Revert last created structure
- Multi-level undo history
- Confirmation for destructive undos
- Session-based history

## Benefits
- Safety net for mistakes
- Easier experimentation
- Confidence in operations
- Better user experience

## Category
Quality of Life

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Undo/Redo Operations"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Favorites Bar" \
    --label "feature" \
    --body "## Description
Pin frequently-used templates to a quick access favorites bar.

## Features
- Pin most-used templates to top bar
- Quick access with single click
- Drag to reorder
- Customizable slots

## Benefits
- Faster access to common templates
- Customizable workflow
- Improved efficiency
- Better organization

## Category
Quality of Life

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Favorites Bar"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Statistics Dashboard" \
    --label "feature" \
    --body "## Description
Track and display usage statistics and insights.

## Features
- Templates created over time
- Most-used templates chart
- Total structures generated
- Files/folders created totals
- Usage trends

## Benefits
- Usage insights
- Template popularity data
- Activity tracking
- Productivity metrics

## Category
Quality of Life

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Statistics Dashboard"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Multi-Language Support (i18n)" \
    --label "feature" \
    --body "## Description
Add internationalization support for multiple languages.

## Languages
- English (default)
- Spanish
- French
- German
- Japanese
- Chinese
- Community translations

## Benefits
- Global accessibility
- Wider user base
- Better user experience
- Community contributions

## Category
Quality of Life

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Multi-Language Support (i18n)"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Custom Themes" \
    --label "feature" \
    --body "## Description
Add customizable themes and color schemes.

## Features
- Theme editor/creator
- Import/export themes
- Community theme gallery
- Per-template color coding
- Syntax highlighting themes for XML

## Benefits
- Personalization
- Better aesthetics
- Accessibility (dark mode, high contrast)
- User preference support

## Category
Quality of Life

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Custom Themes"

# Integration Features

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "VS Code Extension" \
    --label "feature" \
    --body "## Description
Create a VS Code extension for Structure Creator.

## Features
- Create structures from command palette
- Right-click folder to scan as template
- Template browser sidebar
- Schema syntax highlighting
- IntelliSense for variables

## Benefits
- Seamless VS Code integration
- Better developer workflow
- IDE-native experience
- Increased adoption

## Category
Integration

## Related
See ROADMAP.md for additional context"

echo "✓ Created: VS Code Extension"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "JetBrains Plugin" \
    --label "feature" \
    --body "## Description
Create plugins for JetBrains IDEs (IntelliJ, WebStorm, PyCharm, etc.).

## Features
- Similar functionality to VS Code extension
- Project template integration
- Tool window for template management
- IDE-specific optimizations

## Benefits
- JetBrains IDE support
- Wider IDE coverage
- Better developer experience
- Increased adoption

## Category
Integration

## Related
See ROADMAP.md for additional context"

echo "✓ Created: JetBrains Plugin"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Cloud Storage Integration" \
    --label "feature" \
    --body "## Description
Enable creating structures directly in cloud storage services.

## Supported Services
- Dropbox
- Google Drive
- OneDrive
- iCloud Drive

## Features
- Create structures directly in cloud storage
- Sync templates across devices
- Cloud-based template libraries
- Cross-platform synchronization

## Benefits
- Cloud workflow support
- Device synchronization
- Remote structure creation
- Backup capabilities

## Category
Integration

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Cloud Storage Integration"

gh issue create --repo "$REPO_OWNER/$REPO_NAME" \
    --title "Webhook Support" \
    --label "feature" \
    --body "## Description
Add webhook support for remote triggering and integrations.

## Features
- Trigger creation via HTTP webhook
- Integration with automation tools (Zapier, n8n)
- Slack/Discord notifications on creation
- CI/CD pipeline triggers

## Benefits
- Automation integrations
- Event-driven workflows
- Team notifications
- External tool integration

## Category
Integration

## Related
See ROADMAP.md for additional context"

echo "✓ Created: Webhook Support"

echo ""
echo "========================================="
echo "✅ Successfully created all roadmap issues!"
echo "========================================="
echo ""
echo "Summary:"
echo "- High-Priority Features: 5 issues"
echo "- Schema & Template Enhancements: 4 issues"
echo "- User Experience: 5 issues"
echo "- Workflow & Automation: 5 issues"
echo "- Collaboration & Sharing: 4 issues"
echo "- Advanced File Operations: 3 issues"
echo "- Developer Features: 2 issues"
echo "- Quality of Life: 5 issues"
echo "- Integration Features: 4 issues"
echo ""
echo "Total: 37 issues created with 'feature' label"
echo ""
echo "View issues at: https://github.com/$REPO_OWNER/$REPO_NAME/issues"
