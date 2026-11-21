// 把 public/ 下的前端资源内嵌为 ES 模块，供 Worker 在 Workers / Pages 上直接提供网站。
// 这是唯一需要生成的代码文件；修改 public/ 后运行 npm run build:embedded 即可更新。

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const files = {
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
  "/favicon.svg": "favicon.svg",
};

const assets = {};
for (const [urlPath, file] of Object.entries(files)) {
  assets[urlPath] = readFileSync(path.join(publicDir, file), "utf8");
}

const source =
  "// 由 scripts/build-embedded.mjs 自动生成，请勿手动编辑。\n" +
  `export const assets = ${JSON.stringify(assets)};\n`;

writeFileSync(path.join(root, "src", "embedded.js"), source, "utf8");
console.log("已生成 src/embedded.js");
