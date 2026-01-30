import { Link, NavLink, Outlet, useLocation } from "react-router";

const sidebarNav = [
  {
    title: "Getting Started",
    items: [
      { to: "/docs/getting-started", label: "Introduction", end: true },
      { to: "/docs/getting-started/installation", label: "Installation" },
      { to: "/docs/getting-started/quick-start", label: "Quick Start" },
    ],
  },
  {
    title: "Guides",
    items: [
      { to: "/docs/guides/xml-schema", label: "XML Schema" },
      { to: "/docs/guides/variables", label: "Variables & Transforms" },
      { to: "/docs/guides/templates", label: "Templates" },
      { to: "/docs/guides/conditionals", label: "Conditionals & Loops" },
      { to: "/docs/guides/wizard", label: "Template Wizard" },
      { to: "/docs/guides/generators", label: "File Generators" },
      { to: "/docs/guides/binary-variables", label: "Binary File Variables" },
    ],
  },
  {
    title: "Plugins",
    items: [
      { to: "/docs/plugins", label: "Overview", end: true },
      { to: "/docs/plugins/creating-plugins", label: "Creating Plugins" },
      { to: "/docs/plugins/api", label: "API Reference" },
    ],
  },
  {
    title: "Reference",
    items: [
      { to: "/docs/api/schema", label: "Schema Reference" },
      { to: "/docs/api/transforms", label: "Transforms Reference" },
    ],
  },
];

export default function DocsLayout() {
  const location = useLocation();

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col lg:flex-row gap-8 py-8 lg:py-12">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-8">
            {sidebarNav.map((section) => (
              <div key={section.title}>
                <h4 className="mb-2 text-sm font-semibold text-foreground">{section.title}</h4>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          `block rounded-lg px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? "bg-accent/10 font-medium text-accent"
                              : "text-muted-foreground hover:bg-surface hover:text-foreground"
                          }`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Mobile nav */}
        <div className="mb-6 w-full lg:hidden">
          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-foreground">
              Documentation Menu
              <svg
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <nav className="border-t border-border px-4 py-3">
              {sidebarNav.map((section) => (
                <div key={section.title} className="mb-4">
                  <h4 className="mb-2 text-sm font-semibold text-foreground">{section.title}</h4>
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className={`block rounded-lg px-3 py-2 text-sm ${
                            location.pathname === item.to
                              ? "bg-accent/10 font-medium text-accent"
                              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </details>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <article className="prose prose-lg max-w-none">
            <Outlet />
          </article>
        </div>
      </div>
    </div>
  );
}
