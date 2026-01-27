/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        surface: {
          DEFAULT: "var(--color-surface)",
          secondary: "var(--color-surface-secondary)",
          hover: "var(--color-surface-hover)",
        },
        muted: {
          DEFAULT: "var(--color-muted)",
          foreground: "var(--color-muted-foreground)",
        },
        placeholder: "var(--color-placeholder)",
        border: {
          DEFAULT: "var(--color-border)",
          muted: "var(--color-border-muted)",
          subtle: "var(--color-border-subtle)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-foreground)",
        },
        success: "var(--color-success)",
        error: "var(--color-error)",
        warning: "var(--color-warning)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "SF Mono",
          "Monaco",
          "Inconsolata",
          "Fira Code",
          "Fira Mono",
          "Roboto Mono",
          "monospace",
        ],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "none",
            color: "var(--color-muted-foreground)",
            a: {
              color: "var(--color-accent)",
              "&:hover": {
                color: "var(--color-accent)",
              },
            },
            h1: {
              color: "var(--color-foreground)",
            },
            h2: {
              color: "var(--color-foreground)",
            },
            h3: {
              color: "var(--color-foreground)",
            },
            h4: {
              color: "var(--color-foreground)",
            },
            code: {
              color: "var(--color-foreground)",
              backgroundColor: "var(--color-surface)",
              borderRadius: "0.25rem",
              padding: "0.125rem 0.25rem",
            },
            "code::before": {
              content: '""',
            },
            "code::after": {
              content: '""',
            },
            pre: {
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            },
            strong: {
              color: "var(--color-foreground)",
            },
            blockquote: {
              color: "var(--color-muted-foreground)",
              borderLeftColor: "var(--color-border)",
            },
            hr: {
              borderColor: "var(--color-border)",
            },
            "ul > li::marker": {
              color: "var(--color-muted)",
            },
            "ol > li::marker": {
              color: "var(--color-muted)",
            },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
