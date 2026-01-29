# Example Schemas

This directory contains example XML schema files for Structure Creator.

## Files

### conditional-schema.xml

Demonstrates conditional logic with `<if>` and `<else>` blocks. Use variables to control which files and folders are created:

```xml
<if var="USE_TYPESCRIPT">
  <file name="index.ts" />
</if>
<else>
  <file name="index.js" />
</else>
```

Set the variable `USE_TYPESCRIPT` to `true` or `false` in the Variables panel to toggle between TypeScript and JavaScript files.

### repeat-schema.xml

Demonstrates the repeat/loop syntax for generating multiple structures dynamically:

```xml
<repeat count="%NUM_MODULES%" as="i">
  <folder name="module_%i%">
    <file name="index.ts" />
  </folder>
</repeat>
```

Use `%i%` for 0-based index or `%i_1%` for 1-based index inside the loop.

### transforms-schema.xml

Demonstrates variable transformations for case conversion, pluralization, and date formatting:

```xml
<!-- Case transformations -->
<file name="%COMPONENT_NAME:PascalCase%.tsx" />
<file name="%COMPONENT_NAME:kebab-case%.css" />
<file name="%UTILITY_NAME:camelCase%.ts" />
<file name="%MODEL_NAME:snake_case%.rs" />

<!-- Pluralization -->
<folder name="%MODEL_NAME:plural%">  <!-- user → users -->

<!-- Date formatting -->
<file name="CHANGELOG-%DATE:format(YYYY-MM-DD)%.md" />

<!-- Length (character count) -->
<file name="config.json">%PROJECT_NAME:length%</file>
```

**Available transformations:**

| Transform | Example | Result |
|-----------|---------|--------|
| `uppercase` | `%NAME:uppercase%` | `HELLO WORLD` |
| `lowercase` | `%NAME:lowercase%` | `hello world` |
| `camelCase` | `%NAME:camelCase%` | `helloWorld` |
| `PascalCase` | `%NAME:PascalCase%` | `HelloWorld` |
| `kebab-case` | `%NAME:kebab-case%` | `hello-world` |
| `snake_case` | `%NAME:snake_case%` | `hello_world` |
| `plural` | `%NAME:plural%` | `cats`, `boxes`, `children` |
| `length` | `%NAME:length%` | `5` |

**Date format tokens:**

| Token | Example | Description |
|-------|---------|-------------|
| `YYYY` | `2024` | 4-digit year |
| `YY` | `24` | 2-digit year |
| `MMMM` | `January` | Full month name |
| `MMM` | `Jan` | Short month name |
| `MM` | `01` | 2-digit month |
| `DD` | `05` | 2-digit day |
| `D` | `5` | Day without padding |

**Suggested variables for this example:**

- `PROJECT_NAME`: `my awesome project`
- `COMPONENT_NAME`: `user profile`
- `UTILITY_NAME`: `format date`
- `MODEL_NAME`: `category`
- `DATE`: `today` (or a date like `2024-01-15`)

### inheritance-schema.xml

Demonstrates template inheritance using the `extends` attribute. Templates can extend other saved templates to reduce duplication:

```xml
<template extends="base-react-app">
  <folder name="features">
    <file name="feature.ts" />
  </folder>
</template>
```

**How it works:**

1. Create and save a base template (e.g., "base-react-app") with common structure
2. Create a new template that uses `<template extends="base-react-app">`
3. Add only the additional folders/files specific to this variant
4. When loaded, the base template's content is merged with the extension

**Features:**

- **Multiple inheritance**: Extend multiple templates with comma separation: `extends="base1, base2"`
- **Variable inheritance**: Variables from base templates are inherited (child values override base)
- **Validation inheritance**: Validation rules are inherited and merged (later templates override earlier)
- **Hooks inheritance**: Post-create hooks from base templates run first, then child hooks
- **Nested inheritance**: Base templates can themselves extend other templates

**Multiple inheritance merge order:**

When extending multiple templates (`extends="base1, base2"`), they are merged left-to-right:
- `base1` is resolved first, then `base2`'s children are appended
- Variables from `base2` override variables from `base1`
- Validation rules from `base2` completely replace rules from `base1` for the same variable

**Diamond inheritance note:**

If template C extends both A and B, and both A and B extend D, then D's content will appear **twice** in the final result (once via A, once via B). This is by design - use single inheritance chains if you need to avoid duplication.

