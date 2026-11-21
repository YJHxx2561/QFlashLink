# QFlashLink

QQ 闪传分享链接转直链工具。粘贴 `https://qfile.qq.com/q/...` 分享链接，即可列出文件并提取可直接下载的直链。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YJHxx2561/QFlashLink)

> 上面的按钮使用 Cloudflare 官方 **Deploy to Cloudflare** 能力：点击后登录 Cloudflare，它会在你的 GitHub/GitLab 账号中创建仓库副本，自动配置 Workers Builds 并完成部署。仓库需为公开仓库或你本人有权限的仓库，且代码已推送到 GitHub。

**一套代码，三种运行方式**：本地 Node 服务、Cloudflare Workers、Cloudflare Pages；自带在线转换网站，无需单独部署前端。

## 功能

- 解析分享链接，列出分享根目录中的文件（名称、大小、SHA1）
- 批量签发直链，单条 / 全部一键复制，支持浏览器直接打开下载
- 直链过期后可对单个文件重新签发
- 无需 QQ 登录，使用随机匿名 uin 调用网页端接口
- 中文界面、响应式布局，支持跨域调用

## 转换原理

1. 校验分享链接必须为 `https://qfile.qq.com/q/...`。
2. 抓取分享页面 HTML，用正则从 `GetFileset_*` 内容中提取 `fileset_id`。
3. 调用 `trpc.file.FileFlashTrans/GetFileList` 获取文件列表（前 20 个，不展开文件夹）。
4. 对每个文件调用 `trpc.qqntv2.richmedia.InnerProxy/BatchDownload` 签发直链，并在末尾附加 `filename` 参数。
5. 上游请求使用 `HMAC-SHA1(body + nonce + timestamp)` 签名，密钥为网页端内置的 `9EB18BB9ED457684`，签名经 `x-qq-ar-*` 请求头传递。

上游是非公开网页接口，结构与签名算法可能变化；直链由上游按需签发、有效期有限。

## 目录结构

```
src/
  qfile.js        核心解析与签名（仅用 Web 标准 API）
  handler.js      路由 / CORS / JSON，三端共用
  worker.js       Workers / Pages 入口
  server.js       本地 Node HTTP 服务器
  embedded.js     构建生成：内嵌的前端资源
public/           前端网站源码
scripts/          构建脚本
test/             单元测试
wrangler.toml     Workers 配置（name = qflashlink）
```

## 本地运行

需要 Node.js 18+（推荐 22）。

```bash
npm install
npm run dev
```

浏览器打开 <http://localhost:8787>。修改 `public/` 下的前端文件后刷新页面即可生效。

可通过环境变量修改监听地址和端口：

```bash
PORT=3000 HOST=127.0.0.1 npm start
```

## 部署到 Cloudflare（推荐：在 Dashboard 连接仓库）

