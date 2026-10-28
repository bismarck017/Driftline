import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // the floating dev indicator sits bottom-left and collides with the gauge
  // cluster HUD — turn it off entirely
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
