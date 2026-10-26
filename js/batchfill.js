// ⑤ 批量套图：识别模板文字位、读 Excel、按模板一次生成一整套

// 兼容两种回复：{"animals":..,"texts":[..]} 或直接一个数组
function parseSlotReply(raw) {
  raw = String(raw);
  const o = raw.match(/\{[\s\S]*\}/);
  if (o) { try { const j = JSON.parse(o[0]); if (Array.isArray(j.texts)) return { animals: j.animals, texts: j.texts }; } catch (e) { /* 再试数组 */ } }
  const a = raw.match(/\[[\s\S]*\]/);
  if (a) { try { return { animals: null, texts: JSON.parse(a[0]) }; } catch (e) { /* 解析失败 */ } }
  return null;
}
async function detectTemplateSlots(imgId) {
  if (!visionAttempts(cfg()).length) throw new Error(NO_VISION_KEY_MSG);
  const img = await imageToJpeg(imageFileUrl(imgId), 1280);
  const ask = `这是一张宠物医院的团购宣传图。请按阅读顺序（从上到下、从左到右）列出图上每一处独立的文字，一个胶囊、一个色块、一行字、一个徽章各算一处。
另外判断画面里有没有动物（猫、狗、兔等，照片或插画都算；爪印、LOGO 里的小图案不算）。
只输出 JSON，不要任何解释，格式：{"animals":"无 或 写出是什么动物，如 一只金毛和一只猫","texts":[{"text":"图上的原文","kind":"它的位置和样式，如 顶部橙色大胶囊标题 / 标题下一行深色字 / 小蓝色标签 / 左下角圆形徽章","keep":false}]}
keep 的规则：医院名称、LOGO 里的字、"不满意退""售后无忧"这类每张团单都一样的通用承诺或徽章，填 true；具体服务名称、项目、卖点、适用对象填 false。`;
  const m = (await visionAsk(img, ask, parseSlotReply)).value;
  if (m.animals != null) setPets(imgId, /^(无|没有|none|no)?$/i.test(String(m.animals).trim()) ? "none" : "has");
  const arr = m.texts.map((x) => ({ t: String(x.text || "").trim(), kind: String(x.kind || "").trim(), keep: !!x.keep })).filter((x) => x.t);
  if (!arr.length) throw new Error("没有识别到文字");
  setSlots(imgId, arr);
  return arr;
}
// ---------- 上传 Excel / CSV 读团单文字：每行一个团单，格子从左到右用「｜」连起来 ----------
function colIndex(ref) { let n = 0; for (const ch of String(ref).replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
async function readXlsxRows(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = async (path) => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null; };
  const txt = (el) => Array.from(el.getElementsByTagName("t")).map((t) => t.textContent).join("");
  const ss = await xml("xl/sharedStrings.xml");
  const shared = ss ? Array.from(ss.getElementsByTagName("si")).map(txt) : [];
  // 第一个工作表：优先按 workbook 里的顺序找，找不到就取 sheet1
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await xml("xl/workbook.xml"), rels = await xml("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = wb.getElementsByTagName("sheet")[0];
    const rid = first && (first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    if (rel) { const tg = rel.getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, ""); sheetPath = "xl/" + tg; }
  }
  const sh = await xml(sheetPath);
  if (!sh) throw new Error("表格里没找到工作表");
  return Array.from(sh.getElementsByTagName("row")).map((r) => {
    const out = [];
    Array.from(r.getElementsByTagName("c")).forEach((cEl, k) => {
      const ty = cEl.getAttribute("t"), ref = cEl.getAttribute("r");
      const v = cEl.getElementsByTagName("v")[0];
      let val = "";
      if (ty === "s") val = shared[+(v ? v.textContent : -1)] || "";
      else if (ty === "inlineStr") val = txt(cEl);
      else val = v ? v.textContent : "";
      out[ref ? colIndex(ref) : k] = String(val).trim();
    });
    return Array.from(out, (x) => x || "");
  });
}
function readCsvRows(text) {
  text = text.replace(/^﻿/, "");
  const sep = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur.trim()); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}
