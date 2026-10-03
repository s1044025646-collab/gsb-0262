/**
 * 纯后端 HTTP API（无前端页面）。
 * 端口：PORT 环境变量指定；默认在本机选择一个空闲端口。
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { Store } from "./db.js";
import { ApiError, checkExpression, explainSolution, runSolve, validateCards } from "./service.js";
import { seedDefaults } from "./seed.js";

const DATA_DIR = process.env.P24_DATA_DIR ?? join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "point24.db");

export const store = new Store(DB_PATH);
seedDefaults(store);

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new ApiError("PAYLOAD_TOO_LARGE", "请求体过大", 413));
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ApiError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function toExport() {
  const decks = store.listDecks();
  return {
    exportedAt: new Date().toISOString(),
    decks: decks.map((d) => ({ ...d, solves: store.listSolves(d.id), checks: store.listChecks(d.id) })),
  };
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  try {
    if (method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, db: DB_PATH });
    }
    if (method === "GET" && path === "/api/decks") {
      return send(res, 200, { decks: store.listDecks() });
    }
    if (method === "GET" && /^\/api\/decks\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/").pop()!);
      const deck = store.getDeck(id);
      if (!deck) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${id}`, 404);
      return send(res, 200, { deck });
    }
    if (method === "POST" && path === "/api/decks") {
      const body = await readJson(req);
      validateCards(body.cards);
      if (typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id)) {
        throw new ApiError("INVALID_ID", "id 必须是 1..64 位字母数字、下划线或短横线");
      }
      const deck = store.upsertDeck(body.id, typeof body.name === "string" ? body.name : body.id, body.cards);
      return send(res, 200, { deck });
    }
    if (method === "POST" && /^\/api\/decks\/[^/]+\/solve$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const body = await readJson(req);
      const result = runSolve(store, id, {
        limit: body.limit ?? null,
        target: body.target ?? 24,
        version: body.version,
      });
      return send(res, 200, { solve: result });
    }
    if (method === "POST" && /^\/api\/decks\/[^/]+\/check$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const body = await readJson(req);
      const report = checkExpression(store, id, body.expression, {
        version: body.version,
        target: body.target ?? 24,
      });
      return send(res, 200, { report });
    }
    if (method === "POST" && /^\/api\/decks\/[^/]+\/explain$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const body = await readJson(req);
      if (typeof body.expression !== "string") throw new ApiError("INVALID_EXPRESSION", "expression 必须是字符串");
      const explanation = explainSolution(store, id, body.expression, { version: body.version });
      return send(res, 200, { explanation });
    }
    if (method === "GET" && /^\/api\/decks\/[^/]+\/solves$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      if (!store.getDeck(id)) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${id}`, 404);
      return send(res, 200, { solves: store.listSolves(id) });
    }
    if (method === "GET" && /^\/api\/decks\/[^/]+\/checks$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      if (!store.getDeck(id)) throw new ApiError("DECK_NOT_FOUND", `牌例不存在：${id}`, 404);
      return send(res, 200, { checks: store.listChecks(id) });
    }
    if (method === "GET" && path === "/api/export") {
      return send(res, 200, toExport());
    }
    if (method === "POST" && path === "/api/import") {
      const body = await readJson(req);
      if (!Array.isArray(body.decks)) throw new ApiError("INVALID_IMPORT", "导入数据必须包含 decks 数组");
      const imported: string[] = [];
      for (const d of body.decks) {
        validateCards(d.cards);
        store.upsertDeck(d.id, d.name ?? d.id, d.cards);
        imported.push(d.id);
      }
      return send(res, 200, { imported });
    }
    throw new ApiError("NOT_FOUND", `路由不存在：${method} ${path}`, 404);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: { code: e.code, message: e.message } });
    return send(res, 500, { error: { code: "INTERNAL", message: (e as Error).message } });
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else reject(new Error("无法获取空闲端口"));
    });
    srv.on("error", reject);
  });
}

const server = createServer((req, res) => {
  void handle(req, res);
});

const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const listenPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : await findFreePort();

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`二十四点后端已启动: http://127.0.0.1:${listenPort}`);
  console.log(`数据文件: ${DB_PATH}`);
  console.log("健康检查: GET /health");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
