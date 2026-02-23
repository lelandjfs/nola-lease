import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable instrumentation for polyfills
  experimental: {
    instrumentationHook: true,
  },
  // Mark native modules as external (not bundled)
  serverExternalPackages: ["canvas"],
};

export default nextConfig;
