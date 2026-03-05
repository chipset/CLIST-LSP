const {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  SymbolKind,
  CompletionItemKind,
  MarkupKind,
  InsertTextFormat,
  TextEdit,
  CodeActionKind
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const {
  analyzeClist,
  completionItems,
  getWordAtPosition,
  keywordHover,
  commandSignature
} = require("./analyzer");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const analysisCache = new Map();

const semanticLegend = {
  tokenTypes: ["comment", "keyword", "operator", "variable", "function", "number", "string"],
  tokenModifiers: []
};

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    definitionProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    renameProvider: { prepareProvider: true },
    hoverProvider: true,
    completionProvider: {
      resolveProvider: false,
      triggerCharacters: [" ", "&", "="]
    },
    signatureHelpProvider: {
      triggerCharacters: [" ", "=", "("],
      retriggerCharacters: [" "]
    },
    foldingRangeProvider: true,
    documentFormattingProvider: true,
    codeActionProvider: true,
    semanticTokensProvider: {
      legend: semanticLegend,
      full: true
    }
  }
}));

documents.onDidOpen((event) => validate(event.document));
documents.onDidChangeContent((event) => validate(event.document));
documents.onDidClose((event) => {
  analysisCache.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

async function validate(doc) {
  const analysis = analyzeClist(doc.getText(), loadRulesForDocument(doc));
  analysisCache.set(doc.uri, analysis);

  const diagnostics = analysis.diagnostics.map((d) => ({
    severity: mapSeverity(d.severity),
    code: d.code,
    range: {
      start: { line: d.line - 1, character: d.startChar },
      end: { line: d.line - 1, character: d.endChar }
    },
    message: d.message,
    source: "clist-lsp"
  }));

  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const analysis = getAnalysis(doc);
  return analysis.symbols.map((s) => ({
    name: s.name,
    kind: s.kind === "proc" ? SymbolKind.Function : SymbolKind.Key,
    range: {
      start: { line: s.line - 1, character: s.startChar },
      end: { line: s.line - 1, character: s.endChar }
    },
    selectionRange: {
      start: { line: s.line - 1, character: s.startChar },
      end: { line: s.line - 1, character: s.endChar }
    }
  }));
});

connection.onWorkspaceSymbol((params) => {
  const query = String(params.query || "").toUpperCase();
  const out = [];

  for (const [uri, analysis] of analysisCache.entries()) {
    for (const s of analysis.symbols || []) {
      if (query && !String(s.name || "").toUpperCase().includes(query)) {
        continue;
      }
      out.push({
        name: s.name,
        kind: s.kind === "proc" ? SymbolKind.Function : SymbolKind.Key,
        location: {
          uri,
          range: {
            start: { line: s.line - 1, character: s.startChar },
            end: { line: s.line - 1, character: s.endChar }
          }
        }
      });
    }
  }

  return out;
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const analysis = getAnalysis(doc);
  const at = getWordAtPosition(doc.getText(), params.position.line, params.position.character);
  if (!at) {
    return null;
  }

  const labelDef = analysis.labels.get(at.word);
  if (labelDef) {
    return {
      uri: doc.uri,
      range: {
        start: { line: labelDef.line - 1, character: labelDef.character },
        end: { line: labelDef.line - 1, character: labelDef.character + labelDef.id.length }
      }
    };
  }

  const varDef = (analysis.variableDefs || []).find((d) => String(d.name).toUpperCase() === at.word);
  if (varDef) {
    return {
      uri: doc.uri,
      range: {
        start: { line: varDef.line - 1, character: varDef.startChar },
        end: { line: varDef.line - 1, character: varDef.endChar }
      }
    };
  }

  return null;
});

connection.onPrepareRename((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const at = getWordAtPosition(doc.getText(), params.position.line, params.position.character);
  if (!at) {
    return null;
  }

  return {
    range: {
      start: { line: params.position.line, character: at.start },
      end: { line: params.position.line, character: at.end }
    },
    placeholder: at.word
  };
});

connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const analysis = getAnalysis(doc);
  const at = getWordAtPosition(doc.getText(), params.position.line, params.position.character);
  if (!at) {
    return null;
  }

  const name = at.word;
  const edits = [];

  const addEdit = (line, startChar, endChar) => {
    edits.push({
      range: {
        start: { line: line - 1, character: startChar },
        end: { line: line - 1, character: endChar }
      },
      newText: params.newName
    });
  };

  for (const s of analysis.symbolDefs || []) {
    if (String(s.name || "").toUpperCase() === name) {
      addEdit(s.line, s.startChar, s.endChar);
    }
  }
  for (const s of analysis.symbolRefs || []) {
    if (String(s.name || "").toUpperCase() === name) {
      addEdit(s.line, s.startChar, s.endChar);
    }
  }
  for (const v of analysis.variableDefs || []) {
    if (String(v.name || "").toUpperCase() === name) {
      addEdit(v.line, v.startChar, v.endChar);
    }
  }
  for (const v of analysis.variableRefs || []) {
    if (String(v.name || "").toUpperCase() === name) {
      addEdit(v.line, v.startChar, v.endChar);
    }
  }

  return {
    changes: {
      [doc.uri]: edits
    }
  };
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const at = getWordAtPosition(doc.getText(), params.position.line, params.position.character);
  if (!at) {
    return null;
  }

  const hover = keywordHover(at.word);
  if (hover) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${at.word}**\n\n${hover}`
      }
    };
  }

  const signature = commandSignature(at.word);
  if (signature) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${at.word}**\n\n\`${signature}\``
      }
    };
  }

  return null;
});

