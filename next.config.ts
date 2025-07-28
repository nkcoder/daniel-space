import type { NextConfig } from "next";
import nextra from "nextra";

// nextra-specific options
const withNextra = nextra({
  search: true,
  defaultShowCopyCode: true,
  readingTime: true,
});

// regular next.js options
export default withNextra({
  experimental: {
    optimizePackageImports: ['nextra-theme-docs']
  }
});
