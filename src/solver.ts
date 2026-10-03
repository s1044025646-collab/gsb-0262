// 二十四点精确求解器。
//
// 主搜索：递归“子集组合”。单牌子集只有牌本身；多牌子集枚举每一种
// 真子集切分，对子结果做四则运算。减法/除法同时尝试两个方向，
// 除法遇到分母为零直接跳过。每个子集内部按规范化键去重，因此
// 等价的括号形状与交换顺序只保留一个；不同实体牌身份始终保留。
//
// 参考枚举（referenceSolve）：独立实现四张叶子的全部排列、
// 4^3 个运算符组合与五种完全二叉树（Catalan 数 C3=5），
// 用于交叉核对可解性。

import { BinNode, CardNode, ExprNode, OPS, Op } from "./ast.js";
import { renderPretty } from "./evaluator.js";
import { Fraction, ZeroDivisionError } from "./rational.js";

export interface Solution {
  expression: string;
  canonical: string;
}

export interface SolveOutcome {
  target: number;
  totalFound: number;
  solvable: boolean;
  solutions: Solution[];
}

interface Built {
  node: ExprNode;
  value: Fraction;
  canonical: string;
}

function cardNode(id: number): CardNode {
  return { kind: "card", id };
}

function bin(op: Op, left: ExprNode, right: ExprNode): BinNode {
  return { kind: "bin", op, left, right };
}

// 规范化： +/* 拍平并排序； -/ / 保持左右顺序；叶子以 c<编号> 表示。
// 该键用于“明显等价结果”的去重，口径见 README。
export function canonical(node: ExprNode): string {
  if (node.kind === "card") {
    return `c${node.id}`;
  }
  if (node.op === "+" || node.op === "*") {
    const parts: string[] = [];
    collectFlat(node, node.op, parts);
    parts.sort();
    return `(${node.op} ${parts.join(" ")})`;
  }
  return `(${node.op} ${canonical(node.left)} ${canonical(node.right)})`;
}

function collectFlat(node: ExprNode, op: Op, out: string[]): void {
  if (node.kind === "bin" && node.op === op) {
    collectFlat(node.left, op, out);
    collectFlat(node.right, op, out);
  } else {
    out.push(canonical(node));
  }
}

export function solve(cardValues: number[], target = 24): SolveOutcome {
  const n = cardValues.length;
  if (n < 1 || n > 12) {
    throw new Error("求解器仅支持 1..12 张牌");
  }
  const memo = new Map<number, Map<string, Built>>();
  const targetValue = Fraction.fromInt(target);

  const build = (mask: number): Map<string, Built> => {
    const cached = memo.get(mask);
    if (cached !== undefined) {
      return cached;
    }
    const result = new Map<string, Built>();
    const bits: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        bits.push(i + 1);
      }
    }
    if (bits.length === 1) {
      const id = bits[0];
      const node = cardNode(id);
      const built: Built = {
        node,
        value: Fraction.fromInt(cardValues[id - 1]),
        canonical: canonical(node),
      };
      result.set(built.canonical, built);
      memo.set(mask, result);
      return result;
    }

    const sub = (m: number) => mask & m;
    const full = mask;
    // 只枚举左部小于右部（按位比较）的切分，避免同一切分重复两次；
    // 但减法/除法在下方显式尝试两个方向，覆盖非交换运算。
    let leftMask = (full - 1) & full;
    while (leftMask !== 0) {
      const rightMask = sub(full ^ leftMask);
      if (leftMask < rightMask) {
        combine(result, leftMask, rightMask, build);
      }
      leftMask = (leftMask - 1) & full;
    }
    memo.set(mask, result);
    return result;
  };

  const all = (1 << n) - 1;
  const finalMap = build(all);
  const hits: Built[] = [];
  for (const built of finalMap.values()) {
    if (built.value.equals(targetValue)) {
      hits.push(built);
    }
  }
  hits.sort((a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0));
  const solutions: Solution[] = hits.map((built) => ({
    expression: renderPretty(built.node),
    canonical: built.canonical,
  }));
  return {
    target,
    totalFound: solutions.length,
    solvable: solutions.length > 0,
    solutions,
  };
}

function combine(
  result: Map<string, Built>,
  leftMask: number,
  rightMask: number,
  build: (mask: number) => Map<string, Built>,
): void {
  const lefts = build(leftMask);
  const rights = build(rightMask);
  for (const left of lefts.values()) {
    for (const right of rights.values()) {
      for (const op of OPS) {
        tryAdd(result, op, left, right);
        if (op === "-" || op === "/") {
          tryAdd(result, op, right, left);
        }
      }
    }
  }
}