connection.onCompletion(() => {
  const keywordItems = completionItems().map((k) => ({
    label: k,
    kind: CompletionItemKind.Keyword,
    detail: "CLIST keyword"
  }));

  const snippets = [
    {
      label: "IF THEN DO",
      kind: CompletionItemKind.Snippet,
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: "IF ${1:condition} THEN DO\n  ${2}\nEND",
      detail: "IF block"
    },
    {
      label: "SET",
      kind: CompletionItemKind.Snippet,
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: "SET ${1:VAR} = ${2:value}",
      detail: "Assignment"
    }
  ];

  return snippets.concat(keywordItems);
});

connection.onSignatureHelp((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const line = doc
    .getText({
      start: { line: params.position.line, character: 0 },
      end: { line: params.position.line, character: params.position.character }
    })
    .toUpperCase();

  const command = ["PROC", "SET", "IF", "GOTO", "READ", "WRITE"].find((cmd) => line.includes(cmd));
  if (!command) {
    return null;
  }

  const sig = commandSignature(command);
  if (!sig) {
    return null;
  }

  return {
    activeSignature: 0,
    activeParameter: Math.max(0, (line.match(/\s+/g) || []).length - 1),
    signatures: [
      {
        label: sig,
        documentation: `CLIST ${command} usage`,
        parameters: [{ label: "args" }]
      }
    ]
  };
});

