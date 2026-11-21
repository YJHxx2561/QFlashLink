// QFlashLink 前端交互逻辑。
// 默认调用同源的 /qfile 与 /url 接口；如需前后端分离部署，
// 可在页面加载前设置 window.QFLASHLINK_API_BASE 指向 API 域名。

(() => {
  "use strict";

  const API_BASE = String(window.QFLASHLINK_API_BASE || "").replace(/\/$/, "");

  const shareInput = document.getElementById("share-url");
  const convertBtn = document.getElementById("convert-btn");
  const copyAllBtn = document.getElementById("copy-all-btn");
  const errorBox = document.getElementById("error");
  const resultSection = document.getElementById("result-section");
  const fileList = document.getElementById("file-list");
  const fileCount = document.getElementById("file-count");
  const toast = document.getElementById("toast");

  let currentShare = "";
  let toastTimer = 0;

  try {
    shareInput.value = localStorage.getItem("qflashlink:last-share") || "";
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可。
  }

  convertBtn.addEventListener("click", convert);
  copyAllBtn.addEventListener("click", copyAllLinks);
  shareInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      convert();
    }
  });

  async function convert() {
    const share = shareInput.value.trim();
    if (!share) {
      showError("请输入分享链接");
      shareInput.focus();
      return;
    }
    if (!/^https:\/\/qfile\.qq\.com\/q\/.+/i.test(share)) {
      showError("链接格式不正确，应为 https://qfile.qq.com/q/... 开头的分享链接");
      return;
    }

    currentShare = share;
    try {
      localStorage.setItem("qflashlink:last-share", share);
    } catch {
      // 忽略存储失败
    }

    setLoading(true);
    clearError();
    hideResults();

    try {
      const data = await request(
        `/qfile?url=${encodeURIComponent(share)}&link=true`,
      );
      renderFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      showError(err.message || "解析失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function request(path) {
    const response = await fetch(`${API_BASE}${path}`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`服务返回了无法解析的内容（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
    }
    return data;
  }

  function renderFiles(files) {
    fileList.replaceChildren();
    fileCount.textContent = `${files.length} 个文件`;

    if (files.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        "没有找到可下载的文件。分享可能已过期、需要提取码，或只包含了文件夹。";
      fileList.appendChild(empty);
    } else {
      for (const file of files) {
        fileList.appendChild(createFileItem(file));
      }
    }
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function createFileItem(file) {
    const item = document.createElement("article");
    item.className = "file-item";

    const head = document.createElement("div");
    head.className = "file-head";

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = fileKind(file.name);
    head.appendChild(icon);

    const meta = document.createElement("div");
    meta.className = "file-meta";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name || "未命名文件";
    name.title = file.name || "";
    meta.appendChild(name);

    const details = document.createElement("div");
    details.className = "file-details";
    details.textContent = `${formatSize(file.size)}${file.sha1 ? ` · SHA1 ${file.sha1.slice(0, 12)}…` : ""}`;
    meta.appendChild(details);
    head.appendChild(meta);

    const headActions = document.createElement("div");
    headActions.className = "file-head-actions";
    const refreshBtn = makeButton("刷新", "ghost", async () => {
      await refreshLink(file.file_id, linkInput, refreshBtn);
    });
    headActions.appendChild(refreshBtn);
    head.appendChild(headActions);

    const linkRow = document.createElement("div");
    linkRow.className = "link-row";

    const linkInput = document.createElement("input");
    linkInput.className = "link-input";
    linkInput.type = "text";
    linkInput.readOnly = true;
    linkInput.spellcheck = false;
    linkInput.value = file.url || "";
    linkInput.placeholder = file.url === null ? "签发失败，请点击刷新" : "";
    linkInput.addEventListener("focus", () => linkInput.select());
    linkRow.appendChild(linkInput);

    const copyBtn = makeButton("复制", "secondary", async () => {
      if (!linkInput.value) {
        showToast("暂无可复制的直链");
        return;
      }
      try {
        await copyText(linkInput.value);
        showToast("直链已复制");
      } catch {
        showToast("复制失败，请手动选择链接复制");
        linkInput.focus();
        linkInput.select();
      }
    });
    linkRow.appendChild(copyBtn);

    if (file.url) {
      const openLink = document.createElement("a");
      openLink.className = "button secondary";
      openLink.href = file.url;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = "打开";
      linkRow.appendChild(openLink);
    }

    item.appendChild(head);
    item.appendChild(linkRow);
    return item;
  }

  async function refreshLink(fileId, linkInput, button) {
    if (!fileId) {
      showToast("该文件缺少标识，无法刷新");
      return;
    }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "刷新中";
    try {
      const data = await request(
        `/url?url=${encodeURIComponent(currentShare)}&file_id=${encodeURIComponent(fileId)}`,
      );
      linkInput.value = data.url || "";
      showToast("直链已重新签发");
    } catch (err) {
      showToast(err.message || "刷新失败");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function copyAllLinks() {
    const links = Array.from(fileList.querySelectorAll(".link-input"))
      .map((input) => input.value.trim())
      .filter(Boolean);
    if (links.length === 0) {
      showToast("没有可复制的直链");
      return;
    }
    try {
      await copyText(links.join("\n"));
      showToast(`已复制 ${links.length} 条直链`);
    } catch {
      showToast("复制失败，请逐条手动复制");
    }
  }

  function makeButton(label, variant, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${variant}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) {
      throw new Error("copy failed");
    }
  }

  function setLoading(loading) {
    convertBtn.disabled = loading;
    convertBtn.textContent = loading ? "解析中…" : "解析直链";
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function hideResults() {
    resultSection.hidden = true;
    fileList.replaceChildren();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "大小未知";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  function fileKind(name) {
    const ext = String(name || "").split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) {
      return "IMG";
    }
    if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext)) {
      return "VID";
    }
    if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) {
      return "AUD";
    }
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
      return "ZIP";
    }
    if (["pdf"].includes(ext)) {
      return "PDF";
    }
    if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md"].includes(ext)) {
      return "DOC";
    }
    return "FILE";
  }

  // 页脚：本站运行时间，实时更新。
  (function startUptime() {
    const el = document.getElementById("site_uptime");
    if (!el) return;
    const startedAt = new Date(2026, 10, 21, 16, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    function render() {
      const elapsed = Math.max(0, Date.now() - startedAt.getTime());
      const days = Math.floor(elapsed / 86400000);
      const hours = Math.floor(elapsed / 3600000) % 24;
      const minutes = Math.floor(elapsed / 60000) % 60;
      const seconds = Math.floor(elapsed / 1000) % 60;
      el.textContent = `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    render();
    setInterval(render, 1000);
  })();

  // 显示模式：跟随系统 / 白天 / 黑夜，默认跟随系统，点击按钮循环切换。
  (function setupTheme() {
    const KEY = "qflashlink:theme";
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const labels = { system: "跟随系统", light: "白天模式", dark: "黑夜模式" };
    let pref = "system";
    try {
      pref = localStorage.getItem(KEY) || "system";
    } catch {
      // 忽略存储不可用
    }
    if (!["system", "light", "dark"].includes(pref)) {
      pref = "system";
    }

    function apply() {
      const dark = pref === "dark" || (pref === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      button.dataset.mode = pref;
      const title = `当前：${labels[pref]}（点击切换）`;
      button.title = title;
      button.setAttribute("aria-label", title);
    }

    button.addEventListener("click", () => {
      pref = pref === "system" ? "light" : pref === "light" ? "dark" : "system";
      try {
        localStorage.setItem(KEY, pref);
      } catch {
        // 忽略存储不可用
      }
      apply();
      showToast(`已切换到${labels[pref]}`);
    });

    media.addEventListener("change", () => {
      if (pref === "system") apply();
    });

    apply();
  })();
})();
