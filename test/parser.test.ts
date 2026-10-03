import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpression } from "../src/parser.js";

test("支持 c 与 # 两种牌引用", () => {
  assert.equal(parseExpression("c1+c2").kind, "bin");
  assert.equal(parseExpression("#3/(#1-#3/#2)").kind, "bin");
});

test("裸数字属于非法字符", () => {
  assert.throws(
    () => parseExpression("8/3"),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "INVALID_CHAR",
  );
});

test("括号不配对报错", () => {
  const isUnbalanced = (error: unknown) =>
    error instanceof Error && (error as { code?: string }).code === "UNBALANCED_PAREN";
  assert.throws(() => parseExpression("(c1+c2"), isUnbalanced);
  assert.throws(() => parseExpression("c1+c2)"), isUnbalanced);
});

test("运算符位置非法时报错", () => {
  assert.throws(
    () => parseExpression("c1 + * c2"),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "UNEXPECTED_TOKEN",
  );
});
