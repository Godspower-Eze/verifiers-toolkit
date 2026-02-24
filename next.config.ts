import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Prevent Turbopack/webpack from trying to bundle Node-only packages.
   * @distributedlab/circom2 uses Node's built-in WASI module, which has no
   * browser equivalent and must stay in the Node.js server runtime.
   */
  serverExternalPackages: ['@distributedlab/circom2'],
};

export default nextConfig;
