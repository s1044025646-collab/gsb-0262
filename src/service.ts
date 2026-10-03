/**
 * 应用服务层：校验牌例、求解（结果落库）、解释、验算并复核所有解。
 */

import { solve, type SolveOptions, type Solution } from "./solver.js";
import { verifyExpression, type VerifyReport } from "./parser.js";
import { explain } from "./explain.js";
import type { Store } from "./db.js";

export interface StoredSolution {
  expression: string;
  value: string;
  usedCards: number[];
  canonical: string;
}

export interface StoredSolve {
  deckId: string;
  version: number;
  target: number;
  limitCfg: number | null;
  solvable: boolean;
  totalCount: number;
  returnedCount: number;
  solutions: StoredSolution[];
  verifiedAll: boolean;
  note: string;
  createdAt?: string;
}

export function validateCards(cards: unknown): asserts cards is number[] {
  if (!Array.isArray(cards) || cards.length !== 4) {
    throw new ApiError("INVALID_CARDS", "cards 必须是包含 4 个数字的数组");
  }
  for (const v of cards) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 13) {
      throw new ApiError("INVALID_CARDS", "每张牌必须是 1 到 13 的整数");
    }
  }
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function toStored(s: Solution): StoredSolution {
  return { expression: s.expression, value: s.value, usedCards: s.usedCards, canonical: s.canonical };
}

export function runSolve(
  store: Store,
  deckId: string,
  options: { limit?: number | null; target?: number; version?: number } = {},
): StoredSolve {
  const deck = store.getDeck(deckId);
  if (!deck) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${deckId}`, 404);
  const version = options.version ?? deck.latestVersion;
  const ver = store.getDeckVersion(deckId, version);
  if (!ver) throw new ApiError("VERSION_NOT_FOUND", `版本不存在：v${version}`, 404);

  const target = options.target ?? 24;
  if (!Number.isInteger(target)) throw new ApiError("INVALID_TARGET", "target 必须是整数");
  let limit = options.limit ?? null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new ApiError("INVALID_LIMIT", "limit 必须是正整数");
  }

  const cached = store.getSolve(deckId, version, target, limit);
  if (cached) {
    return JSON.parse(cached.resultsJson) as StoredSolve;
  }

  const opts: SolveOptions = { target };
  if (limit !== null) opts.limit = limit;
  const result = solve(ver.cards, opts);

  // 把所有“返回解”交给独立验算器复核（精确分数，逐张牌核对）
  let verifiedAll = true;
  for (const s of result.solutions) {
    const rep = verifyExpression(s.expression, ver.cards, target);
    if (!rep.ok) {
      verifiedAll = false;
      break;
    }
  }

  const payload: StoredSolve = {
    deckId,
    version,
    target,
    limitCfg: limit,
    solvable: result.solvable,
    totalCount: result.totalCount,
    returnedCount: result.returnedCount,
    solutions: result.solutions.map(toStored),
    verifiedAll,
    note: result.solvable
      ? `完成全量枚举：不同解共 ${result.totalCount} 个（按规范化结构去重），展示 ${result.returnedCount} 个`
      : `完成全量枚举：无合法解（已穷尽全部表达式，非“搜不到即无解”）`,
  };
  const rec = store.saveSolve({
    deckId,
    version,
    target,
    limitCfg: limit,
    solvable: payload.solvable,
    totalCount: payload.totalCount,
    returnedCount: payload.returnedCount,
    resultsJson: JSON.stringify(payload),
  });
  payload.createdAt = rec.createdAt;
  return payload;
}

export function checkExpression(
  store: Store,
  deckId: string,
  expression: string,
  options: { version?: number; target?: number } = {},
): VerifyReport {
  const deck = store.getDeck(deckId);
  if (!deck) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${deckId}`, 404);
  const version = options.version ?? deck.latestVersion;
  const ver = store.getDeckVersion(deckId, version);
  if (!ver) throw new ApiError("VERSION_NOT_FOUND", `版本不存在：v${version}`, 404);
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new ApiError("EMPTY_EXPRESSION", "expression 不能为空");
  }
  const report = verifyExpression(expression, ver.cards, options.target ?? 24);
  store.saveCheck({
    deckId,
    version,
    expression,
    ok: report.ok,
    reportJson: JSON.stringify(report),
  });
  return report;
}

/** 解释某条已保存解（重启后用验算器重建 AST，逐步精确分数） */
export function explainSolution(
  store: Store,
  deckId: string,
  expression: string,
  options: { version?: number } = {},
) {
  const deck = store.getDeck(deckId);
  if (!deck) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${deckId}`, 404);
  const version = options.version ?? deck.latestVersion;
  const ver = store.getDeckVersion(deckId, version);
  if (!ver) throw new ApiError("VERSION_NOT_FOUND", `版本不存在：v${version}`, 404);
  const report = verifyExpression(expression, ver.cards);
  if (!report.ok) throw new ApiError(report.errorCode ?? "BAD_EXPRESSION", report.errorMessage ?? "表达式不合法");
  return {
    expression,
    cards: ver.cards,
    steps: report.steps,
    result: report.result,
    equalsTarget: report.equalsTarget,
  };
}

export { explain };