function rowsToBatchText(rows) {
  rows = rows.map((r) => r.map((x) => String(x || "").replace(/\s*\n\s*/g, " ").trim())).filter((r) => r.some((x) => x));
  if (!rows.length) return "";
  // 表头：第一行里出现"序号/标题/名称/卖点/文字/项目/内容"之类的字就跳过
  if (rows[0].some((x) => /^(序号|编号|No\.?|标题|主标题|副标题|名称|项目|卖点|文字|内容|团单|标签|适用|备注|价格)/i.test(x))) rows = rows.slice(1);
  // 序号列：第一列全是数字就去掉
  if (rows.length && rows.every((r) => !r[0] || /^\d+\.?$/.test(r[0]))) rows = rows.map((r) => r.slice(1));
  return rows.map((r) => r.filter((x) => x).join("｜")).filter((x) => x).join("\n");
}
async function handleBatchExcel(file) {
  const msg = $("bf_xls_msg");
  try {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xls")) throw new Error("这是旧版 .xls 格式，请在 Excel/WPS 里「另存为 .xlsx」后再上传");
    const rows = name.endsWith(".csv") ? readCsvRows(await file.text()) : await readXlsxRows(await file.arrayBuffer());
    const text = rowsToBatchText(rows);
    if (!text) throw new Error("表格里没有读到文字");
    const box = $("bf_text");
    if (box.value.trim() && !confirm("文本框里已经有文字，是否用表格内容替换？\n（取消 = 追加到后面）")) box.value = box.value.replace(/\s+$/, "") + "\n" + text;
    else box.value = text;
    renderBatchPreview();
    msg.textContent = `已读取「${file.name}」：${text.split("\n").length} 个团单，请在右侧核对`;
  } catch (e) { msg.textContent = "读取失败：" + e.message; }
}

let _bf = { id: "", running: false };   // 第⑤步批量套图：选中的底版 id

// 解析文案：有空行 → 每个空行分隔的块是一个团单（一行一条）；
//           无空行 → 每行一个团单，文字之间用「｜」「|」或 Tab 分隔
function parseBatchTexts(raw) {
  const text = (raw || "").replace(/\r/g, "").trim();
  if (!text) return [];
  if (/\n\s*\n/.test(text)) {
    return text.split(/\n\s*\n+/).map((b) => b.split("\n").flatMap((x) => x.split(/\s*[｜|\t]\s*/)).map((x) => x.trim()).filter(Boolean)).filter((a) => a.length);
  }
  return text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s*[｜|\t]\s*/).map((x) => x.trim()).filter(Boolean));
}

// 可当模板的图：团单配图 / 抖音团单配图 / 诊疗案例图里，除批量套图产出之外的都可以
function bfCandidates(list) {
  return list.filter((m) => { const t = findType(m.typeKey); return t && t.batchFill && m.stage !== "fill"; })
    .sort((a, b) => b.createdAt - a.createdAt);
}

const BF_UPLOAD_CARD = `<label class="bf-tpl bf-up" title="上传一张你喜欢的团单图当模板">
      <input type="file" accept="image/*" id="bf_up_file" hidden />
      <span class="bf-up-plus">＋</span><span class="bf-up-txt">上传模板图</span>
      <span class="bf-up-sub">用你喜欢的任意团单图当模板</span>
    </label>`;

// 上传一张模板图：存成素材库里的一张图（和生成的图一样能识别文字位、当模板），按比例归到最接近的素材类型
const UP_TPL_NAME = "我上传的模板";
async function uploadBatchTemplate(file) {
  const h = getCurrentHospital(); if (!h) { alert("请先选择医院。"); return; }
  const dataUrl = await compressImage(file, 1600);
  const im = await loadImg(dataUrl);
  const ar = im.naturalWidth / im.naturalHeight;
  const types = MATERIAL_TYPES.flatMap((g) => g.items).filter((t) => t.batchFill);
  const type = types.reduce((a, t) => (Math.abs(Math.log(t.w / t.h / ar)) < Math.abs(Math.log(a.w / a.h / ar)) ? t : a));
  const withLogo = confirm(`这张模板图会按「${type.name}」（${type.ratio}）来套图。\n\n模板图上有医院 LOGO / 店名吗？\n· 确定 = 有：套图时把本院 LOGO 和名称设计进去\n· 取消 = 没有：套图时不加 LOGO`);
  const rec = { id: uid(), hospitalId: h.id, typeKey: type.key, typeName: type.name, w: type.w, h: type.h, ratio: type.ratio,
    copy: "", styleName: UP_TPL_NAME, stage: "", tplKey: "", withLogo, srcId: "", dataUrl, createdAt: Date.now() };
  await saveImageToServer(rec);
  _bf.id = rec.id;
  await renderBatchFillCard();
  if (typeof renderGallery === "function") renderGallery();
}

