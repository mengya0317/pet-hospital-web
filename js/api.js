// 接口配置 + 调用 AI。网页版：所有请求经「CORS 代理」（Cloudflare Worker，见 web-version/worker.js）转发，避开浏览器跨域；
// 生图任务的等待逻辑在 lib/poll.js
const WORKER_URL_KEY = "petvet_worker_url_v1";   // CORS 代理地址（Cloudflare Worker）

const FIELDS = ["ds_base", "ds_model", "ds_key", "img_channel", "img_base", "img_model", "img_quality", "img_key", "vs_model", "vs_provider", "zp_key", "zp_model", "ds_vs_model", "qa_on", "qa_retry", "qa_fix"];

// CORS 代理地址：网页版所有对外请求都经它转发。为空说明还没配置，直接报清晰错误。
function workerBase() {
  const u = (localStorage.getItem(WORKER_URL_KEY) || "").trim().replace(/\/+$/, "");
  if (!u) throw new Error("还没配置「CORS 代理地址」。请到「接口配置」页最上方填写你部署的 Cloudflare Worker 网址（形如 https://xxx.workers.dev）并保存。");
  return u;
}

const IMG_BASE_HISTORY_KEY = "petvet_imgbase_history_v1";   // 用过的图片接口 Base URL 历史（保存配置时记录，输入框下拉可选）

function loadImgBaseHistory() {
  const dl = $("imgBaseList"); if (!dl) return;
  dl.innerHTML = "";
  readJSON(IMG_BASE_HISTORY_KEY, []).forEach((u) => {
    const o = document.createElement("option"); o.value = u; dl.appendChild(o);
  });
}
function rememberImgBase(url) {
  const u = (url || "").trim(); if (!u) return;
  const lst = readJSON(IMG_BASE_HISTORY_KEY, []);
  const i = lst.indexOf(u); if (i >= 0) lst.splice(i, 1);
  lst.unshift(u);
  writeJSON(IMG_BASE_HISTORY_KEY, lst.slice(0, 12));
  loadImgBaseHistory();
}

function loadConfig() {
  const cfgObj = readJSON(CONFIG_KEY, {});
  // DeepSeek 旧模型名 deepseek-chat / deepseek-reasoner 官方已于 2026-07-24 停用，自动换成现行的 deepseek-flash
  if (/^deepseek-(chat|reasoner)$/.test(cfgObj.ds_model || "")) { cfgObj.ds_model = "deepseek-flash"; writeJSON(CONFIG_KEY, cfgObj); }
  FIELDS.forEach((id) => { if (cfgObj[id] !== undefined && $(id)) $(id).value = cfgObj[id]; });
  if ($("worker_url")) $("worker_url").value = localStorage.getItem(WORKER_URL_KEY) || "";
  loadImgBaseHistory();
}
function saveConfig() {
  const cfgObj = {};
  FIELDS.forEach((id) => { if ($(id)) cfgObj[id] = $(id).value.trim(); });
  writeJSON(CONFIG_KEY, cfgObj);
  if ($("worker_url")) localStorage.setItem(WORKER_URL_KEY, $("worker_url").value.trim());
  rememberImgBase(cfgObj.img_base);
  flash($("btn_save"), "已保存 ✓");
}
function clearKeys() {
  if (!confirm("确定清空本地保存的 API Key 吗？（其他配置保留）")) return;
  const cfgObj = readJSON(CONFIG_KEY, {});
  cfgObj.ds_key = ""; cfgObj.img_key = ""; cfgObj.zp_key = "";
  writeJSON(CONFIG_KEY, cfgObj);
  $("ds_key").value = ""; $("img_key").value = ""; $("zp_key").value = "";
  flash($("btn_clear"), "已清空 Key ✓");
}
function cfg() {
  return {
    ds_base: $("ds_base").value.trim(), ds_model: $("ds_model").value.trim(), ds_key: $("ds_key").value.trim(),
    img_channel: ($("img_channel") ? $("img_channel").value : "apimart") || "apimart",
    img_base: $("img_base").value.trim(), img_model: $("img_model").value.trim(),
    img_quality: $("img_quality").value, img_key: $("img_key").value.trim(), vs_model: ($("vs_model") ? $("vs_model").value.trim() : "") || "gemini-2.5-flash",
    vs_provider: $("vs_provider").value || "auto", zp_key: $("zp_key").value.trim(),
    zp_model: $("zp_model").value.trim() || "glm-4.6v-flash", ds_vs_model: $("ds_vs_model").value.trim() || "deepseek-flash",
    // 出图后自动检查（js/qa.js）：默认开，没通过最多自动重出 1 次
    qa_on: ($("qa_on") ? $("qa_on").value : "1") !== "0",
    qa_retry: Math.max(0, Math.min(2, parseInt(($("qa_retry") ? $("qa_retry").value : "1"), 10) || 0)),
    qa_fix: ($("qa_fix") ? $("qa_fix").value : "1") !== "0",   // 只有字写错时先局部修改（js/fix.js）
  };
}
function flash(btn, text) {
  const old = btn.textContent; btn.textContent = text; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200);
}

