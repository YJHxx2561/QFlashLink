// QQ 闪传（qfile.qq.com）分享链接直链解析核心逻辑。
//
// 原理：以匿名 uin 调用 qfile 网页端的非公开接口，请求使用
// HMAC-SHA1(body + nonce + timestamp) 签名。
// 本文件只使用 Web 标准 API（fetch / crypto.subtle / URL / AbortSignal），
// 因此可同时运行在 Node.js、Cloudflare Workers 和 Cloudflare Pages 中。

const ORIGIN = "https://qfile.qq.com";
const API_BASE = `${ORIGIN}/http2rpc/gotrpc/noauth/`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
const SIGN_KEY = "9EB18BB9ED457684";
const SCENE_TYPE = 103;
const PAGE_LIMIT = 8 * 1024 * 1024;
const JSON_LIMIT = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const FILESET_PATTERN =
  /GetFileset_.{0,80}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

export const INVALID_SHARE_MESSAGE =
  "url must be an https://qfile.qq.com/q/... share link";

/** 分享链接不合法时抛出。 */
export class InvalidShareError extends Error {
  constructor() {
    super(INVALID_SHARE_MESSAGE);
    this.name = "InvalidShareError";
  }
}

/**
 * 列出分享根目录中可下载的文件（最多 20 个，不展开文件夹）。
 * @param {string} share 分享链接
 * @returns {Promise<Array<{id:string, cliId:string, name:string, size:number, sha1:string}>>}
 */
export async function listFiles(share) {
  validateShareUrl(share);
  const filesetId = await getFilesetId(share);

  const body = {
    fileset_id: filesetId,
    req_infos: [
      {
        parent_id: "",
        req_depth: 1,
        count: 20,
        sort_conditions: [
          { sort_field: 4, sort_order: 2 },
          { sort_field: 0, sort_order: 1 },
        ],
        filter_condition: { file_category: 0, exclude_deleted: true },
      },
    ],
    support_folder_status: true,
    scene_type: SCENE_TYPE,
  };

  const resp = await post(
    "trpc.file.FileFlashTrans/GetFileList",
    "0x93d4",
    "1",
    body,
  );
  if (resp.retcode !== 0) {
    throw new Error(
      `GetFileList: ${apiMessage(resp.message, resp.error)} (retcode ${resp.retcode})`,
    );
  }

  const files = [];
  for (const list of resp.data?.file_lists ?? []) {
    for (const f of list.file_list ?? []) {
      if (f.is_dir || !f.physical?.id) {
        continue;
      }
      files.push({
        id: f.physical.id,
        cliId: f.cli_fileid ?? "",
        name: f.name ?? "",
        size: parseIntOrZero(f.file_size),
        sha1: f.file_sha1 ?? "",
      });
    }
  }
  return files;
}

/**
 * 为分享中的单个文件签发一条有时效的直链。
 * @param {string} physicalId 文件的 physical id
 * @param {string} name 文件名（会作为 filename 参数附加到直链）
 * @returns {Promise<string>}
 */
export async function getLink(physicalId, name) {
  const body = {
    req_head: { agent: 8 },
    download_info: [
      {
        batch_id: physicalId,
        scene: { business_type: 4, app_type: 22, scene_type: 5 },
        index_node: { file_uuid: physicalId },
        url_type: 2,
        download_scene: 0,
      },
    ],
    scene_type: SCENE_TYPE,
  };

  const resp = await post(
    "trpc.qqntv2.richmedia.InnerProxy/BatchDownload",
    "0x9248",
    "4",
    body,
  );
  if (resp.retcode !== 0) {
    throw new Error(
      `BatchDownload: ${apiMessage(resp.message, resp.error)} (retcode ${resp.retcode})`,
    );
  }

  const item = resp.data?.download_rsp?.[0];
  if (!item) {
    throw new Error("BatchDownload: empty download_rsp");
  }
  if (item.ret_code !== "0") {
    throw new Error(`BatchDownload: ${item.ret_msg} (ret_code ${item.ret_code})`);
  }
  if (!item.url) {
    throw new Error("BatchDownload: empty url");
  }
  return appendFilename(item.url, name);
}

