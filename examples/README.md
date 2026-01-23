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
