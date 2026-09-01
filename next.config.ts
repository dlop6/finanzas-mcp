import type { NextConfig } from "next";

const configuredDistDir = process.env.NEXT_BUILD_DIST_DIR;

const nextConfig: NextConfig = {
  ...(configuredDistDir === undefined || configuredDistDir.trim() === "" ? {} : { distDir: configuredDistDir }),
};

export default nextConfig;
