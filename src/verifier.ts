// 用户表达式独立验算入口。
// 与求解器互不依赖：自行解析、核对实体牌使用情况，再逐步输出精确分数。

import { ExprNode } from "./ast.js";
import { EvalResult, evaluate } from "./evaluator.js";
import { ParseError, parseExpression } from "./parser.js";
import { Fraction } from "./rational.js";

export type VerifyErrorCode =
  | "PARSE_ERROR"
  | "UNKNOWN_CARD"
  | "CARD_COUNT_MISMATCH"
  | "CARD_REPEATED"
  | "CARD_MISSING"
  | "ZERO_DIVISION"
  | "NOT_TARGET";

export interface VerifyReport {
  ok: boolean;
  errorCode?: VerifyErrorCode;
  message: string;
  expression: string;
  cardsUsed: number[];
  steps?: EvalResult["steps"];
  result?: string;
  decimal?: string;
  target: number;
}

export function verifyExpression(
  input: string,
  cardValues: number[],
  target = 24,
): VerifyReport {
  const cardIds = cardValues.map((_, index) => index + 1);
  const cardMap = new Map<number, number>();
  cardValues.forEach((value, index) => cardMap.set(index + 1, value));

  let tree: ExprNode;
  try {
    tree = parseExpression(input);
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        ok: false,
        errorCode: "PARSE_ERROR",
        message: error.message,
        expression: input,
        cardsUsed: [],
        target,
      };
    }
    throw error;
  }

  const used = collectAllCardIds(tree);
  const unknown = used.filter((id) => !cardIds.includes(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      errorCode: "UNKNOWN_CARD",
      message: `表达式引用了不存在的牌编号：${[...new Set(unknown)].map((id) => `c${id}`).join("、")}；本牌例仅有 c1..c${cardIds.length}`,
      expression: input,
      cardsUsed: used,
      target,
    };
  }

  const counts = new Map<number, number>();
  for (const id of used) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (repeated.length > 0) {
    return {
      ok: false,
      errorCode: "CARD_REPEATED",
      message: `实体牌被重复使用：${repeated.map((id) => `c${id}（${counts.get(id)} 次）`).join("、")}；每张牌必须恰好出现一次`,
      expression: input,
      cardsUsed: used,
      target,
    };
  }

  const missing = cardIds.filter((id) => !counts.has(id));
  if (used.length !== cardIds.length || missing.length > 0) {
    return {
      ok: false,
      errorCode: "CARD_COUNT_MISMATCH",
      message: `牌数错误：表达式使用 ${used.length} 张牌，本牌例有 ${cardIds.length} 张；缺少 ${missing.map((id) => `c${id}`).join("、") || "无"}，每张牌必须恰好出现一次`,
      expression: input,
      cardsUsed: used,
      target,
    };
  }

  let evalResult: EvalResult;
  try {
    evalResult = evaluate(tree, cardMap);
  } catch (error) {
    if (error instanceof Error && error.name === "ZeroDivisionError") {
      return {
        ok: false,
        errorCode: "ZERO_DIVISION",
        message: "计算过程中出现除以零，表达式无定义",
        expression: input,
        cardsUsed: used,
        target,
      };
    }
    throw error;
  }

  const targetValue = Fraction.fromInt(target);
  const equals = evalResult.value.equals(targetValue);
  return {
    ok: equals,
    errorCode: equals ? undefined : "NOT_TARGET",
    message: equals
      ? `验算通过：精确结果等于 ${target}`
      : `结果不等于 ${target}：精确值为 ${evalResult.value.toString()}（${evalResult.value.toDecimalString()}）`,
    expression: input,
    cardsUsed: used,
    steps: evalResult.steps,
    result: evalResult.value.toString(),
    decimal: evalResult.value.toDecimalString(),
    target,
  };
}

function collectAllCardIds(node: ExprNode): number[] {
  if (node.kind === "card") {
    return [node.id];
  }
  return [...collectAllCardIds(node.left), ...collectAllCardIds(node.right)];
}
