/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          deep: "#0a0e14",
          primary: "#0d1117",
          secondary: "#161b22",
          tertiary: "#1c2128",
          elevated: "#21262d",
        },
        cyan: {
          dim: "#1a4a5c",
          muted: "#2d6a7a",
          primary: "#22d3ee",
          bright: "#67e8f9",
          glow: "rgba(34, 211, 238, 0.15)",
        },
        border: {
          default: "#30363d",
          muted: "#21262d",
        },
        text: {
          primary: "#e6edf3",
          secondary: "#8b949e",
          muted: "#6e7681",
        },
      },
      fontFamily: {
        sans: ["Outfit", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
