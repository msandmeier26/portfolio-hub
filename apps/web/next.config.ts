import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: produces apps/web/out/ which Cloudflare Pages serves as-is.
  // The whole app is client-side now (algorithms run in WASM in the browser),
  // so we don't need a Node runtime in production.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