function tryAdd(
  result: Map<string, Built>,
  op: Op,
  left: Built,
  right: Built,
): void {
  let value: Fraction;
  try {
    switch (op) {
      case "+":
        value = left.value.add(right.value);
        break;
      case "-":
        value = left.value.sub(right.value);
        break;
      case "*":
        value = left.value.mul(right.value);
        break;
      case "/":
        if (right.value.isZero()) {
          return;
        }
        value = left.value.div(right.value);
        break;
    }
  } catch (error) {
    if (error instanceof ZeroDivisionError) {
      return;
    }
    throw error;
  }
  const node = bin(op, left.node, right.node);
  const key = canonical(node);
  if (!result.has(key)) {
    result.set(key, { node, value, canonical: key });
  }
}

// ---- 参考枚举：4 叶子排列 × 4^3 运算符 × 五种二叉树形状 ----

const TREE_SHAPES: ReadonlyArray<(a: ExprNode, b: ExprNode, c: ExprNode, d: ExprNode) => ExprNode> = [
  (a, b, c, d) => bin("+", bin("+", bin("+", a, b), c), d), // ((a.b).c).d
  (a, b, c, d) => bin("+", bin("+", a, bin("+", b, c)), d), // (a.(b.c)).d
  (a, b, c, d) => bin("+", a, bin("+", bin("+", b, c), d)), // a.((b.c).d)
  (a, b, c, d) => bin("+", a, bin("+", b, bin("+", c, d))), // a.(b.(c.d))
  (a, b, c, d) => bin("+", bin("+", a, b), bin("+", c, d)), // (a.b).(c.d)
];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) {
      out.push([items[i], ...tail]);
    }
  }
  return out;
}

function evalNodePlain(node: ExprNode, values: number[]): Fraction | null {
  if (node.kind === "card") {
    return Fraction.fromInt(values[node.id - 1]);
  }
  const left = evalNodePlain(node.left, values);
  const right = evalNodePlain(node.right, values);
  if (left === null || right === null) {
    return null;
  }
  try {
    switch (node.op) {
      case "+":
        return left.add(right);
      case "-":
        return left.sub(right);
      case "*":
        return left.mul(right);
      case "/":
        return right.isZero() ? null : left.div(right);
    }
  } catch {
    return null;
  }
}

export interface ReferenceOutcome {
  solvable: boolean;
  sample: string | null;
  checkedTrees: number;
}

// 独立参考方法：只判断是否可解，并给出一个样例（若有）。
export function referenceSolve(values: number[], target = 24): ReferenceOutcome {
  const n = values.length;
  if (n !== 4) {
    throw new Error("参考枚举仅支持恰好 4 张牌");
  }
  const targetValue = Fraction.fromInt(target);
  const leafOrder = permutations([1, 2, 3, 4]);
  let checkedTrees = 0;
  for (const order of leafOrder) {
    const leaves = order.map(cardNode);
    for (const ops of allOperatorTriples()) {
      for (let shapeIndex = 0; shapeIndex < TREE_SHAPES.length; shapeIndex += 1) {
        const shape = TREE_SHAPES[shapeIndex];
        const tree = shape(leaves[0], leaves[1], leaves[2], leaves[3]);
        assignOps(tree, ops, { index: 0 });
        const value = evalNodePlain(tree, values);
        checkedTrees += 1;
        if (value !== null && value.equals(targetValue)) {
          // 参考枚举空间大小固定（24 排列 × 64 运算符 × 5 树形）。
          return {
            solvable: true,
            sample: renderPretty(tree),
            checkedTrees: 24 * OPS.length ** 3 * TREE_SHAPES.length,
          };
        }
      }
    }
  }
  return { solvable: false, sample: null, checkedTrees };
}

function allOperatorTriples(): Op[][] {
  const triples: Op[][] = [];
  for (const a of OPS) {
    for (const b of OPS) {
      for (const c of OPS) {
        triples.push([a, b, c]);
      }
    }
  }
  return triples;
}

// TREE_SHAPES 用占位 "+" 构造，这里按中序位置写入真实运算符（不修改 ops）。
function assignOps(node: ExprNode, ops: Op[], cursor: { index: number }): void {
  if (node.kind !== "bin") {
    return;
  }
  assignOps(node.left, ops, cursor);
  node.op = ops[cursor.index];
  cursor.index += 1;
  assignOps(node.right, ops, cursor);
}
