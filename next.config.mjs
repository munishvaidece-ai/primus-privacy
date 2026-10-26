/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The microsite is static HTML in /public/site; give it clean URLs.
  async rewrites() {
    return [
      { source: "/site", destination: "/site/index.html" },
      { source: "/site/", destination: "/site/index.html" },
    ];
  },
  experimental: {
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
