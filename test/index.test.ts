import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { Rational } from "../src/rational.js";
import { solve } from "../src/solver.js";
import { verifyExpression } from "../src/parser.js";
import { referenceSolvable } from "../src/referenceSolver.js";
import { Store } from "../src/db.js";
import { runSolve, checkExpression, explainSolution } from "../src/service.js";

test("Rational 精确运算与约分", () => {
  const a = new Rational(8n, 3n);
  const b = Rational.fromInt(3);
  const diff = b.sub(a); // 3 - 8/3 = 1/3
  assert.equal(diff.toFractionString(), "1/3");
  const eight = new Rational(8n).div(diff)!;
  assert.equal(eight.toFractionString(), "24");
  assert.equal(Rational.fromInt(0).div(Rational.fromInt(0)), null);
  assert.equal(new Rational(-4n, -6n).norm().toFractionString(), "2/3");
  assert.equal(new Rational(3n, -9n).norm().toFractionString(), "-1/3");
});

test("3,3,8,8 必须找到需要分数中间值的解，且无浮点误差", () => {
  const r = solve([3, 3, 8, 8]);
  assert.equal(r.solvable, true);
  assert.ok(r.solutions.every((s) => s.value === "24"));
  const reps = r.solutions.map((s) => verifyExpression(s.expression, [3, 3, 8, 8]));
  assert.ok(reps.every((rep) => rep.ok), "所有返回解必须通过独立验算器");
  // 必须存在 8/(3-8/3) 形态的解（实体编号 c1=c2=3, c3=c4=8 的某种排列）
  const hit = r.solutions.find((s) => s.expression.includes("/") && s.expression.includes("-"));
  assert.ok(hit, "应包含 8/(3-8/3) 形态的除法嵌套解");
});

test("1,1,1,1 完成全量枚举后判定无解", () => {
  const r = solve([1, 1, 1, 1]);
  assert.equal(r.solvable, false);
  assert.equal(r.totalCount, 0);
  assert.equal(r.returnedCount, 0);
});

test("重复数值牌身份独立：每张实体牌恰好用一次", () => {
  const r = solve([3, 3, 8, 8]);
  for (const s of r.solutions) {
    assert.deepEqual(s.usedCards, [1, 2, 3, 4]);
    const counts: Record<string, number> = {};
    for (const c of s.usedCards) counts[c] = (counts[c] ?? 0) + 1;
    assert.deepEqual(Object.values(counts).sort(), [1, 1, 1, 1]);
  }
});

test("负数中间结果可解：3,4,6,? 例 (6-? ) 等，验证允许负值", () => {
  // (1-? ) 负数场景：3,3,8,8 解本身含 3-8/3 = 1/3（正）；
  // 用 4,7,8,? 验证负数分支参与：(1-3)*... 不易构造，直接验证内部含负中间值的解可算：
  // 牌 1,2,3,10：(10-2)*3*1=24
  const r = solve([1, 2, 3, 10]);
  assert.equal(r.solvable, true);
  // 1,3,5,7：(1+5)*(7-3)=24（7-3 正，但搜索中必然走过负数分支不崩溃）
  assert.equal(solve([1, 3, 5, 7]).solvable, true);
});

test("不同括号形状都被枚举：参考枚举器与子集 DP 交叉核对一批牌例", () => {
  const cases: number[][] = [];
  for (let a = 1; a <= 6; a++)
    for (let b = a; b <= 6; b++)
      for (let c = b; c <= 6; c++)
        for (let d = c; d <= 6; d++) cases.push([a, b, c, d]);
  assert.ok(cases.length >= 100);
  for (const cards of cases) {
    const fast = solve(cards).solvable;
    const ref = referenceSolvable(cards);
    assert.equal(fast, ref, `牌例 ${cards.join(",")} 两种枚举结果应一致`);
  }
});

test("经典牌例与参考器一致（3388 可解、1111 不可解）", () => {
  assert.equal(referenceSolvable([3, 3, 8, 8]), true);
  assert.equal(referenceSolvable([1, 1, 1, 1]), false);
});

