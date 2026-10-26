// 局部修字：检查发现只是"字写错 / 模板旧字没换 / 院名写错"时，不整张重出，只把出错的那一小块重画。
//
// 步骤：识图模型找出错字的位置 → 把那一块裁出来再读一遍，确认位置找对了（找错了就不修，免得改坏别处、白花钱）
//      → 做一张蒙版（透明 = 要重画），交给 GPT Image 2.5 按蒙版重画 → 只把重画的那一小块贴回原图（边缘羽化）
//      → 再检查一遍，确实变好了才用，不然还用原图。
// APIMart 文档说蒙版外的像素"不保证完全不变"，所以最后一步由程序自己贴回，保证其余画面一个像素都不动。

const FIX_MODEL = "gpt-image-2.5-sunburst";      // 编辑更准的型号；flare 和 sunburst 都支持 mask_url
const FIXABLE = ["typo", "leftover", "name"];
const FIX_MAX_REGIONS = 3;

// 设置开着、用的是 APIMart（mask_url 是它的参数）才能局部修
function fixReady() { const c = cfg(); return c.qa_fix && !!c.img_key && /apimart\.ai/.test(c.img_base || ""); }
// 没通过的问题全都是"字的问题"，并且至少有一处能修，才走局部修字；有缺字、多了动物、出界这类问题还是整张重出
function qaFixable(qa) {
  if (!qa || !qa.issues) return false;
  // 最常见的一种：模板旧字没换，所以新字"缺了"——把旧字改成新字，两个问题一起解决，也算能局部修
  const coveredMissing = (x) => x.kind === "missing" && qa.issues.some((y) => y.kind === "leftover" && y.to === x.want);
  if (qa.issues.some((x) => x.lv === "err" && !FIXABLE.includes(x.kind) && !coveredMissing(x))) return false;
  return qa.issues.some((x) => FIXABLE.includes(x.kind));
}
// 每处要修的：find = 图上现在写的（用来定位），to = 改成什么（空 = 去掉）
function fixJobs(qa) {
  const jobs = [];
  qa.issues.forEach((x) => {
    if (x.kind === "typo" || x.kind === "name") { if (x.seen) jobs.push({ find: x.seen, to: x.want }); }
    else if (x.kind === "leftover") jobs.push({ find: x.old, to: x.to || "" });
  });
  return jobs.filter((j, k) => jobs.findIndex((y) => y.find === j.find) === k).slice(0, FIX_MAX_REGIONS);
}

