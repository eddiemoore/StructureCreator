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
