import type { NextConfig } from 'next';
import nextra from 'nextra';

// nextra-specific options
const withNextra = nextra({
  search: true,
  defaultShowCopyCode: true,
  readingTime: true,
  codeHighlight: true
});

// regular next.js options
const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
  experimental: {
    optimizePackageImports: ['nextra-theme-docs']
  },
  webpack(config, { isServer }) {
    const path = require('path');
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['next-mdx-import-source-file'] = path.resolve(process.cwd(), 'mdx-components.tsx');
    return config;
  },
  // Turbopack configuration
  transpilePackages: ['nextra', 'nextra-theme-docs']
};

export default withNextra(config);
