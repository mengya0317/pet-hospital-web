// ④ AI 图片生成：风格/模板选择、文案变体、单张与批量出图、生成结果列表

// ---- 批量生成配置（按医院存于 genConfig）----
function curGenConfig() {
  const h = getCurrentHospital(); const c = (h ? getData(h.id).genConfig : null) || {};
  return {
    logoOn: c.logoOn !== false, logoPos: c.logoPos || "top-left", logoSize: c.logoSize || 0.20,
    designStyle: c.designStyle || "", styleRefs: c.styleRefs || [], extra: c.extra || "", texts: c.texts || {}, enabled: c.enabled || {},
    groupTpl: (c.groupTpl && c.groupTpl.length) ? c.groupTpl : GROUP_TPL_DEFAULT.slice(),
    styleSel: migrateStyleSel(c), customStyle: (c.customStyle !== undefined) ? c.customStyle : (isCustomStyle(c) ? c.designStyle : ""),
  };
}
// 判断旧的单选 designStyle 是不是自定义文本（不是预设键、也非空）
function isCustomStyle(c) {
  const v = (c.designStyle || "").trim();
  return !!v && !DESIGN_STYLE_PROMPTS[v];
}
// 把旧的单选 designStyle 迁移成多选 styleSel 数组
function migrateStyleSel(c) {
  if (c.styleSel && c.styleSel.length) return c.styleSel;
  const v = (c.designStyle || "").trim();
  if (!v) return ["__default__"];
  if (DESIGN_STYLE_PROMPTS[v]) return [v];
  return ["__custom__"];
}
function patchGenConfig(patch) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); d.genConfig = Object.assign({}, d.genConfig || {}, patch); saveDataSafe(h.id, d);
}
// 渲染「整体设计风格」多选 chip；勾选多种时一批内按序号轮换
function renderStyleChips() {
  const box = $("design_style_chips"); if (!box) return;
  const c = curGenConfig();
  const sel = new Set(c.styleSel && c.styleSel.length ? c.styleSel : ["__default__"]);
  box.className = "tpl-grid";
  box.innerHTML = STYLE_OPTIONS.map((o) => {
    const th = styleThumb(o.id);
    return `<div class="tpl-card ${sel.has(o.id) ? "on" : ""}">
      <label class="tpl-thumb" title="${th ? "点击更换样图" : "上传一张样图，方便直观识别这个风格"}">
        ${th ? `<img src="${th}" alt="${esc(o.label)}" data-sthumb="${o.id}" />` : `<span class="tpl-up">＋<br>样图</span>`}
        <input type="file" accept="image/*" hidden data-sup="${o.id}" />
      </label>
      <label class="tpl-name"><input type="checkbox" data-sid="${o.id}" ${sel.has(o.id) ? "checked" : ""} /> ${esc(o.label)}</label>
      <div class="tpl-state">
        ${getStyleRefs2()[o.id] ? `<a href="#" data-sdel="${o.id}">移除</a> ` : (th ? `<span class="ok">自动取自素材库</span> ` : `<span class="warn">暂无样图</span> `)}
        ${o.id === "__custom__" ? "" : `<a href="#" data-sgen="${o.id}">${th ? "重新生成" : "生成样图"}</a>`}
      </div>
    </div>`;
  }).join("");

  // 旧版本生成的是 1:1 方图，放在 16:9 框里两边会空：标出来提示重新生成
  box.querySelectorAll("img[data-sthumb]").forEach((im) => {
    const mark = () => {
      if (!getStyleRefs2()[im.dataset.sthumb] || im.naturalWidth / im.naturalHeight > 1.6) return;
      const st = im.closest(".tpl-card").querySelector(".tpl-state");
      if (st && !st.querySelector(".warn-old")) st.insertAdjacentHTML("afterbegin", `<span class="warn warn-old">旧方图</span> `);
    };
    if (im.complete && im.naturalWidth) mark(); else im.addEventListener("load", mark);
  });
  box.querySelectorAll("input[data-sid]").forEach((inp) => inp.addEventListener("change", () => {
    const ids = Array.from(box.querySelectorAll("input[data-sid]")).filter((x) => x.checked).map((x) => x.dataset.sid);
    if (!ids.length) { inp.checked = true; return; }
    patchGenConfig({ styleSel: ids }); updateStyleAux(); renderStyleChips();
  }));
  box.querySelectorAll("input[data-sup]").forEach((inp) => inp.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { setStyleRef2(e.target.dataset.sup, await uploadAsset(await compressImage(f, 1000))); renderStyleChips(); }
    catch (err) { alert("上传失败：" + err.message); }
  }));
  box.querySelectorAll("a[data-sdel]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); setStyleRef2(a.dataset.sdel, ""); renderStyleChips();
  }));
  box.querySelectorAll("a[data-sgen]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); genStyleSample(a.dataset.sgen, a);
  }));
  updateStyleAux();
}
// ---- 风格样图：让"清新治愈/温暖真实照片"这种抽象词有图可看 ----
const STYLEREF_KEY = "petvet_stylerefs_v1";
function getStyleRefs2() { return readJSON(STYLEREF_KEY, {}); }
function setStyleRef2(k, url) { const m = getStyleRefs2(); if (url) m[k] = url; else delete m[k]; writeJSON(STYLEREF_KEY, m); scheduleSync(); }
let _galleryCache = [];   // 用于自动取样图（该风格最近一张成品）
function autoStyleThumb(id) {
  // 生成时存的是 styleShortName(风格值)，__default__ 存成"简洁专业"，与选项 label 不同
  const stored = styleShortName(id === "__default__" ? "" : id);
  const hit = _galleryCache.filter((m) => m.styleName === stored);
  return hit.length ? thumbUrl(hit[0].id) : "";
}
function styleThumb(id) { return getStyleRefs2()[id] || autoStyleThumb(id); }

