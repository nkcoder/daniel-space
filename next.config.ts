import nextra from 'nextra';

// nextra-specific options
const withNextra = nextra({
  search: true,
  defaultShowCopyCode: true,
  readingTime: true,
  codeHighlight: true
});

// regular next.js options
export default withNextra({
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['nextra-theme-docs']
  }
});