async function proxy(target, baseUrl, apiKey, payload, extra) {
  const resp = await fetch(workerBase() + "/proxy", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ target, baseUrl, apiKey, payload }, extra)),
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { _raw: text }; }
  if (!resp.ok) {
    const m = data?.error?.message || data?.error || data?.message || text || ("HTTP " + resp.status);
    throw new Error(typeof m === "string" ? m : JSON.stringify(m));
  }
  return data;
}
function queryTask(baseUrl, apiKey, taskId) { return proxy("task", baseUrl, apiKey, null, { taskId }); }

// DeepSeek 文本补全
async function chat(messages, temperature) {
  const c = cfg();
  if (!c.ds_key) throw new Error("请先到「接口配置」填写并保存 DeepSeek API Key。");
  const data = await proxy("deepseek", c.ds_base, c.ds_key, {
    model: c.ds_model || "deepseek-flash", messages, temperature: temperature ?? 0.7,
  });
  return data?.choices?.[0]?.message?.content || "";
}

// 比例 "W:H" 换算成像素 size（自定义渠道用）：长边按分辨率档位取，四舍五入到 16 的倍数（不低于 256）
// 注意保持原始宽高顺序：1242:264 是横向横幅，输出必须是 宽x高=横 的格式，不能按大小排序（否则会把横图算成竖图）
function ratioToPixels(ratio, quality) {
  const m = String(ratio || "1:1").split(/[:×x]/).map((x) => parseFloat(x));
  const a = m[0] || 1, b = m[1] || 1;   // a=宽的份数, b=高的份数
  // 档位长边：1K=1024 / 2K=1536 / 4K=2048（国内文生图接口普遍支持的上限附近）
  const long = { "1k": 1024, "2k": 1536, "4k": 2048 }[quality] || 1440;
  const r16 = (v) => Math.max(256, Math.round(v / 16) * 16);
  let k = long / Math.max(a, b);
  // 总像素低于 512×512 时整体放大倍率（保持比例），百炼等接口要求总像素不低于该下限，扁长横幅 1K 档会触底
  while (a * k * (b * k) < 512 * 512) k *= 1.1;
  return r16(a * k) + "x" + r16(b * k);
}

// 生成图片（提交 → 轮询）。opts.size 为画面比例，如 "1:1" / "16:9"
async function generateImage(prompt, onProgress, opts) {
  opts = opts || {};
  const c = cfg();
  if (!c.img_key) throw new Error("请先到「接口配置」填写并保存图片 API Key。");
  // ── 自定义渠道：同步的 OpenAI images/generations 兼容接口（火山方舟 / 智谱 / 硅基流动 / 通义万相等）──
  if (c.img_channel === "custom") {
    if (opts.maskUrl) throw new Error("自定义渠道暂不支持局部重绘，请到「接口配置」把图片接口切回 APIMart。");
    const payload = {
      model: opts.model || c.img_model || "doubao-seedream-4-0-250828",
      prompt, size: ratioToPixels(opts.size || "1:1", c.img_quality), n: 1,
      response_format: "url",
    };
    if (opts.imageUrls && opts.imageUrls.length) payload.image = opts.imageUrls.length === 1 ? opts.imageUrls[0] : opts.imageUrls;
    const data = await proxy("image", c.img_base, c.img_key, payload);
    const d0 = data?.data?.[0] || {};
    const src = d0.url || (d0.b64_json ? "data:image/png;base64," + d0.b64_json : null);
    if (!src) throw new Error("接口没返回图片：" + JSON.stringify(data).slice(0, 200));
    return src;
  }
  // ── APIMart（默认）：任务式提交 → 轮询 ──
  const payload = {
    model: opts.model || c.img_model || "gpt-image-2", prompt, size: opts.size || "1:1", resolution: c.img_quality || "1k", n: 1,
  };
  if (opts.imageUrls && opts.imageUrls.length) payload.image_urls = opts.imageUrls;  // 参考图（上传的设备照等）
  if (opts.maskUrl) payload.mask_url = opts.maskUrl;   // 局部重画：透明的地方重画，只作用于第一张参考图
  const submit = await proxy("image", c.img_base, c.img_key, payload);
  const taskId = submit?.data?.[0]?.task_id;
  if (!taskId) throw new Error("提交后没拿到 task_id：" + JSON.stringify(submit).slice(0, 200));
  // 等结果的策略（间隔、超时、网络抖动重试）在 lib/poll.js，和 AI 自由生图共用
  try {
    return await waitForTask(
      () => queryTask(c.img_base, c.img_key, taskId),
      (res) => {
        const d = res?.data || {};
        if (d.status === "failed") return { fail: "任务失败：" + JSON.stringify(d).slice(0, 200) };
        if (d.status !== "completed") return null;
        const url = d?.result?.images?.[0]?.url; const src = Array.isArray(url) ? url[0] : url;
        return src ? { done: src } : { fail: "任务完成但没找到图片地址。" };
      },
      {
        onProgress: (res) => { const d = res?.data || {}; if (onProgress) onProgress(`生成中…（${d.status || "?"}${d.progress != null ? " " + d.progress + "%" : ""}）`); },
        onRetry: (n, max) => { if (onProgress) onProgress(`网络波动，重试中…（${n}/${max}）`); },
      });
  } catch (e) {
    if (e.kind === "fail") throw e;
    throw new Error(`${e.message}（任务号 ${taskId}），图可能已经生成，可以稍后到 APIMart 后台查看。`);
  }
}