// 样图直接按缩略框的 16:9 生成，并要求构图完整——以前用 1:1 图塞进 16:9 框，上下都被裁掉
async function makeStyleSample(styleVal, onProgress) {
  const type = findType("carousel");                     // 16:9 轮播图当样图
  const prompt = buildPrompt(type, "宠物健康 专业守护", "", { use: false }, false, false, styleVal)
    + "\n【样图·构图完整】这是展示风格用的样图：标题文字和宠物等主体要【完整地】落在画面内，四周留出适当边距，不要被画面边缘切掉头、耳朵或文字。";
  const url = await generateImage(prompt, onProgress || (() => {}), { size: "16:9" });
  let dataUrl = await downloadToDataUrl(url);
  dataUrl = await fitToSize(dataUrl, 640, 360, "cover");   // 缩到 640×360 存，够清晰又省空间
  return uploadAsset(dataUrl);
}
// 为某个风格生成一张小样图（只当缩略图用，不写进素材库，避免污染成品）
async function genStyleSample(id, btn) {
  const c = cfg();
  if (!c.img_key) { alert("请先到「接口配置」填写图片 API Key。"); return; }
  const label = (STYLE_OPTIONS.find((o) => o.id === id) || {}).label || "该风格";
  if (!confirm(`用「${label}」生成一张样图？\n（1 次接口调用，会产生少量费用；样图只用于这里的缩略展示，不会进素材库）`)) return;
  const old = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
  try {
    const styleVal = id === "__default__" ? "" : (id === "__custom__" ? (curGenConfig().customStyle || "") : id);
    setStyleRef2(id, await makeStyleSample(styleVal, (m) => { if (btn) btn.textContent = m.length > 6 ? "…" : m; }));
    renderStyleChips();
  } catch (e) {
    alert("样图生成失败：\n" + e.message);
    if (btn) { btn.disabled = false; btn.textContent = old || "生成样图"; }
  }
}

// 一键把所有缺样图的风格补齐（逐个生成，可中途关页面停止）
async function genAllStyleSamples(btn) {
  const missing = STYLE_OPTIONS.filter((o) => o.id !== "__custom__" && !styleThumb(o.id));
  if (!missing.length) { alert("所有风格都已有样图了。"); return; }
  if (!confirm(`还有 ${missing.length} 个风格没有样图，将逐个生成。\n共 ${missing.length} 次接口调用，会产生费用。继续吗？`)) return;
  const old = btn ? btn.textContent : "";
  if (btn) btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < missing.length; i++) {
    const o = missing[i];
    if (btn) btn.textContent = `生成中 ${i + 1}/${missing.length}：${o.label}`;
    try {
      const styleVal = o.id === "__default__" ? "" : o.id;
      setStyleRef2(o.id, await makeStyleSample(styleVal));
      renderStyleChips();
      ok++;
    } catch (e) { /* 单个失败不中断整批 */ }
  }
  if (btn) { btn.disabled = false; btn.textContent = old || "一键补齐缺失样图"; }
  alert(`完成：成功 ${ok} 张，失败 ${missing.length - ok} 张。`);
}

// 团单配图·版式模板多选（只作用于团单配图，颜色仍跟随品牌配色）
function renderTplChips() {
  const box = $("group_tpl_chips"); if (!box) return;
  const sel = new Set(tplPool());
  const tbl = allTplEntries();
  box.className = "tpl-grid";
  box.innerHTML = Object.keys(tbl).map((k) => {
    const t = tbl[k], ref = tplRefOf(k);
    return `<div class="tpl-card ${sel.has(k) ? "on" : ""}" data-k="${k}">
      <label class="tpl-thumb" title="${ref ? "点击更换参考图" : "上传该模板的参考图（强烈建议）"}">
        ${ref ? `<img src="${ref}" alt="${esc(t.name)}" />` : `<span class="tpl-up">＋<br>参考图</span>`}
        <input type="file" accept="image/*" hidden data-up="${k}" />
      </label>
      <label class="tpl-name"><input type="checkbox" data-tpl="${k}" ${sel.has(k) ? "checked" : ""} /> ${esc(t.name)}</label>
      <div class="tpl-state">${ref ? `<span class="ok">✅ 图生图复刻</span>` : `<span class="warn">⚠️ 仅文字描述</span>`}
        ${t.mine ? ` <a href="#" data-delmine="${k}">删除模板</a>` : (ref ? ` <a href="#" data-del="${k}">移除图</a>` : "")}</div>
    </div>`;
  }).join("") + `<div class="tpl-card tpl-new">
      <label class="tpl-thumb" title="上传一张参考图，新建一个模板">
        <span class="tpl-up">＋<br>新建模板</span>
        <input type="file" accept="image/*" hidden id="tpl_new_input" />
      </label>
      <div class="tpl-state" style="text-align:center;">上传参考图即可新增</div>
    </div>`;

  box.querySelectorAll("input[data-tpl]").forEach((inp) => inp.addEventListener("change", () => {
    const ids = Array.from(box.querySelectorAll("input[data-tpl]")).filter((x) => x.checked).map((x) => x.dataset.tpl);
    if (!ids.length) { inp.checked = true; return; }
    patchGenConfig({ groupTpl: ids }); renderTplChips();
  }));
  box.querySelectorAll("input[data-up]").forEach((inp) => inp.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const url = await uploadAsset(await compressImage(f, 1400));
      setTplRef(e.target.dataset.up, url); renderTplChips();
    } catch (err) { alert("上传失败：" + err.message); }
  }));
  box.querySelectorAll("a[data-del]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); setTplRef(a.dataset.del, ""); renderTplChips();
  }));
  box.querySelectorAll("a[data-delmine]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (confirm("删除这个自建模板？（参考图也会一并移除）")) { delMyTpl(a.dataset.delmine); renderTplChips(); }
  }));
  const ni = $("tpl_new_input");
  if (ni) ni.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const name = prompt("给这个模板起个名字（10字以内）：", "我的模板");
    if (name === null) { e.target.value = ""; return; }
    try {
      const key = await addMyTpl(f, name);
      const sel2 = tplPool().slice(); sel2.push(key);
      patchGenConfig({ groupTpl: sel2 });
      renderTplChips();
    } catch (err) { alert("新建失败：" + err.message); }
  });

  const tip = $("tpl_tip");
  if (tip) {
    const n = tplPool().length;
    const withRef = tplPool().filter((k) => tplRefOf(k)).length;
    tip.innerHTML = `已选 <b>${n}</b> 个模板，其中 <b>${withRef}</b> 个已上传参考图。团单配图会按每个模板各生成一张。<br>
      <b>上传参考图后走【图生图复刻】</b>，能做到和参考图几乎一样；未上传只能靠文字描述还原，必然有出入。颜色仍会换成你的品牌配色。<br>
      有新的好设计时，点最后那个「＋ 新建模板」上传即可，随时扩充。`;
  }
}