async function renderBatchFillCard() {
  const h = getCurrentHospital(); if (!h || !$("bf_tpls")) return;
  const list = await listImagesFromServer(h.id);
  const cands = bfCandidates(list);
  const box = $("bf_tpls");
  const bindUpload = () => {
    const f = $("bf_up_file"); if (!f) return;
    f.addEventListener("change", async () => {
      const file = f.files[0]; f.value = ""; if (!file) return;
      const card = f.closest(".bf-up"); card.classList.add("busy"); card.querySelector(".bf-up-txt").textContent = "上传中…";
      try { await uploadBatchTemplate(file); } catch (e) { alert("上传失败：" + e.message); renderBatchFillCard(); }
    });
  };
  if (!cands.length) {
    box.innerHTML = BF_UPLOAD_CARD + `<div class="hint" style="margin:0;align-self:center;">还没有可用的模板图。可以先到第④步生成团单配图（或诊疗案例图），满意的那张会出现在这里；也可以直接点左边上传一张你喜欢的团单图。</div>`;
    bindUpload(); _bf.id = ""; renderSlotPanel(false); return;
  }
  if (!cands.find((m) => m.id === _bf.id)) _bf.id = cands[0].id;
  _bf.typeOf = {}; cands.forEach((m) => { _bf.typeOf[m.id] = m.typeKey; });
  box.innerHTML = BF_UPLOAD_CARD + cands.map((m) => {
    const d0 = new Date(m.createdAt), when = `${d0.getMonth() + 1}/${d0.getDate()} ${String(d0.getHours()).padStart(2, "0")}:${String(d0.getMinutes()).padStart(2, "0")}`;
    return `<div class="bf-tpl ${m.id === _bf.id ? "on" : ""}" data-id="${m.id}">
      ${m.styleName === UP_TPL_NAME ? `<button class="bf-tpl-del" data-del="${m.id}" title="删除这张上传的模板">×</button>` : ""}
      <img src="${thumbUrl(m.id)}" alt="${esc(m.typeName)}" loading="lazy" decoding="async" />
      <div class="bf-tpl-meta"><b>${esc(typeLabel(m))}</b>${m.styleName ? " · " + esc(m.styleName) : ""}<br>${when}${m.withLogo ? " · 含 LOGO" : ""}${m.copy ? " · " + esc(m.copy.split("\n")[0].slice(0, 10)) : ""}</div>
    </div>`;
  }).join("");
  bindUpload();
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (_bf.running || !confirm("删除这张上传的模板图？（素材库里也会一起删掉）")) return;
    await deleteImageFromServer(b.dataset.del); setSlots(b.dataset.del, null); setPets(b.dataset.del, null);
    if (_bf.id === b.dataset.del) _bf.id = "";
    renderBatchFillCard(); if (typeof renderGallery === "function") renderGallery();
  }));
  box.querySelectorAll(".bf-tpl[data-id]").forEach((el) => el.addEventListener("click", () => {
    if (_bf.running) return;
    _bf.id = el.dataset.id; box.querySelectorAll(".bf-tpl[data-id]").forEach((x) => x.classList.toggle("on", x === el)); renderSlotPanel(true);
  }));
  renderSlotPanel(true);
}

