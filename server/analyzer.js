const KEYWORDS = new Set([
  "PROC",
  "SET",
  "IF",
  "THEN",
  "ELSE",
  "DO",
  "END",
  "GOTO",
  "EXIT",
  "READ",
  "WRITE",
  "CONTROL",
  "ERROR",
  "REPEAT"
]);

const HOVER_TEXT = {
  PROC: "Declares CLIST parameters and starts executable logic.",
  IF: "Evaluates a condition. Often followed by THEN DO ... END.",
  DO: "Starts a block. Should be closed by END.",
  END: "Closes a DO block.",
  GOTO: "Transfers control to a label.",
  SET: "Assigns values to CLIST variables.",
  EXIT: "Terminates CLIST execution."
};

function analyzeClist(text) {
  const lines = String(text || "").split(/\r?\n/);
  const diagnostics = [];
  const labels = new Map();
  const gotos = [];
  const symbols = [];
  const doStack = [];

  let sawProc = false;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const parsed = parseLine(raw);
    if (!parsed || !parsed.code) {
      continue;
    }

    const code = parsed.code;
    const upper = code.toUpperCase();

    if (parsed.label) {
      const id = normalize(parsed.label);
      labels.set(id, { id, line: lineNo, character: parsed.labelChar });
      symbols.push({
        name: id,
        kind: "label",
        line: lineNo,
        startChar: parsed.labelChar,
        endChar: parsed.labelChar + parsed.label.length
      });
    }

    if (/^PROC\b/.test(upper)) {
      sawProc = true;
      symbols.push({ name: "PROC", kind: "proc", line: lineNo, startChar: 0, endChar: 4 });
    }

    const tokenized = tokenize(code);
    for (let t = 0; t < tokenized.length; t += 1) {
      const tok = tokenized[t];
      if (tok.value === "DO") {
        doStack.push({ line: lineNo, char: parsed.codeOffset + tok.start });
      }
      if (tok.value === "END") {
        if (doStack.length === 0) {
          diagnostics.push(makeDiag(lineNo, parsed.codeOffset + tok.start, 3, 1, "Unmatched END."));
        } else {
          doStack.pop();
        }
      }
      if (tok.value === "GOTO") {
        const next = tokenized[t + 1];
        if (!next) {
          diagnostics.push(makeDiag(lineNo, parsed.codeOffset + tok.start, 4, 2, "GOTO is missing a label target."));
          continue;
        }
        gotos.push({
          label: normalize(next.value),
          line: lineNo,
          startChar: parsed.codeOffset + next.start,
          endChar: parsed.codeOffset + next.end
        });
      }
    }
  }

  while (doStack.length > 0) {
    const frame = doStack.pop();
    diagnostics.push(makeDiag(frame.line, frame.char, 2, 1, "DO block is not closed with END."));
  }

  if (!sawProc) {
    diagnostics.push(makeDiag(1, 0, 4, 2, "CLIST usually starts with PROC. None was found."));
  }

  for (const g of gotos) {
    if (!labels.has(g.label)) {
      diagnostics.push(makeDiag(g.line, g.startChar, Math.max(1, g.endChar - g.startChar), 1, `Unknown label '${g.label}' in GOTO.`));
    }
  }

  return { diagnostics, labels, gotos, symbols };
}

function parseLine(rawLine) {
  const raw = String(rawLine || "");
  if (!raw.trim()) {
    return null;
  }

  const trimmed = raw.trimStart();
  if (trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return null;
  }

  let line = raw;
  const inlineComment = line.indexOf("/*");
  if (inlineComment >= 0) {
    line = line.slice(0, inlineComment);
  }

  const labelMatch = line.match(/^\s*([A-Za-z$#@][A-Za-z0-9$#@_.-]*)\s*:\s*(.*)$/);
  if (labelMatch) {
    const label = labelMatch[1];
    const rest = labelMatch[2] || "";
    const labelIndex = line.indexOf(label);
    const offset = line.length - rest.length;
    return { label, labelChar: labelIndex, code: rest.trim(), codeOffset: offset + (rest.match(/^\s*/)[0] || "").length };
  }

  const leading = raw.match(/^\s*/)[0].length;
  return { label: null, labelChar: -1, code: line.trim(), codeOffset: leading };
}

function tokenize(code) {
  const out = [];
  const regex = /[A-Za-z$#@][A-Za-z0-9$#@_.-]*/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    out.push({
      value: normalize(match[0]),
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return out;
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function makeDiag(line, start, length, severity, message) {
  return {
    line: Math.max(1, line),
    startChar: Math.max(0, start),
    endChar: Math.max(1, start + Math.max(1, length)),
    severity,
    message
  };
}

function getWordAtPosition(text, line, character) {
  const lines = String(text || "").split(/\r?\n/);
  if (line < 0 || line >= lines.length) {
    return null;
  }
  const current = lines[line] || "";
  const re = /[A-Za-z$#@][A-Za-z0-9$#@_.-]*/g;
  let m;
  while ((m = re.exec(current)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (character >= start && character <= end) {
      return {
        word: normalize(m[0]),
        start,
        end
      };
    }
  }
  return null;
}

function keywordHover(word) {
  return HOVER_TEXT[normalize(word)] || null;
}

function completionItems() {
  return Array.from(KEYWORDS.values()).sort();
}

module.exports = {
  analyzeClist,
  completionItems,
  getWordAtPosition,
  keywordHover
};