// 自定义文本框 / 风格参考图 / 轮换提示 的显隐与文案
function updateStyleAux() {
  const c = curGenConfig();
  const ids = c.styleSel && c.styleSel.length ? c.styleSel : ["__default__"];
  const custom = ids.includes("__custom__");
  const cust = $("batch_design_custom"); if (cust) { cust.style.display = custom ? "block" : "none"; cust.value = c.customStyle || ""; }
  const refBox = $("design_ref_box"); if (refBox) refBox.style.display = custom ? "block" : "none";
  if (custom) renderStyleRefs();
  const tip = $("style_rotate_tip");
  if (tip) {
    const n = stylePool().length;
    tip.textContent = n > 1
      ? `已选 ${n} 种风格：每个文案条目会按这 ${n} 种风格【各生成一张】，方便直接对比（即 1 条文案 → ${n} 张图，接口调用与费用同步翻 ${n} 倍）。`
      : `当前为单一风格：所有素材统一用这一种，1 条文案出 1 张图。多选几种即可一次性拿到多种风格做对比。`;
    const miss = STYLE_OPTIONS.filter((o) => o.id !== "__custom__" && !styleThumb(o.id)).length;
    if (miss) {
      const b = document.createElement("button");
      b.className = "btn btn-test btn-mini"; b.style.marginTop = "8px";
      b.textContent = `一键补齐缺失样图（${miss} 张）`;
      b.addEventListener("click", () => genAllStyleSamples(b));
      tip.appendChild(document.createElement("br")); tip.appendChild(b);
    }
  }
}

// 风格参考图（自定义风格时上传，全局生效）
async function addStyleRef(file) {
  const url = await compressImage(file, 900);
  const stored = await uploadAsset(url);
  const refs = (curGenConfig().styleRefs || []).slice(); refs.push(stored);
  patchGenConfig({ styleRefs: refs });
}
function removeStyleRef(i) {
  const refs = (curGenConfig().styleRefs || []).slice(); refs.splice(i, 1);
  patchGenConfig({ styleRefs: refs });
}
function renderStyleRefs() {
  const box = $("design_refs"); if (!box) return;
  const refs = curGenConfig().styleRefs || [];
  box.innerHTML = refs.map((r, i) => `<span class="bv-ref"><img src="${r}" /><button class="bv-ref-del" data-i="${i}" title="移除">×</button></span>`).join("") +
    `<label class="bv-ref-add" title="上传风格参考图">＋参考图<input type="file" accept="image/*" hidden id="design_ref_input" /></label>`;
  const inp = $("design_ref_input");
  if (inp) inp.addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await addStyleRef(f); renderStyleRefs(); } catch (err) { alert("上传失败：" + err.message); } });
  box.querySelectorAll(".bv-ref-del").forEach((b) => b.addEventListener("click", () => { removeStyleRef(parseInt(b.dataset.i)); renderStyleRefs(); }));
}
function setGenSub(field, key, val) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); const c = d.genConfig || {}; c[field] = c[field] || {}; c[field][key] = val;
  d.genConfig = c; saveDataSafe(h.id, d);
}
// 某素材是否加 LOGO（未单独设置则跟随全局默认）
function getLogoUse(typeKey) {
  const h = getCurrentHospital(); const c = (h ? getData(h.id).genConfig : null) || {};
  const map = c.logoByType || {};
  if (map[typeKey] !== undefined) return !!map[typeKey];
  const t = findType(typeKey);
  if (t && t.logoOffByDefault) return false;   // 详情页等默认不自动叠 LOGO（放阶段4手动摆）
  return c.logoOn !== false;
}

function renderGenerate() {
  const h = getCurrentHospital();
  if (!h) { $("generate_need_hospital").style.display = "block"; $("generate_main").style.display = "none"; return; }
  $("generate_need_hospital").style.display = "none";
  $("generate_main").style.display = "flex";   // flex 才能左右分栏（block 会让预览掉到底部）

  const d = getData(h.id); const c = curGenConfig();
  // 配色信息
  const styleName = (PALETTE_STYLES.find((s) => s.key === d.paletteStyle) || {}).name || "（未设置）";
  const pal = d.palette || {};
  const chips = PALETTE_ORDER.map((k) => pal[k] ? `<span class="mini-chip" style="background:${pal[k]}" title="${PALETTE_LABELS[k]} ${pal[k]}"></span>` : "").join("");
  $("batch_palette_info").innerHTML = `风格：<b>${styleName}</b>　配色：<span style="display:inline-flex;gap:4px;vertical-align:middle;">${chips}</span><br>这一批所有素材都会用这套配色，保证整体风格一致。`;
  // LOGO 控件
  if (d.logo) { $("batch_use_logo").disabled = false; $("batch_logo_pos").disabled = false; $("batch_logo_size").disabled = false; $("batch_use_logo").checked = c.logoOn; $("batch_use_logo").parentElement.querySelector("span").textContent = "默认叠加 LOGO（下方可逐项调整）"; }
  else { $("batch_use_logo").checked = false; $("batch_use_logo").disabled = true; $("batch_logo_pos").disabled = true; $("batch_logo_size").disabled = true; $("batch_use_logo").parentElement.querySelector("span").textContent = "叠加 LOGO（请先到「素材库」上传）"; }
  $("batch_logo_pos").value = c.logoPos; $("batch_logo_size").value = String(c.logoSize); $("batch_extra").value = c.extra;
  // 先拉一次素材库，供风格卡片自动取样图（该风格最近生成的一张）
  listImagesFromServer(h.id).then((list) => {
    _galleryCache = (list || []).sort((a, b) => b.createdAt - a.createdAt);
    renderStyleChips();
  }).catch(() => {});
  renderStyleChips();
  renderTplChips();
  syncGroupLogoOpts();

  renderBatchList();
  renderGallery();
}

