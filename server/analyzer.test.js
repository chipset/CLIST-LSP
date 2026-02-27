const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeClist, getWordAtPosition, keywordHover } = require("./analyzer");

test("flags missing PROC and unknown GOTO label", () => {
  const src = `START: SET A = 1\nGOTO MISSING`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.message.includes("starts with PROC")));
  assert.ok(a.diagnostics.some((d) => d.message.includes("Unknown label")));
});

test("detects unmatched END and unclosed DO", () => {
  const src = `PROC 0\nEND\nDO\nSET A=1`;
  const a = analyzeClist(src);

  assert.ok(a.diagnostics.some((d) => d.message.includes("Unmatched END")));
  assert.ok(a.diagnostics.some((d) => d.message.includes("not closed with END")));
});

test("captures labels and goto targets", () => {
  const src = `PROC 0\nLOOP: SET X = 1\nGOTO LOOP`;
  const a = analyzeClist(src);

  assert.ok(a.labels.has("LOOP"));
  assert.equal(a.gotos[0].label, "LOOP");
});

test("word lookup and hover text", () => {
  const src = `PROC 0\nIF &A = 1 THEN DO`;
  const word = getWordAtPosition(src, 1, 1);

  assert.equal(word.word, "IF");
  assert.ok(keywordHover("IF").includes("condition"));
});
