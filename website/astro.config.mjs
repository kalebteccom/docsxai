// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import rehypeStripAgentAsides from "./plugins/rehype-strip-agent-asides.mjs";

// The docsxai documentation site, served at docsxai.dev.
// Static Astro + Starlight. The published content lives in
// src/content/docs/; internal working docs stay in the repo's docs/ tree
// and never ship here.
export default defineConfig({
  site: "https://docsxai.dev",
  trailingSlash: "always",
  // Remove "For agents" asides from the rendered HTML. The same guidance stays
  // in the page source and is served from the plaintext .md endpoint, so the
  // human site stays end-user-focused while agents still get it via llms.txt.
  markdown: {
    rehypePlugins: [rehypeStripAgentAsides],
  },
  integrations: [
    starlight({
      title: "docsxai",
      description:
        "Deterministic screenshot docs for web apps. Write a flow once and docsxai walks your app, captures annotated screenshots, and replays it forever - agent-free, in CI.",
      // Fail the build on broken internal links or heading anchors, so dead
      // links can never ship. This is the build-time "error boundary" for a
      // static docs site.
      plugins: [starlightLinksValidator()],
      // The branded 404 lives at src/content/docs/404.mdx and renders through
      // the docs catch-all route. Starlight's own injected /404 route would
      // collide with it (an Astro route-conflict warning on every build), so
      // it's disabled — the content entry is the single source of the page.
      disable404Route: true,
      logo: {
        src: "./src/assets/docsxai-tile.svg",
      },
      components: {
        Footer: "./src/components/Footer.astro",
        Sidebar: "./src/components/Sidebar.astro",
      },
      favicon: "/favicon.svg",
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://docsxai.dev/og.png" } },
        { tag: "meta", attrs: { property: "og:image:type", content: "image/png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "docsxai - deterministic screenshot docs" },
        },
        { tag: "meta", attrs: { property: "og:site_name", content: "docsxai" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://docsxai.dev/og.png" } },
        {
          tag: "meta",
          attrs: { name: "twitter:image:alt", content: "docsxai - deterministic screenshot docs" },
        },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        {
          tag: "meta",
          attrs: { name: "theme-color", content: "#140d04", media: "(prefers-color-scheme: dark)" },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: "#fdfaf3",
            media: "(prefers-color-scheme: light)",
          },
        },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "docsxai",
            description:
              "Deterministic documentation engine: walks a web app, follows written flows, and emits screenshot-rich user docs that replay agent-free in CI.",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Node.js (>=20)",
            url: "https://docsxai.dev",
            license: "https://www.apache.org/licenses/LICENSE-2.0",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            author: { "@type": "Organization", name: "Kalebtec", url: "https://kalebtec.com" },
            sameAs: ["https://github.com/kalebteccom/docsxai"],
          }),
        },
        { tag: "link", attrs: { rel: "icon", href: "/favicon.ico", sizes: "any" } },
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
        },
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
        },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/kalebteccom/docsxai",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/kalebteccom/docsxai/edit/main/website/",
      },
      customCss: [
        "@fontsource/poppins/500.css",
        "@fontsource/poppins/600.css",
        "@fontsource/poppins/700.css",
        "@fontsource/inter/400.css",
        "@fontsource/inter/500.css",
        "@fontsource/inter/600.css",
        "@fontsource/jetbrains-mono/400.css",
        "@fontsource/jetbrains-mono/500.css",
        "./src/styles/brand.css",
      ],
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        styleOverrides: {
          borderRadius: "0.5rem",
          borderColor: "var(--docsx-code-border)",
          codeFontFamily: "var(--docsx-font-mono)",
        },
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Architecture", slug: "concepts/architecture" },
            { label: "The doc pack", slug: "concepts/doc-pack" },
            { label: "The browxai ecosystem", slug: "concepts/browxai-ecosystem" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Running against an app repo", slug: "guides/running-against-an-app-repo" },
            { label: "CI recipes", slug: "guides/ci-recipes" },
            { label: "Writing plugins", slug: "guides/writing-plugins" },
            { label: "Security best practices", slug: "guides/security-best-practices" },
            { label: "Troubleshooting", slug: "guides/troubleshooting" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "reference/cli" },
            { label: "Flow-file format", slug: "reference/flow-file" },
            { label: "Auth strategies", slug: "reference/auth-strategies" },
            { label: "Plugins", slug: "reference/plugins" },
            { label: "MCP tools", slug: "reference/mcp-tools" },
            { label: "Backend API", slug: "reference/backend-api" },
            { label: "Actionability contract", slug: "reference/actionability" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "engine", slug: "packages/engine" },
            { label: "plugin", slug: "packages/plugin" },
            { label: "mcp", slug: "packages/mcp" },
            { label: "backend", slug: "packages/backend" },
            { label: "viewer", slug: "packages/viewer" },
            { label: "skill", slug: "packages/skill" },
            { label: "plugin-confluence", slug: "packages/plugin-confluence" },
            { label: "plugin-starlight", slug: "packages/plugin-starlight" },
          ],
        },
        {
          label: "Project",
          items: [
            { label: "Changelog", slug: "project/changelog" },
            { label: "Contributing", slug: "project/contributing" },
            { label: "Security", slug: "project/security" },
          ],
        },
      ],
      lastUpdated: true,
    }),
  ],
});