// ---- 每种素材的「多条目」（一条目 = 一张图的文案）----
function getVariants(typeKey) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {};
  c.variants = c.variants || {};
  if (!c.variants[typeKey] || !c.variants[typeKey].length) {
    const t = (c.texts && c.texts[typeKey]) || "";   // 兼容旧的单条 texts
    c.variants[typeKey] = [{ id: uid(), text: t, reqSplit: true }];
    d.genConfig = c; saveDataSafe(h.id, d);
  }
  return c.variants[typeKey];
}
function addVariant(typeKey) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  (c.variants[typeKey] = c.variants[typeKey] || []).push({ id: uid(), text: "", reqSplit: true });
  d.genConfig = c; saveDataSafe(h.id, d);
}
function removeVariant(typeKey, vid) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  let arr = (c.variants[typeKey] || []).filter((v) => v.id !== vid);
  if (!arr.length) arr = [{ id: uid(), text: "", reqSplit: true }];
  c.variants[typeKey] = arr; d.genConfig = c; saveDataSafe(h.id, d);
}
function setVariantReq(typeKey, vid, text) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  const v = (c.variants[typeKey] || []).find((x) => x.id === vid);
  if (v) { v.req = text; d.genConfig = c; saveDataSafe(h.id, d); }
}
// 一次性整理：以前写在「画面文字」里的要求挪到「对这张图的要求」里（所有医院），返回挪了几条
function migrateVariantReqs() {
  let moved = 0;
  getHospitals().forEach((h) => {
    const d = getData(h.id); const vs = (d.genConfig || {}).variants; if (!vs) return;
    let changed = false;
    Object.values(vs).forEach((arr) => (arr || []).forEach((v) => {
      if (v.reqSplit) return;
      const sp = splitCopyReq(v.text || "");
      if (sp.req.length) { v.text = sp.copy; v.req = [v.req, ...sp.req].filter(Boolean).join("\n"); moved += sp.req.length; }
      v.reqSplit = true; changed = true;
    }));
    if (changed) saveDataSafe(h.id, d);
  });
  return moved;
}
function setVariantText(typeKey, vid, text) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  const v = (c.variants[typeKey] || []).find((x) => x.id === vid);
  if (v) { v.text = text; d.genConfig = c; saveDataSafe(h.id, d); }
}
async function addVariantRef(typeKey, vid, file) {
  const h = getCurrentHospital(); if (!h) return;
  const url = await compressImage(file, 900);
  const stored = await uploadAsset(url);
  const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  const v = (c.variants[typeKey] || []).find((x) => x.id === vid); if (!v) return;
  v.refs = v.refs || []; v.refs.push(stored);
  d.genConfig = c; saveDataSafe(h.id, d);
}
function removeVariantRef(typeKey, vid, idx) {
  const h = getCurrentHospital(); const d = getData(h.id); const c = d.genConfig || {}; c.variants = c.variants || {};
  const v = (c.variants[typeKey] || []).find((x) => x.id === vid); if (!v || !v.refs) return;
  v.refs.splice(idx, 1);
  d.genConfig = c; saveDataSafe(h.id, d);
}

function renderBatchList() {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); const c = curGenConfig();
  const pool = d.copyPool || [];
  const poolOpts = '<option value="">＋从文案池添加…</option>' +
    pool.map((p, i) => `<option value="${i}">${p.tag ? "[" + esc(p.tag) + "] " : ""}${esc(p.text.slice(0, 18))}${p.text.length > 18 ? "…" : ""}</option>`).join("");
  let html = "";
  MATERIAL_TYPES.forEach((g) => {
    html += `<div class="batch-group-title">${g.cat}</div>`;
    g.items.forEach((it) => {
      const enabled = c.enabled[it.key] !== false;
      const variants = getVariants(it.key);
      html += `<div class="batch-type">
        <div class="batch-type-head">
          <input type="checkbox" class="batch-enable" data-key="${it.key}" ${enabled ? "checked" : ""} />
          <div class="batch-name"><div class="t-name">${it.name}</div><div class="t-size">${it.w}×${it.h} · 共 ${variants.length} 张</div></div>
          ${(it.logoCanvas || it.nameLogoCanvas) ? "" : `<label class="inline-check batch-logo-check"><input type="checkbox" class="batch-logo" data-key="${it.key}" ${getLogoUse(it.key) ? "checked" : ""} ${d.logo ? "" : "disabled"} /> <span>加LOGO</span></label>`}
          <button class="btn btn-test btn-mini batch-add" data-key="${it.key}">＋ 再加一张</button>
        </div>
        <div class="batch-variants">
          ${variants.map((v, vi) => `
            <div class="batch-variant" data-key="${it.key}" data-vid="${v.id}">
              <div class="bv-no">${vi + 1}</div>
              <div class="batch-text">
                ${it.logoCanvas
                  ? `<div class="hint" style="margin:0;">白底居中放置你上传的 LOGO，无需文字、不调用 AI（不花钱）。</div>`
                  : it.nameLogoCanvas
                    ? `<div class="hint" style="margin:0;">自动用 LOGO + 医院名称合成横幅，无需文字、不调用 AI（不花钱）。</div>`
                  : it.forceNoText
                    ? `<div class="hint" style="margin:0;">纯视觉背景，中间预留文字区，文字下一阶段自己填。</div>
                       <textarea class="batch-req-input" rows="2" placeholder="对这张图的要求（不会写到图上），如：颜色浅一点">${esc(v.req || "")}</textarea>`
                    : `<select class="batch-copy-add">${poolOpts}</select>
                       <textarea class="batch-text-input" rows="2" placeholder="画面文字：要写到图上的字（留空=纯视觉）">${esc(v.text || "")}</textarea>
                       <div class="req-detect hint"></div>
                       <textarea class="batch-req-input" rows="2" placeholder="对这张图的要求（不会写到图上），如：保持原图人像不变、设备图大一点、不要加环境图">${esc(v.req || "")}</textarea>`}
                ${(it.logoCanvas || it.nameLogoCanvas) ? "" : `<div class="bv-refs">
                  ${(v.refs || []).map((r, ri) => `<span class="bv-ref"><img src="${r}" /><button class="bv-ref-del" data-ri="${ri}" title="移除">×</button></span>`).join("")}
                  <label class="bv-ref-add" title="上传设备/环境等图片，融入这张设计">＋图片<input type="file" accept="image/*" hidden class="bv-ref-input" /></label>
                </div>`}
              </div>
              <div class="bv-actions">
                <button class="btn btn-test btn-mini batch-one">生成</button>
                ${variants.length > 1 ? `<button class="btn btn-danger btn-mini batch-del">删</button>` : ""}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
    });
  });
  const box = $("batch_list"); box.innerHTML = html;
  box.querySelectorAll(".batch-enable").forEach((el) => el.addEventListener("change", (e) => setGenSub("enabled", e.target.dataset.key, e.target.checked)));
  box.querySelectorAll(".batch-logo").forEach((el) => el.addEventListener("change", (e) => setGenSub("logoByType", e.target.dataset.key, e.target.checked)));
  box.querySelectorAll(".batch-add").forEach((el) => el.addEventListener("click", (e) => { addVariant(e.target.dataset.key); renderBatchList(); }));
  box.querySelectorAll(".batch-variant").forEach((row) => {
    const key = row.dataset.key, vid = row.dataset.vid;
    const ta = row.querySelector(".batch-text-input");
    // 画面文字里又写了像要求的话：当场提示"这几句不会写到图上"
    const det = row.querySelector(".req-detect");
    const showDetect = () => { if (!det || !ta) return; const r = splitCopyReq(ta.value).req; det.textContent = r.length ? `这几句看起来是要求，生成时不会写到图上：${r.join("；")}` : ""; };
    if (ta) ta.addEventListener("input", () => { setVariantText(key, vid, ta.value); showDetect(); });
    showDetect();
    const rq = row.querySelector(".batch-req-input");
    if (rq) rq.addEventListener("input", () => setVariantReq(key, vid, rq.value));
    const cadd = row.querySelector(".batch-copy-add");
    if (cadd) cadd.addEventListener("change", (e) => {
      const idx = e.target.value; if (idx === "") return;
      const item = (getData(h.id).copyPool || [])[idx]; if (!item) return;
      const cur = ta.value.trim(); ta.value = cur ? cur + "\n" + item.text : item.text;
      setVariantText(key, vid, ta.value); e.target.value = "";
    });
    row.querySelector(".batch-one").addEventListener("click", () => doSingleGenerate(key, vid));
    const del = row.querySelector(".batch-del");
    if (del) del.addEventListener("click", () => { removeVariant(key, vid); renderBatchList(); });
    const refInput = row.querySelector(".bv-ref-input");
    if (refInput) refInput.addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { await addVariantRef(key, vid, file); renderBatchList(); } catch (err) { alert("上传失败：" + err.message); }
    });
    row.querySelectorAll(".bv-ref-del").forEach((b) => b.addEventListener("click", () => { removeVariantRef(key, vid, parseInt(b.dataset.ri)); renderBatchList(); }));
  });
  // 列表重绘（切换页面回来、删图等）后，恢复还在生成中的按钮进度，避免看起来"被打断"
  Object.keys(_oneRunning).forEach((k) => { const [key, vid] = k.split("|"); const b = oneBtn(key, vid); if (b) { b.disabled = true; b.textContent = _oneRunning[k]; } });
}

