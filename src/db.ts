/**
 * SQLite 持久层：牌例（多版本）、求解配置与结果、验算报告。
 * 使用 Node 内置 node:sqlite（Node >= 22.5 / 24+ 默认可用），无需原生编译。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DeckRecord {
  id: string;
  name: string;
  latestVersion: number;
  cards: number[];
  createdAt: string;
  updatedAt: string;
}

export interface SolveRecord {
  id: number;
  deckId: string;
  version: number;
  target: number;
  limitCfg: number | null;
  solvable: boolean;
  totalCount: number;
  returnedCount: number;
  resultsJson: string;
  createdAt: string;
}

export interface CheckRecord {
  id: number;
  deckId: string;
  version: number;
  expression: string;
  ok: boolean;
  reportJson: string;
  createdAt: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deck_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id TEXT NOT NULL REFERENCES decks(id),
        version INTEGER NOT NULL,
        cards_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(deck_id, version)
      );
      CREATE TABLE IF NOT EXISTS solves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        target INTEGER NOT NULL,
        limit_cfg INTEGER,
        solvable INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        returned_count INTEGER NOT NULL,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(deck_id, version, target, limit_cfg)
      );
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        expression TEXT NOT NULL,
        ok INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  upsertDeck(id: string, name: string, cards: number[]): DeckRecord {
    const now = new Date().toISOString();
    const existing = this.getDeckRaw(id);
    if (existing) {
      // 牌面有变化才产生新版本；仅改名不产生新版本
      const latest = this.getLatestVersionRow(id);
      const oldCards = JSON.parse(latest.cards_json) as number[];
      let version = latest.version;
      if (JSON.stringify(oldCards) !== JSON.stringify(cards)) {
        version = latest.version + 1;
        this.db
          .prepare("INSERT INTO deck_versions(deck_id, version, cards_json, created_at) VALUES(?,?,?,?)")
          .run(id, version, JSON.stringify(cards), now);
      }
      this.db.prepare("UPDATE decks SET name=?, updated_at=? WHERE id=?").run(name, now, id);
      return this.getDeck(id)!;
    }
    this.db.prepare("INSERT INTO decks(id, name, created_at, updated_at) VALUES(?,?,?,?)").run(id, name, now, now);
    this.db
      .prepare("INSERT INTO deck_versions(deck_id, version, cards_json, created_at) VALUES(?,?,?,?)")
      .run(id, 1, JSON.stringify(cards), now);
    return this.getDeck(id)!;
  }

  private getDeckRaw(id: string) {
    return this.db.prepare("SELECT * FROM decks WHERE id=?").get(id) as
      | { id: string; name: string; created_at: string; updated_at: string }
      | undefined;
  }

  private getLatestVersionRow(deckId: string) {
    const row = this.db
      .prepare("SELECT * FROM deck_versions WHERE deck_id=? ORDER BY version DESC LIMIT 1")
      .get(deckId) as { version: number; cards_json: string; created_at: string };
    return row;
  }

  getDeck(id: string): DeckRecord | null {
    const d = this.getDeckRaw(id);
    if (!d) return null;
    const v = this.getLatestVersionRow(id);
    return {
      id: d.id,
      name: d.name,
      latestVersion: v.version,
      cards: JSON.parse(v.cards_json),
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  }

  getDeckVersion(id: string, version: number): { cards: number[]; version: number } | null {
    const row = this.db
      .prepare("SELECT * FROM deck_versions WHERE deck_id=? AND version=?")
      .get(id, version) as { cards_json: string; version: number } | undefined;
    if (!row) return null;
    return { version: row.version, cards: JSON.parse(row.cards_json) };
  }

  listDecks(): DeckRecord[] {
    const rows = this.db.prepare("SELECT id FROM decks ORDER BY id").all() as { id: string }[];
    return rows.map((r) => this.getDeck(r.id)!).filter(Boolean);
  }

  saveSolve(rec: Omit<SolveRecord, "id" | "createdAt">): SolveRecord {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO solves(deck_id, version, target, limit_cfg, solvable, total_count, returned_count, results_json, created_at)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(deck_id, version, target, limit_cfg) DO UPDATE SET
           solvable=excluded.solvable, total_count=excluded.total_count,
           returned_count=excluded.returned_count, results_json=excluded.results_json, created_at=excluded.created_at`,
      )
      .run(
        rec.deckId,
        rec.version,
        rec.target,
        rec.limitCfg,
        rec.solvable ? 1 : 0,
        rec.totalCount,
        rec.returnedCount,
        rec.resultsJson,
        now,
      );
    return this.getSolve(rec.deckId, rec.version, rec.target, rec.limitCfg)!;
  }

  getSolve(deckId: string, version: number, target: number, limitCfg: number | null): SolveRecord | null {
    const row = this.db
      .prepare("SELECT * FROM solves WHERE deck_id=? AND version=? AND target=? AND limit_cfg IS ?")
      .get(deckId, version, target, limitCfg) as
      | {
          id: number;
          deck_id: string;
          version: number;
          target: number;
          limit_cfg: number | null;
          solvable: number;
          total_count: number;
          returned_count: number;
          results_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      deckId: row.deck_id,
      version: row.version,
      target: row.target,
      limitCfg: row.limit_cfg,
      solvable: row.solvable === 1,
      totalCount: row.total_count,
      returnedCount: row.returned_count,
      resultsJson: row.results_json,
      createdAt: row.created_at,
    };
  }

  listSolves(deckId?: string): SolveRecord[] {
    const rows = (deckId
      ? (this.db.prepare("SELECT id FROM solves WHERE deck_id=? ORDER BY id").all(deckId) as { id: number }[])
      : (this.db.prepare("SELECT id FROM solves ORDER BY id").all() as { id: number }[]))
      .map((r) => this.db.prepare("SELECT * FROM solves WHERE id=?").get(r.id)) as any[];
    return rows.map((row) => ({
      id: row.id,
      deckId: row.deck_id,
      version: row.version,
      target: row.target,
      limitCfg: row.limit_cfg,
      solvable: row.solvable === 1,
      totalCount: row.total_count,
      returnedCount: row.returned_count,
      resultsJson: row.results_json,
      createdAt: row.created_at,
    }));
  }

  saveCheck(rec: Omit<CheckRecord, "id" | "createdAt">): CheckRecord {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        "INSERT INTO checks(deck_id, version, expression, ok, report_json, created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(rec.deckId, rec.version, rec.expression, rec.ok ? 1 : 0, rec.reportJson, now);
    const row = this.db.prepare("SELECT * FROM checks WHERE rowid=?").get(info.lastInsertRowid) as any;
    return {
      id: row.id,
      deckId: row.deck_id,
      version: row.version,
      expression: row.expression,
      ok: row.ok === 1,
      reportJson: row.report_json,
      createdAt: row.created_at,
    };
  }

  listChecks(deckId?: string): CheckRecord[] {
    const rows: any[] = deckId
      ? this.db.prepare("SELECT * FROM checks WHERE deck_id=? ORDER BY id").all(deckId)
      : this.db.prepare("SELECT * FROM checks ORDER BY id").all();
    return rows.map((row) => ({
      id: row.id,
      deckId: row.deck_id,
      version: row.version,
      expression: row.expression,
      ok: row.ok === 1,
      reportJson: row.report_json,
      createdAt: row.created_at,
    }));
  }
}
