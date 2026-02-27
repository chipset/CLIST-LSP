const vscode = require("vscode");
const path = require("node:path");
const { parseRexxControlFlow, toDot } = require("./parser");

const SUPPORTED_LANGS = new Set(["rexx", "REXX"]);

function activate(context) {
  let graphPanel = null;
  let graphDocumentUri = null;

  const renderForDocument = (doc) => {
    const graph = parseRexxControlFlow(doc.getText());
    if (!graphPanel) {
      graphPanel = vscode.window.createWebviewPanel(
        "rexxControlFlow",
        `REXX Control Flow: ${path.basename(doc.fileName)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      graphPanel.onDidDispose(() => {
        graphPanel = null;
        graphDocumentUri = null;
      });

      graphPanel.webview.onDidReceiveMessage(async (msg) => {
        if (!msg || !graphDocumentUri) {
          return;
        }

        if (msg.type === "revealLine") {
          const line = Math.max(1, Number(msg.line) || 1);
          const targetUri = graphDocumentUri;
          const docTarget = await vscode.workspace.openTextDocument(targetUri);
          const editor = await vscode.window.showTextDocument(docTarget, vscode.ViewColumn.One);
          const position = new vscode.Position(line - 1, 0);
          const range = new vscode.Range(position, position);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
      });
    }

    graphDocumentUri = doc.uri;
    graphPanel.title = `REXX Control Flow: ${path.basename(doc.fileName)}`;
    graphPanel.webview.html = renderGraphHtml(graph, doc.fileName);
  };

  const show = vscode.commands.registerCommand("rexxFlow.showControlGraph", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isSupported(editor.document)) {
      vscode.window.showWarningMessage("Open a REXX file to generate control flow.");
      return;
    }

    renderForDocument(editor.document);
  });

  const exportJson = vscode.commands.registerCommand("rexxFlow.exportGraphJson", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isSupported(editor.document)) {
      vscode.window.showWarningMessage("Open a REXX file to export control flow.");
      return;
    }

    const graph = parseRexxControlFlow(editor.document.getText());
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(graph, null, 2),
      language: "json"
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  });

  const exportDot = vscode.commands.registerCommand("rexxFlow.exportDot", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isSupported(editor.document)) {
      vscode.window.showWarningMessage("Open a REXX file to export control flow.");
      return;
    }

    const graph = parseRexxControlFlow(editor.document.getText());
    const doc = await vscode.workspace.openTextDocument({
      content: toDot(graph),
      language: "dot"
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  });

  const onDocumentChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!graphPanel || !graphDocumentUri) {
      return;
    }
    if (event.document.uri.toString() !== graphDocumentUri.toString()) {
      return;
    }
    renderForDocument(event.document);
  });

  context.subscriptions.push(show, exportJson, exportDot, onDocumentChange);
}

function isSupported(doc) {
  if (SUPPORTED_LANGS.has(doc.languageId)) {
    return true;
  }
  const name = doc.fileName.toLowerCase();
  return name.endsWith(".rexx") || name.endsWith(".rex") || name.endsWith(".exec");
}

function renderGraphHtml(graph, fileName) {
  const nodes = graph.nodes;
  const edges = graph.edges;

  const cardWidth = 170;
  const cardHeight = 56;
  const gapX = 60;
  const gapY = 56;
  const cols = Math.max(3, Math.ceil(Math.sqrt(Math.max(nodes.length, 1))));

  const positions = new Map();
  nodes.forEach((node, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 30 + col * (cardWidth + gapX);
    const y = 30 + row * (cardHeight + gapY);
    positions.set(node.id, { x, y });
  });

  const totalRows = Math.ceil(nodes.length / cols);
  const width = Math.max(720, 60 + cols * (cardWidth + gapX));
  const height = Math.max(420, 60 + totalRows * (cardHeight + gapY));

  const edgeSvg = edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) {
        return "";
      }

      const x1 = from.x + cardWidth / 2;
      const y1 = from.y + cardHeight / 2;
      const x2 = to.x + cardWidth / 2;
      const y2 = to.y + cardHeight / 2;
      const mx = Math.round((x1 + x2) / 2);
      const my = Math.round((y1 + y2) / 2) - 6;
      const classNames = edgeClassNames(edge);

      return [
        `<g class="edge-group ${classNames}" data-edge-type="${escapeHtml(edge.type)}">`,
        `<line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arrow)" />`,
        `<text class="edge-label" x="${mx}" y="${my}">${escapeHtml(edge.type)}</text>`,
        `</g>`
      ].join("");
    })
    .join("\n");

  const nodeHtml = nodes
    .map((node) => {
      const pos = positions.get(node.id);
      return `<button class="node ${nodeClassName(node)}" data-line="${node.line}" data-kind="${escapeHtml(
        node.kind || ""
      )}" style="left:${pos.x}px;top:${pos.y}px" title="Jump to line ${node.line}"><div class="name">${escapeHtml(
        node.label
      )}</div><div class="meta">line ${node.line}</div></button>`;
    })
    .join("\n");

  const edgeRows = edges
    .map(
      (edge) =>
        `<tr class="${edgeClassNames(edge)}" data-edge-type="${escapeHtml(edge.type)}"><td>${escapeHtml(edge.from)}</td><td>${escapeHtml(
          edge.to
        )}</td><td>${escapeHtml(edge.type)}</td><td>${edge.line}</td></tr>`
    )
    .join("\n");

  const graphTitle = `${escapeHtml(fileName)} | Nodes: ${nodes.length} | Edges: ${edges.length}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>REXX Control Flow</title>
  <style>
    :root {
      --bg: #f7f9fb;
      --card: #ffffff;
      --line: #2f4858;
      --ink: #1d2a33;
      --muted: #5f7380;
      --accent: #cc3f0c;
      --border: #d7e0e8;
    }
    body {
      margin: 0;
      background: linear-gradient(145deg, #f7f9fb 0%, #eef3f8 100%);
      color: var(--ink);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    .wrap {
      padding: 16px;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .subtitle {
      color: var(--muted);
      margin-bottom: 12px;
      font-size: 13px;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      margin-bottom: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
      font-size: 12px;
    }
    .controls label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #2f4858;
    }
    .controls button {
      border: 1px solid #96acbc;
      border-radius: 8px;
      background: #fff;
      color: #1e3441;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .canvas {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
      overflow: auto;
    }
    .canvas svg {
      position: absolute;
      inset: 0;
    }
    .edge {
      stroke: var(--line);
      stroke-width: 1.5;
      opacity: 0.75;
    }
    .edge-label {
      font-size: 10px;
      fill: var(--muted);
      text-anchor: middle;
      paint-order: stroke;
      stroke: #fff;
      stroke-width: 2px;
      stroke-linejoin: round;
    }
    .node {
      position: absolute;
      width: ${cardWidth}px;
      height: ${cardHeight}px;
      border: 1px solid #b8cad8;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(26, 44, 61, 0.08);
      padding: 6px 8px;
      box-sizing: border-box;
      text-align: left;
      cursor: pointer;
    }
    .node:hover {
      border-color: #6d8aa0;
    }
    .node .name {
      font-weight: 700;
      font-size: 13px;
      color: var(--accent);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }
    .node .meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
      pointer-events: none;
    }
    .node.kind-synthetic,
    .node.kind-statement,
    .node.kind-dynamic-call,
    .node.kind-dynamic-jump {
      background: #f4f8fb;
    }
    .hidden-synthetic .node.kind-synthetic,
    .hidden-synthetic .node.kind-statement,
    .hidden-synthetic .node.kind-dynamic-call,
    .hidden-synthetic .node.kind-dynamic-jump,
    .hidden-synthetic .edge-group.edge-synthetic,
    .hidden-synthetic tr.edge-synthetic {
      display: none;
    }
    .hidden-terminal .edge-group.edge-terminal,
    .hidden-terminal tr.edge-terminal,
    .hidden-terminal .edge-group.edge-dynamic,
    .hidden-terminal tr.edge-dynamic {
      display: none;
    }
    table {
      margin-top: 14px;
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      font-size: 12px;
    }
    th, td {
      padding: 8px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    th {
      background: #f0f5fa;
      color: #274356;
    }
  </style>
</head>
<body>
  <div class="wrap" id="app">
    <div class="title">REXX Control Flow</div>
    <div class="subtitle">${graphTitle}</div>

    <div class="controls">
      <label><input id="filterSynthetic" type="checkbox" checked /> Show synthetic nodes/edges</label>
      <label><input id="filterTerminal" type="checkbox" checked /> Show terminal/dynamic edges</label>
      <button id="downloadSvg" type="button">Download SVG</button>
      <button id="downloadPng" type="button">Download PNG</button>
    </div>

    <div class="canvas" id="canvasWrap">
      <svg id="graphSvg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f4858"></path>
          </marker>
        </defs>
        ${edgeSvg}
      </svg>
      ${nodeHtml}
    </div>

    <table>
      <thead>
        <tr><th>From</th><th>To</th><th>Type</th><th>Line</th></tr>
      </thead>
      <tbody id="edgeTableBody">
        ${edgeRows}
      </tbody>
    </table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');

    document.querySelectorAll('.node').forEach((node) => {
      node.addEventListener('click', () => {
        const line = Number(node.getAttribute('data-line') || '1');
        vscode.postMessage({ type: 'revealLine', line });
      });
    });

    const filterSynthetic = document.getElementById('filterSynthetic');
    const filterTerminal = document.getElementById('filterTerminal');

    function syncFilters() {
      app.classList.toggle('hidden-synthetic', !filterSynthetic.checked);
      app.classList.toggle('hidden-terminal', !filterTerminal.checked);
    }

    filterSynthetic.addEventListener('change', syncFilters);
    filterTerminal.addEventListener('change', syncFilters);
    syncFilters();

    function downloadBlob(filename, blob, mime) {
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }

    document.getElementById('downloadSvg').addEventListener('click', () => {
      const svg = document.getElementById('graphSvg');
      const serialized = new XMLSerializer().serializeToString(svg);
      downloadBlob('rexx-control-flow.svg', serialized, 'image/svg+xml');
    });

    document.getElementById('downloadPng').addEventListener('click', () => {
      const svg = document.getElementById('graphSvg');
      const serialized = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = svg.viewBox.baseVal.width || svg.clientWidth;
        canvas.height = svg.viewBox.baseVal.height || svg.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) {
            return;
          }
          const pngUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = pngUrl;
          anchor.download = 'rexx-control-flow.png';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      };
      img.src = url;
    });
  </script>
</body>
</html>`;
}

function nodeClassName(node) {
  const kind = (node.kind || "").toLowerCase();
  if (!kind) {
    return "";
  }
  return `kind-${kind.replace(/[^a-z0-9_-]/g, "-")}`;
}

function edgeClassNames(edge) {
  const classes = [];
  if (edge.type === "terminal" || edge.type === "dynamic") {
    classes.push("edge-terminal", "edge-dynamic");
  }
  if (
    edge.type === "next" ||
    edge.type === "do-body" ||
    edge.type === "loop" ||
    edge.type === "exit-do" ||
    edge.type === "call-dynamic" ||
    edge.type === "signal-value" ||
    edge.type === "when" ||
    edge.type === "when-next" ||
    edge.type === "otherwise"
  ) {
    classes.push("edge-synthetic");
  }

  if (edge.type === "terminal" || edge.type === "dynamic" || edge.type === "signal-value") {
    classes.push("edge-terminal");
  }
  if (edge.type === "dynamic") {
    classes.push("edge-dynamic");
  }

  return classes.join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
