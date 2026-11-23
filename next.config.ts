import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown in the footer; bump "version" in package.json for each release.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
