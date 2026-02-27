const {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  SymbolKind,
  CompletionItemKind,
  MarkupKind
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const {
  analyzeClist,
  completionItems,
  getWordAtPosition,
  keywordHover
} = require("./analyzer");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      documentSymbolProvider: true,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [" "]
      }
    }
  };
});

documents.onDidOpen((event) => validate(event.document));
documents.onDidChangeContent((event) => validate(event.document));

async function validate(doc) {
  const analysis = analyzeClist(doc.getText());
  const diagnostics = analysis.diagnostics.map((d) => ({
    severity: mapSeverity(d.severity),
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
  const analysis = analyzeClist(doc.getText());

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

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const analysis = analyzeClist(doc.getText());
  const at = getWordAtPosition(doc.getText(), params.position.line, params.position.character);
  if (!at) {
    return null;
  }

  const def = analysis.labels.get(at.word);
  if (!def) {
    return null;
  }

  return {
    uri: doc.uri,
    range: {
      start: { line: def.line - 1, character: def.character },
      end: { line: def.line - 1, character: def.character + def.id.length }
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
  if (!hover) {
    return null;
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `**${at.word}**\n\n${hover}`
    }
  };
});

connection.onCompletion(() => {
  return completionItems().map((k) => ({
    label: k,
    kind: CompletionItemKind.Keyword,
    detail: "CLIST keyword"
  }));
});

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
