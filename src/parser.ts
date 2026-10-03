// 用户表达式解析器。
// 语法（仅接受四则运算、括号与实体牌引用，不含任何数字字面量）：
//   expr   := term (("+" | "-") term)*
//   term   := factor (("*" | "/") factor)*
//   factor := "(" expr ")" | card
//   card   := "c" digit | "#" digit        （digit 为 1..9 的实体牌编号）
// 不使用 eval / new Function，输入只被当作普通文本扫描。

import { ExprNode, isOp, Op } from "./ast.js";

export type ParseErrorCode =
  | "INVALID_CHAR"
  | "EXPECTED_CARD"
  | "UNEXPECTED_TOKEN"
  | "UNBALANCED_PAREN"
  | "UNEXPECTED_END";

export class ParseError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    message: string,
    readonly position?: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

interface Token {
  type: "card" | "op" | "lparen" | "rparen";
  value: string;
  pos: number;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "c" || ch === "C" || ch === "#") {
      const pos = i;
      const digit = input[i + 1];
      if (digit === undefined || !/[1-9]/.test(digit)) {
        throw new ParseError(
          "EXPECTED_CARD",
          `位置 ${pos} 的 "${ch}" 后必须紧跟 1..9 的牌编号`,
          pos,
        );
      }
      tokens.push({ type: "card", value: digit, pos });
      i += 2;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      throw new ParseError(
        "INVALID_CHAR",
        `位置 ${i} 出现裸数字 "${ch}"，请使用 c${ch}（或 #${ch}）引用实体牌`,
        i,
      );
    }
    throw new ParseError(
      "INVALID_CHAR",
      `位置 ${i} 含非法字符 "${ch}"，仅允许 c1 形式的牌、+ - * / ( ) 和空白`,
      i,
    );
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    if (this.tokens.length === 0) {
      throw new ParseError("UNEXPECTED_END", "表达式为空");
    }
    const node = this.parseExpr();
    if (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (token.type === "rparen") {
        throw new ParseError(
          "UNBALANCED_PAREN",
          `位置 ${token.pos} 出现多余的右括号`,
          token.pos,
        );
      }
      throw new ParseError(
        "UNEXPECTED_TOKEN",
        `位置 ${token.pos} 出现多余的 "${token.value}"`,
        token.pos,
      );
    }
    return node;
  }

  private parseExpr(): ExprNode {
    let left = this.parseTerm();
    while (this.matchOp("+") || this.matchOp("-")) {
      const op = this.previous().value as Op;
      const right = this.parseTerm();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  private parseTerm(): ExprNode {
    let left = this.parseFactor();
    while (this.matchOp("*") || this.matchOp("/")) {
      const op = this.previous().value as Op;
      const right = this.parseFactor();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  private parseFactor(): ExprNode {
    const token = this.peek();
    if (token === undefined) {
      throw new ParseError("UNEXPECTED_END", "表达式提前结束，缺少牌或括号内容");
    }
    if (token.type === "lparen") {
      this.index += 1;
      const inner = this.parseExpr();
      const close = this.peek();
      if (close === undefined || close.type !== "rparen") {
        throw new ParseError(
          "UNBALANCED_PAREN",
          `位置 ${token.pos} 的左括号缺少配对的右括号`,
          token.pos,
        );
      }
      this.index += 1;
      return inner;
    }
    if (token.type === "card") {
      this.index += 1;
      return { kind: "card", id: Number(token.value) };
    }
    if (token.type === "rparen") {
      throw new ParseError(
        "UNBALANCED_PAREN",
        `位置 ${token.pos} 出现多余的右括号`,
        token.pos,
      );
    }
    throw new ParseError(
      "UNEXPECTED_TOKEN",
      `位置 ${token.pos} 不应出现运算符 "${token.value}"`,
      token.pos,
    );
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private previous(): Token {
    return this.tokens[this.index - 1];
  }

  private matchOp(op: string): boolean {
    const token = this.tokens[this.index];
    if (token !== undefined && token.type === "op" && isOp(token.value) && token.value === op) {
      this.index += 1;
      return true;
    }
    return false;
  }
}

export function parseExpression(input: string): ExprNode {
  return new Parser(tokenize(input)).parse();
}
