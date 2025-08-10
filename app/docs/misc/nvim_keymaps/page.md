---
title: 'My Neovim Keymaps (LazyVim)'
description: 'A collection of my personal Neovim (LazyVim) key mappings for efficient coding.'
---

## Leader Key

- Space: Leader key (default)

## Window

- Ctrl + h: Go to the left window
- Ctrl + j: Go to the lower window
- Ctrl + k: Go to the upper window
- Ctrl + l: Go to the right window

- `<leader>` + -: Split window below
- `<leader>` + |: Split window right
- `<leader>` + wd: Delete window

## Buffer (Tab)

- Shift + h: Previous buffer
- Shift + l: Next buffer
- [ + b: Previous buffer
- ] + b: Next buffer

- `<leader>` + bd: Delete current buffer(close current tab)
- `<leader>` + bo: Delete other buffers (close other tabs)

- `<leader>` + fb: Buffers
- `<leader>` + fB: All buffers

## Code Navigation

- g + d: Go to definition
- g + I: Go to implementation
- g + K: Signature help
- g + r: References
- K: Hover

- Ctrl+ o: Go to previous location
- Ctrl+ i: Go to next location

- ] + ]: Next reference
- [ + [: Previous reference

- g + g: Go to first line
- G + G: Go to last line

- ] + e: Next error
- ] + w: Next warning
- ] + d: Next diagnostic
- [ + e: Previous error
- [ + w: Previous warning
- [ + d: Previous diagnostic

## Editor

- g + u: Lowercase
- g + U: Uppercase

- `<leader>` + cr: Rename
- `<leader>` + cR: Rename file
- `<leader>` + ca: Code action
- `<leader>` + cA: Source action

- `<leader>` + uw: Toggle wrap
- `<leader>` + ul: Toggle line numbers
- `<leader>` + uh: Toggle inlay hints

- `<leader>` + ff: Find files (root dir)
- `<leader>` + fF: Find files (cwd)
- `<leader>` + fn: New file
- `<leader>` + fr: Recent files

- g + sa: Add surrounding
- g + sd: Delete surrounding
- g + sr: Replace surrounding

> Need to enable mini-surround.

## Git

- `<leader>` + gb: Git blame line
- `<leader>` + gB: Git browse (open)
- `<leader>` + gl: Git log
- `<leader>` + gs: Git status

## Terminal

- Ctrl + /: Toggle terminal
- `<leader>` + ft: Toggle terminal

## Mason

- `<leader>` + cm: Mason

## Commands

- `:LazyExtras`: enable/disable extras.
- `:Lazy`: open LazyVim plugin manager.

- `:q`: Quit current window
- `:qa`: Quit all

---

- [LazyVim Keymaps](https://www.lazyvim.org/keymaps)
