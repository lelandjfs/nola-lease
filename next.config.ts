import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark native modules as external (not bundled by webpack)
  serverExternalPackages: ["canvas", "pdfjs-dist"],
};

export default nextConfig;
