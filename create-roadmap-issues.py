#!/usr/bin/env python3
"""
Script to create GitHub issues for Structure Creator roadmap items.
Usage: python3 create-roadmap-issues.py [GITHUB_TOKEN]

The GITHUB_TOKEN can be provided as:
1. Command-line argument
2. Environment variable: GITHUB_TOKEN
3. The script will prompt for it if not provided

To create a GitHub token:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a name like "Structure Creator Issues"
4. Select scope: "repo" (Full control of private repositories)
5. Click "Generate token" and copy the token
"""

import json
import os
import sys
import urllib.request
import urllib.error
from typing import Dict, List

REPO_OWNER = "eddiemoore"
REPO_NAME = "StructureCreator"

# All issues to create
ISSUES = [
    # High-Priority Features
    {
        "title": "Visual Schema Editor",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "CLI Interface",
        "body": """## Description
Create a command-line interface for Structure Creator to enable automation and CI/CD integration.

## Features
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

## Benefits
- Enables automation and scripting
- CI/CD pipeline integration
- Batch operations support
- Headless server usage

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "Conditional Logic in Schemas",
        "body": """## Description
Add if/else syntax to schemas for creating reusable templates that adapt based on variable values.

## Example
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

## Benefits
- More flexible and reusable templates
- Single template can handle multiple configurations
- Reduces template duplication

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "Template Import/Export",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Post-Creation Hooks",
        "body": """## Description
Allow running commands automatically after structure creation (e.g., npm install, git init, code .).

## Example
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

## Benefits
- Automates common setup tasks
- Reduces manual steps after creation
- Improves workflow efficiency
- Consistent project initialization

## Category
High-Priority Feature

## Related
See ROADMAP.md for additional context"""
    },

    # Schema & Template Enhancements
    {
        "title": "Repeater/Loop Syntax",
        "body": """## Description
Add loop/repeat functionality to generate multiple similar structures dynamically.

## Example
```xml
<repeat count="%NUM_MODULES%" as="i">
  <folder name="module_%i%">
    <file name="index.ts" />
  </folder>
</repeat>
```

## Benefits
- Generate multiple similar structures efficiently
- Dynamic structure creation based on variables
- Reduces repetitive XML writing

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "Variable Types & Transformations",
        "body": """## Description
Add support for variable transformations, types, and validation.

## Features
- Case transformations: `%NAME:uppercase%`, `%NAME:kebab-case%`, `%NAME:camelCase%`
- Date formatting: `%DATE:format(YYYY-MM-DD)%`
- Computed values: `%NAME:plural%`, `%NAME:length%`
- Validation rules: regex patterns, min/max length, required fields

## Benefits
- More powerful variable system
- Automatic name formatting
- Input validation
- Reduces manual text manipulation

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "Template Inheritance",
        "body": """## Description
Allow templates to extend other templates for better code reuse and modularity.

## Example
```xml
<template extends="base-react-app">
  <folder name="additional-feature">
    <file name="feature.ts" />
  </folder>
</template>
```

## Benefits
- Better template organization
- Reduced duplication
- Easier maintenance
- Modular template design

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "File Content Templates",
        "body": """## Description
Implement a full templating engine for file contents with conditional logic and loops.

## Example
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

## Benefits
- Dynamic file content generation
- Complex template logic in files
- Reduces need for post-processing
- More powerful file generation

## Category
Schema Enhancement

## Related
See ROADMAP.md for additional context"""
    },

    # User Experience Improvements
    {
        "title": "Diff Preview for Dry Run",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Template Search & Tags",
        "body": """## Description
Add comprehensive template search and tagging system.

## Features
- Full-text search across template names and descriptions
- Tagging system (e.g., "react", "python", "monorepo", "backend")
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Recent Projects History",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Keyboard Shortcuts",
        "body": """## Description
Add comprehensive keyboard shortcuts for common operations.

## Shortcuts
- `Cmd/Ctrl + Enter` - Create structure
- `Cmd/Ctrl + N` - New template
- `Cmd/Ctrl + O` - Open folder/file
- `Cmd/Ctrl + S` - Save current as template
- `Cmd/Ctrl + F` - Focus search
- `Escape` - Cancel/close modals
- Arrow keys - Navigate template list

## Benefits
- Faster workflow for power users
- Reduced mouse usage
- More efficient navigation
- Better accessibility

## Category
User Experience

## Related
See ROADMAP.md for additional context"""
    },
    {
        "title": "Template Previews",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },

    # Workflow & Automation
    {
        "title": "Watch Mode",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Batch Operations",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Template Wizards",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Schema Validation",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Debug Mode",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },

    # Collaboration & Sharing
    {
        "title": "Template Hub / Registry",
        "body": """## Description
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
**Requires**: Template Import/Export feature"""
    },
    {
        "title": "Team Template Libraries",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Git Integration for Templates",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "GitHub/GitLab Integration",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },

    # Advanced File Operations
    {
        "title": "Smart File Detection",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Binary File Generation",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Structure Comparison",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },

    # Developer Features
    {
        "title": "Plugin System",
        "body": """## Description
Create an extensible plugin system for custom functionality.

## Example
```javascript
// plugins/license-header.js
export default {
  name: 'license-header',
  fileTypes: ['.ts', '.js'],
  process(content, variables, filePath) {
    const header = `// Copyright ${variables.YEAR} ${variables.AUTHOR}\\n// Licensed under MIT\\n\\n`;
    return header + content;
  }
};
```

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
See ROADMAP.md for additional context"""
    },
    {
        "title": "API/SDK",
        "body": """## Description
Expose Structure Creator functionality as a library/SDK.

## Example
```typescript
import { StructureCreator } from 'structure-creator';

const creator = new StructureCreator();
const tree = await creator.parseSchema(xmlContent);
await creator.create(tree, '/output/path', {
  variables: { NAME: 'MyProject' }
});
```

## Benefits
- Programmatic usage
- Integration into other tools
- Custom automation
- Library ecosystem

## Category
Developer Features

## Related
See ROADMAP.md for additional context"""
    },

    # Quality of Life
    {
        "title": "Undo/Redo Operations",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Favorites Bar",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Statistics Dashboard",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Multi-Language Support (i18n)",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Custom Themes",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },

    # Integration Features
    {
        "title": "VS Code Extension",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "JetBrains Plugin",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Cloud Storage Integration",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    },
    {
        "title": "Webhook Support",
        "body": """## Description
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
See ROADMAP.md for additional context"""
    }
]


def get_github_token() -> str:
    """Get GitHub token from various sources."""
    # Check command-line argument
    if len(sys.argv) > 1:
        return sys.argv[1]

    # Check environment variable
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        return token

    # Prompt user
    print("\nGitHub Personal Access Token required.")
    print("Create one at: https://github.com/settings/tokens")
    print("Required scope: 'repo' (Full control of private repositories)\n")

    token = input("Enter your GitHub token: ").strip()
    if not token:
        print("Error: No token provided")
        sys.exit(1)

    return token


def check_and_create_label(token: str) -> None:
    """Check if 'feature' label exists, create if it doesn't."""
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/labels/feature"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json"
    }

    req = urllib.request.Request(url, headers=headers, method='GET')

    try:
        urllib.request.urlopen(req)
        print("✓ 'feature' label already exists")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # Label doesn't exist, create it
            create_url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/labels"
            data = json.dumps({
                "name": "feature",
                "description": "New feature or enhancement",
                "color": "0E8A16"
            }).encode('utf-8')

            create_req = urllib.request.Request(
                create_url,
                data=data,
                headers={**headers, "Content-Type": "application/json"},
                method='POST'
            )

            try:
                urllib.request.urlopen(create_req)
                print("✓ Created 'feature' label")
            except urllib.error.HTTPError as create_error:
                print(f"⚠ Warning: Could not create 'feature' label: {create_error}")
        else:
            print(f"⚠ Warning: Error checking for 'feature' label: {e}")


def create_issue(token: str, title: str, body: str) -> bool:
    """Create a single GitHub issue."""
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/issues"

    data = json.dumps({
        "title": title,
        "body": body,
        "labels": ["feature"]
    }).encode('utf-8')

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
    }

    req = urllib.request.Request(url, data=data, headers=headers, method='POST')

    try:
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))
        print(f"✓ Created: {title} (#{result['number']})")
        return True
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"✗ Failed to create: {title}")
        print(f"  Error: {e.code} - {error_body}")
        return False
    except Exception as e:
        print(f"✗ Failed to create: {title}")
        print(f"  Error: {str(e)}")
        return False


def main():
    """Main function to create all issues."""
    print("=" * 50)
    print("Structure Creator - Roadmap Issues Creator")
    print("=" * 50)
    print(f"\nRepository: {REPO_OWNER}/{REPO_NAME}")
    print(f"Total issues to create: {len(ISSUES)}\n")

    # Get GitHub token
    token = get_github_token()

    print("\nChecking repository access...")

    # Check and create feature label
    check_and_create_label(token)

    print(f"\nCreating {len(ISSUES)} issues...\n")

    # Create all issues
    success_count = 0
    failed_count = 0

    for i, issue in enumerate(ISSUES, 1):
        print(f"[{i}/{len(ISSUES)}] ", end="")
        if create_issue(token, issue["title"], issue["body"]):
            success_count += 1
        else:
            failed_count += 1

    # Summary
    print("\n" + "=" * 50)
    print("Summary:")
    print(f"  ✓ Successfully created: {success_count} issues")
    if failed_count > 0:
        print(f"  ✗ Failed: {failed_count} issues")
    print("=" * 50)

    print(f"\nView issues at: https://github.com/{REPO_OWNER}/{REPO_NAME}/issues")

    if failed_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
