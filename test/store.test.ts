import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Point24Service } from "../src/service.js";
import { Store } from "../src/store.js";

function openAt(path: string): { store: Store; service: Point24Service } {
  const store = new Store(path);
  return { store, service: new Point24Service(store) };
}

test("同名改牌产生新版本，重复导入幂等", () => {
  const path = join(mkdtempSync(join(tmpdir(), "p24-")), "a.db");
  const first = openAt(path);
  const v1 = first.service.importDeck("d", [1, 2, 3, 4]);
  assert.equal(v1.deck.version, 1);
  const same = first.service.importDeck("d", [1, 2, 3, 4]);
  assert.equal(same.reused, true);
  const v2 = first.service.importDeck("d", [3, 3, 8, 8]);
  assert.equal(v2.deck.version, 2);
  first.store.close();
});

test("求解与解释在重开数据库后仍可读取", () => {
  const path = join(mkdtempSync(join(tmpdir(), "p24-")), "b.db");
  const first = openAt(path);
  first.service.importDeck("d", [3, 3, 8, 8]);
  const solved = first.service.solve("d", 5);
  const id = solved.resultId;
  first.store.close();

  const second = openAt(path);
  const reloaded = second.service.getSolve(id);
  assert.equal(reloaded.totalFound, solved.totalFound);
  const explanation = second.service.explain(id, 0);
  assert.equal(explanation.report.ok, true);
  assert.equal(explanation.report.result, "24");
  second.store.close();
});

test("验算报告持久化", () => {
  const path = join(mkdtempSync(join(tmpdir(), "p24-")), "c.db");
  const opened = openAt(path);
  opened.service.importDeck("d", [3, 3, 8, 8]);
  const saved = opened.service.verify("d", "c1+c2+c3+c4");
  assert.equal(saved.report.ok, false);
  const reloaded = opened.service.getVerify(saved.verifyId);
  assert.equal(reloaded.errorCode, "NOT_TARGET");
  opened.store.close();
});
