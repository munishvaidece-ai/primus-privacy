/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The microsite is static HTML in /public/site; give it clean URLs.
  // The microsite used to be eleven overlapping pages. Old links still land somewhere useful.
  async redirects() {
    const to = (from, dest) => ({ source: `/site/${from}.html`, destination: `/site/${dest}.html`, permanent: false });
    return [to("obligations", "check"), to("readiness", "check"), to("configurator", "check"), to("portal", "platform"), to("workflows", "platform"), to("ai-layer", "platform"), to("ai-console", "platform"), to("live-skeleton", "platform"), to("sitemap", "index")];
  },
  async rewrites() {
    return [
      { source: "/site", destination: "/site/index.html" },
      { source: "/site/", destination: "/site/index.html" },
    ];
  },
  experimental: {
    // Lets instrumentation.ts start the AI worker with the server on demo installs.
    instrumentationHook: true,
    serverComponentsExternalPackages: ["pg", "pdfkit"],
    // Server Actions default to a 1MB request body limit — too small for
    // evidence file uploads. Raised to match Slice C2's own chosen MVP
    // maximum (lib/storage/evidence-storage.ts's EVIDENCE_MAX_FILE_SIZE_BYTES,
    // 25MB — DECISIONS.md R-94), plus headroom for the surrounding form
    // fields, not an arbitrary/unrelated number.
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
};

export default nextConfig;
