// 识图模型：按「接口配置 → 识图模型」的设置依次尝试 智谱 → DeepSeek → APIMart，哪家调通用哪家，并记住能用的型号。
// 第⑤步识别模板文字位、出图后的自动检查都走这里。

async function imageToJpeg(url, maxSide) {
  const im = await loadImg(url);
  const sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
const VISION_CANDIDATES = ["gemini-2.5-flash", "gpt-5-mini", "gemini-3-flash-preview", "gpt-5", "claude-sonnet-4-6"];
const ZP_BASE = "https://open.bigmodel.cn/api/paas/v4";
function rememberVisionModel(field, model) {
  const el = $(field); if (el) el.value = model;
  const o = readJSON(CONFIG_KEY, {}); o[field] = model; writeJSON(CONFIG_KEY, o);
}
// 列出这次要依次尝试的 {家, 地址, Key, 模型}
function visionAttempts(c) {
  const uniq = (a) => a.filter((x, k) => x && a.indexOf(x) === k);
  const zp = c.zp_key ? uniq([c.zp_model, "glm-4.6v-flash", "glm-4v-flash"]).map((model) => ({ who: "智谱", field: "zp_model", base: ZP_BASE, key: c.zp_key, model, raw64: true })) : [];
  const ds = c.ds_key ? uniq([c.ds_vs_model, "deepseek-flash"]).map((model) => ({ who: "DeepSeek", field: "ds_vs_model", base: c.ds_base || "https://api.deepseek.com/v1", key: c.ds_key, model })) : [];
  const bad = ["gpt-4o-mini", "gpt-4o"];   // APIMart 对话接口不提供，之前默认值填错过
  const am = c.img_key ? uniq([c.vs_model, ...VISION_CANDIDATES]).filter((x) => !bad.includes(x)).map((model) => ({ who: "APIMart", field: "vs_model", base: c.img_base, key: c.img_key, model })) : [];
  return { auto: [...zp, ...ds, ...am], zhipu: zp, deepseek: ds, apimart: am }[c.vs_provider] || [...zp, ...ds, ...am];
}
const NO_VISION_KEY_MSG = "还没有可用的识图 Key：请到「接口配置 → 识图模型」填智谱 Key（免费），或填好 DeepSeek / APIMart 的 Key";

// 问识图模型一个关于图片的问题。parse(回复文字) 返回 null 表示这家没答好，换下一家；都不行就抛错。
async function visionAsk(img, ask, parse) {
  const c = cfg();
  const tries = visionAttempts(c);
  if (!tries.length) throw new Error(NO_VISION_KEY_MSG);
  const errs = [];
  for (const a of tries) {
    try {
      const body = { model: a.model, stream: false,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: a.raw64 ? img.split(",")[1] : img } }, { type: "text", text: ask }] }] };
      if (a.who === "智谱") body.thinking = { type: "disabled" };   // 不需要深度思考，关掉更快
      const data = await proxy("deepseek", a.base, a.key, body);
      let raw = (data?.choices || data?.data?.choices || [])[0]?.message?.content || "";
      if (Array.isArray(raw)) raw = raw.map((x) => x.text || "").join("");
      const value = parse(String(raw));
      if (value != null) {
        if (a.model !== c[a.field]) rememberVisionModel(a.field, a.model);   // 第一个成功的记下来，下次优先用
        return { value, model: a.model, who: a.who };
      }
      errs.push(`${a.who} ${a.model}：回复格式不对（${String(raw).slice(0, 60)}）`);
    } catch (e) { errs.push(`${a.who} ${a.model}：${String(e.message).slice(0, 80)}`); }
  }
  throw new Error("识图模型都没调通：\n" + errs.join("\n"));
}