// 单张「生成」的进度状态存在这里，而不是只存在按钮元素上（按钮会随列表重绘被重建）
const _oneRunning = {};
function oneBtn(key, vid) { return document.querySelector(`.batch-variant[data-key="${key}"][data-vid="${vid}"] .batch-one`); }
function setOneState(key, vid, text) {
  const k = key + "|" + vid;
  if (text == null) delete _oneRunning[k]; else _oneRunning[k] = text;
  const b = oneBtn(key, vid); if (!b) return;
  b.disabled = text != null; b.textContent = text == null ? "生成" : text;
}

// 把真实 LOGO（可带医院名称）叠加到生成图上。widthRatio = LOGO 宽占画面比例
function compositeLogo(baseUrl, logoUrl, pos, widthRatio, name, color) {
  return new Promise((resolve) => {
    const base = new Image();
    base.onload = () => {
      const W = base.naturalWidth, H = base.naturalHeight;
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);   // 同样铺不透明白底，防止底图带 alpha
      ctx.drawImage(base, 0, 0, W, H);
      const logo = new Image();
      logo.onload = () => {
        const targetW = W * (widthRatio || 0.12);
        const scale = targetW / logo.naturalWidth;
        const lw = logo.naturalWidth * scale, lh = logo.naturalHeight * scale;
        const m = W * 0.04;
        let x, y;
        switch (pos) {
          case "top-left": x = m; y = m; break;
          case "top-right": x = W - lw - m; y = m; break;
          case "bottom-left": x = m; y = H - lh - m; break;
          case "bottom-right": x = W - lw - m; y = H - lh - m; break;
          case "bottom-center": x = (W - lw) / 2; y = H - lh - m; break;
          case "top-center": x = (W - lw) / 2; y = m; break;
          default: x = m; y = m;
        }
        ctx.drawImage(logo, x, y, lw, lh);
        // 医院名称放在 LOGO 旁
        if (name && name.trim()) {
          const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
          const gap = lh * 0.28;
          const right = pos.indexOf("right") >= 0;
          let fs = Math.round(lh * 0.52);
          const setF = () => { ctx.font = `bold ${fs}px ${FONT}`; };
          setF();
          const maxW = right ? (x - gap - m) : (W - (x + lw + gap) - m);
          while (fs > 10 && ctx.measureText(name).width > maxW) { fs -= 1; setF(); }
          ctx.fillStyle = color || "#1f8a8f";
          ctx.textBaseline = "middle";
          if (right) { ctx.textAlign = "right"; ctx.fillText(name, x - gap, y + lh / 2); }
          else { ctx.textAlign = "left"; ctx.fillText(name, x + lw + gap, y + lh / 2); }
        }
        resolve(c.toDataURL("image/png"));
      };
      logo.onerror = () => resolve(baseUrl);
      logo.src = logoUrl;
    };
    base.onerror = () => resolve(baseUrl);
    base.src = baseUrl;
  });
}

