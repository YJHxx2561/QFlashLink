import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  InvalidShareError,
  appendFilename,
  errorMessage,
  signRequest,
  validateShareUrl,
} from "../src/qfile.js";
import { handleRequest } from "../src/handler.js";

test("validateShareUrl 接受合法的分享链接", () => {
  assert.doesNotThrow(() => validateShareUrl("https://qfile.qq.com/q/tlTMa1XknC"));
  assert.doesNotThrow(() => validateShareUrl("https://qfile.qq.com/q/abc/def?x=1"));
});

test("validateShareUrl 拒绝非法链接", () => {
  const bad = [
    "http://qfile.qq.com/q/tlTMa1XknC",
    "https://example.com/q/tlTMa1XknC",
    "https://qfile.qq.com/other/tlTMa1XknC",
    "https://qfile.qq.com/q/",
    "not a url",
  ];
  for (const value of bad) {
    assert.throws(() => validateShareUrl(value), InvalidShareError, value);
  }
});

test("appendFilename 按 Go QueryEscape 规则编码文件名", () => {
  assert.equal(
    appendFilename("https://x.com/download?a=1", "a b+c.png"),
    "https://x.com/download?a=1&filename=a%20b%2Bc.png",
  );
  assert.equal(
    appendFilename("https://x.com/download", "a!'()*.txt"),
    "https://x.com/download?filename=a%21%27%28%29%2A.txt",
  );
  assert.equal(appendFilename("https://x.com/download", ""), "https://x.com/download");
});

test("signRequest 与独立的 HMAC-SHA1 实现结果一致", async () => {
  const body = '{"fileset_id":"abc"}';
  const nonce = "4321";
  const timestamp = "1700000000";
  const expected = createHmac("sha1", "9EB18BB9ED457684")
    .update(body + nonce + timestamp)
    .digest("hex");
  assert.equal(await signRequest(body, nonce, timestamp), expected);
});

test("errorMessage 同时支持 Error 与任意值", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("oops"), "oops");
});

test("handleRequest 从内嵌资源提供首页", async () => {
  const response = await handleRequest(new Request("http://localhost:8787/"), {
    assets: { "/index.html": "<h1>hello</h1>" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(await response.text(), "<h1>hello</h1>");
});

test("handleRequest 校验 /qfile 参数", async () => {
  const response = await handleRequest(new Request("http://localhost:8787/qfile"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing url parameter" });
});

test("handleRequest 校验 /url 参数", async () => {
  const response = await handleRequest(
    new Request("http://localhost:8787/url?url=https%3A%2F%2Fqfile.qq.com%2Fq%2Fabc"),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing file_id parameter" });
});

test("handleRequest 处理跨域预检", async () => {
  const response = await handleRequest(
    new Request("http://localhost:8787/qfile", { method: "OPTIONS" }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});