// 第⑤步：显示 / 编辑当前模板图的文字位；没有就自动识别（每张模板只识别一次）
async function renderSlotPanel(autoDetect) {
  const box = $("bf_slots"); if (!box) return;
  if (!_bf.id) { box.innerHTML = "（请先选择模板图）"; renderBatchPreview(); return; }
  const id = _bf.id, slots = slotsOf(id);
  if (!slots && autoDetect && visionAttempts(cfg()).length && !_bf.detecting) {
    _bf.detecting = id;
    box.innerHTML = `<span class="loading">🔍 正在识别模板上的文字…（约 5~15 秒）</span>`;
    try { await detectTemplateSlots(id); }
    catch (e) { _bf.detectErr = { id, msg: e.message }; }
    finally { _bf.detecting = null; }
    if (_bf.id === id) renderSlotPanel(false);
    return;
  }
  if (!slots || !slots.length) {
    const err = _bf.detectErr && _bf.detectErr.id === id ? _bf.detectErr.msg : "";
    box.innerHTML = `<div class="hint" style="margin:0;">${err ? `自动识别失败：${esc(err)}<br>可以点「重新识别」，或到「接口配置 → 识图模型」换一家（智谱免费）；也可以手动添加文字位。` : (visionAttempts(cfg()).length ? "还没有识别。" : "需要先在「接口配置 → 识图模型」填智谱 Key（免费）或 DeepSeek / APIMart 的 Key 才能自动识别；也可以手动添加文字位。")}</div>
      <div class="bf-slot-bar"><button class="btn btn-test btn-mini" id="bf_redetect">🔍 ${err ? "重新识别" : "自动识别"}</button><button class="btn btn-test btn-mini" id="bf_addslot">＋ 手动添加文字位</button></div>`;
  } else {
    let n = 0;
    box.innerHTML = slots.map((sl, i) => `<div class="bf-slot ${sl.keep ? "is-keep" : ""}" data-i="${i}">
        <span class="bf-no">${sl.keep ? "·" : ++n}</span>
        <input class="bf-slot-t" value="${esc(sl.t)}" title="模板上的原文（用来定位这一处）" />
        <span class="bf-slot-k" title="${esc(sl.kind)}">${esc(sl.kind)}</span>
        <button class="bf-tg ${sl.keep ? "keep" : "rep"}" title="点击切换">${sl.keep ? "保留" : "替换"}</button>
        <button class="bf-x" title="删除这一处">×</button>
      </div>`).join("") + `<div class="bf-slot-bar"><button class="btn btn-test btn-mini" id="bf_addslot">＋ 添加文字位</button><button class="btn btn-test btn-mini" id="bf_redetect">🔍 重新识别</button>
      <span class="hint" style="margin:0;">共 ${slots.length} 处，其中 ${n} 处会被替换</span></div>
      <div class="bf-slot-bar bf-pets"><span>画面里的动物：</span><select id="bf_pets">
        <option value="">让 AI 看模板自己判断</option>
        <option value="none"${petsOf(id) === "none" ? " selected" : ""}>没有动物 → 套图也绝不画动物</option>
        <option value="has"${petsOf(id) === "has" ? " selected" : ""}>有动物 → 保留，按文字内容换猫/狗</option>
      </select></div>`;
    box.querySelectorAll(".bf-slot").forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector(".bf-slot-t").addEventListener("change", (e) => { const a = slotsOf(id).slice(); a[i] = Object.assign({}, a[i], { t: e.target.value.trim() }); setSlots(id, a.filter((x) => x.t)); renderSlotPanel(false); });
      row.querySelector(".bf-tg").addEventListener("click", () => { const a = slotsOf(id).slice(); a[i] = Object.assign({}, a[i], { keep: !a[i].keep }); setSlots(id, a); renderSlotPanel(false); });
      row.querySelector(".bf-x").addEventListener("click", () => { const a = slotsOf(id).slice(); a.splice(i, 1); setSlots(id, a.length ? a : null); renderSlotPanel(false); });
    });
  }
  const ps = $("bf_pets");
  if (ps) ps.addEventListener("change", () => setPets(id, ps.value || null));
  const add = $("bf_addslot");
  if (add) add.addEventListener("click", () => {
    const t = prompt("模板上这一处文字的原文（照图上写，用来定位）："); if (!t || !t.trim()) return;
    const a = (slotsOf(id) || []).slice(); a.push({ t: t.trim(), kind: "", keep: false }); setSlots(id, a); renderSlotPanel(false);
  });
  const rd = $("bf_redetect");
  if (rd) rd.addEventListener("click", async () => {
    rd.disabled = true; rd.textContent = "识别中…";
    try { await detectTemplateSlots(id); _bf.detectErr = null; } catch (e) { _bf.detectErr = { id, msg: e.message }; }
    renderSlotPanel(false);
  });
  renderBatchPreview();
}