**Example base template** (save as "base-react-app"):

```xml
<folder name="%PROJECT%">
  <file name="package.json" />
  <file name="README.md" />
  <folder name="src">
    <file name="index.tsx" />
    <file name="App.tsx" />
  </folder>
</folder>
```

**Extending template:**

```xml
<template extends="base-react-app">
  <folder name="tests">
    <file name="App.test.tsx" />
  </folder>
  <file name=".gitignore" />
</template>
```

**Result after merge:**

```
%PROJECT%/
├── package.json      (from base)
├── README.md         (from base)
├── src/              (from base)
│   ├── index.tsx
│   └── App.tsx
├── tests/            (from extension)
│   └── App.test.tsx
└── .gitignore        (from extension)
```

### binary-generators.xml

Demonstrates the `generate` attribute for creating binary files:

#### Image Generation

Create placeholder PNG and JPEG images with custom dimensions and colors:

```xml
<!-- Simple placeholder (100x100 gray PNG) -->
<file name="placeholder.png" generate="image" />

<!-- Custom size and color -->
<file name="logo.png" generate="image" width="200" height="200" background="#3B82F6" />

<!-- JPEG format -->
<file name="banner.jpg" generate="image" width="1920" height="600" background="#1F2937" />

<!-- Using variables -->
<file name="avatar.png" generate="image" width="%SIZE%" height="%SIZE%" background="%COLOR%" />
```

**Image attributes:**

| Attribute | Default | Description |
|-----------|---------|-------------|
| `width` | 100 | Width in pixels (max 10000) |
| `height` | 100 | Height in pixels (max 10000) |
| `background` | #CCCCCC | Hex color (#RGB or #RRGGBB) |
| `format` | auto | `png` or `jpeg` (auto-detected from extension) |

#### SQLite Database Generation

Create SQLite databases with raw SQL:

```xml
<file name="app.db" generate="sqlite"><![CDATA[
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO users (email) VALUES ('%ADMIN_EMAIL%');
]]></file>
```

Variables (`%VAR_NAME%`) are substituted in SQL before execution.

**Suggested variables for this example:**

- `PROJECT_NAME`: `my-app`
- `VERSION`: `1.0.0`
- `AVATAR_SIZE`: `64`
- `BRAND_COLOR`: `#3B82F6`

### file-content-templating.xml

Demonstrates `{{if}}/{{for}}` template directives within file content. This is opt-in via the `template="true"` attribute to avoid conflicts with Handlebars/Mustache files.

#### Conditional Content

```xml
<file name="README.md" template="true"><![CDATA[
{{if USE_NPM}}
npm install
{{else}}
yarn install
{{endif}}
]]></file>
```

#### Loop Content

```xml
<file name="features.md" template="true"><![CDATA[
## Features

{{for feature in FEATURES}}
- {{feature}}
{{endfor}}
]]></file>
```

Set `FEATURES=auth,api,database` to generate a bullet list of features.

#### Preserving Handlebars/Mustache Syntax

Files **without** `template="true"` preserve `{{}}` syntax as-is:

```xml
<!-- This Handlebars template is NOT processed -->
<file name="layout.hbs"><![CDATA[
{{> header}}
<main>{{{body}}}</main>
{{> footer}}
]]></file>
```

#### Key Differences: Structure vs Content Conditionals

| Feature | `<if var="X">` (XML) | `{{if X}}` (Content) |
|---------|---------------------|----------------------|
| Controls | Which files/folders are created | Content within a file |
| Syntax location | XML element | Inside file content |
| Opt-in | Always available | Requires `template="true"` |

**Example combining both:**

```xml
<!-- File is only created if INCLUDE_TESTS is truthy -->
<if var="INCLUDE_TESTS">
  <file name="test-setup.ts" template="true"><![CDATA[
// Test setup
{{if USE_NPM}}
// Using npm
{{else}}
// Using yarn
{{endif}}
]]></file>
</if>
```

**Truthiness rules for `{{if VAR}}`:**

A variable is **truthy** if it:
- Exists (is defined)
- Is not empty
- Is not `"false"` (case-insensitive)
- Is not `"0"`

**Suggested variables for this example:**

- `PROJECT_NAME`: `my-app`
- `AUTHOR`: `Your Name`
- `USE_NPM`: `true` or `false`
- `INCLUDE_TESTS`: `true` or `false`
- `FEATURES`: `auth,api,database`
