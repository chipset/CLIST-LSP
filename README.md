# IBM CLIST Language Server

Language Server Protocol (LSP) support for IBM CLIST files in VS Code.

## Features

- Lint diagnostics for:
  - 80-column overflow (error)
  - missing `PROC`
  - unmatched `END` and unclosed `DO`
  - malformed `IF`/missing `THEN` and unmatched `ELSE`
  - invalid `SET` form
  - missing `READ`/`WRITE` arguments
  - duplicate labels and duplicate `PROC` parameters
  - unknown `GOTO` targets
  - unsafe `GOTO` into deeper `DO` blocks
  - unbalanced quotes and parentheses
  - undefined variable references and assigned-but-unused variables
  - labels never targeted by `GOTO`
- Go to Definition for labels and variables
- Rename for labels and variables
- Document + Workspace Symbols
- Hover help for CLIST keywords and command usage
- Completion + snippets (`IF THEN DO`, `SET`)
- Signature Help for common commands (`PROC`, `SET`, `IF`, `GOTO`, `READ`, `WRITE`)
- Folding ranges for block regions (`DO ... END`)
- Document Formatting (indentation for CLIST block structure)
- Semantic highlighting (keywords, labels, variables, operators, numbers, strings, comments)
- Quick Fixes:
  - add missing `THEN`
  - insert missing `END`
- Configurable linting via `clist-lsp.json` in the source file directory:
  - `maxColumns`
  - `severityOverrides`

## File Types

- `.clist`
- `.clst`
- `.exec`

## Lint Config Example

Create `clist-lsp.json` next to your CLIST file:

```json
{
  "maxColumns": 80,
  "severityOverrides": {
    "var-unused": 2,
    "missing-proc": 1
  }
}
```

Severity values:

- `1` = Error
- `2` = Warning
- `3` = Information

## Development

- Client entry: `client/extension.js`
- Server entry: `server/server.js`
- CLIST analysis logic: `server/analyzer.js`
- Analyzer tests: `server/analyzer.test.js`
