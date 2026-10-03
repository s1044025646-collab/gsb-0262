// 对语法树进行精确求值，并生成逐步分数计算过程。

import { ExprNode, Op } from "./ast.js";
import { Fraction, ZeroDivisionError } from "./rational.js";

export interface EvalStep {
  // 本子表达式的渲染形式，例如 (8 / 3)
  expr: string;
  op: Op | null;
  leftValue: string | null;
  rightValue: string | null;
  // 本子表达式的精确结果
  value: string;
  decimal: string;
}

export interface EvalResult {
  value: Fraction;
  steps: EvalStep[];
}

export function collectCardIds(node: ExprNode): number[] {
  if (node.kind === "card") {
    return [node.id];
  }
  return [...collectCardIds(node.left), ...collectCardIds(node.right)];
}

export function evaluate(node: ExprNode, cards: Map<number, number>): EvalResult {
  const steps: EvalStep[] = [];
  const value = evalNode(node, cards, steps);
  return { value, steps };
}

function evalNode(
  node: ExprNode,
  cards: Map<number, number>,
  steps: EvalStep[],
): Fraction {
  if (node.kind === "card") {
    return Fraction.fromInt(cards.get(node.id) as number);
  }
  const left = evalNode(node.left, cards, steps);
  const right = evalNode(node.right, cards, steps);
  let value: Fraction;
  switch (node.op) {
    case "+":
      value = left.add(right);
      break;
    case "-":
      value = left.sub(right);
      break;
    case "*":
      value = left.mul(right);
      break;
    case "/":
      if (right.isZero()) {
        throw new ZeroDivisionError();
      }
      value = left.div(right);
      break;
  }
  steps.push({
    expr: render(node),
    op: node.op,
    leftValue: left.toString(),
    rightValue: right.toString(),
    value: value.toString(),
    decimal: value.toDecimalString(),
  });
  return value;
}

// 依据语法树天然的括号形状渲染，保留用户/搜索产生的分组结构。
export function render(node: ExprNode): string {
  if (node.kind === "card") {
    return `c${node.id}`;
  }
  return `(${render(node.left)} ${node.op} ${render(node.right)})`;
}

// 去掉最外层多余括号，便于展示阅读。
export function renderPretty(node: ExprNode): string {
  const raw = render(node);
  return raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
}
