// SQLite 持久化层（使用 Node 内置 node:sqlite，无需本地编译模块）。
// 牌例按名称管理：再次导入同名牌例时生成递增版本，求解结果与验算报告
// 都关联到具体版本，保证重复计算结果稳定。

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface DeckRow {
  id: number;
  name: string;
  version: number;
  cards: string;
  target: number;
  created_at: string;
}

export interface SolveConfigRow {
  limit: number;
  target: number;
}

export interface SolveRecord {
  id: number;
  deck_version_id: number;
  target: number;
  limit: number;
  solvable: number;
  total_found: number;
  solutions_json: string;
  created_at: string;
}

export interface VerifyRecord {
  id: number;
  deck_version_id: number;
  expression: string;
  ok: number;
  error_code: string | null;
  message: string;
  report_json: string;
  created_at: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deck_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        cards TEXT NOT NULL,
        target INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, version)
      );
      CREATE TABLE IF NOT EXISTS solve_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_version_id INTEGER NOT NULL,
        target INTEGER NOT NULL,
        "limit" INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (deck_version_id) REFERENCES deck_versions(id)
      );
      CREATE TABLE IF NOT EXISTS solve_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_id INTEGER NOT NULL,
        deck_version_id INTEGER NOT NULL,
        target INTEGER NOT NULL,
        "limit" INTEGER NOT NULL,
        solvable INTEGER NOT NULL,
        total_found INTEGER NOT NULL,
        solutions_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (config_id) REFERENCES solve_configs(id),
        FOREIGN KEY (deck_version_id) REFERENCES deck_versions(id)
      );
      CREATE TABLE IF NOT EXISTS verify_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_version_id INTEGER NOT NULL,
        expression TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error_code TEXT,
        message TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (deck_version_id) REFERENCES deck_versions(id)
      );
    `);
  }

  upsertDeck(name: string, cards: number[], target: number): DeckRow {
    const latest = this.latestDeck(name);
    const nextVersion = latest === null ? 1 : latest.version + 1;
    const stmt = this.db.prepare(
      `INSERT INTO deck_versions (name, version, cards, target) VALUES (?, ?, ?, ?)`,
    );
    const info = stmt.run(name, nextVersion, JSON.stringify(cards), target);
    const row = this.db
      .prepare(`SELECT * FROM deck_versions WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as unknown as DeckRow;
    return row;
  }

  // 幂等：若最新版本牌面完全一致则直接复用，不产生重复版本。
  importDeck(name: string, cards: number[], target: number): { row: DeckRow; reused: boolean } {
    const latest = this.latestDeck(name);
    if (latest !== null && latest.target === target && JSON.stringify(cards) === latest.cards) {
      return { row: latest, reused: true };
    }
    return { row: this.upsertDeck(name, cards, target), reused: false };
  }

  latestDeck(name: string): DeckRow | null {
    const row = this.db
      .prepare(`SELECT * FROM deck_versions WHERE name = ? ORDER BY version DESC LIMIT 1`)
      .get(name) as unknown as DeckRow | undefined;
    return row ?? null;
  }

  deckById(id: number): DeckRow | null {
    const row = this.db.prepare(`SELECT * FROM deck_versions WHERE id = ?`).get(id) as unknown as DeckRow | undefined;
    return row ?? null;
  }

  listDecks(): DeckRow[] {
    return this.db
      .prepare(`SELECT * FROM deck_versions ORDER BY name, version`)
      .all() as unknown as DeckRow[];
  }

  saveSolve(
    deck: DeckRow,
    config: SolveConfigRow,
    payload: { solvable: boolean; totalFound: number; solutionsJson: string },
  ): number {
    const configInfo = this.db
      .prepare(`INSERT INTO solve_configs (deck_version_id, target, "limit") VALUES (?, ?, ?)`)
      .run(deck.id, config.target, config.limit);
    const configId = Number(configInfo.lastInsertRowid);
    const info = this.db
      .prepare(
        `INSERT INTO solve_results
          (config_id, deck_version_id, target, "limit", solvable, total_found, solutions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        configId,
        deck.id,
        config.target,
        config.limit,
        payload.solvable ? 1 : 0,
        payload.totalFound,
        payload.solutionsJson,
      );
    return Number(info.lastInsertRowid);
  }

  latestSolve(deckVersionId: number): SolveRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM solve_results WHERE deck_version_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(deckVersionId) as unknown as SolveRecord | undefined;
    return row ?? null;
  }

  solveById(id: number): SolveRecord | null {
    const row = this.db.prepare(`SELECT * FROM solve_results WHERE id = ?`).get(id) as unknown as SolveRecord | undefined;
    return row ?? null;
  }

  saveVerify(
    deck: DeckRow,
    expression: string,
    report: unknown,
    ok: boolean,
    errorCode: string | null,
    message: string,
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO verify_reports
          (deck_version_id, expression, ok, error_code, message, report_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(deck.id, expression, ok ? 1 : 0, errorCode, message, JSON.stringify(report));
    return Number(info.lastInsertRowid);
  }

  verifyById(id: number): VerifyRecord | null {
    const row = this.db.prepare(`SELECT * FROM verify_reports WHERE id = ?`).get(id) as unknown as VerifyRecord | undefined;
    return row ?? null;
  }
}

export function parseDeckCards(row: DeckRow): number[] {
  return JSON.parse(row.cards) as number[];
}


