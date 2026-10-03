import { DeckRow, Store, parseDeckCards } from "./store.js";
import { solve } from "./solver.js";
import { verifyExpression, VerifyReport } from "./verifier.js";

export interface ServiceError {
  code:
    | "INVALID_CARDS"
    | "INVALID_NAME"
    | "INVALID_TARGET"
    | "INVALID_LIMIT"
    | "DECK_NOT_FOUND"
    | "RECORD_NOT_FOUND";
  message: string;
}

export class ServiceException extends Error {
  constructor(readonly error: ServiceError) {
    super(error.message);
    this.name = "ServiceException";
  }
}

export const MAX_LIMIT = 1000;

export function validateCards(cards: unknown): number[] {
  if (!Array.isArray(cards) || cards.length !== 4) {
    throw new ServiceException({
      code: "INVALID_CARDS",
      message: "cards 必须是恰好 4 个整数组成的数组",
    });
  }
  const values: number[] = [];
  for (const raw of cards) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 13) {
      throw new ServiceException({
        code: "INVALID_CARDS",
        message: "每张牌必须是 1 到 13 的整数",
      });
    }
    values.push(raw);
  }
  return values;
}

function validateTarget(target: unknown): number {
  if (typeof target !== "number" || !Number.isInteger(target) || target <= 0) {
    throw new ServiceException({
      code: "INVALID_TARGET",
      message: "target 必须是正整数（本项目固定为 24）",
    });
  }
  return target;
}

function validateLimit(limit: unknown): number {
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw new ServiceException({
      code: "INVALID_LIMIT",
      message: `limit 必须是 1 到 ${MAX_LIMIT} 的整数；上限只影响展示，不影响“有解/无解”判定`,
    });
  }
  return limit;
}

export class Point24Service {
  constructor(private readonly store: Store) {}

  importDeck(name: unknown, cards: unknown, target = 24): { deck: DeckRow; reused: boolean } {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 64) {
      throw new ServiceException({
        code: "INVALID_NAME",
        message: "name 必须是 1..64 个字符的非空字符串",
      });
    }
    const values = validateCards(cards);
    const t = validateTarget(target);
    const { row, reused } = this.store.importDeck(name.trim(), values, t);
    return { deck: row, reused };
  }

  getDeck(name: string): DeckRow {
    const deck = this.store.latestDeck(name);
    if (deck === null) {
      throw new ServiceException({
        code: "DECK_NOT_FOUND",
        message: `找不到牌例 "${name}"，请先导入`,
      });
    }
    return deck;
  }

  solve(name: string, limitInput = 20, targetInput?: number) {
    const deck = this.getDeck(name);
    const cards = parseDeckCards(deck);
    const target = validateTarget(targetInput ?? deck.target);
    const limit = validateLimit(limitInput);

    // 上限只截断展示；totalFound/solvable 始终来自完整搜索。
    const outcome = solve(cards, target);
    const shown = outcome.solutions.slice(0, limit);
    const resultId = this.store.saveSolve(
      deck,
      { target, limit },
      {
        solvable: outcome.solvable,
        totalFound: outcome.totalFound,
        solutionsJson: JSON.stringify(shown),
      },
    );
    return {
      resultId,
      deck: this.deckView(deck),
      target,
      limit,
      solvable: outcome.solvable,
      totalFound: outcome.totalFound,
      shown: shown.length,
      solutions: shown,
      conclusion: outcome.solvable
        ? `有解：完整搜索共找到 ${outcome.totalFound} 个去重解，展示前 ${shown.length} 个`
        : `无解：已完整枚举全部合法表达式，四张牌无论如何组合都无法得到 ${target}`,
    };
  }

  getSolve(resultId: number) {
    const record = this.store.solveById(resultId);
    if (record === null) {
      throw new ServiceException({
        code: "RECORD_NOT_FOUND",
        message: `找不到求解结果 #${resultId}`,
      });
    }
    const deck = this.store.deckById(record.deck_version_id);
    if (deck === null) {
      throw new ServiceException({ code: "RECORD_NOT_FOUND", message: "关联牌例缺失" });
    }
    const solutions = JSON.parse(record.solutions_json) as { expression: string }[];
    return {
      resultId: record.id,
      deck: this.deckView(deck),
      target: record.target,
      limit: record.limit,
      solvable: record.solvable === 1,
      totalFound: record.total_found,
      shown: solutions.length,
      solutions,
      createdAt: record.created_at,
    };
  }

  explain(resultId: number, solutionIndex = 0) {
    const solved = this.getSolve(resultId);
    const solution = solved.solutions[solutionIndex];
    if (solution === undefined) {
      throw new ServiceException({
        code: "RECORD_NOT_FOUND",
        message: `该结果只展示了 ${solved.solutions.length} 个解，下标 ${solutionIndex} 越界（从 0 开始）`,
      });
    }
    const cards = solved.deck.cards;
    const report = verifyExpression(solution.expression, cards, solved.target);
    return {
      resultId,
      solutionIndex,
      expression: solution.expression,
      report,
    };
  }

  verify(name: string, expression: unknown): { verifyId: number; report: VerifyReport } {
    const deck = this.getDeck(name);
    if (typeof expression !== "string" || expression.trim().length === 0) {
      throw new ServiceException({
        code: "INVALID_CARDS",
        message: "expression 必须是非空字符串，例如 c4/(c2-c4/c1) 形式",
      });
    }
    const cards = parseDeckCards(deck);
    const report = verifyExpression(expression, cards, deck.target);
    const verifyId = this.store.saveVerify(
      deck,
      expression,
      report,
      report.ok,
      report.errorCode ?? null,
      report.message,
    );
    return { verifyId, report };
  }

  getVerify(verifyId: number) {
    const record = this.store.verifyById(verifyId);
    if (record === null) {
      throw new ServiceException({
        code: "RECORD_NOT_FOUND",
        message: `找不到验算报告 #${verifyId}`,
      });
    }
    return {
      verifyId: record.id,
      deckVersionId: record.deck_version_id,
      expression: record.expression,
      ok: record.ok === 1,
      errorCode: record.error_code,
      message: record.message,
      report: JSON.parse(record.report_json) as VerifyReport,
      createdAt: record.created_at,
    };
  }

  exportAll() {
    const decks = this.store.listDecks();
    return {
      exportedAt: new Date().toISOString(),
      decks: decks.map((deck) => ({
        name: deck.name,
        version: deck.version,
        cards: parseDeckCards(deck),
        target: deck.target,
        createdAt: deck.created_at,
      })),
    };
  }

  private deckView(deck: DeckRow) {
    return {
      deckVersionId: deck.id,
      name: deck.name,
      version: deck.version,
      cards: parseDeckCards(deck),
      target: deck.target,
    };
  }
}

// 内置两个标准牌例：3,3,8,8（需要分数中间值）与 1,1,1,1（明显无解）。
export function seedBuiltins(service: Point24Service): {
  classic: { deck: DeckRow; reused: boolean };
  impossible: { deck: DeckRow; reused: boolean };
} {
  return {
    classic: service.importDeck("builtin-3388", [3, 3, 8, 8], 24),
    impossible: service.importDeck("builtin-1111", [1, 1, 1, 1], 24),
  };
}