// 把图片适配到严格目标尺寸。
// 比例接近：cover 居中（几乎无损）；比例差异大（超宽/超长）：模糊填充背景 + 完整图居中，
// 保证内容【绝不被裁掉】（详情页/特色图等极端比例的硬性要求，见记忆 petvet-design-tool-rules）。
function fitToSize(srcUrl, w, h, mode) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      // 先铺不透明白底：接口返回的 PNG 有时整张都带 alpha（半透明），不铺底会把透明像素一路带到成品图，
      // 贴到美团上会透出背景。铺白底后输出必定完全不透明。
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const ga = iw / ih, ta = w / h;
      const mismatch = Math.max(ga / ta, ta / ga);
      console.log(`[fitToSize] 接口返回图 ${iw}x${ih}(${ga.toFixed(2)}) → 目标 ${w}x${h}(${ta.toFixed(2)}) mismatch=${mismatch.toFixed(2)} mode=${mode || "auto"}`);
      if (mode === "cover" || mismatch <= 1.35) {
        // 比例接近 → cover 居中裁切（基本无损）
        const s = Math.max(w / iw, h / ih);
        ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
      } else {
        // 比例差异大 → 完整图居中（contain，绝不裁内容）+ 边缘色自然延展填充（无模糊、无裁切）
        const sf = Math.min(w / iw, h / ih);
        const fw = Math.round(iw * sf), fh = Math.round(ih * sf);
        const ox = Math.round((w - fw) / 2), oy = Math.round((h - fh) / 2);
        ctx.drawImage(img, ox, oy, fw, fh);
        const avg = (sx, sy, sw, sh) => {
          const dd = ctx.getImageData(sx, sy, Math.max(1, sw), Math.max(1, sh)).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < dd.length; i += 4) { r += dd[i]; g += dd[i + 1]; b += dd[i + 2]; n++; }
          return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
        };
        if (oy > 0) { // 上下用图片上/下边缘色延展
          ctx.fillStyle = avg(ox, oy, fw, 1); ctx.fillRect(0, 0, w, oy);
          ctx.fillStyle = avg(ox, oy + fh - 1, fw, 1); ctx.fillRect(0, oy + fh, w, h - (oy + fh));
        }
        if (ox > 0) { // 左右用图片左/右边缘色延展
          ctx.fillStyle = avg(ox, oy, 1, fh); ctx.fillRect(0, 0, ox, h);
          ctx.fillStyle = avg(ox + fw - 1, oy, 1, fh); ctx.fillRect(ox + fw, 0, w - (ox + fw), h);
        }
        ctx.drawImage(img, ox, oy, fw, fh); // 把完整图重绘到最上层
      }
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(srcUrl);
    img.src = srcUrl;
  });
}

// LOGO + 医院名称 横幅（品牌背景图专用，不调用 AI；名称用真实文字所以准确）
function makeBrandBanner(w, h, logoUrl, name, palette) {
  return new Promise((resolve) => {
    const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    const draw = (logoImg) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = palette.bgSoft || "#ffffff"; ctx.fillRect(0, 0, w, h);
      const pad = h * 0.14;
      let x = pad;
      if (logoImg) {
        const lh = h * 0.46, s = lh / logoImg.naturalHeight, lw = logoImg.naturalWidth * s;   // LOGO 缩小
        ctx.drawImage(logoImg, x, (h - lh) / 2, lw, lh); x += lw + h * 0.1;
      }
      ctx.fillStyle = palette.primary || palette.textDark || "#2b3a42";   // 名称用 LOGO 主色
      ctx.textBaseline = "middle";
      let fs = Math.floor(h * 0.46);   // 名称放大
      const fit = () => { ctx.font = `bold ${fs}px ${FONT}`; };
      fit();
      const maxW = w - x - pad;
      while (fs > 12 && ctx.measureText(name).width > maxW) { fs -= 2; fit(); }
      if (logoImg) { ctx.textAlign = "left"; ctx.fillText(name, x, h / 2); }
      else { ctx.textAlign = "center"; ctx.fillText(name, w / 2, h / 2); }
      resolve(c.toDataURL("image/png"));
    };
    if (logoUrl) { const li = new Image(); li.onload = () => draw(li); li.onerror = () => draw(null); li.src = logoUrl; }
    else draw(null);
  });
}

// 白底 + LOGO 居中（品牌LOGO图专用，不调用 AI）
function makeLogoCanvas(w, h, logoUrl) {
  return new Promise((resolve) => {
    const logo = new Image();
    logo.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      const s = Math.min((w * 0.7) / logo.naturalWidth, (h * 0.7) / logo.naturalHeight);
      const lw = logo.naturalWidth * s, lh = logo.naturalHeight * s;
      ctx.drawImage(logo, (w - lw) / 2, (h - lh) / 2, lw, lh);
      resolve(c.toDataURL("image/png"));
    };
    logo.onerror = () => resolve(null);
    logo.src = logoUrl;
  });
}

