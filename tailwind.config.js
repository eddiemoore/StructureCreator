/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "media", // Uses system preference
  theme: {
    extend: {
      colors: {
        // macOS Theme Colors - using CSS variables for automatic dark mode
        mac: {
          bg: "var(--color-bg)",
          "bg-secondary": "var(--color-bg-secondary)",
          "bg-tertiary": "var(--color-bg-tertiary)",
          "bg-hover": "var(--color-bg-hover)",
          sidebar: "var(--color-sidebar)",
        },
        // System Colors (Apple HIG) - consistent across themes
        system: {
          blue: "#0a84ff",
          "blue-dark": "#0071e3",
          green: "#34c759",
          red: "#ff3b30",
          orange: "#ff9500",
          yellow: "#ffcc00",
          gray: "#8e8e93",
        },
        // Text Colors - using CSS variables
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          placeholder: "var(--color-text-placeholder)",
        },
        // Border Colors - using CSS variables
        border: {
          DEFAULT: "var(--color-border-default)",
          muted: "var(--color-border-muted)",
          subtle: "var(--color-border-subtle)",
        },
        // Card background
        card: {
          bg: "var(--color-card-bg)",
        },
        // Accent color (configurable)
        accent: "var(--color-accent)",
      },
      fontFamily: {
        sans: [
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
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      fontSize: {
        // macOS Typography Scale
        "mac-xs": ["11px", { lineHeight: "13px" }],
        "mac-sm": ["12px", { lineHeight: "16px" }],
        "mac-base": ["13px", { lineHeight: "18px" }],
        "mac-lg": ["16px", { lineHeight: "21px" }],
        "mac-xl": ["20px", { lineHeight: "25px" }],
      },
      boxShadow: {
        // macOS-style shadows
        "mac-sm": "0 1px 2px rgba(0, 0, 0, 0.04)",
        mac: "0 2px 8px rgba(0, 0, 0, 0.08)",
        "mac-lg": "0 4px 16px rgba(0, 0, 0, 0.12)",
        "mac-xl": "0 20px 40px rgba(0, 0, 0, 0.15)",
        // Dark mode shadows
        "mac-sm-dark": "0 1px 2px rgba(0, 0, 0, 0.2)",
        "mac-dark": "0 2px 8px rgba(0, 0, 0, 0.3)",
        "mac-lg-dark": "0 4px 16px rgba(0, 0, 0, 0.4)",
      },
      borderRadius: {
        mac: "6px",
        "mac-lg": "10px",
      },
    },
  },
  plugins: [],
};