function renderBatchPreview() {
  const items = parseBatchTexts($("bf_text").value);
  const box = $("bf_preview"), btn = $("bf_start");
  const slots = _bf.id ? slotsOf(_bf.id) : null;
  const mapView = (a) => {
    if (!slots || !slots.length) return `<span class="bf-t">${esc(a[0])}</span>${a.length > 1 ? `<span class="bf-s">${esc(a.slice(1).join(" ／ "))}</span>` : ""}`;
    const mp = mapToSlots(slots, a);
    // 比原来那处长很多的标出来：生图时容易挤、换行或把胶囊撑变形
    return mp.pairs.map((p) => {
      const long = textLen(p.to) > slotBudget(p.from);
      return `<span class="bf-map${long ? " long" : ""}"${long ? ` title="原来 ${textLen(p.from)} 个字，这里 ${textLen(p.to)} 个字，建议不超过 ${slotBudget(p.from)} 个，可能会挤"` : ""}><s>${esc(p.from)}</s> → <b>${esc(p.to)}</b>${long ? " ⚠偏长" : ""}</span>`;
    }).join("")
      + mp.removed.map((x) => `<span class="bf-map del">删除「${esc(x.t)}」</span>`).join("")
      + mp.added.map((x) => `<span class="bf-map add">新增「${esc(x)}」</span>`).join("");
  };
  box.innerHTML = items.length ? items.map((a, i) => `<div class="bf-item"><span class="bf-n">${i + 1}.</span>${mapView(a)}</div>`).join("") : "（还没有输入文字）";
  if (_bf.running) return;
  btn.disabled = !items.length || !_bf.id;
  btn.textContent = !_bf.id ? "请先选择模板图" : (items.length ? `开始批量生成（共 ${items.length} 张）` : "开始批量生成");
}

// ---------- 智能对位：让文案模型把每条团单的描述分到模板的文字位上，并按原来的字数精简 ----------
// 结果写回左边的文本框（按文字位顺序、用「｜」隔开），右边对照表照常显示，不满意可以直接改或撤销
const ASSIGN_SYS = `你是美团团购配图的文案编辑。模板图上有一组固定的文字位，要把每条团单的描述填进这些文字位。
规则：
1. 按文字位的角色放内容：大标题放项目名称，副标题或说明放具体内容，标签、胶囊放短卖点，以此类推；参考那一处原来的文字判断它该放什么。
2. 每处字数尽量接近原来的字数，不能超过给出的"最多"字数；放不下就精简说法，但不能改变意思。
3. 只能用团单描述里有的信息，不能编造价格、数量、功效和承诺；不要用"最""第一""根治""100%"这类广告违禁词。
4. 某个文字位在描述里找不到合适的内容，就填 null（那一处会连同底色一起删掉），不要硬凑、不要重复别处的内容。
5. 描述里重要但放不下的信息，可以放进 extra（最多 2 条，每条要短），会照同类样式补上；不重要的可以舍弃。
只输出 JSON，不要任何解释：{"items":[{"slots":["第1处的新文字", null],"extra":[]}]}
items 的顺序和条数必须和输入的团单一致，每个 slots 的长度必须等于文字位个数。`;

function parseAssignReply(raw, nItems, nSlots) {
  const o = String(raw).match(/\{[\s\S]*\}/);
  if (!o) throw new Error("文案模型没有按格式回复");
  const j = JSON.parse(o[0]);
  if (!Array.isArray(j.items) || j.items.length !== nItems) throw new Error(`文案模型回复的条数不对（要 ${nItems} 条，给了 ${Array.isArray(j.items) ? j.items.length : 0} 条）`);
  return j.items.map((it) => {
    const s = Array.isArray(it && it.slots) ? it.slots : [];
    const slots = Array.from({ length: nSlots }, (_, k) => { const v = s[k]; return v == null || !String(v).trim() ? null : String(v).trim(); });
    const extra = (Array.isArray(it && it.extra) ? it.extra : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 2);
    return { slots, extra };
  });
}

