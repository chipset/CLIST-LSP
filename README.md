# REXX Control Flow

REXX Control Flow is a VS Code extension that builds a control-flow graph from a REXX source file.

## Features

- Generate an interactive graph view from the active REXX editor.
- Export the graph to JSON.
- Export the graph to DOT format.
- Click graph nodes to jump to the matching source line.
- Auto-refresh the graph when the source document changes.
- Toggle visibility of synthetic nodes/edges and terminal/dynamic edges.
- Download graph renderings as SVG or PNG from the graph toolbar.

## Supported flow constructs

- Labels (`label:`)
- `SIGNAL` and `SIGNAL TO`
- `CALL`
- `RETURN` and `EXIT`
- `IF ... THEN ... ELSE` (inline and `THEN DO ... END`)
- `DO ... END` blocks, including loop-like forms (`DO WHILE`, `DO UNTIL`, `DO ... TO/BY/FOR`)
- `ITERATE` and `LEAVE`, including labeled targets (`ITERATE loop1`, `LEAVE loop1`)
- `SELECT`, `WHEN ... THEN`, and `OTHERWISE`
- `SIGNAL VALUE ...` as a dynamic terminal jump
- `SIGNAL ON/OFF ...` and `CALL ON/OFF ...` recognized as condition-trap statements
- Dynamic calls (`CALL VALUE ...`, `CALL (...)`)
- Named block endings (`END name`) for labeled `DO`/`SELECT` blocks
- Multiple statements per line separated by `;` (quote-aware splitting)
- Implicit fall-through and merge edges between branch paths

## Usage

1. Open a REXX file.
2. Right-click in the editor.
3. Run **Generate REXX Control Flow**.

From the command palette, you can also run:

- **REXX Control Flow: Export REXX Control Flow to JSON**
- **REXX Control Flow: Export REXX Control Flow to DOT**

## Notes

This version focuses on core label-based flow analysis and common jump/call statements.