connection.onFoldingRanges((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const analysis = getAnalysis(doc);
  return (analysis.foldingRanges || []).map((r) => ({
    startLine: r.startLine,
    endLine: r.endLine,
    kind: "region"
  }));
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const out = [];
  let indent = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const upper = trimmed.toUpperCase();

    if (!trimmed) {
      out.push("");
      continue;
    }

    if (/^(END|ELSE)\b/.test(upper)) {
      indent = Math.max(0, indent - 1);
    }

    out.push(`${"  ".repeat(indent)}${trimmed}`);

    if (/\bTHEN\s+DO\b/.test(upper) || /^DO\b/.test(upper) || /^ELSE\b/.test(upper)) {
      indent += 1;
    }
  }

  return [
    TextEdit.replace(
      {
        start: doc.positionAt(0),
        end: doc.positionAt(text.length)
      },
      out.join("\n")
    )
  ];
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const lines = doc.getText().split(/\r?\n/);
  const actions = [];

  for (const d of params.context.diagnostics || []) {
    const lineNo = d.range.start.line;
    const line = lines[lineNo] || "";

    if (d.code === "if-missing-then") {
      actions.push({
        title: "Add THEN to IF",
        kind: CodeActionKind.QuickFix,
        edit: {
          changes: {
            [doc.uri]: [
              {
                range: {
                  start: { line: lineNo, character: line.length },
                  end: { line: lineNo, character: line.length }
                },
                newText: " THEN"
              }
            ]
          }
        },
        diagnostics: [d]
      });
    }

    if (d.code === "do-unclosed") {
      actions.push({
        title: "Insert END",
        kind: CodeActionKind.QuickFix,
        edit: {
          changes: {
            [doc.uri]: [
              {
                range: {
                  start: { line: lineNo + 1, character: 0 },
                  end: { line: lineNo + 1, character: 0 }
                },
                newText: "END\n"
              }
            ]
          }
        },
        diagnostics: [d]
      });
    }
  }

  return actions;
});

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { data: [] };
  }

  const lines = doc.getText().split(/\r?\n/);
  const raw = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    pushMatches(raw, lineIdx, line, /^\s*\*.*/g, 0);
    pushMatches(raw, lineIdx, line, /\b(PROC|SET|IF|THEN|ELSE|DO|END|GOTO|EXIT|READ|WRITE|CONTROL|ERROR|REPEAT)\b/gi, 1);
    pushMatches(raw, lineIdx, line, /[=<>!]+|\b(AND|OR|NOT)\b/gi, 2);
    pushMatches(raw, lineIdx, line, /&?[A-Za-z$#@][A-Za-z0-9$#@_.-]*/g, 3);
    pushMatches(raw, lineIdx, line, /^\s*([A-Za-z$#@][A-Za-z0-9$#@_.-]*)\s*:/gi, 4, 1);
    pushMatches(raw, lineIdx, line, /\b\d+\b/g, 5);
    pushMatches(raw, lineIdx, line, /"[^"\n]*"|'[^'\n]*'/g, 6);
  }

  raw.sort((a, b) => a.line - b.line || a.start - b.start);

  const data = [];
  let prevLine = 0;
  let prevStart = 0;
  for (const t of raw) {
    const deltaLine = t.line - prevLine;
    const deltaStart = deltaLine === 0 ? t.start - prevStart : t.start;
    data.push(deltaLine, deltaStart, t.length, t.type, 0);
    prevLine = t.line;
    prevStart = t.start;
  }

  return { data };
});

function pushMatches(out, line, text, regex, type, captureGroup) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = captureGroup ? m[captureGroup] : m[0];
    if (!token) {
      continue;
    }
    const start = captureGroup ? m.index + m[0].indexOf(token) : m.index;
    out.push({ line, start, length: token.length, type });
  }
}

function getAnalysis(doc) {
  let analysis = analysisCache.get(doc.uri);
  if (!analysis) {
    analysis = analyzeClist(doc.getText(), loadRulesForDocument(doc));
    analysisCache.set(doc.uri, analysis);
  }
  return analysis;
}

function loadRulesForDocument(doc) {
  try {
    if (!String(doc.uri).startsWith("file://")) {
      return {};
    }
    const filePath = fileURLToPath(doc.uri);
    const cfgPath = path.join(path.dirname(filePath), "clist-lsp.json");
    if (!fs.existsSync(cfgPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return {
      maxColumns: parsed.maxColumns,
      severityOverrides: parsed.severityOverrides
    };
  } catch {
    return {};
  }
}

function mapSeverity(sev) {
  if (sev === 1) {
    return DiagnosticSeverity.Error;
  }
  if (sev === 2) {
    return DiagnosticSeverity.Warning;
  }
  return DiagnosticSeverity.Information;
}

documents.listen(connection);
connection.listen();
