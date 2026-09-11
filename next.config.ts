import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler adds noticeable transform time in local development.
  // Keep it for production builds, where its render optimizations matter,
  // but avoid paying that compile cost on every Turbopack dev update.
  reactCompiler: process.env.NODE_ENV === "production",
  compress: true,
};

export default nextConfig;
