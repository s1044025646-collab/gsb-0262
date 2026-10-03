#!/usr/bin/env node
/**
 * p24 命令行：
 *   import <id> <name> <c1,c2,c3,c4>   导入/修改牌例（牌面变化自动产生新版本）
 *   list                                查看牌例
 *   solve <id> [limit] [version]        求解（完成全量枚举；limit 只限制展示）
 *   solutions <id>                      查看有限解列表
 *   explain <id> <expression> [version] 逐步解释（精确分数）
 *   check <id> <expression> [version]   验算外部表达式
 *   export [file]                       导出 JSON（默认 stdout）
 *   demo                                完整演示（含重启后读取、各类错误）
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./db.js";
import { ApiError, checkExpression, explainSolution, runSolve } from "./service.js";
import { solve } from "./solver.js";
import { verifyExpression } from "./parser.js";
import { referenceSolvable } from "./referenceSolver.js";
import { seedDefaults } from "./seed.js";

const DATA_DIR = process.env.P24_DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

function openStore(): Store {
  const store = new Store(join(DATA_DIR, "point24.db"));
  seedDefaults(store);
  return store;
}

function parseCards(s: string): number[] {
  const cards = s.split(",").map((x) => parseInt(x.trim(), 10));
  if (cards.length !== 4 || cards.some((v) => !Number.isInteger(v) || v < 1 || v > 13)) {
    throw new Error("牌例必须是 4 个 1..13 的整数，逗号分隔，例如 3,3,8,8");
  }
  return cards;
}

function printReport(r: ReturnType<typeof verifyExpression>): void {
  console.log(`表达式: ${r.expression}`);
  console.log(`牌面: c1=${r.cardValues[0]} c2=${r.cardValues[1]} c3=${r.cardValues[2]} c4=${r.cardValues[3]}`);
  if (!r.ok) {
    console.log(`结论: 不合法/不成立  错误码=${r.errorCode}  ${r.errorMessage}`);
    if (r.steps.length) {
      console.log("已计算步骤:");
      for (const s of r.steps) console.log(`  ${s.subExpression} = ${s.arithmetic} = ${s.result}`);
    }
    return;
  }
  console.log("逐步精确计算:");
  for (const s of r.steps) console.log(`  ${s.subExpression} = ${s.arithmetic} = ${s.result}`);
  console.log(`结论: 成立，结果精确等于 ${r.target}（使用牌 ${r.usedCards.map((c) => `c${c}`).join("、")}）`);
}

function cmdSolve(args: string[]): void {
  const [id, limitStr, verStr] = args;
  if (!id) throw new Error("用法: solve <id> [limit] [version]");
  const store = openStore();
  const limit = limitStr ? parseInt(limitStr, 10) : null;
  const version = verStr ? parseInt(verStr, 10) : undefined;
  const result = runSolve(store, id, { limit, version });
  console.log(`牌例 ${id} v${result.version}：${result.note}`);
  result.solutions.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.expression} = ${s.value}`);
  });
  store.close();
}

function cmdCheck(args: string[]): void {
  const [id, expression, verStr] = args;
  if (!id || !expression) throw new Error("用法: check <id> <expression> [version]");
  const store = openStore();
  const report = checkExpression(store, id, expression, { version: verStr ? parseInt(verStr, 10) : undefined });
  printReport(report);
  store.close();
}

function cmdExplain(args: string[]): void {
  const [id, expression, verStr] = args;
  if (!id || !expression) throw new Error("用法: explain <id> <expression> [version]");
  const store = openStore();
  const explanation = explainSolution(store, id, expression, {
    version: verStr ? parseInt(verStr, 10) : undefined,
  });
  console.log(`表达式: ${expression}`);
  explanation.steps.forEach((s, i) => {
    console.log(`  步骤 ${i + 1}: ${s.subExpression} = ${s.arithmetic} = ${s.result}`);
  });
  console.log(`结果: ${explanation.result}（等于 24: ${explanation.equalsTarget}）`);
  store.close();
}

function cmdImport(args: string[]): void {
  const [id, name, cardsStr] = args;
  if (!id || !name || !cardsStr) throw new Error("用法: import <id> <name> <c1,c2,c3,c4>");
  const store = openStore();
  const before = store.getDeck(id);
  const deck = store.upsertDeck(id, name, parseCards(cardsStr));
  console.log(
    before
      ? `已更新牌例 ${id}，最新版本 v${deck.latestVersion}（牌面变化才升版本），牌面 ${deck.cards.join(",")}`
      : `已导入牌例 ${id} v1，牌面 ${deck.cards.join(",")}`,
  );
  store.close();
}

function cmdList(): void {
  const store = openStore();
  for (const d of store.listDecks()) {
    console.log(`${d.id}  v${d.latestVersion}  ${d.name}  [${d.cards.join(", ")}]`);
  }
  store.close();
}

function cmdSolutions(args: string[]): void {
  const [id, limitStr] = args;
  if (!id) throw new Error("用法: solutions <id> [limit]");
  const store = openStore();
  const result = runSolve(store, id, { limit: limitStr ? parseInt(limitStr, 10) : null });
  console.log(JSON.stringify(result.solutions, null, 2));
  store.close();
}

function cmdExport(args: string[]): void {
  const store = openStore();
  const payload = {
    exportedAt: new Date().toISOString(),
    decks: store
      .listDecks()
      .map((d) => ({ ...d, solves: store.listSolves(d.id), checks: store.listChecks(d.id) })),
  };
  const json = JSON.stringify(payload, null, 2);
  if (args[0]) {
    writeFileSync(args[0], json, "utf-8");
    console.log(`已导出到 ${args[0]}`);
  } else {
    console.log(json);
  }
  store.close();
}

function cmdImportFile(args: string[]): void {
  const file = args[0];
  if (!file) throw new Error("用法: import-file <file.json>");
  const data = JSON.parse(readFileSync(file, "utf-8"));
  const store = openStore();
  let count = 0;
  for (const d of data.decks ?? []) {
    if (!Array.isArray(d.cards) || d.cards.length !== 4) continue;
    store.upsertDeck(d.id, d.name ?? d.id, d.cards);
    count++;
  }
  console.log(`已从 ${file} 导入 ${count} 个牌例`);
  store.close();
}

function heading(s: string): void {
  console.log("\n==================== " + s + " ====================");
}

/** 演示：3388 分数解、1111 无解、重复用牌错误、展示上限、重启后读取、参考枚举交叉核对 */
function cmdDemo(): void {
  heading("1. 内置牌例");
  cmdList();

  heading("2. 求解 3,3,8,8（展示上限 3 条）");
  const store = openStore();
  const r1 = runSolve(store, "classic-3388", { limit: 3 });
  console.log(r1.note);
  r1.solutions.forEach((s, i) => console.log(`  ${i + 1}. ${s.expression} = ${s.value}`));
  console.log(`所有返回解均通过独立验算器复核: ${r1.verifiedAll}`);

  heading("3. 逐步解释 8/(c1-c3/c2)（即 8/(3-8/3)，区分两张 3、两张 8）");
  const expr = "c3/(c1-c4/c2)";
  printReport(verifyExpression(expr, [3, 3, 8, 8]));

  heading("4. 无解示例 1,1,1,1（完成搜索后才下结论）");
  const r2 = runSolve(store, "ones-1111", { limit: 10 });
  console.log(r2.note);

  heading("5. 错误表达式：重复使用 c1（c1*c1*c3*c4）");
  printReport(verifyExpression("c1*c1*c3*c4", [3, 3, 8, 8]));

  heading("6. 其余各类错误");
  printReport(verifyExpression("c1+c2+c3", [3, 3, 8, 8])); // 漏牌
  printReport(verifyExpression("c1*c2*c3*c9", [3, 3, 8, 8])); // 未知编号
  printReport(verifyExpression("c1+c2^c3*c4", [3, 3, 8, 8])); // 非法字符/运算
  printReport(verifyExpression("c1/0+c2+c3+c4", [3, 3, 8, 8])); // 裸数字
  printReport(verifyExpression("c1/(c2-c2)+c3+c4", [3, 3, 8, 8])); // 除零
  printReport(verifyExpression("c1+c2+c3+c4", [3, 3, 8, 8])); // 结果不对

  heading("7. 修改牌例形成新版本（独立演示牌例 demo-edit：3,3,8,8 -> 3,3,8,7）");
  store.upsertDeck("demo-edit", "版本演示", [3, 3, 8, 8]);
  store.upsertDeck("demo-edit", "版本演示", [3, 3, 8, 7]);
  console.log(`当前最新版本: v${store.getDeck("demo-edit")!.latestVersion}`);
  const v1 = runSolve(store, "demo-edit", { version: 1, limit: 3 });
  const v2 = runSolve(store, "demo-edit", { version: 2, limit: 3 });
  console.log(`v1 牌面 3,3,8,8 可解=${v1.solvable}；v2 牌面 3,3,8,7 可解=${v2.solvable}（旧版本保留可查）`);
  store.close();

  heading("8. 独立参考枚举器交叉核对一批小牌例");
  const cases = [
    [3, 3, 8, 8],
    [1, 1, 1, 1],
    [1, 2, 3, 4],
    [4, 6, 6, 6],
    [1, 1, 4, 6],
    [5, 5, 5, 5],
    [2, 3, 5, 12],
  ];
  for (const cards of cases) {
    const fast = solve(cards).solvable;
    const ref = referenceSolvable(cards);
    const mark = fast === ref ? "一致" : "不一致!!";
    console.log(`  [${cards.join(",")}]  子集DP=${fast}  参考枚举=${ref}  ${mark}`);
  }

  heading("9. 模拟重启：重新打开数据库读取原求解与解释");
  const reopened = openStore();
  const cached = reopened
    .listSolves("classic-3388")
    .find((s) => s.limitCfg === 3 && s.version === 1);
  if (cached) {
    const payload = JSON.parse(cached.resultsJson);
    console.log(`从 SQLite 读到 v${cached.version} 的求解：可解=${payload.solvable}，解总数=${payload.totalCount}`);
    const first = payload.solutions[0].expression;
    const explanation = explainSolution(reopened, "classic-3388", first, { version: 1 });
    explanation.steps.forEach((s, i) =>
      console.log(`  步骤 ${i + 1}: ${s.subExpression} = ${s.arithmetic} = ${s.result}`),
    );
  } else {
    console.log("未找到缓存求解记录");
  }
  reopened.close();

  heading("演示结束");
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "import":
        return cmdImport(rest);
      case "import-file":
        return cmdImportFile(rest);
      case "list":
        return cmdList();
      case "solve":
        return cmdSolve(rest);
      case "solutions":
        return cmdSolutions(rest);
      case "explain":
        return cmdExplain(rest);
      case "check":
        return cmdCheck(rest);
      case "export":
        return cmdExport(rest);
      case "demo":
        return cmdDemo();
      default:
        console.log(
          [
            "用法: p24 <command>",
            "命令: import | import-file | list | solve | solutions | explain | check | export | demo",
          ].join("\n"),
        );
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`错误 [${e.code}]: ${e.message}`);
    } else {
      console.error(`错误: ${(e as Error).message}`);
    }
    process.exitCode = 1;
  }
}

main();

