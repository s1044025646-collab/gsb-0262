/**
 * 用户表达式解析与独立验算。
 *
 * 公开语法（实体牌语法）：
 *   - 牌引用：c1..cN（大小写不敏感，例如 C2），编号对应求解时的实体牌编号
 *   - 运算符：+ - * /，可加括号 ( )
 *   - 允许空白
 *   - 不允许出现数字字面量（防止用户直接写 24 等常数）、不允许其它字符
 *
 * 手写递归下降解析器，不使用 eval / new Function。
 */

import { Rational } from "./rational.js";
import type { ExprNode, Op } from "./solver.js";

export type VerifyErrorCode =
 | "EMPTY_EXPRESSION"
 | "ILLEGAL_CHAR"
 | "UNKNOWN_CARD"
 | "SYNTAX_ERROR"
 | "CARD_COUNT_ERROR"
 | "DIVIDE_BY_ZERO"
 | "WRONG_RESULT";

export class VerifyError extends Error {
  constructor(
    readonly code: VerifyErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

interface Token {
  type: "card" | "op" | "lparen" | "rparen";
  value: string;
  pos: number;
}

function tokenize(input: string, cardCount: number): Token[] {
  const tokens: Token[] = [];
  const re = /\s+|([cC])([0-9]+)|([0-9]+)|([+\-*/()])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIndex) {
      const bad = input.slice(lastIndex, m.index);
      throw new VerifyError("ILLEGAL_CHAR", `包含非法字符：${JSON.stringify(bad)}`, { near: bad });
    }
    lastIndex = re.lastIndex;
    if (m[1] !== undefined) {
      const id = parseInt(m[2], 10);
      if (id < 1 || id > cardCount) {
        throw new VerifyError("UNKNOWN_CARD", `未知牌编号：c${id}（本牌例只有 c1..c${cardCount}）`, {
          card: id,
        });
      }
      tokens.push({ type: "card", value: String(id), pos: m.index });
    } else if (m[4] !== undefined) {
      const ch = m[4];
      tokens.push({
        type: ch === "(" ? "lparen" : ch === ")" ? "rparen" : "op",
        value: ch,
        pos: m.index,
      });
    } else if (m[3] !== undefined) {
      // 裸数字字面量：视为非法（必须通过 cN 引用实体牌）
      throw new VerifyError(
        "ILLEGAL_CHAR",
        `不允许直接写数字 ${m[0]}，请使用 c编号 引用牌面（例如 c1）`,
        { near: m[0] },
      );
    } else {
      // 空白，忽略
    }
  }
  if (lastIndex < input.length) {
    throw new VerifyError("ILLEGAL_CHAR", `包含非法字符：${JSON.stringify(input.slice(lastIndex))}`);
  }
  if (tokens.length === 0) throw new VerifyError("EMPTY_EXPRESSION", "表达式为空");
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private cardValues: number[],
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parse(): ExprNode {
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new VerifyError("SYNTAX_ERROR", `多余的记号：${this.tokens[this.pos].value}`);
    }
    return node;
  }

  private parseExpr(): ExprNode {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.tokens[this.pos++].value as Op;
      const right = this.parseTerm();
      left = { kind: "bin", op, left, right, value: applyOp(op, left.value, right.value) };
    }
    return left;
  }

  private parseTerm(): ExprNode {
    let left = this.parseFactor();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const op = this.tokens[this.pos++].value as Op;
      const right = this.parseFactor();
      left = { kind: "bin", op, left, right, value: applyOp(op, left.value, right.value) };
    }
    return left;
  }

  private parseFactor(): ExprNode {
    const t = this.peek();
    if (!t) throw new VerifyError("SYNTAX_ERROR", "表达式不完整");
    if (t.type === "lparen") {
      this.pos++;
      const node = this.parseExpr();
      if (this.peek()?.type !== "rparen") throw new VerifyError("SYNTAX_ERROR", "缺少右括号 )");
      this.pos++;
      return node;
    }
    if (t.type === "op" && (t.value === "+" || t.value === "-")) {
      // 一元正负号：按 0 - x / 0 + x 处理（如 -c1+c2*c3*c4）
      this.pos++;
      const operand = this.parseFactor();
      const zero: ExprNode = { kind: "leaf", value: Rational.fromInt(0) };
      return {
        kind: "bin",
        op: t.value as Op,
        left: zero,
        right: operand,
        value: applyOp(t.value as Op, zero.value, operand.value),
      };
    }
    if (t.type === "card") {
      this.pos++;
      const idx = parseInt(t.value, 10) - 1;
      return { kind: "leaf", cardIndex: idx, value: Rational.fromInt(this.cardValues[idx]) };
    }
    throw new VerifyError("SYNTAX_ERROR", `记号位置有误：${t.value}`);
  }
}