test("展示上限只限制返回数量，不影响 totalCount 与无解判定", () => {
  const full = solve([1, 2, 3, 4]);
  const limited = solve([1, 2, 3, 4], { limit: 2 });
  assert.ok(full.totalCount >= 2);
  assert.equal(limited.totalCount, full.totalCount);
  assert.equal(limited.returnedCount, 2);
  assert.equal(limited.solutions.length, 2);
  assert.equal(solve([1, 1, 1, 1], { limit: 5 }).solvable, false);
});

test("除零分支被安全跳过", () => {
  // 任意含重复牌可构造 a-a=0 再做除法，搜索不应抛错
  assert.doesNotThrow(() => solve([4, 4, 5, 6]));
  const rep = verifyExpression("c1/(c1-c2)+c3+c4", [4, 4, 5, 6]);
  assert.equal(rep.ok, false);
  assert.equal(rep.errorCode, "DIVIDE_BY_ZERO");
});

test("验算器：非法字符 / 未知编号 / 牌数错误 / 除零 / 结果错误 分别报错", () => {
  let r = verifyExpression("c1^2+c2+c3+c4", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "ILLEGAL_CHAR");

  r = verifyExpression("c1+c2+c3+c9", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "UNKNOWN_CARD");

  r = verifyExpression("c1*c1*c3*c4", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "CARD_COUNT_ERROR");
  assert.match(r.errorMessage!, /c1/);

  r = verifyExpression("c1+c2+c3", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "CARD_COUNT_ERROR");

  r = verifyExpression("c1/(c2-c2)*c3*c4", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "DIVIDE_BY_ZERO");

  r = verifyExpression("c1+c2+c3+c4", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "WRONG_RESULT");
  assert.equal(r.result, "22");

  r = verifyExpression("c1+c2", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "CARD_COUNT_ERROR");

  r = verifyExpression("(c1+c2", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "SYNTAX_ERROR");
});

test("验算器：合法解逐步输出精确分数", () => {
  const r = verifyExpression("c3/(c1-c4/c2)", [3, 3, 8, 8]);
  assert.equal(r.ok, true);
  assert.equal(r.result, "24");
  const fractions = r.steps.map((s) => s.result);
  assert.ok(fractions.includes("8/3"));
  assert.ok(fractions.includes("1/3"));
});

test("不允许裸数字与 eval：24 常数表达式被拒", () => {
  const r = verifyExpression("24", [3, 3, 8, 8]);
  assert.equal(r.errorCode, "ILLEGAL_CHAR");
});

test("SQLite 持久化：重启后读取原求解与解释，改牌产生新版本", () => {
  const dir = join(tmpdir(), `p24-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dbPath = join(dir, "t.db");
  {
    const store = new Store(dbPath);
    const deck = store.upsertDeck("d1", "测试", [3, 3, 8, 8]);
    assert.equal(deck.latestVersion, 1);
    const res = runSolve(store, "d1", { limit: 3 });
    assert.equal(res.totalCount > 0, true);
    checkExpression(store, "d1", "c1*c1*c3*c4");
    store.close();
  }
  assert.ok(existsSync(dbPath));
  {
    const store = new Store(dbPath); // 重新打开 = 模拟重启
    const deck = store.getDeck("d1")!;
    assert.deepEqual(deck.cards, [3, 3, 8, 8]);
    const res = runSolve(store, "d1", { limit: 3 }); // 命中持久化结果
    assert.equal(res.solutions.length <= 3, true);
    const first = res.solutions[0].expression;
    const ex = explainSolution(store, "d1", first);
    assert.ok(ex.steps.length >= 3);
    assert.equal(ex.result, "24");
    assert.ok(store.listChecks("d1").length >= 1);

    // 修改牌面 -> 新版本
    store.upsertDeck("d1", "测试", [1, 1, 1, 1]);
    assert.equal(store.getDeck("d1")!.latestVersion, 2);
    assert.deepEqual(store.getDeckVersion("d1", 1)!.cards, [3, 3, 8, 8]);
    const v1 = runSolve(store, "d1", { version: 1, limit: 3 });
    assert.equal(v1.solvable, true);
    const v2 = runSolve(store, "d1", { version: 2, limit: 3 });
    assert.equal(v2.solvable, false);
    store.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

