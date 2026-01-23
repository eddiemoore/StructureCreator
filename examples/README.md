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
