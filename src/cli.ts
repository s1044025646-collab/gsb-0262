#!/usr/bin/env node
// 命令行入口：point24 <command> [...args]

import { resolve } from "node:path";
import { Store } from "./store.js";
import { Point24Service, seedBuiltins, ServiceException } from "./service.js";
import { startServer } from "./server.js";
import { referenceSolve, solve } from "./solver.js";
import { verifyExpression } from "./verifier.js";

const DATA_DIR = resolve(process.cwd(), "data");
const DB_PATH = resolve(DATA_DIR, "point24.db");

function openService(): { store: Store; service: Point24Service } {
  const store = new Store(DB_PATH);
  return { store, service: new Point24Service(store) };
}

function parseCards(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printSteps(report: ReturnType<typeof verifyExpression>): void {
  if (report.steps === undefined) {
    return;
  }
  process.stdout.write("逐步精确计算：\n");
  report.steps.forEach((step, index) => {
    process.stdout.write(
      `  ${index + 1}. ${step.expr} = ${step.value}` +
        (step.value.includes("/") ? ` （${step.decimal}）` : "") +
        "\n",
    );
  });
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "import": {
      const [name, cardsRaw] = rest;
      const { store, service } = openService();
      try {
        const result = service.importDeck(name, parseCards(cardsRaw ?? ""));
        print({ ...result.deck, cards: JSON.parse(result.deck.cards), reused: result.reused });
      } finally {
        store.close();
      }
      return 0;
    }

    case "solve": {
      const [name, limitRaw] = rest;
      const limit = limitRaw === undefined ? 20 : Number(limitRaw);
      const { store, service } = openService();
      try {
        const result = service.solve(name, limit);
        print(result);
      } finally {
        store.close();
      }
      return 0;
    }

    case "show": {
      const [idRaw] = rest;
      const { store, service } = openService();
      try {
        print(service.getSolve(Number(idRaw)));
      } finally {
        store.close();
      }
      return 0;
    }

    case "explain": {
      const [idRaw, indexRaw] = rest;
      const { store, service } = openService();
      try {
        const result = service.explain(Number(idRaw), indexRaw === undefined ? 0 : Number(indexRaw));
        print(result);
        printSteps(result.report);
      } finally {
        store.close();
      }
      return 0;
    }

    case "verify": {
      const [name, ...exprParts] = rest;
      const expression = exprParts.join(" ");
      const { store, service } = openService();
      try {
        const result = service.verify(name, expression);
        print(result.report);
        printSteps(result.report);
        process.stdout.write(`验算报告编号：${result.verifyId}\n`);
      } finally {
        store.close();
      }
      return 0;
    }

    case "export": {
      const { store, service } = openService();
      try {
        print(service.exportAll());
      } finally {
        store.close();
      }
      return 0;
    }

    case "reference": {
      // 直接运行独立参考枚举，交叉核对某组 4 张牌的可解性。
      const values = parseCards(rest[0] ?? "");
      const ref = referenceSolve(values);
      const main = solve(values);
      print({
        cards: values,
        referenceSolvable: ref.solvable,
        referenceSample: ref.sample,
        referenceCheckedTrees: ref.checkedTrees,
        mainSolvable: main.solvable,
        mainTotalDeduped: main.totalFound,
        agree: ref.solvable === main.solvable,
      });
      return 0;
    }

    case "serve": {
      const portArg = rest.includes("--port")
        ? Number(rest[rest.indexOf("--port") + 1])
        : Number(process.env.PORT ?? 0);
      const port = Number.isFinite(portArg) ? portArg : 0;
      const { store, service } = openService();
      seedBuiltins(service);
      const { port: actualPort } = await startServer(service, port);
      process.stdout.write(
        `二十四点后端已启动：http://127.0.0.1:${actualPort}\n` +
          `数据库：${DB_PATH}\n健康检查：GET /health\n按 Ctrl+C 停止。\n`,
      );
      const shutdown = () => {
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return new Promise<number>(() => {});
    }

    case "demo": {
      await runDemo();
      return 0;
    }

    case "help":
    case undefined:
    case "--help":
    case "-h": {
      process.stdout.write(USAGE);
      return 0;
    }

    default:
      process.stderr.write(`未知命令：${command}\n\n${USAGE}`);
      return 2;
  }
}

async function runDemo(): Promise<void> {
  const { store, service } = openService();
  try {
    seedBuiltins(service);

    process.stdout.write("=== 1) 求解内置 3,3,8,8（分数中间值解） ===\n");
    const solved3388 = service.solve("builtin-3388", 10);
    process.stdout.write(solved3388.conclusion + "\n");
    solved3388.solutions.slice(0, 5).forEach((item, index) => {
      process.stdout.write(`  解 ${index + 1}: ${item.expression}\n`);
    });

    process.stdout.write("\n=== 2) 解释第一个解的精确分数步骤 ===\n");
    const explanation = service.explain(solved3388.resultId, 0);
    printSteps(explanation.report);

    process.stdout.write("\n=== 3) 验算外部写法 8/(3-8/3)，即 c4/(c1-c3/c2) ===\n");
    const good = service.verify("builtin-3388", "c4/(c1-c3/c2)");
    process.stdout.write(`${good.report.message}（报告 #${good.verifyId}）\n`);

    process.stdout.write("\n=== 4) 重复使用同一张实体牌（c1 出现两次）应报错 ===\n");
    const repeated = service.verify("builtin-3388", "c3/(c1-c1/c2)");
    process.stdout.write(`[${repeated.report.errorCode}] ${repeated.report.message}\n`);

    process.stdout.write("\n=== 5) 除零分支 ===\n");
    const divZero = service.verify("builtin-3388", "c3/(c1-c2)+c4");
    process.stdout.write(`[${divZero.report.errorCode}] ${divZero.report.message}\n`);

    process.stdout.write("\n=== 6) 求解内置 1,1,1,1（明确无解） ===\n");
    const solved1111 = service.solve("builtin-1111", 10);
    process.stdout.write(solved1111.conclusion + "\n");

    process.stdout.write("\n=== 7) 独立参考枚举交叉核对若干小牌例 ===\n");
    const cases = [
      [3, 3, 8, 8],
      [1, 1, 1, 1],
      [1, 2, 3, 4],
      [4, 6, 6, 6],
      [5, 5, 5, 1],
      [1, 1, 4, 6],
      [2, 3, 5, 12],
      [13, 13, 13, 13],
    ];
    for (const cards of cases) {
      const ref = referenceSolve(cards);
      const main = solve(cards);
      process.stdout.write(
        `  ${cards.join(",")}: 参考=${ref.solvable ? "有解" : "无解"} ` +
          `主搜索=${main.solvable ? "有解" : "无解"} 去重解数=${main.totalFound} ` +
          `${ref.solvable === main.solvable ? "一致 ✓" : "不一致 ✗"}\n`,
      );
    }

    process.stdout.write("\n=== 8) 将所有返回解重新交给验算器 ===\n");
    const all = solve([3, 3, 8, 8]);
    let bad = 0;
    for (const item of all.solutions) {
      const report = verifyExpression(item.expression, [3, 3, 8, 8]);
      if (!report.ok) {
        bad += 1;
        process.stdout.write(`  非法解：${item.expression} -> ${report.message}\n`);
      }
    }
    process.stdout.write(
      `  共复核 ${all.solutions.length} 个去重解，非法解 ${bad} 个` +
        (bad === 0 ? "，全部通过 ✓\n" : "\n"),
    );

    process.stdout.write(
      `\n数据已保存在 ${DB_PATH}，重启后可用 "show ${solved3388.resultId}" ` +
        `与 "explain ${solved3388.resultId}" 重新读取。\n`,
    );
  } finally {
    store.close();
  }
}

const USAGE = `二十四点精确求解与验算后端（CLI）

用法：
  node dist/src/cli.js import <名称> <牌面>     导入牌例，牌面如 3,3,8,8（同名称改牌产生新版本）
  node dist/src/cli.js solve <名称> [上限]      完整枚举求解，上限仅限制展示（默认 20）
  node dist/src/cli.js show <结果编号>          查看历史有限解列表（重启后仍可读取）
  node dist/src/cli.js explain <结果编号> [下标] 逐步展示某个解的精确分数计算
  node dist/src/cli.js verify <名称> <表达式>    验算外部表达式，例如 c3/(c1-c3/c2)
  node dist/src/cli.js reference <牌面>          五种二叉树参考枚举，与主搜索交叉核对
  node dist/src/cli.js export                   导出全部牌例版本为 JSON
  node dist/src/cli.js serve [--port 端口]       启动 HTTP API（默认自动选择空闲端口）
  node dist/src/cli.js demo                     运行内置完整演示

实体牌语法：c1、c2、c3、c4（或 #1..#4），仅允许 + - * / 与括号。
`;

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof ServiceException) {
      process.stderr.write(`[${error.error.code}] ${error.message}\n`);
      process.exit(1);
    }
    process.stderr.write(error instanceof Error ? `${error.stack ?? error.message}\n` : String(error));
    process.exit(1);
  },
);
