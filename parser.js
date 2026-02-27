function parseRexxControlFlow(source) {
  const lines = source.split(/\r?\n/);
  const nodes = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const syntheticCounts = new Map();

  ensureNode(nodes, "MAIN", "MAIN", 1, "entry");
  ensureNode(nodes, "END", "END", lines.length + 1, "exit");

  let frontier = [{ nodeId: "MAIN", edgeType: null }];
  let inBlockComment = false;
  const blockStack = [];
  const pendingIf = [];
  let lastLabel = null;

  const addEdge = (from, to, type, line) => {
    ensureNode(nodes, from, from, line, "synthetic");
    ensureNode(nodes, to, to, line, "synthetic");
    const key = `${from}->${to}:${type}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({ from, to, type, line });
  };

  const makeSyntheticNode = (prefix, label, line, kind = "synthetic") => {
    const key = `${prefix}@${line}`;
    const count = syntheticCounts.get(key) || 0;
    syntheticCounts.set(key, count + 1);
    const id = count === 0 ? key : `${key}#${count + 1}`;
    ensureNode(nodes, id, label, line, kind);
    return id;
  };

  const connectFromFrontier = (targetId, type, line) => {
    for (const f of frontier) {
      addEdge(f.nodeId, targetId, f.edgeType || type, line);
    }
  };

  const setFrontier = (arr) => {
    frontier = dedupeFrontier(arr);
  };

  const mergeFrontier = (...parts) => {
    setFrontier(parts.flat());
  };

  const runPrimitiveStatement = (text, lineNo, startFrontier) => {
    const collapsed = collapse(text);
    if (!collapsed) {
      return startFrontier;
    }
    if (!startFrontier || startFrontier.length === 0) {
      return [];
    }
    const upper = collapsed.toUpperCase();

    const localConnect = (stmtNode, defaultType) => {
      for (const f of startFrontier) {
        addEdge(f.nodeId, stmtNode, f.edgeType || defaultType, lineNo);
      }
    };

    if (/^SIGNAL(?:\s+TO)?\s+VALUE\b/.test(upper)) {
      const stmtNode = makeSyntheticNode("SIGNAL", `SIGNAL line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      const targetNode = makeSyntheticNode(
        "SIGNAL_VALUE",
        `SIGNAL VALUE line ${lineNo}`,
        lineNo,
        "dynamic-jump"
      );
      addEdge(stmtNode, targetNode, "signal-value", lineNo);
      addEdge(targetNode, "END", "dynamic", lineNo);
      return [];
    }

    const signalMatch = upper.match(/^SIGNAL(?:\s+TO)?\s+([A-Z0-9_.$!?@#]+)/);
    if (signalMatch) {
      const target = normalizeLabel(signalMatch[1]);
      if (target === "ON" || target === "OFF") {
        const stmtNode = makeSyntheticNode("SIGNAL_COND", `SIGNAL condition line ${lineNo}`, lineNo, "statement");
        localConnect(stmtNode, "next");
        return [{ nodeId: stmtNode, edgeType: null }];
      }
      const stmtNode = makeSyntheticNode("SIGNAL", `SIGNAL line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      addEdge(stmtNode, target, "signal", lineNo);
      return [];
    }

    if (/^CALL\s+VALUE\b/.test(upper) || /^CALL\s+\(/.test(upper)) {
      const stmtNode = makeSyntheticNode("CALL_DYNAMIC", `CALL dynamic line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      const targetNode = makeSyntheticNode("CALL_TARGET", `CALL target line ${lineNo}`, lineNo, "dynamic-call");
      addEdge(stmtNode, targetNode, "call-dynamic", lineNo);
      return [{ nodeId: stmtNode, edgeType: null }];
    }

    const callMatch = upper.match(/^CALL\s+([A-Z0-9_.$!?@#]+)/);
    if (callMatch) {
      const target = normalizeLabel(callMatch[1]);
      if (target === "ON" || target === "OFF") {
        const stmtNode = makeSyntheticNode("CALL_COND", `CALL condition line ${lineNo}`, lineNo, "statement");
        localConnect(stmtNode, "next");
        return [{ nodeId: stmtNode, edgeType: null }];
      }
      const stmtNode = makeSyntheticNode("CALL", `CALL line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      addEdge(stmtNode, target, "call", lineNo);
      return [{ nodeId: stmtNode, edgeType: null }];
    }

    if (/^(RETURN|EXIT)\b/.test(upper)) {
      const stmtNode = makeSyntheticNode("EXIT", `${upper.split(" ")[0]} line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      addEdge(stmtNode, "END", "terminal", lineNo);
      return [];
    }

    const iterateMatch = upper.match(/^ITERATE(?:\s+([A-Z0-9_.$!?@#]+))?\b/);
    if (iterateMatch) {
      const target = iterateMatch[1] ? normalizeLabel(iterateMatch[1]) : null;
      const doFrame = findDoFrame(blockStack, target);
      const stmtNode = makeSyntheticNode("ITERATE", `ITERATE line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      if (doFrame) {
        addEdge(stmtNode, doFrame.doNode, "iterate", lineNo);
      } else {
        addEdge(stmtNode, "END", "terminal", lineNo);
      }
      return [];
    }

    const leaveMatch = upper.match(/^LEAVE(?:\s+([A-Z0-9_.$!?@#]+))?\b/);
    if (leaveMatch) {
      const target = leaveMatch[1] ? normalizeLabel(leaveMatch[1]) : null;
      const doFrame = findDoFrame(blockStack, target);
      const stmtNode = makeSyntheticNode("LEAVE", `LEAVE line ${lineNo}`, lineNo, "statement");
      localConnect(stmtNode, "next");
      if (doFrame) {
        doFrame.leaveFrontier.push({ nodeId: stmtNode, edgeType: "leave" });
      } else {
        addEdge(stmtNode, "END", "terminal", lineNo);
      }
      return [];
    }

    const stmtNode = makeSyntheticNode("STMT", `line ${lineNo}`, lineNo, "statement");
    localConnect(stmtNode, "next");
    return [{ nodeId: stmtNode, edgeType: null }];
  };

  const resolvePendingElseIfNeeded = (upper, lineNo) => {
    if (upper.startsWith("ELSE")) {
      return;
    }
    if (pendingIf.length === 0) {
      return;
    }

    const resume = [];
    while (pendingIf.length > 0) {
      const ifFrame = pendingIf.pop();
      resume.push(...ifFrame.thenExit, ...ifFrame.falseEntry);
    }
    mergeFrontier(frontier, resume);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const stripped = stripComments(lines[i], { inBlockComment });
    inBlockComment = stripped.inBlockComment;
    const line = stripped.line.trim();
    if (!line) {
      continue;
    }

    const labelMatch = line.match(/^([A-Za-z0-9_.$!?@#]+)\s*:\s*(.*)$/);
    if (labelMatch) {
      resolvePendingElseIfNeeded("", lineNo);

      const label = normalizeLabel(labelMatch[1]);
      lastLabel = label;
      ensureNode(nodes, label, label, lineNo, "label");
      for (const f of frontier) {
        addEdge(f.nodeId, label, f.edgeType || "fallthrough", lineNo);
      }
      setFrontier([{ nodeId: label, edgeType: null }]);

      const trailing = collapse(labelMatch[2]);
      if (trailing) {
        for (const segment of splitStatements(trailing)) {
          const upperTrailing = segment.toUpperCase();
          resolvePendingElseIfNeeded(upperTrailing, lineNo);
          processStatement(segment, upperTrailing, lineNo, label, lastLabel);
        }
      }
      continue;
    }

    for (const segment of splitStatements(line)) {
      const collapsed = collapse(segment);
      const upper = collapsed.toUpperCase();
      resolvePendingElseIfNeeded(upper, lineNo);
      processStatement(collapsed, upper, lineNo, null, lastLabel);
    }
  }

  resolvePendingElseIfNeeded("", lines.length + 1);

  // Any open constructs degrade to simple fallthrough continuation.
  while (blockStack.length > 0) {
    const frame = blockStack.pop();
    if (frame.kind === "do") {
      mergeFrontier(frontier, frame.leaveFrontier, [{ nodeId: frame.doNode, edgeType: "exit-do" }]);
    }
    if (frame.kind === "select") {
      mergeFrontier(frontier, frame.branchExits, frame.pendingNoMatch);
    }
    if (frame.kind === "if-then") {
      mergeFrontier(frontier, frame.ifFrame.thenExit, frame.ifFrame.falseEntry);
    }
    if (frame.kind === "if-else") {
      mergeFrontier(frontier, frame.ifFrame.thenExit, frontier);
    }
  }

  // Any remaining path that did not terminate goes to END.
  for (const f of frontier) {
    addEdge(f.nodeId, "END", f.edgeType || "implicit", lines.length + 1);
  }

  const nodeList = Array.from(nodes.values()).sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  return { nodes: nodeList, edges };

  function processStatement(text, upper, lineNo, statementLabel, activeLabel) {
    const elseDoMatch = upper.match(/^ELSE\s+DO\b(.*)$/);
    if (elseDoMatch) {
      const ifFrame = pendingIf.pop();
      if (!ifFrame) {
        setFrontier(runPrimitiveStatement(text, lineNo, frontier));
        return;
      }
      setFrontier(ifFrame.falseEntry);
      blockStack.push({ kind: "if-else", ifFrame });

      const rest = collapse(elseDoMatch[1] || "");
      if (rest) {
        setFrontier(runPrimitiveStatement(rest, lineNo, frontier));
      }
      return;
    }

    const elseMatch = upper.match(/^ELSE\b(.*)$/);
    if (elseMatch) {
      const ifFrame = pendingIf.pop();
      if (!ifFrame) {
        setFrontier(runPrimitiveStatement(text, lineNo, frontier));
        return;
      }

      const rest = collapse(elseMatch[1] || "");
      if (/^IF\b/.test(rest.toUpperCase())) {
        setFrontier(ifFrame.falseEntry);
        processStatement(rest, rest.toUpperCase(), lineNo, statementLabel, activeLabel);
        mergeFrontier(ifFrame.thenExit, frontier);
        return;
      }
      const elseOut = runPrimitiveStatement(rest, lineNo, ifFrame.falseEntry);
      mergeFrontier(ifFrame.thenExit, elseOut);
      return;
    }

    if (/^SELECT\b/.test(upper)) {
      const selectNode = makeSyntheticNode("SELECT", `SELECT line ${lineNo}`, lineNo, "control");
      connectFromFrontier(selectNode, "next", lineNo);
      blockStack.push({
        kind: "select",
        selectNode,
        pendingNoMatch: [{ nodeId: selectNode, edgeType: "when" }],
        branchExits: [],
        frameLabel: statementLabel || activeLabel || null
      });
      setFrontier([]);
      return;
    }

    const whenMatch = upper.match(/^WHEN\b[\s\S]*?\bTHEN\b(.*)$/);
    if (whenMatch) {
      const selectFrame = findFrame(blockStack, (f) => f.kind === "select");
      if (!selectFrame) {
        setFrontier(runPrimitiveStatement(text, lineNo, frontier));
        return;
      }

      if (frontier.length > 0) {
        selectFrame.branchExits.push(...frontier);
      }

      const whenNode = makeSyntheticNode("WHEN", `WHEN line ${lineNo}`, lineNo, "control");
      for (const f of selectFrame.pendingNoMatch) {
        addEdge(f.nodeId, whenNode, f.edgeType || "when", lineNo);
      }

      const thenEntry = [{ nodeId: whenNode, edgeType: "then" }];
      selectFrame.pendingNoMatch = [{ nodeId: whenNode, edgeType: "when-next" }];

      const thenText = collapse(whenMatch[1] || "");
      if (thenText) {
        setFrontier(thenEntry);
        processStatement(thenText, thenText.toUpperCase(), lineNo, statementLabel, activeLabel);
      } else {
        setFrontier(thenEntry);
      }
      return;
    }

    const otherwiseMatch = upper.match(/^OTHERWISE\b(.*)$/);
    if (otherwiseMatch) {
      const selectFrame = findFrame(blockStack, (f) => f.kind === "select");
      if (!selectFrame) {
        setFrontier(runPrimitiveStatement(text, lineNo, frontier));
        return;
      }

      if (frontier.length > 0) {
        selectFrame.branchExits.push(...frontier);
      }

      const otherwiseNode = makeSyntheticNode("OTHERWISE", `OTHERWISE line ${lineNo}`, lineNo, "control");
      for (const f of selectFrame.pendingNoMatch) {
        addEdge(f.nodeId, otherwiseNode, f.edgeType || "otherwise", lineNo);
      }
      selectFrame.pendingNoMatch = [];

      const rest = collapse(otherwiseMatch[1] || "");
      if (rest) {
        setFrontier([{ nodeId: otherwiseNode, edgeType: "next" }]);
        processStatement(rest, rest.toUpperCase(), lineNo, statementLabel, activeLabel);
      } else {
        setFrontier([{ nodeId: otherwiseNode, edgeType: null }]);
      }
      return;
    }

    const endMatch = upper.match(/^END(?:\s+([A-Z0-9_.$!?@#]+))?\b/);
    if (endMatch) {
      const frame = popMatchingFrame(blockStack, endMatch[1] ? normalizeLabel(endMatch[1]) : null);
      if (!frame) {
        setFrontier(runPrimitiveStatement(text, lineNo, frontier));
        return;
      }

      if (frame.kind === "do") {
        if (frame.loopLike) {
          for (const f of frontier) {
            addEdge(f.nodeId, frame.doNode, f.edgeType || "loop", lineNo);
          }
        }
        mergeFrontier(frame.leaveFrontier, [{ nodeId: frame.doNode, edgeType: "exit-do" }]);
        return;
      }

      if (frame.kind === "select") {
        if (frontier.length > 0) {
          frame.branchExits.push(...frontier);
        }
        mergeFrontier(frame.branchExits, frame.pendingNoMatch);
        return;
      }

      if (frame.kind === "if-then") {
        frame.ifFrame.thenExit = frontier;
        pendingIf.push(frame.ifFrame);
        setFrontier([]);
        return;
      }

      if (frame.kind === "if-else") {
        frame.ifFrame.elseExit = frontier;
        mergeFrontier(frame.ifFrame.thenExit, frame.ifFrame.elseExit);
        return;
      }

      return;
    }

    const ifMatch = upper.match(/^IF\b[\s\S]*?\bTHEN\b([\s\S]*)$/);
    if (ifMatch) {
      const ifNode = makeSyntheticNode("IF", `IF line ${lineNo}`, lineNo, "control");
      connectFromFrontier(ifNode, "next", lineNo);
      const thenEntry = [{ nodeId: ifNode, edgeType: "then" }];
      const elseEntry = [{ nodeId: ifNode, edgeType: "else" }];

      const thenRaw = collapse(ifMatch[1] || "");
      const splitInlineElse = splitInlineElseThen(thenRaw);
      const thenText = splitInlineElse.thenText;
      const elseText = splitInlineElse.elseText;

      if (/^DO\b/.test(thenText.toUpperCase())) {
        const ifFrame = { thenExit: [], falseEntry: elseEntry, elseExit: [] };
        setFrontier(thenEntry);
        blockStack.push({ kind: "if-then", ifFrame });

        const rest = collapse(thenText.replace(/^DO\b/i, ""));
        if (rest) {
          setFrontier(runPrimitiveStatement(rest, lineNo, frontier));
        }
        return;
      }

      setFrontier(thenEntry);
      if (thenText) {
        processStatement(thenText, thenText.toUpperCase(), lineNo, statementLabel, activeLabel);
      }
      const thenOut = frontier.length > 0 ? frontier : thenEntry;

      if (elseText) {
        setFrontier(elseEntry);
        processStatement(elseText, elseText.toUpperCase(), lineNo, statementLabel, activeLabel);
        const elseOut = frontier.length > 0 ? frontier : elseEntry;
        mergeFrontier(thenOut, elseOut);
      } else {
        mergeFrontier(thenOut, elseEntry);
      }
      return;
    }

    const doMatch = upper.match(/^DO\b(.*)$/);
    if (doMatch) {
      const doNode = makeSyntheticNode("DO", `DO line ${lineNo}`, lineNo, "control");
      connectFromFrontier(doNode, "do", lineNo);
      const rest = collapse(doMatch[1] || "");
      const loopLike = /\b(WHILE|UNTIL|FOREVER|TO|BY|FOR)\b/.test(upper) || /\w+\s*=/.test(upper);
      blockStack.push({
        kind: "do",
        doNode,
        leaveFrontier: [],
        loopLike,
        loopLabel: statementLabel || activeLabel || null
      });

      setFrontier([{ nodeId: doNode, edgeType: "do-body" }]);
      if (rest) {
        setFrontier(runPrimitiveStatement(rest, lineNo, frontier));
      }
      return;
    }

    setFrontier(runPrimitiveStatement(text, lineNo, frontier));
  }
}

function splitInlineElseThen(text) {
  if (!text) {
    return { thenText: "", elseText: "" };
  }
  const match = text.match(/^(.*?)\bELSE\b(.*)$/i);
  if (!match) {
    return { thenText: text.trim(), elseText: "" };
  }
  return {
    thenText: (match[1] || "").trim(),
    elseText: (match[2] || "").trim()
  };
}

function dedupeFrontier(frontier) {
  const seen = new Set();
  const out = [];
  for (const item of frontier) {
    if (!item || !item.nodeId) {
      continue;
    }
    const key = `${item.nodeId}|${item.edgeType || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ nodeId: item.nodeId, edgeType: item.edgeType || null });
  }
  return out;
}

function ensureNode(nodes, id, label, line, kind) {
  if (nodes.has(id)) {
    return;
  }
  nodes.set(id, {
    id,
    label,
    line,
    kind
  });
}

function normalizeLabel(label) {
  return String(label).trim().toUpperCase();
}

function collapse(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stripComments(line, state) {
  let inBlockComment = state.inBlockComment;
  let result = "";

  for (let i = 0; i < line.length; i += 1) {
    const pair = line.slice(i, i + 2);
    if (!inBlockComment && pair === "/*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (inBlockComment && pair === "*/") {
      inBlockComment = false;
      i += 1;
      continue;
    }
    if (!inBlockComment) {
      result += line[i];
    }
  }

  return { line: result, inBlockComment };
}

function findFrame(stack, predicate) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (predicate(stack[i])) {
      return stack[i];
    }
  }
  return null;
}

function findDoFrame(stack, targetLabel) {
  if (!targetLabel) {
    return findFrame(stack, (f) => f.kind === "do");
  }
  return findFrame(
    stack,
    (f) => f.kind === "do" && typeof f.loopLabel === "string" && normalizeLabel(f.loopLabel) === targetLabel
  );
}

function splitStatements(text) {
  const out = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === ";") {
      const stmt = collapse(current);
      if (stmt) {
        out.push(stmt);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = collapse(current);
  if (tail) {
    out.push(tail);
  }
  return out;
}

function popMatchingFrame(stack, endLabel) {
  if (!endLabel) {
    return stack.pop() || null;
  }

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i];
    const names = [];
    if (frame.kind === "do" && frame.loopLabel) {
      names.push(normalizeLabel(frame.loopLabel));
    }
    if (frame.kind === "select" && frame.frameLabel) {
      names.push(normalizeLabel(frame.frameLabel));
    }
    if (names.includes(endLabel)) {
      stack.splice(i, 1);
      return frame;
    }
  }

  return stack.pop() || null;
}

function toDot(graph) {
  const out = ["digraph REXXControlFlow {", "  rankdir=LR;"];

  for (const node of graph.nodes) {
    out.push(`  \"${escapeDot(node.id)}\" [label=\"${escapeDot(node.label)}\"];`);
  }

  for (const edge of graph.edges) {
    out.push(
      `  \"${escapeDot(edge.from)}\" -> \"${escapeDot(edge.to)}\" [label=\"${escapeDot(edge.type)}\"];`
    );
  }

  out.push("}");
  return out.join("\n");
}

function escapeDot(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
}

module.exports = {
  parseRexxControlFlow,
  toDot
};
