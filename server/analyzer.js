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

const COMMAND_SIGNATURES = {
  PROC: "PROC [param[=default] ...]",
  SET: "SET var = value",
  IF: "IF condition THEN [DO]",
  GOTO: "GOTO label",
  READ: "READ [dataset|ddname] [var]",
  WRITE: "WRITE value..."
};

const HOVER_TEXT = {
  PROC: "Declares CLIST parameters and starts executable logic.",
  IF: "Evaluates a condition. Typically includes THEN, optionally THEN DO ... END.",
  THEN: "Required action clause for IF in most CLIST forms.",
  ELSE: "Alternative branch for an IF condition.",
  DO: "Starts a block. Should be closed by END.",
  END: "Closes a DO block.",
  GOTO: "Transfers control to a label.",
  SET: "Assigns values to CLIST variables.",
  EXIT: "Terminates CLIST execution.",
  READ: "Reads input into CLIST context.",
  WRITE: "Writes output text or values."
};

const BUILTIN_VARS = new Set(["RC", "LASTCC", "SYSUID", "SYSPREF", "SYSNEST"]);

const DEFAULT_RULES = {
  maxColumns: 80,
  severityOverrides: {}
};

function analyzeClist(text, rules = {}) {
  const cfg = mergeRules(rules);
  const lines = String(text || "").split(/\r?\n/);

  const diagnostics = [];
  const labels = new Map();
  const gotos = [];
  const symbols = [];
  const symbolDefs = [];
  const symbolRefs = [];
  const variableDefs = [];
  const variableRefs = [];
  const foldingRanges = [];

  const doStack = [];
  const ifStack = [];
  const labelMeta = [];

  let sawProc = false;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i] || "";

    if (raw.length > cfg.maxColumns) {
      diagnostics.push(
        makeDiag(
          lineNo,
          cfg.maxColumns,
          Math.max(1, raw.length - cfg.maxColumns),
          ruleSeverity("max-columns", 1, cfg),
          `Line exceeds ${cfg.maxColumns} columns (${raw.length}/${cfg.maxColumns}).`,
          "max-columns"
        )
      );
    }

    const parsed = parseLine(raw);
    if (!parsed || !parsed.code) {
      continue;
    }

    const code = parsed.code;
    const upper = code.toUpperCase();
    const tokenized = tokenize(code);

    if (hasUnbalancedQuotes(code)) {
      diagnostics.push(
        makeDiag(lineNo, parsed.codeOffset, Math.max(1, code.length), ruleSeverity("quote-balance", 1, cfg), "Unbalanced quote in line.", "quote-balance")
      );
    }

    const parenIssue = findFirstParenIssue(code);
    if (parenIssue >= 0) {
      diagnostics.push(
        makeDiag(lineNo, parsed.codeOffset + parenIssue, 1, ruleSeverity("paren-balance", 1, cfg), "Unbalanced parenthesis in line.", "paren-balance")
      );
    }

    if (parsed.label) {
      const id = normalize(parsed.label);
      if (labels.has(id)) {
        const prev = labels.get(id);
        diagnostics.push(
          makeDiag(
            lineNo,
            parsed.labelChar,
            parsed.label.length,
            ruleSeverity("duplicate-label", 1, cfg),
            `Duplicate label '${id}' (previously defined on line ${prev.line}).`,
            "duplicate-label"
          )
        );
      }

      labels.set(id, { id, line: lineNo, character: parsed.labelChar, depth: doStack.length });
      labelMeta.push({ id, line: lineNo });
      symbols.push({
        name: id,
        kind: "label",
        line: lineNo,
        startChar: parsed.labelChar,
        endChar: parsed.labelChar + parsed.label.length
      });
      symbolDefs.push({
        name: id,
        type: "label",
        line: lineNo,
        startChar: parsed.labelChar,
        endChar: parsed.labelChar + parsed.label.length
      });
    }

    if (/^PROC\b/.test(upper)) {
      sawProc = true;
      symbols.push({ name: "PROC", kind: "proc", line: lineNo, startChar: parsed.codeOffset, endChar: parsed.codeOffset + 4 });
      symbolDefs.push({ name: "PROC", type: "proc", line: lineNo, startChar: parsed.codeOffset, endChar: parsed.codeOffset + 4 });
      validateProcParams(code, lineNo, parsed.codeOffset, diagnostics, variableDefs, cfg);
    }

    if (/^SET\b/.test(upper)) {
      validateSetStatement(code, lineNo, parsed.codeOffset, diagnostics, variableDefs, cfg);
    }

    if (/^IF\b/.test(upper)) {
      const thenIdx = upper.indexOf(" THEN");
      if (thenIdx < 0 && !/\bTHEN\b/.test(upper)) {
        diagnostics.push(
          makeDiag(
            lineNo,
            parsed.codeOffset,
            2,
            ruleSeverity("if-missing-then", 1, cfg),
            "IF statement should include THEN.",
            "if-missing-then"
          )
        );
      }
      ifStack.push({ line: lineNo, char: parsed.codeOffset });
      if (/\bTHEN\s+DO\b/.test(upper)) {
        doStack.push({ line: lineNo, char: parsed.codeOffset + upper.indexOf("DO"), kind: "IF" });
      }
    }

    if (/^ELSE\b/.test(upper) && ifStack.length === 0) {
      diagnostics.push(
        makeDiag(lineNo, parsed.codeOffset, 4, ruleSeverity("else-without-if", 1, cfg), "ELSE without matching IF.", "else-without-if")
      );
    }

    for (let t = 0; t < tokenized.length; t += 1) {
      const tok = tokenized[t];
      if (tok.value === "DO") {
        if (!/\bTHEN\s+DO\b/.test(upper) || t !== tokenized.findIndex((x) => x.value === "DO")) {
          doStack.push({ line: lineNo, char: parsed.codeOffset + tok.start, kind: "DO" });
        }
      }

      if (tok.value === "END") {
        if (doStack.length === 0) {
          diagnostics.push(
            makeDiag(lineNo, parsed.codeOffset + tok.start, 3, ruleSeverity("end-unmatched", 1, cfg), "Unmatched END.", "end-unmatched")
          );
        } else {
          const frame = doStack.pop();
          if (frame.line < lineNo) {
            foldingRanges.push({ startLine: frame.line - 1, endLine: lineNo - 1 });
          }
          if (frame.kind === "IF" && ifStack.length > 0) {
            ifStack.pop();
          }
        }
      }

      if (tok.value === "GOTO") {
        const next = tokenized[t + 1];
        if (!next) {
          diagnostics.push(
            makeDiag(
              lineNo,
              parsed.codeOffset + tok.start,
              4,
              ruleSeverity("goto-missing-target", 1, cfg),
              "GOTO is missing a label target.",
              "goto-missing-target"
            )
          );
          continue;
        }

        gotos.push({
          label: normalize(next.value),
          line: lineNo,
          depth: doStack.length,
          startChar: parsed.codeOffset + next.start,
          endChar: parsed.codeOffset + next.end
        });
        symbolRefs.push({
          name: normalize(next.value),
          type: "label",
          line: lineNo,
          startChar: parsed.codeOffset + next.start,
          endChar: parsed.codeOffset + next.end
        });
      }
    }

    validateCommandArgs(code, upper, lineNo, parsed.codeOffset, diagnostics, cfg);
    collectVariableRefs(code, lineNo, parsed.codeOffset, variableRefs);
  }

  while (doStack.length > 0) {
    const frame = doStack.pop();
    diagnostics.push(
      makeDiag(frame.line, frame.char, 2, ruleSeverity("do-unclosed", 1, cfg), "DO block is not closed with END.", "do-unclosed")
    );
  }

  while (ifStack.length > 0) {
    const frame = ifStack.pop();
    diagnostics.push(
      makeDiag(frame.line, frame.char, 2, ruleSeverity("if-unclosed", 2, cfg), "IF block appears to be incomplete.", "if-unclosed")
    );
  }

  if (!sawProc) {
    diagnostics.push(
      makeDiag(1, 0, 4, ruleSeverity("missing-proc", 2, cfg), "CLIST usually starts with PROC. None was found.", "missing-proc")
    );
  }

  for (const g of gotos) {
    const target = labels.get(g.label);
    if (!target) {
      diagnostics.push(
        makeDiag(
          g.line,
          g.startChar,
          Math.max(1, g.endChar - g.startChar),
          ruleSeverity("goto-unknown-label", 1, cfg),
          `Unknown label '${g.label}' in GOTO.`,
          "goto-unknown-label"
        )
      );
      continue;
    }

    if (target.depth > g.depth) {
      diagnostics.push(
        makeDiag(
          g.line,
          g.startChar,
          Math.max(1, g.endChar - g.startChar),
          ruleSeverity("goto-unsafe-depth", 2, cfg),
          `GOTO '${g.label}' jumps into a deeper DO block.`,
          "goto-unsafe-depth"
        )
      );
    }
  }

  for (const label of labelMeta) {
    if (label.line === 1) {
      continue;
    }
    const isTarget = gotos.some((g) => g.label === label.id);
    if (!isTarget) {
      diagnostics.push(
        makeDiag(
          label.line,
          0,
          label.id.length,
          ruleSeverity("label-unreachable", 3, cfg),
          `Label '${label.id}' is never targeted by GOTO.`,
          "label-unreachable"
        )
      );
    }
  }

  const defSet = new Set(variableDefs.map((d) => normalize(d.name)));
  const refSet = new Set(variableRefs.map((r) => normalize(r.name)));

  for (const ref of variableRefs) {
    const id = normalize(ref.name);
    if (BUILTIN_VARS.has(id) || defSet.has(id)) {
      continue;
    }
    diagnostics.push(
      makeDiag(
        ref.line,
        ref.startChar,
        Math.max(1, ref.endChar - ref.startChar),
        ruleSeverity("var-undefined", 2, cfg),
        `Variable '${id}' is referenced before assignment.`,
        "var-undefined"
      )
    );
  }

  for (const def of variableDefs) {
    const id = normalize(def.name);
    const used = refSet.has(id);
    if (!used) {
      diagnostics.push(
        makeDiag(
          def.line,
          def.startChar,
          Math.max(1, def.endChar - def.startChar),
          ruleSeverity("var-unused", 3, cfg),
          `Variable '${id}' is assigned but never used.`,
          "var-unused"
        )
      );
    }
  }

  return {
    diagnostics,
    labels,
    gotos,
    symbols,
    symbolDefs,
    symbolRefs,
    variableDefs,
    variableRefs,
    foldingRanges
  };
}