/** 校验分享链接必须是 https://qfile.qq.com/q/... 形式。 */
export function validateShareUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidShareError();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "qfile.qq.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new InvalidShareError();
  }
  const code = url.pathname.startsWith("/q/") ? url.pathname.slice(3) : "";
  if (code.replace(/^\/+|\/+$/g, "") === "") {
    throw new InvalidShareError();
  }
}

/** 给直链附加编码后的 filename 参数，行为与 Go 的 url.QueryEscape 一致。 */
export function appendFilename(rawUrl, name) {
  if (name === "") {
    return rawUrl;
  }
  let sep = "?";
  if (rawUrl.includes("?")) {
    sep = "&";
  }
  if (rawUrl.endsWith("?") || rawUrl.endsWith("&")) {
    sep = "";
  }
  return `${rawUrl}${sep}filename=${encodeQueryComponent(name)}`;
}

/** HMAC-SHA1 签名，返回小写十六进制字符串。 */
export async function signRequest(body, nonce, timestamp) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(body + nonce + timestamp),
  );
  return hex(new Uint8Array(mac));
}

/** 抓取分享页面并从 HTML 中提取 fileset id。 */
async function getFilesetId(share) {
  const resp = await fetch(share, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let finalHost = "";
  try {
    finalHost = new URL(resp.url).hostname;
  } catch {
    // 交由下面的校验统一报错
  }
  if (finalHost !== "qfile.qq.com") {
    throw new Error("fetch share page: unexpected redirect away from qfile.qq.com");
  }
  if (resp.status !== 200) {
    throw new Error(`fetch share page: HTTP ${resp.status} ${resp.statusText}`);
  }

  const page = await resp.text();
  if (page.length > PAGE_LIMIT) {
    throw new Error("fetch share page: response too large");
  }
  const match = FILESET_PATTERN.exec(page);
  if (!match) {
    throw new Error(
      "fileset id not found in share page; the share may be expired or require an extraction code",
    );
  }
  return match[1];
}

/** 发起一次带签名的上游 RPC 请求。 */
async function post(service, command, serviceType, body) {
  const raw = JSON.stringify(body);
  const nonce = String(1 + randomInt(10000));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signRequest(raw, nonce, timestamp);

  const resp = await fetch(API_BASE + service, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      "x-oidb": `{"uint32_command":${JSON.stringify(command)}, "uint32_service_type":${JSON.stringify(serviceType)}}`,
      "x-device-id": "",
      "x-qq-ar-nonce": nonce,
      "x-qq-ar-timestamp": timestamp,
      "x-qq-ar-signature": signature,
      Cookie: "uin=" + anonymousUin(),
    },
    body: raw,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await resp.text();
  if (resp.status !== 200) {
    throw new Error(
      `${service}: HTTP ${resp.status} ${resp.statusText}: ${snippet(text)}`,
    );
  }
  if (text.length > JSON_LIMIT) {
    throw new Error(`${service}: response too large`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${service}: decode response: ${errorMessage(err)}`);
  }
}

let signingKeyPromise;

function signingKey() {
  signingKeyPromise ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGN_KEY),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return signingKeyPromise;
}

let cachedUin = 0;

function anonymousUin() {
  if (cachedUin === 0) {
    cachedUin = 100000000 + randomInt(900000000);
  }
  return cachedUin;
}

function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function hex(bytes) {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function encodeQueryComponent(value) {
  // 与 Go 的 url.QueryEscape 对齐：encodeURIComponent 不会转义 !'()*
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function parseIntOrZero(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(n) ? 0 : n;
}

function apiMessage(message, error) {
  if (message) {
    return message;
  }
  if (error?.message) {
    return error.message;
  }
  return "request failed";
}

function snippet(data) {
  const s = data.trim();
  return s.length > 200 ? `${s.slice(0, 200)}...` : s;
}

export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
