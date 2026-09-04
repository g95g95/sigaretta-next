import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Un package-lock.json nella cartella padre confonde l'inferenza della workspace root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
