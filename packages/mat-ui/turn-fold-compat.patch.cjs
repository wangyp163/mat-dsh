'use strict'

const TARGET = {
  package: '@deepseek-ai/dsh-client-ui-conversation',
  version: '>=0.1.0-rc.8 <0.2.0-0',
  file: 'lib/client.js',
}

const ACTIVITY_BEFORE = `function __ch4acko3DshTurnFoldIsActivityNode(node) {
  if (node.kind === "tool-call" || node.kind === "context") return true;
  if (node.kind !== "assistant-step" || __ch4acko3DshTurnFoldReasoningTexts(node).length === 0) return false;
  return __ch4acko3DshTurnFoldHasToolCallBlock(node) || !__ch4acko3DshTurnFoldHasVisibleNonReasoning(node);
}`

const ACTIVITY_AFTER = `function __matDshTurnFoldIsUnsettledToolNode(node) {
  if (node.kind !== "tool-call") return false;
  var root = node.data === void 0 ? void 0 : node.data.root;
  return root !== void 0 && !("kind" in root);
}
function __ch4acko3DshTurnFoldIsActivityNode(node) {
  if (node.kind === "tool-call") return !__matDshTurnFoldIsUnsettledToolNode(node);
  if (node.kind === "context") return true;
  if (node.kind !== "assistant-step" || __ch4acko3DshTurnFoldReasoningTexts(node).length === 0) return false;
  return __ch4acko3DshTurnFoldHasToolCallBlock(node) || !__ch4acko3DshTurnFoldHasVisibleNonReasoning(node);
}`

const RENDER_REPLACEMENTS = [
  [
    'if (FOLD_KINDS[node.kind] === true) {\n      if (plan.firstActivityOrder < 0) plan.firstActivityOrder = i;',
    'if (FOLD_KINDS[node.kind] === true && !__matDshTurnFoldIsUnsettledToolNode(node)) {\n      if (plan.firstActivityOrder < 0) plan.firstActivityOrder = i;',
  ],
  [
    'if (foldable && FOLD_KINDS[node.kind] === true && key !== plan.closingKey) continue;',
    'if (foldable && FOLD_KINDS[node.kind] === true && !__matDshTurnFoldIsUnsettledToolNode(node) && key !== plan.closingKey) continue;',
  ],
]

function replaceExactlyOnce(source, before, after) {
  const first = source.indexOf(before)
  if (first < 0 || first !== source.lastIndexOf(before)) {
    throw new Error('mat-ui: dsh-turn-fold runtime shape changed')
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

module.exports = [
  {
    id: 'preserve-unsettled-turn-fold-tools',
    description: 'Keeps running and interactive tool rows mounted outside collapsed Turn Fold activity groups.',
    target: TARGET,
    after: ['@ch4acko3/dsh-turn-fold'],
    select: 'FunctionDeclaration[name.name="__ch4acko3DshTurnFoldIsActivityNode"]',
    expect: 1,
    apply({ node, sourceFile, edit }) {
      const source = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd())
      if (source !== ACTIVITY_BEFORE) throw new Error('mat-ui: dsh-turn-fold activity predicate changed')
      edit.overwrite(node.getStart(sourceFile), node.getEnd(), ACTIVITY_AFTER)
    },
  },
  {
    id: 'exclude-unsettled-tools-from-turn-plan',
    description: 'Excludes unsettled tool rows from completed-turn disclosures until their result is projected.',
    target: TARGET,
    after: ['@ch4acko3/dsh-turn-fold'],
    select: 'FunctionDeclaration[name.name="__ch4acko3DshTurnFoldRender"]',
    expect: 1,
    apply({ node, sourceFile, edit }) {
      let source = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd())
      for (const [before, after] of RENDER_REPLACEMENTS) source = replaceExactlyOnce(source, before, after)
      edit.overwrite(node.getStart(sourceFile), node.getEnd(), source)
    },
  },
]
