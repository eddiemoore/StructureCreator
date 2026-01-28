import { Link } from "react-router";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Structure Creator - Generate folder structures with templates" },
    {
      name: "description",
      content:
        "Create consistent folder structures and document templates in seconds. Perfect for client projects, development workflows, and standardized file organization.",
    },
  ];
}

const features = [
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
      </svg>
    ),
    title: "Any File Type",
    description: "Create folders and files of any type—documents, spreadsheets, images, code, and more. Include content or download from URLs.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    title: "Smart Placeholders",
    description: "Use variables like %CLIENT_NAME% or %DATE% that get filled in automatically. Transform text to different formats instantly.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    title: "Reusable Templates",
    description: "Save your folder structures as templates. Share with colleagues or use community templates to get started faster.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
    title: "Setup Wizards",
    description: "Create step-by-step wizards that guide users through options. Perfect for onboarding or complex project setups.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: "Preview First",
    description: "See exactly what will be created before committing. Visual tree preview shows the complete folder structure.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
      </svg>
    ),
    title: "Import Existing",
    description: "Turn any existing folder or ZIP file into a template. Scan a project structure and save it for reuse.",
  },
];

function CodeWindow() {
  return (
    <div className="window-chrome rounded-xl overflow-hidden animate-scale-in opacity-0 delay-300">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          <div className="traffic-light-red h-3 w-3 rounded-full" />
          <div className="traffic-light-yellow h-3 w-3 rounded-full" />
          <div className="traffic-light-green h-3 w-3 rounded-full" />
        </div>
        <div className="flex-1 text-center">
          <span className="text-xs text-muted-foreground font-medium">schema.xml</span>
        </div>
        <div className="w-14" /> {/* Spacer for symmetry */}
      </div>

      {/* Code content */}
      <div className="p-5 code-window overflow-x-auto">
        <pre className="text-[13px] leading-relaxed">
          <code>
            <span className="xml-tag">&lt;folder</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"</span>
            <span className="xml-variable">%PROJECT_NAME%</span>
            <span className="xml-string">"</span>
            <span className="xml-tag">&gt;</span>{"\n"}
            {"  "}<span className="xml-tag">&lt;folder</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"src"</span>
            <span className="xml-tag">&gt;</span>{"\n"}
            {"    "}<span className="xml-tag">&lt;folder</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"components"</span>
            <span className="xml-tag">&gt;</span>{"\n"}
            {"      "}<span className="xml-tag">&lt;file</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"</span>
            <span className="xml-variable">%COMPONENT_NAME%</span>
            <span className="xml-string">.tsx"</span>
            <span className="xml-tag"> /&gt;</span>{"\n"}
            {"      "}<span className="xml-tag">&lt;file</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"</span>
            <span className="xml-variable">%COMPONENT_NAME%</span>
            <span className="xml-string">.css"</span>
            <span className="xml-tag"> /&gt;</span>{"\n"}
            {"    "}<span className="xml-tag">&lt;/folder&gt;</span>{"\n"}
            {"    "}<span className="xml-tag">&lt;file</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"index.ts"</span>
            <span className="xml-tag"> /&gt;</span>{"\n"}
            {"  "}<span className="xml-tag">&lt;/folder&gt;</span>{"\n"}
            {"  "}<span className="xml-tag">&lt;file</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"package.json"</span>{" "}
            <span className="xml-attr">url</span>=<span className="xml-string">"https://..."</span>
            <span className="xml-tag"> /&gt;</span>{"\n"}
            {"  "}<span className="xml-tag">&lt;file</span>{" "}
            <span className="xml-attr">name</span>=<span className="xml-string">"README.md"</span>
            <span className="xml-tag">&gt;</span>{"\n"}
            <span className="xml-content">{"# "}</span>
            <span className="xml-variable">%PROJECT_NAME%</span>{"\n"}
            <span className="xml-content">{"\nA new project created with Structure Creator."}</span>{"\n"}
            {"  "}<span className="xml-tag">&lt;/file&gt;</span>{"\n"}
            <span className="xml-tag">&lt;/folder&gt;</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative min-h-[calc(100vh-4rem)] sm:min-h-[90vh] flex items-center overflow-x-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 -z-10">
          <div className="gradient-mesh absolute inset-0" />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] gradient-radial animate-glow-pulse" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-24 lg:py-32 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Left: Text content */}
            <div className="text-center lg:text-left">
              <div className="animate-fade-down opacity-0 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-1.5 text-sm text-muted-foreground mb-8 border border-border">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                Now available for macOS
              </div>

              <h1 className="animate-fade-up opacity-0 text-3xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1]">
                Create folder{" "}
                <br className="hidden sm:block" />
                structures{" "}
                <br className="hidden sm:block" />
                <span className="text-gradient whitespace-nowrap">in seconds</span>
              </h1>

              <p className="animate-fade-up opacity-0 delay-100 mt-6 text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Set up new projects, client folders, or document templates instantly.
                Define once, reuse forever—with smart placeholders that fill in the details.
              </p>

              <div className="animate-fade-up opacity-0 delay-200 mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
                <a
                  href="https://github.com/eddiemoore/structurecreator/releases"
                  className="btn btn-primary btn-glow px-8 py-3.5 text-base font-medium rounded-xl inline-flex items-center gap-2 group"
                >
                  <AppleIcon />
                  <span>Download for macOS</span>
                  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </a>
                <a
                  href="/app?action=new"
                  className="btn btn-ghost px-6 py-3 text-base font-medium rounded-xl inline-flex items-center gap-2 group"
                >
                  <span>Try online</span>
                  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Right: Code window */}
            <div className="relative lg:pl-8 hidden sm:block">
              <div className="animate-float">
                <CodeWindow />
              </div>
              {/* Decorative glow behind window */}
              <div className="absolute -inset-4 -z-10 gradient-radial opacity-40" />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-24 sm:py-32">
        <div className="section-divider mb-24" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Everything you need
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Whether you're starting client projects, organizing documents, or scaffolding code—Structure Creator keeps everything consistent.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <div
                key={feature.title}
                className="feature-card opacity-0 animate-fade-up"
                style={{ animationDelay: `${150 + i * 75}ms` }}
              >
                <div className="feature-icon mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-[15px] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="relative py-24 sm:py-32">
        <div className="section-divider mb-24" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Built for everyone
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From freelancers to enterprise teams, Structure Creator adapts to your workflow.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
              <div className="text-2xl mb-4">📁</div>
              <h3 className="text-lg font-semibold mb-2">Client Projects</h3>
              <p className="text-muted-foreground text-[15px] leading-relaxed">
                Create standardized folder structures for each client with pre-filled contracts, briefs, and deliverable folders.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
              <div className="text-2xl mb-4">📝</div>
              <h3 className="text-lg font-semibold mb-2">Document Templates</h3>
              <p className="text-muted-foreground text-[15px] leading-relaxed">
                Generate reports, proposals, or documentation with placeholders that auto-fill with names, dates, and project details.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
              <div className="text-2xl mb-4">💻</div>
              <h3 className="text-lg font-semibold mb-2">Development Teams</h3>
              <p className="text-muted-foreground text-[15px] leading-relaxed">
                Scaffold new projects, components, or modules with consistent structure. Run setup scripts automatically after creation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 sm:py-32">
        <div className="section-divider mb-24" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl">
            {/* Background */}
            <div className="absolute inset-0 bg-surface" />
            <div className="absolute inset-0 gradient-mesh opacity-50" />

            {/* Content */}
            <div className="relative px-5 py-12 sm:px-16 sm:py-24 text-center">
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-xl mx-auto">
                Stop creating folders manually
              </h2>
              <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
                Download Structure Creator and set up your next project, client folder, or document template in seconds.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center">
                <a
                  href="https://github.com/eddiemoore/structurecreator/releases"
                  className="btn btn-primary btn-glow px-8 py-3.5 text-base font-medium rounded-xl inline-flex items-center gap-2 group"
                >
                  <AppleIcon />
                  <span>Download for macOS</span>
                </a>
                <a
                  href="/app?action=new"
                  className="btn btn-secondary px-8 py-3.5 text-base font-medium rounded-xl"
                >
                  Try Online
                </a>
              </div>

              {/* Stats */}
              <div className="mt-16 grid grid-cols-3 gap-4 sm:gap-8 max-w-lg mx-auto">
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold text-gradient">Open</div>
                  <div className="mt-1 text-sm text-muted-foreground">Source</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold text-gradient">Native</div>
                  <div className="mt-1 text-sm text-muted-foreground">macOS App</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold text-gradient">Fast</div>
                  <div className="mt-1 text-sm text-muted-foreground">Rust Backend</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
