---
title: Use Biome in new Node.js Projects
description: Recommended to use Biome, rather than Prettier and ESLint, in new Node.js projects.
date: 2025-09-04
---

# Use Biome in new Node.js Projects

[Biome](https://github.com/biomejs/biome) is a toolchain for web projects that includes a linter, formatter, and more. It is recommended to use Biome in new web projects instead of Prettier and ESLint.

Actually Biome doesn't require Node.js to function.

## Why Biome?

- **All-in-One**: Biome combines the functionalities of a linter and formatter, reducing the need for multiple tools (and dependencies conflicts).
- **Fast Formatter**: Biome is a fast formatter that scores 97% compatibility with Prettier, but ~35x faster than Prettier, saving CI and developer time.
- **Performant Linter**: Biome is a performant linter for JavaScript, TypeScript, JSX, JSON, CSS, and GraphQL that features more than 340 rules from sources including ESLint, typescript-eslint. And it outputs detailed and contextualized diagnostics that help you to improve your code and become a better programmer.
- **First-class LSP support**: Biome has first-class LSP support, with a sophisticated parser that represents the source text in full fidelity and top-notch error recovery.
- **Sensible Defaults**: Biome has sane defaults and it doesn't require configuration.
- **Migration Tool**: Biome provides a migration tool to help you switch from ESLint and Prettier to Biome.
- **IDE Support**: Biome has plugins for popular IDEs like VSCode, Neovim, and JetBrains.

## Migrate from ESLint and Prettier

Biome provides a [comprehensive guide](https://biomejs.dev/guides/migrate-eslint-prettier/) and dedicated commands to ease the migration from ESLint and Prettier to Biome.

I've migrated the project [whitehaven](https://github.com/nkcoder/whitehaven) from ESLint and Prettier to Biome.

### Install Biome

```sh
npm i -D -E @biomejs/biome

# Generate a configuration file: biome.json
npx @biomejs/biome init
```

### Run The Migration Commands

```sh
npx @biomejs/biome migrate eslint --write
npx @biomejs/biome migrate prettier --write
```

The migration commands will update the `biome.json` configuration file based on your project's existing ESLint and Prettier configurations.

### Update Scripts in package.json

```json
{
  "scripts": {
    "format": "biome format --write",
    "lint": "biome lint --write",
    "check": "biome check --write"
  }
}
```

### Update CI/CD

Example:

```yml
name: Code quality

on:
  push:
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v5
        with:
          persist-credentials: false
      - name: Setup Biome
        uses: biomejs/setup-biome@v2
        with:
          version: latest
      - name: Run Biome
        run: biome ci .
```
