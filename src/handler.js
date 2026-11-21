// 与运行时无关的统一请求处理器。
// 接受 Web Request，返回 Web Response，因此可被 Cloudflare Workers、
// Cloudflare Pages 以及本地 Node 服务器共用。

import { InvalidShareError, errorMessage, getLink, listFiles } from "./qfile.js";

const LINK_CONCURRENCY = 6;
const API_PREFIXES = ["/qfile", "/url"];

/**
 * @param {Request} request
 * @param {{ assets?: Record<string, string> }} [options] 静态资源映射（路径 -> 内容）
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, options = {}) {
  const assets = options.assets ?? {};
  const url = new URL(request.url);

  // 静态资源 / 首页：由各部署方式的 assets 提供，API 路径除外。
  if (
    request.method === "GET" &&
    !API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
  ) {
    const assetPath = url.pathname === "/" ? "/index.html" : url.pathname;
    if (Object.prototype.hasOwnProperty.call(assets, assetPath)) {
      return text(200, assets[assetPath], contentTypeFor(assetPath));
    }
  }

  const response = request.method === "OPTIONS" ? preflight() : await route(request, url);

  // 网站与 API 允许跨域调用，方便把前端和 API 部署在不同域名。
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Vary", "Origin");
  return response;
}

async function route(request, url) {
  if (url.pathname === "/qfile") {
    return handleFiles(request, url);
  }
  if (url.pathname === "/url") {
    return handleLink(request, url);
  }
  return json(404, { error: "not found" });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleFiles(request, url) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }
  const share = url.searchParams.get("url");
  if (!share) {
    return json(400, { error: "missing url parameter" });
  }

  try {
    const files = await listFiles(share);
    const withLinks = url.searchParams.get("link") === "true";
    const urls = withLinks ? await signFileLinks(files) : [];

    const views = files.map((f, index) => {
      const view = {
        file_id: f.cliId || f.id,
        name: f.name,
        size: f.size,
        sha1: f.sha1,
      };
      if (withLinks) {
        view.url = urls[index] ?? null;
      }
      return view;
    });
    return json(200, { files: views });
  } catch (err) {
    return upstreamError("/qfile", err);
  }
}

async function handleLink(request, url) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }
  const share = url.searchParams.get("url");
  const fileId = url.searchParams.get("file_id");
  if (!share) {
    return json(400, { error: "missing url parameter" });
  }
  if (!fileId) {
    return json(400, { error: "missing file_id parameter" });
  }

  try {
    const files = await listFiles(share);
    const found = files.find((f) => f.cliId === fileId || f.id === fileId);
    if (!found) {
      return json(404, { error: "file not found in share" });
    }
    return json(200, { url: await getLink(found.id, found.name) });
  } catch (err) {
    return upstreamError("/url", err);
  }
}

function methodNotAllowed() {
  return json(405, { error: "method not allowed" }, { Allow: "GET" });
}

function upstreamError(path, err) {
  if (err instanceof InvalidShareError) {
    return json(400, { error: err.message });
  }
  console.error(`${path}: ${errorMessage(err)}`);
  return json(502, { error: errorMessage(err) });
}

/** 按固定并发为文件签发直链；单个文件失败仅影响它自己。 */
export async function signFileLinks(files, sign = getLink) {
  return mapLimit(files, LINK_CONCURRENCY, async (f) => {
    try {
      return await sign(f.id, f.name);
    } catch (err) {
      console.error(`sign link for ${f.name}: ${errorMessage(err)}`);
      return null;
    }
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function json(status, value, headers = {}) {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function text(status, body, contentType) {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function contentTypeFor(path) {
  if (path.endsWith(".html") || path === "/index.html") {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}
