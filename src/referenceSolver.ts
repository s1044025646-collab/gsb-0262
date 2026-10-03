/**
 * 独立参考枚举器：与 solver.ts 的子集 DP 完全不同的写法，用于交叉核对。
 *
 * 方法：
 *   1. 独立枚举四张实体牌的全部 4! 个叶子排列（含重复数值，身份独立）；
 *   2. 枚举三个内部节点上各 4 个运算符（+ - * /）共 4^3 种组合，
 *      减法/除法两个方向通过“叶子排列 + 操作数顺序”自然覆盖；
 *   3. 枚举 4 个叶子的全部 5 种满二叉树（Catalan(3)=5）形状：
 *        (((a op b) op c) op d)
 *        ((a op (b op c)) op d)
 *        ((a op b) op (c op d))
 *        (a op ((b op c) op d))
 *        (a op (b op (c op d)))
 *   4. 有理数精确计算，除零分支跳过；结果等于目标即判可解。
 */

import { Rational } from "./rational.js";

type BOp = "+" | "-" | "*" | "/";

const OPS: BOp[] = ["+", "-", "*", "/"];

function calc(op: BOp, a: Rational, b: Rational): Rational | null {
  switch (op) {
    case "+":
      return a.add(b);
    case "-":
      return a.sub(b);
    case "*":
      return a.mul(b);
    case "/":
      return a.div(b);
  }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

/** 只返回可解性布尔值；参数为 4 张牌（数值 1..13） */
export function referenceSolvable(cards: number[], target = 24): boolean {
  if (cards.length !== 4) throw new Error("参考枚举器仅支持 4 张牌");
  const indices = [0, 1, 2, 3];
  const t = Rational.fromInt(target);

  for (const perm of permutations(indices)) {
    const v = perm.map((i) => Rational.fromInt(cards[i]));
    for (const op1 of OPS) {
      for (const op2 of OPS) {
        for (const op3 of OPS) {
          // 形状 1：(((a o1 b) o2 c) o3 d)
          {
            const x1 = calc(op1, v[0], v[1]);
            if (x1) {
              const x2 = calc(op2, x1, v[2]);
              if (x2) {
                const x3 = calc(op3, x2, v[3]);
                if (x3 && x3.equals(t)) return true;
              }
            }
          }
          // 形状 2：((a o1 (b o2 c)) o3 d)
          {
            const x1 = calc(op2, v[1], v[2]);
            if (x1) {
              const x2 = calc(op1, v[0], x1);
              if (x2) {
                const x3 = calc(op3, x2, v[3]);
                if (x3 && x3.equals(t)) return true;
              }
            }
          }
          // 形状 3：((a o1 b) o2 (c o3 d))
          {
            const x1 = calc(op1, v[0], v[1]);
            const x2 = calc(op3, v[2], v[3]);
            if (x1 && x2) {
              const x3 = calc(op2, x1, x2);
              if (x3 && x3.equals(t)) return true;
            }
          }
          // 形状 4：(a o1 ((b o2 c) o3 d))
          {
            const x1 = calc(op2, v[1], v[2]);
            if (x1) {
              const x2 = calc(op3, x1, v[3]);
              if (x2) {
                const x3 = calc(op1, v[0], x2);
                if (x3 && x3.equals(t)) return true;
              }
            }
          }
          // 形状 5：(a o1 (b o2 (c o3 d)))
          {
            const x1 = calc(op3, v[2], v[3]);
            if (x1) {
              const x2 = calc(op2, v[1], x1);
              if (x2) {
                const x3 = calc(op1, v[0], x2);
                if (x3 && x3.equals(t)) return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}