以下两种方式都通过 [dash.cloudflare.com](https://dash.cloudflare.com) 连接 GitHub 仓库完成，之后每次向生产分支 push 都会自动重新部署。

### 准备：把代码推送到 GitHub

Dashboard 连接仓库部署依赖 GitHub 上的代码。如果你还没有推送，先执行（按需修改提交信息）：

```bash
git add .
git commit -m "init QFlashLink"
git push origin main
```

本项目仓库地址为 `https://github.com/YJHxx2561/QFlashLink`，生产分支为 `main`。

### 方式 A：部署为 Cloudflare Workers（Workers Builds）

Workers 域名会同时提供网站和 API。

1. 打开 <https://dash.cloudflare.com>，进入 **Workers & Pages** 页面。
2. 点击 **Create application** → 选择 **GitHub**（也支持 GitLab / Artifacts）。
3. 如提示，点击 **Install & Authorize** 授权 Cloudflare 访问你的 GitHub 仓库。
4. 在仓库列表中选择 `QFlashLink`。
5. 填写项目配置：

   | 字段 | 填写值 | 说明 |
   | --- | --- | --- |
   | Project name | `qflashlink` | **必须与 `wrangler.toml` 中的 `name` 完全一致**，否则构建失败 |
   | Production branch | `main` | 生产分支 |
   | Root directory | 留空 | 仓库根目录 |
   | Build command | `npm run build` | 生成内嵌前端与 Pages 产物 |
   | Deploy command | `npx wrangler deploy` | 部署 Worker |
   | 环境变量 `NODE_VERSION` | `22` | 建议显式指定 Node 版本 |

   如果 Cloudflare 未自动识别构建脚本，请手动按上表填写；`package.json` 中已提供 `build` 与 `deploy` 脚本供其自动检测。

6. 点击 **Save and Deploy**，等待构建日志跑完。
7. 部署完成后得到形如 `https://qflashlink.<你的子域>.workers.dev` 的地址，打开即可使用在线转换网站和 API。
8. 后续可在 Worker 的 **Deployments** 页查看构建历史与日志；非生产分支会生成 Preview 地址。

### 方式 B：部署为 Cloudflare Pages（连接 Git）

Pages 会把 `dist/` 作为静态站点发布，并自动把其中的 `_worker.js` 作为 Worker 运行，因此接口和首页同域名可用。

1. 打开 <https://dash.cloudflare.com>，进入 **Workers & Pages** 页面。
2. 点击 **Create application** → **Pages** → **Connect to Git**。
3. 选择 **GitHub**，完成授权，在仓库列表中选择 `QFlashLink`，点击 **Install & Authorize** → **Begin setup**。
4. 在 **Set up builds and deployments** 中填写：

   | 字段 | 填写值 |
   | --- | --- |
   | Project name | `qflashlink`（会生成 `https://qflashlink.pages.dev`） |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Root directory (advanced) | 留空 |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | 环境变量 `NODE_VERSION` | `22` |

5. 点击 **Save and Deploy**，等待首次构建完成。
6. 部署成功后打开 `https://<项目名>.pages.dev` 验证；其余分支会自动生成预览部署。
7. 若首次访问出现 DNS 错误，通常是 DNS 尚未传播完成，稍等或换网络再试。

> 注意：通过 Git 集成创建的 Pages 项目不能转为 Direct Upload；如果以后只想用命令行上传，请另行新建项目。

## 部署到 Cloudflare（命令行方式）

本地已登录 Cloudflare 账号时也可直接部署：

```bash
npm install
npm run deploy:worker   # 部署 Workers（同时提供网站和 API）
npm run deploy:pages    # 部署 Pages，产物为 dist/
```

本地模拟 Workers 环境：`npm run dev:worker`；本地预览 Pages 产物：`npm run dev:pages`。

> 如果把前端与 API 分开部署，可在页面加载前设置 `window.QFLASHLINK_API_BASE` 指向 API 域名，例如 `https://qflashlink.xxx.workers.dev`。

## API

### 文件列表

```text
GET /qfile?url=<分享链接>
```

```json
{ "files": [{ "file_id": "...", "name": "...", "size": 123, "sha1": "..." }] }
```

### 文件列表并附带直链

```text
GET /qfile?url=<分享链接>&link=true
```

`link=true` 时每个文件追加 `url` 字段；单个文件签发失败时其 `url` 为 `null`。

### 单文件直链

```text
GET /url?url=<分享链接>&file_id=<文件 id>
```

```json
{ "url": "https://multimedia.qfile.qq.com/download?..." }
```

所有接口允许跨域（返回 `Access-Control-Allow-Origin: *`），支持 `OPTIONS` 预检。错误码：`400` 参数或链接不合法、`404` 文件不存在、`405` 方法不允许、`502` 上游失败。

## 测试与检查

```bash
npm run check   # 语法检查
npm test        # 单元测试（9 项）
npm run build   # 生成 src/embedded.js 与 dist/
```

## 注意事项

- 仅支持公开分享；需要提取码的分享无法解析。
- 文件列表只取分享根目录前 20 个文件，不展开文件夹。
- 分享链接默认有效期 7 天（SVIP 最长 180 天）；解析出的直链是上游临时签名地址，通常数小时内有效（具体时长未公开），过期后请重新解析或点击「刷新」。
- 请仅用于合法合规的场景，勿用于传播侵权内容。
