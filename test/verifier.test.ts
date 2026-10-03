import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyExpression } from "../src/verifier.js";

const cards3388 = [3, 3, 8, 8];

test("合法外部解通过并给出分数步骤", () => {
  // 8(c4)/(3(c1)-8(c3)/3(c2))=24，四张实体牌各用一次。
  const report = verifyExpression("c4/(c1-c3/c2)", cards3388);
  assert.equal(report.ok, true);
  assert.equal(report.result, "24");
  assert.ok((report.steps?.length ?? 0) >= 3);
});

test("未知编号报错", () => {
  const report = verifyExpression("c5+c1+c2+c3", cards3388);
  assert.equal(report.ok, false);
  assert.equal(report.errorCode, "UNKNOWN_CARD");
});

test("重复使用同一张实体牌报错（即使数值重复也不行）", () => {
  const report = verifyExpression("c3/(c1-c1/c2)", cards3388);
  assert.equal(report.errorCode, "CARD_REPEATED");
});

test("缺牌导致牌数错误", () => {
  const report = verifyExpression("c1+c2+c3", cards3388);
  assert.equal(report.errorCode, "CARD_COUNT_MISMATCH");
});

test("除零单独报错", () => {
  // c1 与 c2 是数值都为 3 的两张不同实体牌，c1-c2=0 且四张牌各用一次。
  const report = verifyExpression("c3/(c1-c2)+c4", cards3388);
  assert.equal(report.errorCode, "ZERO_DIVISION");
});

test("结果不等于 24 给出精确值", () => {
  const report = verifyExpression("c1+c2+c3-c4", cards3388); // 3+3+8-8=6
  assert.equal(report.errorCode, "NOT_TARGET");
  assert.equal(report.result, "6");
});

test("非法字符被拦截且未执行任何输入", () => {
  const report = verifyExpression("process.exit(1)", cards3388);
  assert.equal(report.errorCode, "PARSE_ERROR");
});
