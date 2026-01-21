# Creating GitHub Issues from Roadmap

This directory contains scripts to automatically create GitHub issues for all features listed in ROADMAP.md.

## Overview

37 GitHub issues will be created, organized into these categories:
- **High-Priority Features** (5 issues)
- **Schema & Template Enhancements** (4 issues)
- **User Experience** (5 issues)
- **Workflow & Automation** (5 issues)
- **Collaboration & Sharing** (4 issues)
- **Advanced File Operations** (3 issues)
- **Developer Features** (2 issues)
- **Quality of Life** (5 issues)
- **Integration Features** (4 issues)

All issues will be labeled with the `feature` label to distinguish them from bugs.

## Method 1: Python Script (Recommended)

### Prerequisites
- Python 3.x installed
- GitHub Personal Access Token

### Steps

1. **Create a GitHub Personal Access Token:**
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Give it a descriptive name like "Structure Creator Issues"
   - Select scope: `repo` (Full control of private repositories)
   - Click "Generate token" and **copy the token**

2. **Run the script:**

   ```bash
   # Option A: Provide token as environment variable
   export GITHUB_TOKEN="your_token_here"
   python3 create-roadmap-issues.py

   # Option B: Provide token as command-line argument
   python3 create-roadmap-issues.py "your_token_here"

   # Option C: Script will prompt you for the token
   python3 create-roadmap-issues.py
   ```

3. **Verify:**
   - The script will show progress as it creates each issue
   - Check https://github.com/eddiemoore/StructureCreator/issues when complete

## Method 2: Bash Script (Requires GitHub CLI)

### Prerequisites
- GitHub CLI (`gh`) installed
- GitHub CLI authenticated

### Steps

1. **Install GitHub CLI** (if not already installed):
   ```bash
   # Ubuntu/Debian
   sudo apt install gh

   # macOS
   brew install gh

   # Or download from: https://cli.github.com/
   ```

2. **Authenticate:**
   ```bash
   gh auth login
   ```

3. **Run the script:**
   ```bash
   ./create-roadmap-issues.sh
   ```

4. **Verify:**
   - Check https://github.com/eddiemoore/StructureCreator/issues

## What Gets Created

Each issue includes:
- **Title**: Clear, descriptive feature name
- **Description**: Detailed explanation with:
  - Overview of the feature
  - Key features or examples
  - Benefits and use cases
  - Category classification
  - Reference to ROADMAP.md
- **Label**: `feature` label (created automatically if it doesn't exist)

## Example Issue

**Title:** Visual Schema Editor

**Body:**
```markdown
## Description
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
See ROADMAP.md for additional context
```

## Troubleshooting

### Python Script Issues

**Problem:** `urllib.error.HTTPError: HTTP Error 401: Unauthorized`
- **Solution:** Your GitHub token is invalid or expired. Generate a new token and try again.

**Problem:** `urllib.error.HTTPError: HTTP Error 403: Forbidden`
- **Solution:** Your token doesn't have the `repo` scope. Create a new token with the correct permissions.

**Problem:** `urllib.error.HTTPError: HTTP Error 422: Unprocessable Entity`
- **Solution:** The issue might already exist with the same title. Check existing issues first.

### Bash Script Issues

**Problem:** `gh: command not found`
- **Solution:** Install GitHub CLI: https://cli.github.com/

**Problem:** `gh: Not authenticated`
- **Solution:** Run `gh auth login` and follow the prompts.

## Manual Creation

If you prefer to create issues manually, refer to ROADMAP.md and follow this template:

1. Go to https://github.com/eddiemoore/StructureCreator/issues/new
2. Use the feature name as the title
3. Copy the relevant section from ROADMAP.md as the description
4. Add the `feature` label
5. Click "Submit new issue"

## Script Files

- **create-roadmap-issues.py**: Python script using GitHub API (recommended)
- **create-roadmap-issues.sh**: Bash script using GitHub CLI
- **ROADMAP.md**: Source document with all feature descriptions
- **CREATE_ISSUES_README.md**: This file

## Notes

- The scripts are idempotent - if an issue with the same title exists, it will fail gracefully
- The `feature` label will be created automatically if it doesn't exist (green color, #0E8A16)
- All issues are created without assignees or milestones (you can add these later)
- Issues are created in the order they appear in the roadmap

## Next Steps

After creating the issues:
1. Review each issue for accuracy
2. Add appropriate milestones (e.g., "v1.0", "v2.0")
3. Assign issues to team members
4. Prioritize issues using labels or project boards
5. Close this task on your project board

## Support

If you encounter any problems:
1. Check the troubleshooting section above
2. Verify your GitHub token has the correct permissions
3. Ensure you have internet connectivity
4. Try running the script with verbose output enabled

For more information, see:
- GitHub API: https://docs.github.com/en/rest
- GitHub CLI: https://cli.github.com/manual/
