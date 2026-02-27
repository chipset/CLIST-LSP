# IBM CLIST Language Server

This extension provides a Language Server Protocol (LSP) implementation for IBM CLIST files in VS Code.

## Features

- Diagnostics for:
  - Unmatched `END`
  - Unclosed `DO` blocks
  - `GOTO` statements that reference unknown labels
  - Missing `PROC` statement
- Go to Definition for label references
- Document Symbols for `PROC` and labels
- Hover help for common CLIST keywords
- Keyword completion

## File Types

- `.clist`
- `.clst`
- `.exec`

## Development

- Client entry: `client/extension.js`
- Server entry: `server/server.js`
- CLIST analysis logic: `server/analyzer.js`
- Analyzer tests: `server/analyzer.test.js`
