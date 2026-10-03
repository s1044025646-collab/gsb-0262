import assert from "node:assert/strict";
import { test } from "node:test";
import { Fraction, ZeroDivisionError } from "../src/rational.js";

test("分数约分且分母保持为正", () => {
  assert.equal(Fraction.make(6n, 9n).toString(), "2/3");
  assert.equal(Fraction.make(-6n, 9n).toString(), "-2/3");
  assert.equal(Fraction.make(6n, -9n).toString(), "-2/3");
});

test("精确复现 8/(3-8/3)=24，不依赖浮点", () => {
  const three = Fraction.fromInt(3);
  const eight = Fraction.fromInt(8);
  const inner = three.sub(eight.div(three)); // 3 - 8/3 = 1/3
  assert.equal(inner.toString(), "1/3");
  assert.ok(eight.div(inner).equals(Fraction.fromInt(24)));
});

test("零作分母抛出去零错误", () => {
  assert.throws(() => Fraction.fromInt(1).div(Fraction.fromInt(0)), ZeroDivisionError);
});

test("接近但不等于的分数不会误判相等", () => {
  const almost = Fraction.make(23999999n, 1000000n);
  assert.ok(!almost.equals(Fraction.fromInt(24)));
});
