import type { NextConfig } from "next";

// GitHub Pages deployment: `GH_PAGES=1 next build` produces a fully static
// site under `out/`, served from https://<user>.github.io/Driftline/ —
// everything the game does (WebGL, terrain streaming, HUD) is client-side,
// so a static export works. Without GH_PAGES we keep the standalone Node
// server build used by the local production scripts.
const isGithubPages = process.env.GH_PAGES === "1";
const repoName = "Driftline";

const nextConfig: NextConfig = {
  ...(isGithubPages
    ? {
        output: "export",
        basePath: `/${repoName}`,
        images: { unoptimized: true },
      }
    : { output: "standalone" }),
  // the floating dev indicator sits bottom-left and collides with the gauge
  // cluster HUD — turn it off entirely
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
