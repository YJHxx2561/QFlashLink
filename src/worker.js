// Cloudflare Workers / Pages 入口。
// 构建脚本会先生成 src/embedded.js（把前端静态资源内嵌进来），
// 这样同一个 Worker 既能提供 API，也能直接提供在线转换网站。

import { handleRequest } from "./handler.js";
import { assets } from "./embedded.js";

export default {
  async fetch(request) {
    return handleRequest(request, { assets });
  },
};
