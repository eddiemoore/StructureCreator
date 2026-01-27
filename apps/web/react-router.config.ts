import type { Config } from "@react-router/dev/config";

export default {
  // Enable SSR for dynamic pages
  ssr: true,

  // Prerender static pages at build time
  async prerender() {
    return [
      "/",
      "/docs",
      "/docs/getting-started",
      "/docs/getting-started/installation",
      "/docs/getting-started/quick-start",
      "/docs/guides",
      "/docs/guides/xml-schema",
      "/docs/guides/variables",
      "/docs/guides/templates",
      "/docs/guides/conditionals",
      "/docs/guides/wizard",
      "/docs/api/schema",
      "/docs/api/transforms",
      "/templates",
    ];
  },
} satisfies Config;
