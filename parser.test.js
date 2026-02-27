const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRexxControlFlow, toDot } = require('./parser');

function hasEdge(graph, from, to, type) {
  return graph.edges.some((e) => e.from === from && e.to === to && e.type === type);
}

function findFirstNodeId(graph, prefix) {
  const node = graph.nodes.find((n) => n.id.startsWith(prefix));
  return node && node.id;
}

test('supports SIGNAL VALUE as dynamic terminal jump', () => {
  const src = `A:\n  SIGNAL VALUE expr\n  CALL NEXT\n`;
  const g = parseRexxControlFlow(src);

  const signalNode = findFirstNodeId(g, 'SIGNAL@');
  const signalValueNode = findFirstNodeId(g, 'SIGNAL_VALUE@');

  assert.ok(signalNode, 'expected SIGNAL node');
  assert.ok(signalValueNode, 'expected SIGNAL_VALUE node');
  assert.ok(hasEdge(g, signalNode, signalValueNode, 'signal-value'));
  assert.ok(hasEdge(g, signalValueNode, 'END', 'dynamic'));

  // CALL after terminal SIGNAL VALUE should not be reachable.
  assert.ok(!g.nodes.some((n) => n.id.startsWith('CALL@')));
});

test('supports labeled ITERATE and LEAVE resolution to matching DO frames', () => {
  const src = `outer:\n  DO i = 1 TO 2\n    inner: DO j = 1 TO 3\n      IF j = 2 THEN ITERATE inner\n      IF i = 2 THEN LEAVE outer\n      CALL STEP\n    END inner\n  END outer\n  EXIT\n`;
  const g = parseRexxControlFlow(src);

  const innerDo = g.nodes.find((n) => n.id.startsWith('DO@3'));
  const leaveNode = g.nodes.find((n) => n.id.startsWith('LEAVE@5'));
  const iterateNode = g.nodes.find((n) => n.id.startsWith('ITERATE@4'));
  const exitNode = g.nodes.find((n) => n.id.startsWith('EXIT@9'));

  assert.ok(innerDo, 'expected inner DO node');
  assert.ok(iterateNode, 'expected ITERATE node');
  assert.ok(leaveNode, 'expected LEAVE node');
  assert.ok(exitNode, 'expected EXIT node');

  assert.ok(hasEdge(g, iterateNode.id, innerDo.id, 'iterate'));
  assert.ok(hasEdge(g, leaveNode.id, exitNode.id, 'leave'));
});

test('supports inline ELSE IF chains', () => {
  const src = `A: IF A THEN CALL B ELSE IF C THEN CALL D ELSE CALL E`;
  const g = parseRexxControlFlow(src);

  const ifNodes = g.nodes.filter((n) => n.id.startsWith('IF@'));
  const callNodes = g.nodes.filter((n) => n.id.startsWith('CALL@'));

  assert.ok(ifNodes.length >= 2, 'expected nested IF nodes for ELSE IF');
  assert.ok(callNodes.length >= 3, 'expected CALL nodes for B, D, E paths');

  const hasThen = g.edges.some((e) => e.type === 'then');
  const hasElse = g.edges.some((e) => e.type === 'else');
  assert.ok(hasThen && hasElse, 'expected then/else branch edges');
});

test('supports END name matching for labeled DO/SELECT frames', () => {
  const src = `S1: SELECT\n  WHEN X = 1 THEN DO\n    CALL ONE\n  END S1\n  OTHERWISE CALL OTHER\nEND S1\n`;
  const g = parseRexxControlFlow(src);

  const selectNode = findFirstNodeId(g, 'SELECT@');
  const whenNode = findFirstNodeId(g, 'WHEN@');
  const otherwiseNode = findFirstNodeId(g, 'OTHERWISE@');

  assert.ok(selectNode, 'expected SELECT node');
  assert.ok(whenNode, 'expected WHEN node');
  assert.ok(otherwiseNode, 'expected OTHERWISE node');
  assert.ok(hasEdge(g, selectNode, whenNode, 'when'));
  assert.ok(g.edges.some((e) => e.type === 'when-next'), 'expected when-next edge');
});

test('splits semicolon-separated statements while preserving quoted semicolons', () => {
  const src = `A: CALL X; SAY 'A;B'; CALL Y`;
  const g = parseRexxControlFlow(src);

  const callEdges = g.edges.filter((e) => e.type === 'call');
  assert.ok(callEdges.some((e) => e.to === 'X'));
  assert.ok(callEdges.some((e) => e.to === 'Y'));

  // SAY statement becomes generic STMT and should not break on quoted ';'
  const stmtNode = findFirstNodeId(g, 'STMT@');
  assert.ok(stmtNode, 'expected generic statement node for SAY');
});

test('renders DOT output with expected graph header', () => {
  const g = parseRexxControlFlow('A: EXIT');
  const dot = toDot(g);
  assert.ok(dot.startsWith('digraph REXXControlFlow {'));
  assert.ok(dot.includes('rankdir=LR;'));
});
