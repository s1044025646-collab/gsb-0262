// 表达式抽象语法树：叶子是实体牌，内部节点是四则运算。

export type Op = "+" | "-" | "*" | "/";

export interface CardNode {
  kind: "card";
  id: number;
}

export interface BinNode {
  kind: "bin";
  op: Op;
  left: ExprNode;
  right: ExprNode;
}

export type ExprNode = CardNode | BinNode;

export const OPS: readonly Op[] = ["+", "-", "*", "/"];

export function isOp(value: string): value is Op {
  return value === "+" || value === "-" || value === "*" || value === "/";
}
