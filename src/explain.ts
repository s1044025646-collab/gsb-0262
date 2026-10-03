/**
 * 把求解 AST 转成逐步计算过程（精确分数，后序求值顺序）。
 */

import type { ExprNode } from "./solver.js";
import type { VerifyStep } from "./parser.js";

function renderCN(node: ExprNode): string {
  if (node.kind === "leaf") return `c${node.cardIndex! + 1}`;
  return `(${renderCN(node.left!)}${node.op}${renderCN(node.right!)})`;
}

function renderValues(node: ExprNode, values: number[]): string {
  if (node.kind === "leaf") return String(values[node.cardIndex!]);
  return `(${renderValues(node.left!, values)}${node.op}${renderValues(node.right!, values)})`;
}

function walk(node: ExprNode, values: number[], steps: VerifyStep[]): void {
  if (node.kind === "leaf") return;
  walk(node.left!, values, steps);
  walk(node.right!, values, steps);
  steps.push({
    subExpression: renderCN(node),
    arithmetic: renderValues(node, values),
    result: node.value.toFractionString(),
  });
}

export function explain(root: ExprNode, cards: number[]): VerifyStep[] {
  const steps: VerifyStep[] = [];
  walk(root, cards, steps);
  return steps;
}
