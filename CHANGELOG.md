# Changelog

## 0.2.0

- Added comprehensive CLIST linting with structured diagnostics and codes:
  - 80-column limit errors
  - IF/THEN, DO/END, and ELSE structure checks
  - duplicate labels and duplicate PROC parameters
  - unknown/unsafe GOTO validation
  - quote/parenthesis balance checks
  - command argument checks for SET/READ/WRITE
  - variable usage diagnostics (undefined and unused)
  - unreachable-label hints
- Added richer LSP capabilities:
  - workspace symbols, rename support, signature help
  - folding ranges, document formatting, semantic tokens
  - quick-fix code actions for common issues
- Added configurable lint settings via local `clist-lsp.json`.

## 0.1.0

- Initial CLIST language server implementation for VS Code.
