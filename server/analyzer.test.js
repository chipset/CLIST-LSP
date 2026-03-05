const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeClist, getWordAtPosition, keywordHover, commandSignature } = require("./analyzer");

test("flags missing PROC and unknown GOTO label", () => {
  const src = `START: SET A = 1\nGOTO MISSING`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.code === "missing-proc"));
  assert.ok(a.diagnostics.some((d) => d.code === "goto-unknown-label"));
});

test("detects unmatched END and unclosed DO", () => {
  const src = `PROC 0\nEND\nDO\nSET A=1`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.code === "end-unmatched"));
  assert.ok(a.diagnostics.some((d) => d.code === "do-unclosed"));
});

test("captures labels and goto targets", () => {
  const src = `PROC P1\nLOOP: SET X = 1\nGOTO LOOP`;
  const a = analyzeClist(src);

  assert.ok(a.labels.has("LOOP"));
  assert.equal(a.gotos[0].label, "LOOP");
  assert.ok(a.symbolDefs.some((s) => s.type === "label" && s.name === "LOOP"));
  assert.ok(a.symbolRefs.some((s) => s.type === "label" && s.name === "LOOP"));
});

test("word lookup, hover and signatures", () => {
  const src = `PROC 0\nIF &A = 1 THEN DO`;
  const word = getWordAtPosition(src, 1, 1);

  assert.equal(word.word, "IF");
  assert.ok(keywordHover("IF").includes("condition"));
  assert.ok(commandSignature("SET").includes("SET"));
});

test("reports error for lines wider than 80 columns", () => {
  const src = `PROC 0\nSET A = ${"X".repeat(75)}`;
  const a = analyzeClist(src);
  const widthDiag = a.diagnostics.find((d) => d.code === "max-columns");

  assert.ok(widthDiag);
  assert.equal(widthDiag.severity, 1);
  assert.ok(widthDiag.message.includes("exceeds 80 columns"));
});

test("validates IF, SET and READ/WRITE argument shapes", () => {
  const src = `PROC\nIF &A = 1\nSET BAD\nREAD\nWRITE`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.code === "if-missing-then"));
  assert.ok(a.diagnostics.some((d) => d.code === "set-invalid"));
  assert.ok(a.diagnostics.some((d) => d.code === "read-missing-args"));
  assert.ok(a.diagnostics.some((d) => d.code === "write-missing-args"));
});

test("reports duplicate PROC params and duplicate labels", () => {
  const src = `PROC A A\nLBL: SET A=1\nLBL: SET B=2`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.code === "proc-dup-param"));
  assert.ok(a.diagnostics.some((d) => d.code === "duplicate-label"));
});

test("reports unsafe goto depth and basic folding", () => {
  const src = `PROC\nDO\n  INNER: SET A=1\nEND\nGOTO INNER`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.code === "goto-unsafe-depth"));
  assert.ok((a.foldingRanges || []).length > 0);
});