async function autoAssignTexts() {
  const msg = $("bf_assign_msg"), btn = $("bf_assign");
  const slots = _bf.id ? slotsOf(_bf.id) : null;
  const rep = (slots || []).filter((x) => !x.keep);
  if (!rep.length) { msg.textContent = "请先在「② 模板上的文字位」完成识别（至少要有一处「替换」的文字）。"; return; }
  const items = parseBatchTexts($("bf_text").value);
  if (!items.length) { msg.textContent = "请先在下面粘贴或上传团单文字（每行一个团单，怎么写都行，不用管顺序）。"; return; }
  if (!cfg().ds_key) { msg.textContent = "需要先在「接口配置」填写 DeepSeek Key（就是写文案用的那个）。"; return; }
  const slotList = rep.map((x, k) => `${k + 1}. 原文「${x.t}」｜${x.kind || "文字"}｜原 ${textLen(x.t)} 字，最多 ${slotBudget(x.t)} 字`).join("\n");
  const before = $("bf_text").value;
  btn.disabled = true; msg.textContent = "正在分配…";
  try {
    const out = [];
    for (let i = 0; i < items.length; i += 12) {   // 一次最多 12 条，太多了模型容易漏
      const part = items.slice(i, i + 12);
      msg.textContent = items.length > 12 ? `正在分配…（${Math.min(i + 12, items.length)}/${items.length}）` : "正在分配…";
      const user = `文字位（按顺序，共 ${rep.length} 处）：\n${slotList}\n\n团单描述（共 ${part.length} 条）：\n` + part.map((a, k) => `${k + 1}. ${a.join(" ")}`).join("\n");
      const reply = await chat([{ role: "system", content: ASSIGN_SYS }, { role: "user", content: user }], 0.2);
      out.push(...parseAssignReply(reply, part.length, rep.length));
    }
    _bf.undoText = before;
    $("bf_text").value = out.map((r) => r.slots.map((v) => v == null ? DEL_MARK : v).concat(r.extra).join("｜")).join("\n");
    renderBatchPreview();
    const long = out.reduce((n, r) => n + r.slots.filter((v, k) => v != null && textLen(v) > slotBudget(rep[k].t)).length, 0);
    msg.innerHTML = `已分配 ${out.length} 条，请在右边核对，不满意可以直接改左边的文字${long ? `（有 ${long} 处偏长，已标出）` : ""}。<a href="#" id="bf_assign_undo">↩ 恢复原文</a>`;
    $("bf_assign_undo").addEventListener("click", (e) => { e.preventDefault(); $("bf_text").value = _bf.undoText || ""; renderBatchPreview(); msg.textContent = "已恢复原文。"; });
  } catch (e) {
    msg.textContent = "分配失败：" + e.message;
  } finally { btn.disabled = false; }
}

async function runBatchFill() {
  if (_bf.running || !_bf.id) return;
  const items = parseBatchTexts($("bf_text").value);
  if (!items.length) return;
  if (!cfg().img_key) { alert("请先到「接口配置」填写图片 API Key。"); return; }
  const h = getCurrentHospital(); if (!h) return;
  const list = await listImagesFromServer(h.id);
  const m = list.find((x) => x.id === _bf.id); if (!m) { alert("模板图不存在，请重新选择。"); renderBatchFillCard(); return; }
  const type = findType(m.typeKey);
  if (!slotsOf(m.id) && usesTemplate(type) && !confirm("这张模板图还没有识别出文字位，套图会按模板文字的阅读顺序大致替换，准确度较低。\n建议先在「② 模板上的文字位」完成识别。仍要继续吗？")) return;
  if (!confirm(`将以选中的模板图，按顺序生成 ${items.length} 张「${type.name}」。\n共 ${items.length} 次接口调用，会产生费用。继续吗？` + qaCostNote())) return;

  _bf.running = true;
  const btn = $("bf_start"), log = $("bf_log");
  btn.disabled = true; log.style.display = "block"; log.className = "out"; log.innerHTML = "";
  let ok = 0, fail = 0, look = 0;
  try {
    const baseImage = await assetToDataUrl(imageFileUrl(m.id));   // 模板图（风格参考）
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const line = document.createElement("div");
      line.textContent = `(${i + 1}/${items.length}) ${a[0]}：开始…`;
      log.appendChild(line); log.scrollTop = log.scrollHeight;
      btn.textContent = `生成中 ${i + 1}/${items.length}…`;
      try {
        const rec = await generateOne(type, a.join("\n"), [], (t) => { line.textContent = `(${i + 1}/${items.length}) ${a[0]}：${t}`; },
          m.tplKey || undefined, { stage: "fill", baseImage, styleName: m.styleName || type.name, tplKey: m.tplKey || "", srcId: m.id, tplWithLogo: !!m.withLogo, slots: slotsOf(m.id), pets: petsOf(m.id) });
        line.textContent = `(${i + 1}/${items.length}) ${a[0]}：${qaLogText(rec.qa)}`; ok++;
        if (rec.qa && (rec.qa.status === "fail" || rec.qa.status === "warn")) { look++; line.className = rec.qa.status === "fail" ? "error" : ""; }
      } catch (e) {
        line.textContent = `(${i + 1}/${items.length}) ${a[0]}：❌ ${e.message}`; line.className = "error"; fail++;
      }
    }
  } catch (e) {
    alert("读取模板图失败：" + e.message);
  } finally {
    _bf.running = false;
    renderEditGallery();
    btn.disabled = false; btn.textContent = `完成：成功 ${ok} 张${look ? `（${look} 张需要看一眼）` : ""}${fail ? `，失败 ${fail} 张` : ""}（结果在下方素材列表）`;
  }
}
