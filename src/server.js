// 本地部署用的 Node.js HTTP 服务器适配器。
// 它把 Node 请求转换成 Web Request，交给共享的 handler 处理，
// 因此本地运行与 Cloudflare 上运行的业务逻辑完全一致。

import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest } from "./handler.js";

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSET_FILES = {
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
  "/favicon.svg": "favicon.svg",
};

/** 每次请求重新读取静态文件，改前端后刷新即可看到效果。 */
function loadAssets() {
  const assets = {};
  for (const [urlPath, file] of Object.entries(ASSET_FILES)) {
    const full = path.join(PUBLIC_DIR, file);
    if (existsSync(full)) {
      assets[urlPath] = readFileSync(full, "utf8");
    }
  }
  return assets;
}

async function toWebRequest(req) {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const requestUrl = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, value);
    }
  }

  const method = req.method || "GET";
  const init = { method, headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    init.body = Buffer.concat(chunks);
  }
  return new Request(requestUrl, init);
}

async function sendResponse(res, webResponse) {
  res.statusCode = webResponse.status;
  if (webResponse.statusText) {
    res.statusMessage = webResponse.statusText;
  }
  webResponse.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(Buffer.from(await webResponse.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const request = await toWebRequest(req);
    const response = await handleRequest(request, { assets: loadAssets() });
    await sendResponse(res, response);
  } catch (err) {
    console.error("local server:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(`${JSON.stringify({ error: err?.message || String(err) })}\n`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QFlashLink 已启动: http://localhost:${PORT}`);
});
