import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

export default [
  // Shared layout with header/footer
  layout("routes/_layout.tsx", [
    // Home page
    index("routes/_index.tsx"),

    // Docs section with sidebar layout
    ...prefix("docs", [
      layout("routes/docs/_layout.tsx", [
        index("routes/docs/_index.tsx"),
        route("*", "routes/docs/$.tsx"),
      ]),
    ]),

    // Templates section
    ...prefix("templates", [
      index("routes/templates/_index.tsx"),
      route("submit", "routes/templates/submit.tsx"),
      route(":id", "routes/templates/$id.tsx"),
    ]),
  ]),

  // API routes (no layout)
  route("api/templates/submit", "routes/api/templates.submit.ts"),
  route("api/webhooks/github", "routes/api/webhooks.github.ts"),
] satisfies RouteConfig;
