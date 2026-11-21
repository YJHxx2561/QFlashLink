// 生成 Cloudflare Pages 部署产物 dist/：
//   - public/ 下的静态文件原样复制
//   - src/worker.js 及其依赖打包成单文件 dist/_worker.js
// Pages 不会解析 _worker.js 里的相对 import，因此必须预先打包成单文件。

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// 使用逐文件复制而不是 fs.cpSync：后者在 Windows 非 ASCII 路径下会导致进程崩溃。
function copyDir(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = path.join(source, entry);
    const to = path.join(target, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

copyDir(path.join(root, "public"), dist);

// 使用 write:false 让 esbuild 只返回内存中的结果，再由 Node 写入目标路径。
// 这样可避免 esbuild 原生二进制在 Windows 非 ASCII 路径下直接写文件崩溃。
const result = await build({
  entryPoints: [path.join(root, "src", "worker.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});

writeFileSync(path.join(dist, "_worker.js"), result.outputFiles[0].contents);

console.log("已生成 dist/（静态文件 + _worker.js）");
