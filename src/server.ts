// 纯 Node HTTP 后端，不依赖 Web 框架。默认端口 0 表示由操作系统分配空闲端口。

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { Point24Service, ServiceException } from "./service.js";

interface JsonResponse {
  status: number;
  body: unknown;
}

export function startServer(service: Point24Service, requestedPort = 0): Promise<{
  server: Server;
  port: number;
}> {
  const server = createServer((req, res) => {
    handle(req, service).then(
      (result) => sendJson(res, result.status, result.body),
      (error: unknown) => {
        if (error instanceof ServiceException) {
          sendJson(res, 400, { error: error.error });
          return;
        }
        const body = {
          error: {
            code: "INTERNAL",
            message: error instanceof Error ? error.message : String(error),
          },
        };
        sendJson(res, 500, body);
      },
    );
  });

  return new Promise((resolve) => {
    server.listen(requestedPort, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ServiceException({
      code: "INVALID_CARDS",
      message: "请求体不是合法 JSON",
    });
  }
}

async function handle(
  req: IncomingMessage,
  service: Point24Service,
): Promise<JsonResponse> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/health") {
    return { status: 200, body: { ok: true, service: "point24" } };
  }

  if (method === "POST" && path === "/api/decks") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = service.importDeck(body.name, body.cards, (body.target as number) ?? 24);
    return { status: result.reused ? 200 : 201, body: result };
  }

  if (method === "POST" && path === "/api/solve") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const limit = body.limit === undefined ? 20 : Number(body.limit);
    const target = body.target === undefined ? undefined : Number(body.target);
    return {
      status: 200,
      body: service.solve(String(body.name ?? ""), limit, target),
    };
  }

  const solveMatch = /^\/api\/solves\/(\d+)$/.exec(path);
  if (method === "GET" && solveMatch !== null) {
    return { status: 200, body: service.getSolve(Number(solveMatch[1])) };
  }

  const explainMatch = /^\/api\/solves\/(\d+)\/explain$/.exec(path);
  if (method === "GET" && explainMatch !== null) {
    const index = Number(url.searchParams.get("index") ?? "0");
    return {
      status: 200,
      body: service.explain(Number(explainMatch[1]), index),
    };
  }

  if (method === "POST" && path === "/api/verify") {
    const body = (await readJson(req)) as Record<string, unknown>;
    return { status: 200, body: service.verify(String(body.name ?? ""), body.expression) };
  }

  const verifyMatch = /^\/api\/verifies\/(\d+)$/.exec(path);
  if (method === "GET" && verifyMatch !== null) {
    return { status: 200, body: service.getVerify(Number(verifyMatch[1])) };
  }

  if (method === "GET" && path === "/api/export") {
    return { status: 200, body: service.exportAll() };
  }

  return {
    status: 404,
    body: { error: { code: "NOT_FOUND", message: `没有与 ${method} ${path} 匹配的路由` } },
  };
}
