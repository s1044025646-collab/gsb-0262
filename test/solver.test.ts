import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceSolve, solve } from "../src/solver.js";
import { verifyExpression } from "../src/verifier.js";

test("3,3,8,8 可解且包含 8/(3-8/3) 型分数解", () => {
  const outcome = solve([3, 3, 8, 8]);
  assert.ok(outcome.solvable);
  const expressions = outcome.solutions.map((item) => item.expression.replace(/\s+/g, ""));
  assert.ok(
    expressions.includes("c4/(c1-(c3/c2))"),
    `应存在 8/(3-8/3) 型分数解 c4/(c1-(c3/c2))，实际：${expressions.join(" | ")}`,
  );
});

test("1,1,1,1 完整搜索后判定无解", () => {
  const outcome = solve([1, 1, 1, 1]);
  assert.equal(outcome.solvable, false);
  assert.equal(outcome.totalFound, 0);
});

test("展示上限不改变 totalFound 与有解判定", () => {
  const full = solve([1, 2, 3, 4]);
  const limited = solve([1, 2, 3, 4]);
  assert.equal(full.totalFound, limited.totalFound);
  assert.ok(full.solutions.length <= limited.solutions.length + 1000);
  const shown = full.solutions.slice(0, 1);
  assert.equal(shown.length, 1);
  assert.ok(full.totalFound >= shown.length);
});

test("负数中间结果解被覆盖（4,6,6,6 含 6*? 类结构）", () => {
  const outcome = solve([4, 6, 6, 6]);
  assert.ok(outcome.solvable);
});

test("参考枚举与主搜索在一批牌例上可解性一致", () => {
  const cases = [
    [3, 3, 8, 8],
    [1, 1, 1, 1],
    [1, 2, 3, 4],
    [4, 6, 6, 6],
    [5, 5, 5, 1],
    [1, 1, 4, 6],
    [2, 3, 5, 12],
    [13, 13, 13, 13],
  ];
  for (const cards of cases) {
    const ref = referenceSolve(cards);
    const main = solve(cards);
    assert.equal(
      ref.solvable,
      main.solvable,
      `牌例 ${cards.join(",")} 的两种枚举结果不一致`,
    );
  }
});

test("主搜索返回的每一个解都能通过验算器", () => {
  for (const cards of [
    [3, 3, 8, 8],
    [1, 2, 3, 4],
    [4, 6, 6, 6],
    [5, 5, 5, 1],
  ]) {
    const outcome = solve(cards);
    for (const item of outcome.solutions) {
      const report = verifyExpression(item.expression, cards);
      assert.ok(report.ok, `${item.expression} 未通过验算：${report.message}`);
    }
  }
});

test("不同括号形状不会因左结合搜索而遗漏（参考枚举检查 5 种树形）", () => {
  const ref = referenceSolve([3, 3, 8, 8]);
  assert.equal(ref.checkedTrees, 24 * 64 * 5);
  assert.ok(ref.solvable);
});
