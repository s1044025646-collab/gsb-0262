/**
 * 二十四点精确递归组合搜索。
 *
 * 设计要点：
 * - 每张实体牌有独立 id（0..n-1），重复数值也是不同叶子，绝不会误用同一张牌两次。
 * - 对“牌集合”做记忆化的子集 DP：solve(mask) 返回该子集所有可构造的精确表达式。
 * - 合并两个不相交子集时考虑 +、-（两个方向）、*、/（两个方向，除零跳过），
 *   因此不只是左结合，所有二叉树形状（括号形状）都会被枚举到。
 * - 允许中间结果为分数、零、负数。
 * - 去重口径：按“规范化表达式结构字符串”去重。叶子按实体牌 id 区分；
 *   交换运算（+、*）的两个子树按规范串排序，消除交换律产生的重复；
 *   不做结合律之外的代数化简（不跨节点重组），口径简单可解释。
 */

import { Rational } from "./rational.js";

export type Op = "+" | "-" | "*" | "/";

export interface ExprNode {
  kind: "leaf" | "bin";
  cardIndex?: number;
  op?: Op;
  left?: ExprNode;
  right?: ExprNode;
  value: Rational;
}

export interface SolveOptions {
  /** 展示数量上限，只影响返回切片，不影响是否判定无解 */
  limit?: number;
  target?: number;
}

export interface SolveResult {
  solvable: boolean;
  totalCount: number;
  returnedCount: number;
  target: number;
  solutions: Solution[];
}

export interface Solution {
  /** 带最少括号的中缀表达式，使用 c1..cN 实体牌编号 */
  expression: string;
  /** 该解的值（应为目标） */
  value: string;
  /** 用到的实体牌编号 */
  usedCards: number[];
  /** 规范化键（去重口径依据） */
  canonical: string;
  root: ExprNode;
}

const OP_PREC: Record<Op, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

/** 中缀渲染：仅在需要保证结合方式时加括号 */
function render(node: ExprNode, parentOp?: Op, isRight?: boolean): string {
  if (node.kind === "leaf") return `c${node.cardIndex! + 1}`;
  const op = node.op!;
  const l = render(node.left!, op, false);
  const r = render(node.right!, op, true);
  const myPrec = OP_PREC[op];
  const lp = OP_PREC[node.left!.op ?? ("+" as Op)];
  const rp = OP_PREC[node.right!.op ?? ("+" as Op)];
  const leftStr = node.left!.kind === "leaf" || lp >= myPrec ? l : `(${l})`;
  // 右子树：同级的非交换运算需要括号（a-(b-c)、a/(b/c)）
  let rightStr: string;
  if (node.right!.kind === "leaf") rightStr = r;
  else if (rp > myPrec) rightStr = r;
  else if (rp < myPrec) rightStr = `(${r})`;
  else {
    // 同级
    rightStr = op === "+" || op === "*" ? r : `(${r})`;
  }
  void lp;
  void isRight;
  void parentOp;
  return `${leftStr}${op}${rightStr}`;
}

/** 规范化键：交换运算子树排序，叶子用实体牌 id */
function canonical(node: ExprNode): string {
  if (node.kind === "leaf") return `#${node.cardIndex}`;
  let l = canonical(node.left!);
  let r = canonical(node.right!);
  const op = node.op!;
  if (op === "+" || op === "*") {
    if (l > r) [l, r] = [r, l];
  }
  return `(${l}${op}${r})`;
}

function leaf(index: number, values: number[]): ExprNode {
  return { kind: "leaf", cardIndex: index, value: Rational.fromInt(values[index]) };
}

function combine(a: ExprNode, b: ExprNode): ExprNode[] {
  const out: ExprNode[] = [];
  const add = a.value.add(b.value);
  const subAB = a.value.sub(b.value);
  const subBA = b.value.sub(a.value);
  const mul = a.value.mul(b.value);
  const divAB = a.value.div(b.value);
  const divBA = b.value.div(a.value);
  out.push({ kind: "bin", op: "+", left: a, right: b, value: add });
  out.push({ kind: "bin", op: "*", left: a, right: b, value: mul });
  // 减法两个方向
  out.push({ kind: "bin", op: "-", left: a, right: b, value: subAB });
  out.push({ kind: "bin", op: "-", left: b, right: a, value: subBA });
  // 除法两个方向，除零跳过
  if (divAB) out.push({ kind: "bin", op: "/", left: a, right: b, value: divAB });
  if (divBA) out.push({ kind: "bin", op: "/", left: b, right: a, value: divBA });
  return out;
}

export function solve(cards: number[], options: SolveOptions = {}): SolveResult {
  const n = cards.length;
  const target = options.target ?? 24;
  const targetRat = Rational.fromInt(target);

  // 校验
  if (n < 1 || n > 8) throw new Error("当前仅支持 1..8 张牌的搜索（二十四点固定 4 张）");
  for (const v of cards) {
    if (!Number.isInteger(v) || v < 1 || v > 13) throw new Error("牌面必须是 1 到 13 的整数");
  }

  const size = 1 << n;
  const memo = new Map<number, ExprNode[]>();

  for (let mask = 1; mask < size; mask++) {
    const bits: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) bits.push(i);
    if (bits.length === 1) {
      memo.set(mask, [leaf(bits[0], cards)]);
      continue;
    }
    const nodes: ExprNode[] = [];
    // 枚举真子集 L（L 非空且为 mask 真子集），R = mask ^ L；
    // 要求 L 含最低位 bit 以避免每对互补子集重复两次。
    const low = mask & -mask;
    for (let l = (mask - 1) & mask; l > 0; l = (l - 1) & mask) {
      const r = mask ^ l;
      if (r === 0 || !(l & low)) continue;
      const la = memo.get(l)!;
      const rb = memo.get(r)!;
      for (const a of la) for (const b of rb) nodes.push(...combine(a, b));
    }
    memo.set(mask, nodes);
  }

  // 完成全量搜索后再按规范化键去重并筛选目标值
  const all = memo.get(size - 1)!;
  const seen = new Map<string, ExprNode>();
  for (const node of all) {
    if (!node.value.equals(targetRat)) continue;
    const key = canonical(node);
    if (!seen.has(key)) seen.set(key, node);
  }

  const entries = [...seen.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const limit = options.limit ?? entries.length;
  const sliced = entries.slice(0, Math.max(0, limit));

  const solutions: Solution[] = sliced.map(([key, root]) => ({
    expression: render(root),
    value: root.value.toFractionString(),
    usedCards: collectLeaves(root),
    canonical: key,
    root,
  }));

  return {
    solvable: entries.length > 0,
    totalCount: entries.length,
    returnedCount: solutions.length,
    target,
    solutions,
  };
}

export function collectLeaves(node: ExprNode): number[] {
  if (node.kind === "leaf") return [node.cardIndex! + 1];
  return [...collectLeaves(node.left!), ...collectLeaves(node.right!)].sort((a, b) => a - b);
}