// 生成一张并保存入库（批量 / 单张共用）。copy = 文字；refs = 参考图数组
async function generateOne(type, copy, refs, onProgress, styleVal, opts) {
  opts = opts || {};
  const stage = opts.stage;                    // 'fill' = 第⑤步批量套图
  const baseImg = opts.baseImage || null;      // 套图时的模板图
  const h = getCurrentHospital(); const d = getData(h.id); const c = curGenConfig();
  copy = (copy || "").trim();
  refs = refs || [];
  // 第④步的文字框里常夹着对这张图的要求（"保持原图人像不变"）：拆出来当要求，不写到图上、不当缺字查
  let req = String(opts.req || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (stage !== "fill") { const sp = splitCopyReq(copy); copy = sp.copy; req = req.concat(sp.req); }
  const extraAll = [c.extra, req.join("；")].map((x) => String(x || "").trim()).filter(Boolean).join("；");
  // 品牌LOGO图：本地白底+LOGO居中，不调用 AI
  if (type.logoCanvas) {
    if (!d.logo) throw new Error("请先到「素材库」上传 LOGO。");
    if (onProgress) onProgress("正在生成…");
    const dataUrl = await makeLogoCanvas(type.w, type.h, d.logo);
    if (!dataUrl) throw new Error("LOGO 处理失败。");
    const rec = { id: uid(), hospitalId: h.id, typeKey: type.key, typeName: type.name, w: type.w, h: type.h, ratio: type.ratio, copy: "", dataUrl, createdAt: Date.now() };
    await saveImageToServer(rec); return rec;
  }
  // 品牌背景图：本地 LOGO + 医院名称横幅，不调用 AI
  if (type.nameLogoCanvas) {
    if (onProgress) onProgress("正在生成…");
    const dataUrl = await makeBrandBanner(type.w, type.h, d.logo || null, h.name, d.palette || {});
    const rec = { id: uid(), hospitalId: h.id, typeKey: type.key, typeName: type.name, w: type.w, h: type.h, ratio: type.ratio, copy: h.name, dataUrl, createdAt: Date.now() };
    await saveImageToServer(rec); return rec;
  }
  const logo = { use: getLogoUse(type.key) && !!d.logo, pos: c.logoPos, size: c.logoSize };
  // 团单配图：第④步勾选「设计进 LOGO」→ 把 LOGO 原图 + 院名交给 AI 设计进画面；
  // 第⑤步套图不再单独选择，模板图当初设计了 LOGO 就沿用，没有就不加
  logo.design = usesTemplate(type) && !!d.logo && (stage === "fill" ? !!opts.tplWithLogo : groupLogoOn());
  logo.slots = opts.slots || null;
  logo.pets = opts.pets || null;
  if (usesTemplate(type) || stage === "fill") logo.use = false;   // 团单配图不再往角落叠 LOGO
  const styleRefs = c.styleRefs || [];
  styleVal = styleVal !== undefined ? styleVal : pickStyle(0);   // 未指定则用第一种风格
  // 抖音团单：按 16:9 出图后居中裁成 4:3（套图时模板本身已是 4:3，直接按原比例出）
  const gType = (type.genAs && stage !== "fill") ? Object.assign({}, type, type.genAs) : type;
  const prompt = buildPrompt(gType, copy, extraAll, logo, refs.length > 0, styleRefs.length > 0, styleVal, stage);
  // 套图 → 只喂模板图；团单模板有参考图 → 只喂该参考图（图生图）；其余用风格参考图 + 变体参考图
  const tplRefUrl = (!baseImg && tplStyled(type)) ? tplRefOf(styleVal) : "";
  const rawRefs = baseImg ? [baseImg] : (tplRefUrl ? [tplRefUrl] : styleRefs.concat(refs));
  if (logo.design) rawRefs.push(d.logo);   // LOGO 原图固定放最后一张（提示词里按"最后一张"指代）
  const imageUrls = rawRefs.length ? await Promise.all(rawRefs.map(assetToDataUrl)) : [];   // 参考图转回 base64（外部接口访问不到 localhost 文件）
  // 出图后自动检查（js/qa.js）：没通过就把问题写进提示词重出，最多重出「接口配置」里设的次数；
  // 每一版只留在内存里，最后只保存问题最少的那一版，没通过的废图不会进素材库
  const spec = qaSpecFor({ type, copy, stage, logoDesign: logo.design, slots: logo.slots, pets: logo.pets, styleVal, hospitalName: h.name });
  const checking = !!spec && qaReady();
  const maxTries = 1 + (checking ? qaSettings().retry : 0);
  const attempts = [];
  let gens = 0;   // 整张出了几次（局部修字不算）
  for (let k = 0; k < maxTries; k++) {
    const p = k === 0 ? prompt : prompt + "\n\n" + qaFeedback(attempts[attempts.length - 1].qa);
    let dataUrl;
    try {
      const url = await generateImage(p, onProgress, { size: gType.ratio, imageUrls });
      if (onProgress) onProgress("正在保存图片…");
      dataUrl = await downloadToDataUrl(url);
      if (onProgress) onProgress("正在适配尺寸…");
      dataUrl = await fitToSize(dataUrl, type.w, type.h, gType !== type ? "cover" : type.fit);   // 严格适配目标尺寸（16:9→4:3 只裁左右，不压缩）
      if (logo.use) { if (onProgress) onProgress("正在叠加 LOGO…"); dataUrl = await compositeLogo(dataUrl, d.logo, logo.pos, logo.size); }
    } catch (e) {
      if (!attempts.length) throw e;   // 第一版就失败：照旧报错
      break;                           // 重出失败：保留之前出好的那版
    }
    gens++;
    if (!checking) { attempts.push({ dataUrl, qa: null }); break; }
    if (onProgress) onProgress(k ? `正在检查重出的第 ${k} 版…` : "正在检查…");
    let qa = await qaCheck(dataUrl, spec);
    attempts.push({ dataUrl, qa });
    // 只是字写错 / 旧字没换 / 院名写错：先只重画出错的那一小块（js/fix.js），保住整张构图；修好了就不用整张重出
    if (qa.status !== "pass" && fixReady() && qaFixable(qa)) {
      const fixed = await localFix(dataUrl, qa, spec, type.ratio, onProgress);   // 修的是最终尺寸的图（抖音已裁成 4:3）
      if (fixed) { attempts.push(fixed); qa = fixed.qa; }
    }
    if (qa.status !== "fail") break;
    if (k + 1 < maxTries && onProgress) onProgress(`没通过（${qa.issues.find((x) => x.lv === "err").msg}），自动重出 ${k + 1}/${maxTries - 1}…`);
  }
  const best = qaPickBest(attempts);
  const rec = { id: uid(), hospitalId: h.id, typeKey: type.key, typeName: type.name, w: type.w, h: type.h, ratio: type.ratio, copy, styleName: opts.styleName || (tplStyled(type) ? tplName(styleVal) : styleShortName(styleVal)), req: req.join("\n"), stage: stage || '', tplKey: usesTemplate(type) ? (opts.tplKey || styleVal) : '', withLogo: !!logo.design, srcId: opts.srcId || '', dataUrl: best.dataUrl, qa: qaRecord(best.qa, gens), createdAt: Date.now() };
  await saveImageToServer(rec);
  return rec;
}

async function doSingleGenerate(key, vid) {
  const type = findType(key); if (!type) return;
  if (_oneRunning[key + "|" + vid]) return;   // 正在生成中，不重复触发
  const v = getVariants(key).find((x) => x.id === vid); const copy = v ? v.text : ""; const refs = v ? (v.refs || []) : [];
  // 选了几种就出几张（本地合成图只出一张；团单配图按模板库）
  const isTpl = usesTemplate(type);
  const styles = (type.logoCanvas || type.nameLogoCanvas) ? [stylePool()[0]]
    : tplStyled(type) ? tplPool() : stylePool();
  const unit = tplStyled(type) ? "个模板" : "种风格";
  if (styles.length > 1 && !confirm(`已选 ${styles.length} ${unit}，将为「${type.name}」各生成一张，共 ${styles.length} 张（${styles.length} 次接口调用，会产生费用）。继续吗？` + qaCostNote())) return;
  setOneState(key, vid, "…");
  try {
    const bad = [];
    for (let i = 0; i < styles.length; i++) {
      const rec = await generateOne(type, copy, refs, (m) => {
        setOneState(key, vid, styles.length > 1 ? `${i + 1}/${styles.length}` : (m.length > 4 ? "…" : m));
      }, styles[i], { req: v ? v.req : "" });
      if (rec.qa && rec.qa.status === "fail") bad.push(rec.qa);
      await renderGallery();
    }
    setOneState(key, vid, bad.length ? "!" : "✓");
    setTimeout(() => setOneState(key, vid, null), 1500);
    if (bad.length) alert(`「${type.name}」出好了，但有 ${bad.length} 张没通过检查：\n` + bad.map((q) => qaLogText(q).replace(/^❌ 已生成，但没通过检查：/, "· ")).join("\n") + "\n\n在下方结果里点图上的红色标记可以看详情。");
  } catch (e) {
    setOneState(key, vid, null);
    alert(`「${type.name}」生成失败：\n` + e.message);
  }
}

async function doBatchGenerate() {
  const h = getCurrentHospital(); if (!h) return;
  const c = curGenConfig();
  const jobs = [];
  // 每个文案条目 × 每种选中的风格 —— 选 2 种风格就出 2 张，方便直接对比
  const pool = stylePool();
  MATERIAL_TYPES.forEach((g) => g.items.forEach((it) => {
    if (c.enabled[it.key] === false) return;
    // 本地合成图（LOGO图/品牌横幅）与风格无关，只生成一次；团单配图走模板库
    const styles = (it.logoCanvas || it.nameLogoCanvas) ? [pool[0]]
      : tplStyled(it) ? tplPool() : pool;
    getVariants(it.key).forEach((v) => styles.forEach((sv) => {
      jobs.push({ type: it, copy: v.text, req: v.req || "", refs: v.refs || [], styleVal: sv });
    }));
  }));
  if (!jobs.length) { alert("请至少勾选一种素材。"); return; }
  // 预检：Key 没配就别开跑，免得每张都报同一个错、白等一轮
  const needAI = jobs.some((j) => !j.type.logoCanvas && !j.type.nameLogoCanvas);
  if (needAI && !cfg().img_key) { alert("请先到「⚙️ 接口配置」填写并保存图片 API Key，再批量生成。"); return; }
  // 预检：CORS 代理是否已配置（没配会导致每张都报错、白等一轮）
  if (needAI && !localStorage.getItem(WORKER_URL_KEY)) { alert("请先到「⚙️ 接口配置」填写并保存「网页版 CORS 代理地址」，再批量生成。"); return; }
  if (!confirm(`将按顺序生成 ${jobs.length} 张素材，约 ${jobs.length} 次接口调用并产生相应费用。继续吗？` + qaCostNote())) return;

  const log = $("batch_log"); log.style.display = "block"; log.className = "out"; log.innerHTML = "";
  const btn = $("btn_batch_gen"); btn.disabled = true;
  let ok = 0, fail = 0, look = 0;
  for (let i = 0; i < jobs.length; i++) {
    const t = jobs[i].type;
    const line = document.createElement("div");
    line.textContent = `(${i + 1}/${jobs.length}) ${t.name}：开始…`;
    log.appendChild(line); log.scrollTop = log.scrollHeight;
    try {
      const sn = tplStyled(t) ? "·" + tplName(jobs[i].styleVal)
        : (pool.length > 1 ? "·" + styleShortName(jobs[i].styleVal) : "");
      const rec = await generateOne(t, jobs[i].copy, jobs[i].refs, (m) => { line.textContent = `(${i + 1}/${jobs.length}) ${t.name}${sn}：${m}`; }, jobs[i].styleVal, { req: jobs[i].req });
      line.textContent = `(${i + 1}/${jobs.length}) ${t.name}${sn}：${qaLogText(rec.qa)}`; ok++;
      if (rec.qa && (rec.qa.status === "fail" || rec.qa.status === "warn")) { look++; line.className = rec.qa.status === "fail" ? "error" : ""; }
      await renderGallery();
    } catch (e) {
      line.textContent = `(${i + 1}/${jobs.length}) ${t.name}：❌ ${e.message}`; line.className = "error"; fail++;
    }
  }
  const done = document.createElement("div");
  done.innerHTML = `<b>全部结束：成功 ${ok} 张${look ? `（其中 ${look} 张需要你看一眼，图上有标记）` : ""}，失败 ${fail} 张。</b>`;
  log.appendChild(done);
  btn.disabled = false;
}

async function renderGallery() {
  const h = getCurrentHospital(); if (!h) return;
  const box = $("material_gallery");
  let list = await listImagesFromServer(h.id);
  if (!list.length) { box.innerHTML = '<div class="hint">（暂无）</div>'; return; }
  // 按素材类型分组，每种类型一行（横向滚动）
  const byType = {};
  list.forEach((m) => { (byType[m.typeKey] = byType[m.typeKey] || []).push(m); });
  let html = "";
  MATERIAL_TYPES.forEach((g) => g.items.forEach((it) => {
    const arr = byType[it.key]; if (!arr || !arr.length) return;
    arr.sort((a, b) => b.createdAt - a.createdAt);
    html += `<div class="gv-row-title">${it.name} <span class="gv-count">${arr.length} 张 · ${it.w}×${it.h}</span></div>
      <div class="gv-row">
        ${arr.map((m) => `
          <div class="gv-cell">
            <div class="gv-imgwrap">
              <img class="gv-img" src="${thumbUrl(m.id)}" alt="${esc(m.typeName)}" loading="lazy" decoding="async" style="aspect-ratio:${m.w} / ${m.h}" onclick="openLightbox('${imageFileUrl(m.id)}')" />
              ${m.styleName ? `<div class="gv-style" title="生成风格">${esc(m.styleName)}${m.stage === "fill" ? " · 套图" : ""}</div>` : ""}
              ${qaBadgeHtml(m)}
            </div>
            ${m.copy ? `<div class="g-copy">${esc(m.copy.split("\n")[0].slice(0, 14))}${m.copy.length > 14 ? "…" : ""}</div>` : ""}
            <div class="g-actions">
              <button class="btn btn-test btn-mini" onclick="downloadMaterial('${m.id}')">下载</button>
              <button class="btn btn-danger btn-mini" onclick="deleteMaterial('${m.id}')">删</button>
            </div>
          </div>`).join("")}
      </div>`;
  }));
  box.innerHTML = html || '<div class="hint">（暂无）</div>';
}

// 「设计进 LOGO」选项：第④步和第⑤步两处复选框共用一个设置
function syncGroupLogoOpts() {
  const h = getCurrentHospital(); const d = h ? getData(h.id) : {};
  document.querySelectorAll(".opt-group-logo").forEach((el) => {
    el.checked = groupLogoOn(); el.disabled = !d.logo;
    const lab = el.closest(".group-logo-opt"); if (!lab) return;
    lab.classList.toggle("disabled", !d.logo);
    lab.title = d.logo ? "" : "请先到「医院素材库」上传 LOGO";
  });
}