// ---------- 找位置 ----------
async function locateText(img, text) {
  const ask = `在这张图上找到文字「${text}」（字可能有个别写错或写得不像，找最像的那一处）。给出刚好框住这处文字的矩形，坐标用图片宽和高的千分比表示（0 到 1000，左上角是 0,0，right 比 left 大、bottom 比 top 大）。
只输出 JSON，不要解释：{"found":true,"left":0,"top":0,"right":0,"bottom":0}；图上找不到就输出 {"found":false}`;
  const r = await visionAsk(img, ask, (raw) => {
    const o = String(raw).match(/\{[\s\S]*?\}/);
    if (!o) return null;
    try {
      const j = JSON.parse(o[0]);
      if (j.found === false) return { none: true };
      const b = ["left", "top", "right", "bottom"].map((k) => Number(j[k]));
      if (b.some((v) => !isFinite(v) || v < 0 || v > 1000) || b[2] - b[0] < 5 || b[3] - b[1] < 5) return null;   // 坐标不像样：换一家识图再试
      return { left: b[0] / 1000, top: b[1] / 1000, right: b[2] / 1000, bottom: b[3] / 1000 };
    } catch (e) { return null; }
  });
  return r.value.none ? null : r.value;
}
// 把框住的那块裁出来再读一遍：确认位置找对了
async function readRegion(im, box) {
  const W = im.naturalWidth, H = im.naturalHeight;
  const bw = (box.right - box.left) * W, bh = (box.bottom - box.top) * H;
  const x0 = Math.max(0, box.left * W - bw * 0.15), y0 = Math.max(0, box.top * H - bh * 0.15);
  const x1 = Math.min(W, box.right * W + bw * 0.15), y1 = Math.min(H, box.bottom * H + bh * 0.15);
  const sc = Math.min(1024 / (x1 - x0), Math.max(1, 96 / (y1 - y0)));   // 太小的字放大一点再读
  const c = document.createElement("canvas"); c.width = Math.round((x1 - x0) * sc); c.height = Math.round((y1 - y0) * sc);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(im, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  const r = await visionAsk(c.toDataURL("image/jpeg", 0.9), `这块图里写的是什么字？原样照抄，看不清的字用 □ 代替，不要自动纠正。只输出 JSON：{"text":"…"}`, (raw) => {
    const o = String(raw).match(/\{[\s\S]*\}/);
    try { const j = o && JSON.parse(o[0]); return j && typeof j.text === "string" ? j.text : null; } catch (e) { return null; }
  });
  return r.value;
}
function regionLooksRight(read, find) {
  const n = qaNorm(find), r = qaNorm(read);
  return !!r && qaBestMatch(n, r).dist <= qaTolerance(n.length);
}

// ---------- 蒙版、重画、贴回 ----------
// 每处往外多留一点边（去掉整处文字时留多一点，连底色小胶囊一起重画）
function regionPad(rg, W, H) { const bh = (rg.box.bottom - rg.box.top) * H; return Math.max(14, bh * (rg.to ? 0.35 : 0.6)); }
function regionRect(rg, W, H, pad) {
  const x0 = Math.max(0, rg.box.left * W - pad), y0 = Math.max(0, rg.box.top * H - pad);
  return [x0, y0, Math.min(W, rg.box.right * W + pad) - x0, Math.min(H, rg.box.bottom * H + pad) - y0];
}
// 蒙版：和原图一样大，不透明 = 保留，完全透明 = 重画
function makeFixMask(W, H, regions) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  regions.forEach((rg) => x.clearRect(...regionRect(rg, W, H, regionPad(rg, W, H))));
  return c.toDataURL("image/png");
}
function fixPrompt(regions) {
  return `这是一张已经设计好的宣传图。只修改蒙版里透明的区域，其余一切保持原样。
要改的地方（按图上现在写的字定位）：
${regions.map((rg, k) => `${k + 1}. 现在写着「${rg.find}」的那一处 → ${rg.to ? `改成「${rg.to}」` : "把这些字连同它的底色小胶囊一起去掉，用周围的背景自然补齐"}`).join("\n")}
要求：新文字一字不差（规范简体中文，笔画完整，不得错字、漏字或乱码）；字体、字重、颜色、描边、字号、对齐方式和原来这一处保持一致；不要改动底色、胶囊、图标的形状和颜色（要去掉的除外）；不要添加任何其它文字或元素。`;
}
// 只把重画结果里的那几小块贴回原图，边缘羽化，其余像素完全是原图
async function pasteRegions(src, fixedUrl, regions) {
  const [a, b] = await Promise.all([loadImg(src), loadImg(fixedUrl)]);
  const W = a.naturalWidth, H = a.naturalHeight;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const o = out.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, W, H); o.drawImage(a, 0, 0);
  const patch = document.createElement("canvas"); patch.width = W; patch.height = H;
  const p = patch.getContext("2d"); p.drawImage(b, 0, 0, W, H);   // 重画结果尺寸可能不同，缩放到原图大小
  const m = document.createElement("canvas"); m.width = W; m.height = H;
  const mx = m.getContext("2d"); mx.fillStyle = "#fff";
  regions.forEach((rg) => {
    // 羽化让接缝不生硬；羽化的"尾巴"必须落在重画区域（蒙版透明处）以内，文字本身又要 100% 盖住
    const pad = regionPad(rg, W, H), blur = Math.max(1.5, pad * 0.12);
    mx.filter = `blur(${blur}px)`;
    mx.fillRect(...regionRect(rg, W, H, pad - 3 * blur));
  });
  p.globalCompositeOperation = "destination-in"; p.drawImage(m, 0, 0);
  o.drawImage(patch, 0, 0);
  return out.toDataURL("image/png");
}

// 局部修一张图。成功且确实变好了返回 { dataUrl, qa }，否则返回 null（照旧用原图或整张重出）。不会抛错
async function localFix(src, qa, spec, ratio, onProgress) {
  const say = (m) => { if (onProgress) onProgress(m); };
  try {
    const jobs = fixJobs(qa);
    if (!jobs.length) return null;
    const im = await loadImg(src);
    const W = im.naturalWidth, H = im.naturalHeight;
    const small = await qaImage(src, { square: 0 });
    const regions = [];
    for (const j of jobs) {
      say(`正在找「${qaShort(j.find)}」在图上的位置…`);
      const box = await locateText(small, j.find);
      if (!box) continue;
      if (!regionLooksRight(await readRegion(im, box), j.find)) continue;   // 位置没找对：这一处不修
      regions.push(Object.assign({}, j, { box }));
    }
    if (!regions.length) { say("没找准错字的位置，改为整张处理"); return null; }
    say(`正在局部修改 ${regions.length} 处…`);
    // 发给接口的图必须和蒙版一样大：统一转成原尺寸的 PNG
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, W, H); cx.drawImage(im, 0, 0);
    const srcPng = c.toDataURL("image/png");
    const url = await generateImage(fixPrompt(regions), onProgress, { size: ratio, imageUrls: [srcPng], maskUrl: makeFixMask(W, H, regions), model: FIX_MODEL });
    const merged = await pasteRegions(srcPng, await downloadToDataUrl(url), regions);
    say("正在检查修改后的图…");
    const qa2 = await qaCheck(merged, spec);
    if (qa2.status === "error" || qaScore(qa2) >= qaScore(qa)) { say("局部修改没有变好，保留原来那版"); return null; }
    qa2.fixed = regions.length;
    return { dataUrl: merged, qa: qa2 };
  } catch (e) {
    console.warn("[局部修字] 失败：", e);
    say("局部修改没成功：" + String(e.message).slice(0, 40));
    return null;
  }
}
