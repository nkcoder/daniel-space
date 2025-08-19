---
title: Most used Vim commands for daily coding
description: A collection of commonly used Vim commands to enhance your coding efficiency.
---

# Most Used Vim Commands for Daily Coding

> For my personal daily references.

## Modes

- Normal mode (default) → navigation, editing commands.
- Insert mode → i (insert before cursor), a (append after cursor), o (new line below).
- Visual mode → v (character select), V (line select), Ctrl+v (block select).
- Command-line mode → : for commands (save, quit, search, etc).

## Movement

- `h j k l` - Left, down, up, right (basic movement)
- `w b` - Jump forward/backward by word
- `0 $` - Beginning/end of line
- `^` - First non-blank character of line
- `gg G` - Go to first/last line of file
- `{ }` - Jump between paragraphs/blocks
- `Ctrl+u Ctrl+d` - Half page up/down
- `Ctrl+b Ctrl+f` - Full page up/down
- `:n`: Go to line number `n`
- `:set nu`: Show line numbers

## Editing Modes

- `i a` - Insert before cursor / Insert after cursor
- `I A` - Insert at beginning/end of line
- `o O` - Open new line below/above
- `v V` - Visual mode / Visual line mode
- `Ctrl+v` - Visual block mode

## Essential Editing

- `x` - Delete character under cursor
- `dw`- Delete word
- `dd` - Delete entire line
- `D` - Delete to end of line
- `yy` - Copy (yank) line
- `yw` - Copy (yank) word
- `p P` - Paste after/before cursor
- `u Ctrl+r` - Undo/redo
- `r` - Replace single character
- `c` - Change (delete and enter insert mode)
- `.` - Repeat last command

## Search & Replace

- `/` - Search forward
- `?` - Search backward
- `n N` - Next/previous search result
- `:%s/old/new/g` - Replace all occurrences in file
- `:s/old/new/g` - Replace all occurrences in current line

## File Operations

- `:w` - Save the current file
- `:wq` - Save and quit
- `:x` - Save and quit (alternative)
- `:q` - Quit Vim
- `:q!` - Quit without saving
- `:e filename` - Open a file
- `:split filename` or `:vsplit filename` - Open file in horizontal/vertical split view

## Code-Specific

- `>>` `<<` - Indent/unindent line
- `=` - Auto-indent selection
- `%` - Jump to matching bracket/parenthesis
- `*` - Find next occurrence of word under cursor
- `~` - Toggle case of character under cursor
- `g~` - Toggle case of selected text
- `Ctrl+o Ctrl+i` - Jump to previous/next location in jump list

## Combining Commands

- `dw` - Delete word
- `d$` - Delete to end of line
- `y$` - Copy to end of line
- `c$` - Change to end of line
- `5dd` - Delete 5 lines
- `3w` - Move 3 words forward

## Window Management

- `:split` - Split window
- `:vsplit` - Vertical split window
- `Ctrl+w h/j/k/l` - Move between split windows