function validateProcParams(code, lineNo, codeOffset, diagnostics, variableDefs, cfg) {
  const paramPart = code.replace(/^PROC\b/i, "").trim();
  if (!paramPart) {
    return;
  }

  const rawParams = paramPart.split(/[\s,]+/).filter(Boolean);
  const seen = new Set();

  for (const raw of rawParams) {
    const name = normalize(raw.split("=")[0] || "");
    if (!name || /^\d+$/.test(name)) {
      continue;
    }
    const idx = code.toUpperCase().indexOf(name);

    if (seen.has(name)) {
      diagnostics.push(
        makeDiag(
          lineNo,
          Math.max(codeOffset, codeOffset + idx),
          Math.max(1, name.length),
          ruleSeverity("proc-dup-param", 1, cfg),
          `Duplicate PROC parameter '${name}'.`,
          "proc-dup-param"
        )
      );
    }

    seen.add(name);
    variableDefs.push({
      name,
      line: lineNo,
      startChar: Math.max(0, codeOffset + idx),
      endChar: Math.max(1, codeOffset + idx + name.length)
    });
  }
}

function validateSetStatement(code, lineNo, codeOffset, diagnostics, variableDefs, cfg) {
  const m = code.match(/^SET\s+([A-Za-z$#@][A-Za-z0-9$#@_.-]*)\s*=\s*(.+)$/i);
  if (!m) {
    diagnostics.push(
      makeDiag(lineNo, codeOffset, 3, ruleSeverity("set-invalid", 1, cfg), "SET should be in the form: SET var = value.", "set-invalid")
    );
    return;
  }

  const name = normalize(m[1]);
  const nameIdx = code.toUpperCase().indexOf(name);
  variableDefs.push({
    name,
    line: lineNo,
    startChar: codeOffset + Math.max(0, nameIdx),
    endChar: codeOffset + Math.max(1, nameIdx + name.length)
  });
}

function validateCommandArgs(code, upper, lineNo, codeOffset, diagnostics, cfg) {
  if (/^READ\b/.test(upper)) {
    const args = code.replace(/^READ\b/i, "").trim();
    if (!args) {
      diagnostics.push(
        makeDiag(lineNo, codeOffset, 4, ruleSeverity("read-missing-args", 1, cfg), "READ is missing arguments.", "read-missing-args")
      );
    }
  }

  if (/^WRITE\b/.test(upper)) {
    const args = code.replace(/^WRITE\b/i, "").trim();
    if (!args) {
      diagnostics.push(
        makeDiag(lineNo, codeOffset, 5, ruleSeverity("write-missing-args", 1, cfg), "WRITE is missing arguments.", "write-missing-args")
      );
    }
  }
}

function collectVariableRefs(code, lineNo, codeOffset, variableRefs) {
  const varRegex = /(?:&)?([A-Za-z$#@][A-Za-z0-9$#@_.-]*)/g;
  let m;
  while ((m = varRegex.exec(code)) !== null) {
    const name = normalize(m[1]);
    if (!name || KEYWORDS.has(name)) {
      continue;
    }

    if (looksLikeLabelContext(code, m.index)) {
      continue;
    }

    variableRefs.push({
      name,
      line: lineNo,
      startChar: codeOffset + m.index,
      endChar: codeOffset + m.index + m[0].length
    });
  }
}

function looksLikeLabelContext(code, startIdx) {
  const before = code.slice(0, startIdx).toUpperCase();
  return /\bGOTO\s*$/.test(before);
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
    const lead = rest.match(/^\s*/)[0] || "";
    return {
      label,
      labelChar: labelIndex,
      code: rest.trim(),
      codeOffset: offset + lead.length
    };
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

function hasUnbalancedQuotes(code) {
  let quote = null;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (!quote && (ch === "'" || ch === '"')) {
      quote = ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
    }
  }
  return Boolean(quote);
}

function findFirstParenIssue(code) {
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        return i;
      }
    }
  }
  if (depth > 0) {
    return code.lastIndexOf("(");
  }
  return -1;
}

function normalize(value) {
  return String(value || "").replace(/^&/, "").trim().toUpperCase();
}

function mergeRules(rules) {
  return {
    maxColumns: Number(rules.maxColumns || DEFAULT_RULES.maxColumns),
    severityOverrides: { ...DEFAULT_RULES.severityOverrides, ...(rules.severityOverrides || {}) }
  };
}

function ruleSeverity(rule, fallback, cfg) {
  const value = cfg?.severityOverrides?.[rule];
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return fallback;
}

function makeDiag(line, start, length, severity, message, code = undefined) {
  return {
    line: Math.max(1, line),
    startChar: Math.max(0, start),
    endChar: Math.max(1, start + Math.max(1, length)),
    severity,
    message,
    code
  };
}

function getWordAtPosition(text, line, character) {
  const lines = String(text || "").split(/\r?\n/);
  if (line < 0 || line >= lines.length) {
    return null;
  }
  const current = lines[line] || "";
  const re = /(?:&)?[A-Za-z$#@][A-Za-z0-9$#@_.-]*/g;
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

function commandSignature(name) {
  return COMMAND_SIGNATURES[normalize(name)] || null;
}

module.exports = {
  analyzeClist,
  completionItems,
  getWordAtPosition,
  keywordHover,
  commandSignature
};
