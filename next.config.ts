import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Token cache, the WLTE socket, and SQLite live in this process.
  cacheComponents: false,
  // The dev server is bound to 0.0.0.0 and advertised as localhost. Opening it
  // at 127.0.0.1 is treated as cross-origin, which blocks the HMR socket. The
  // React debug channel rides that socket, so hydration never finishes.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
