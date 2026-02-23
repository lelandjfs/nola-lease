import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark native modules as external (not bundled)
  serverExternalPackages: ["canvas", "pdfjs-dist", "@napi-rs/canvas", "unpdf"],
};

export default nextConfig;