function applyOp(op: Op, a: Rational, b: Rational): Rational {
  switch (op) {
    case "+":
      return a.add(b);
    case "-":
      return a.sub(b);
    case "*":
      return a.mul(b);
    case "/": {
      const r = a.div(b);
      if (r === null) {
        throw new VerifyError("DIVIDE_BY_ZERO", "表达式中出现除以零");
      }
      return r;
    }
  }
}

export interface VerifyStep {
  /** 子表达式（cN 形式） */
  subExpression: string;
  /** 代入牌值后的算式 */
  arithmetic: string;
  /** 本步精确结果 */
  result: string;
}

export interface VerifyReport {
  ok: boolean;
  expression: string;
  cardValues: number[];
  usedCards: number[];
  steps: VerifyStep[];
  result: string;
  equalsTarget: boolean;
  target: number;
  errorCode?: VerifyErrorCode;
  errorMessage?: string;
}

function leavesOf(node: ExprNode): number[] {
  if (node.kind === "leaf") return node.cardIndex === undefined ? [] : [node.cardIndex];
  return [...leavesOf(node.left!), ...leavesOf(node.right!)];
}

/** 把 AST 渲染成带牌面数值的算式（叶子处显示 n） */
function renderWithValues(node: ExprNode, values: number[]): string {
  if (node.kind === "leaf") return node.cardIndex === undefined ? "0" : String(values[node.cardIndex]);
  return `(${renderWithValues(node.left!, values)}${node.op}${renderWithValues(node.right!, values)})`;
}

/** 后序遍历收集计算步骤（内部节点），逐步给出精确分数 */
function collectSteps(node: ExprNode, values: number[], steps: VerifyStep[]): string {
  if (node.kind === "leaf") {
    return node.cardIndex === undefined ? "0" : `c${node.cardIndex + 1}`;
  }
  const l = collectSteps(node.left!, values, steps);
  const r = collectSteps(node.right!, values, steps);
  const sub = `(${l}${node.op}${r})`;
  steps.push({
    subExpression: sub,
    arithmetic: renderWithValues(node, values),
    result: node.value.toFractionString(),
  });
  return sub;
}

export function verifyExpression(
  expression: string,
  cards: number[],
  target = 24,
): VerifyReport {
  const base: Omit<VerifyReport, "ok" | "usedCards" | "steps" | "result" | "equalsTarget"> = {
    expression,
    cardValues: cards,
    target,
  };

  let root: ExprNode;
  try {
    const tokens = tokenize(expression, cards.length);
    root = new Parser(tokens, cards).parse();
  } catch (e) {
    if (e instanceof VerifyError) {
      return {
        ...base,
        ok: false,
        usedCards: [],
        steps: [],
        result: "",
        equalsTarget: false,
        errorCode: e.code,
        errorMessage: e.message,
      };
    }
    throw e;
  }

  const used = leavesOf(root).map((i) => i + 1);
  const expected = cards.map((_, i) => i + 1);
  const counts = new Map<number, number>();
  for (const c of used) counts.set(c, (counts.get(c) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, k]) => k > 1).map(([c]) => c);
  const missing = expected.filter((c) => !counts.has(c));

  const steps: VerifyStep[] = [];
  collectSteps(root, cards, steps);
  const result = root.value.toFractionString();
  const equalsTarget = root.value.equals(Rational.fromInt(target));

  if (duplicates.length > 0 || missing.length > 0 || used.length !== cards.length) {
    return {
      ...base,
      ok: false,
      usedCards: used.sort((a, b) => a - b),
      steps,
      result,
      equalsTarget,
      errorCode: "CARD_COUNT_ERROR",
      errorMessage: `每张牌必须恰好出现一次；重复使用：${
        duplicates.length ? duplicates.map((c) => `c${c}`).join("、") : "无"
      }；遗漏：${missing.length ? missing.map((c) => `c${c}`).join("、") : "无"}`,
    };
  }

  if (!equalsTarget) {
    return {
      ...base,
      ok: false,
      usedCards: used.sort((a, b) => a - b),
      steps,
      result,
      equalsTarget: false,
      errorCode: "WRONG_RESULT",
      errorMessage: `结果为 ${result}，不等于 ${target}`,
    };
  }

  return {
    ...base,
    ok: true,
    usedCards: used.sort((a, b) => a - b),
    steps,
    result,
    equalsTarget: true,
  };
}
