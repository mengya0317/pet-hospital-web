// 入口：界面框架（视图切换、皮肤、大图查看）、接口自检、服务端心跳、页面初始化

// ===== 皮肤：整个工作台（含 AI 自由生图 iframe）共用一套 =====
const SKIN_KEY = "petvet_skin";
const AIGEN_SKIN = { "": "light", warm: "light", slate: "light", dark: "dark", ocean: "ocean", plum: "plum" };
function applySkin(v) {
  if (v) document.body.dataset.skin = v; else delete document.body.dataset.skin;
  localStorage.setItem(SKIN_KEY, v);
  localStorage.setItem("aiimg_skin", AIGEN_SKIN[v] || "dark");   // 自由生图同源，共用这个键
  const f = $("aigen_frame");
  if (f && f.contentWindow) f.contentWindow.postMessage({ type: "skin", skin: AIGEN_SKIN[v] || "dark" }, location.origin);
}
function initSkin() {
  const sel = $("skin_pick"); if (!sel) return;
  const v = localStorage.getItem(SKIN_KEY) || "";
  sel.value = v; applySkin(v);
  sel.addEventListener("change", () => applySkin(sel.value));
}

function switchView(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  const content = document.querySelector(".content");
  if (content) content.classList.toggle("wide", name === "generate" || name === "edit" || name === "aigen");
  // AI 自由生图：首次打开时才加载内嵌页面（避免每次打开工作台都去拉它的历史图）
  if (name === "aigen") { const f = $("aigen_frame"); if (f && !f.src) f.src = f.dataset.src; }
  // 独立工具与医院无关，隐藏顶栏的"当前医院"
  const tag = $("current_hospital_tag"); if (tag) tag.style.visibility = name === "aigen" ? "hidden" : "";
  if (name === "profile") renderProfile();
  if (name === "hospital") renderHospitals();
  if (name === "material") renderMaterial();
  if (name === "generate") renderGenerate();
  if (name === "edit") renderEdit();
  if (name === "generate" || name === "edit") renderQaHints();
}

// 点击放大预览
function openLightbox(src) { $("lightbox_img").src = src; $("lightbox").style.display = "flex"; }
function closeLightbox() { $("lightbox").style.display = "none"; $("lightbox_img").src = ""; }
window.openLightbox = openLightbox;

// 查询接口方可用的模型列表（不消耗额度），方便换模型时照抄型号名
async function listModels() {
  const btn = $("btn_list_models"), out = $("models_out");
  const c = cfg();
  if (!c.img_key) { alert("请先填写并保存图片 API Key。"); return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = "查询中…";
  out.className = "out"; out.textContent = "正在查询…";
  try {
    const r = await proxy("models", c.img_base, c.img_key, {});
    const arr = (r && (r.data || r.models || r)) || [];
    const ids = (Array.isArray(arr) ? arr : []).map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean).sort();
    if (!ids.length) { out.textContent = "接口没返回模型列表：\n" + JSON.stringify(r).slice(0, 600); return; }
    const img = ids.filter((x) => /image|dall|flux|qwen-image|seedream|imagen|midjourney/i.test(x));
    out.textContent =
      `共 ${ids.length} 个模型，其中图像类 ${img.length} 个：\n\n【图像模型】\n` +
      (img.join("\n") || "（未识别到）") +
      `\n\n把想用的型号名，原样复制到上面的「图片模型」输入框并保存即可。`;
  } catch (e) {
    out.className = "out error";
    out.textContent = "查询失败：" + e.message;
  } finally { btn.disabled = false; btn.textContent = old; }
}

// 网络连通检测（网页版）：只检测 CORS 代理（Worker）是否可达。网页版没有本地后端做 DNS/直连自检，
// 浏览器能打开本页 + 这里通了，剩下就看各接口 Key 是否有效、该模型接口在当前网络能否被代理访问到。
async function runNetCheck() {
  const btn = $("btn_netcheck"), out = $("netcheck_out");
  btn.disabled = true; const old = btn.textContent; btn.textContent = "检测中…";
  out.className = "out"; out.textContent = "正在检测 CORS 代理连通…";
  try {
    const u = (localStorage.getItem(WORKER_URL_KEY) || "").trim().replace(/\/+$/, "");
    if (!u) { out.className = "out error"; out.textContent = "还没配置 CORS 代理地址（见本页最上方「网页版 CORS 代理」卡片）。"; return; }
    const r = await fetch(u);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok) {
      out.className = "out";
      out.textContent = "✅ CORS 代理连接正常。\n\n说明：网页版没有本地后端，只要这里通了，接口能不能用就看各家 Key 是否有效、以及该模型接口在当前网络下能否被代理访问到（生图/文案按钮会给出具体报错）。";
    } else {
      out.className = "out error";
      out.textContent = "❌ 连不上 CORS 代理：HTTP " + r.status + "。请检查 Worker 地址是否填对、是否已部署。";
    }
  } catch (e) {
    out.className = "out error";
    out.textContent = "❌ 连不上 CORS 代理：" + e.message + "。请检查 Worker 地址。";
  } finally { btn.disabled = false; btn.textContent = old; }
}

async function testText() {
  const out = $("text_out");
  out.className = "out loading"; out.textContent = "正在请求 DeepSeek…"; $("btn_test_text").disabled = true;
  try {
    const reply = await chat([
      { role: "system", content: "你是宠物医院的美团店铺文案助手，回答简洁。" },
      { role: "user", content: "用一句话为一家叫“暖爪宠物医院”的店铺写一句温暖的宣传语。" },
    ]);
    out.className = "out"; out.textContent = "✅ 文案接口正常！\n\n" + reply;
  } catch (e) { out.className = "out error"; out.textContent = "❌ 文案接口失败：\n" + e.message; }
  finally { $("btn_test_text").disabled = false; }
}
async function testImage() {
  const out = $("image_out");
  out.className = "out img-out loading"; out.textContent = "正在提交任务…"; $("btn_test_image").disabled = true;
  try {
    const src = await generateImage("一只可爱的橘色小猫在干净明亮的宠物医院里，温暖治愈风格，扁平插画",
      (msg) => { out.textContent = msg; });
    out.className = "out img-out"; out.innerHTML = ""; const img = new Image(); img.src = src; out.appendChild(img);
  } catch (e) { out.className = "out img-out error"; out.textContent = "❌ 图片接口失败：\n" + e.message; }
  finally { $("btn_test_image").disabled = false; }
}

async function pingProxy() {
  try {
    const u = (localStorage.getItem(WORKER_URL_KEY) || "").trim().replace(/\/+$/, "");
    if (!u) { $("proxy_dot").className = "dot bad"; $("proxy_text").textContent = "还没配置 CORS 代理地址"; return; }
    const r = await fetch(u);
    if (r.ok) { $("proxy_dot").className = "dot ok"; $("proxy_text").textContent = "CORS 代理连接正常"; return; }
    throw new Error();
  } catch (e) { $("proxy_dot").className = "dot bad"; $("proxy_text").textContent = "连不上 CORS 代理（请检查 Worker 地址）"; }
}

// 暴露给 HTML onclick 用
window.selectHospital = selectHospital;
window.deleteHospital = deleteHospital;
window.editCopy = editCopy;
window.deleteCopy = deleteCopy;

window.addEventListener("DOMContentLoaded", async () => {
  loadConfig();
  // 先把服务端数据里内联的 base64 参考图/LOGO 搬成文件，给 localStorage 瘦身（解决"本地存储空间不足"）
  await migrateAssetsToServer();
  // 再从服务端文件加载医院数据；若服务端没有但本地还有残留，则迁移上去
  const loaded = await loadFromServer();
  if (!loaded && getHospitals().length) syncToServer();
  migrateImagesToServer();   // 把浏览器里旧的成品图迁移到服务端文件（后台进行）
  updateCurrentTag();
  renderHospitals();
  // 一次性整理：写在「画面文字」里的要求挪到「对这张图的要求」，以前因此报的"缺字"去掉
  const movedReq = migrateVariantReqs();
  const fixedQa = await migrateQaReqIssues();
  if (movedReq || fixedQa) setTimeout(() => alert(`已把 ${movedReq} 句写在「画面文字」里的要求（比如「保持原图人像不变」「设备图大一点」）挪到了每张图新的「对这张图的要求」框里——它们以后不会被写到图上，也不会再被当成缺字。`
    + (fixedQa ? `\n另外 ${fixedQa} 张已生成的图，之前因为这些要求报的"缺字"已经去掉。` : "") + "\n\n可以到第④步核对一下。"), 300);

  initSkin();
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  // 自动检查的两个开关：改了立即存（不用点「保存接口配置」），生成按钮旁的说明跟着变
  ["qa_on", "qa_retry", "qa_fix"].forEach((id) => $(id).addEventListener("change", () => {
    const o = readJSON(CONFIG_KEY, {}); o[id] = $(id).value; writeJSON(CONFIG_KEY, o); renderQaHints();
  }));
  renderQaHints();

  $("lightbox").addEventListener("click", closeLightbox);
  $("bf_text").addEventListener("input", renderBatchPreview);
  $("bf_xls").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) handleBatchExcel(f); e.target.value = ""; });
  document.querySelectorAll(".opt-group-logo").forEach((el) => el.addEventListener("change", () => { patchGenConfig({ groupLogo: el.checked }); syncGroupLogoOpts(); }));
  $("bf_start").addEventListener("click", runBatchFill);
  $("bf_assign").addEventListener("click", autoAssignTexts);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  // 编辑器
  preloadFonts();
  loadUserFonts();
  $("ed_back").addEventListener("click", renderEdit);
  $("ed_add_text").addEventListener("click", edAddText);
  $("ed_add_box").addEventListener("click", edAddRect);
  $("ed_add_logo").addEventListener("click", edAddLogo);
  $("ed_download").addEventListener("click", edDownload);
  $("ed_save_new").addEventListener("click", () => edSave(true));
  $("ed_save_over").addEventListener("click", () => edSave(false));
  $("edit_batch_download").addEventListener("click", editBatchDownload);
  $("ed_upload_font").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await uploadFont(f); } catch (err) { alert("上传失败：" + err.message); } e.target.value = ""; });
  $("ed_del").addEventListener("click", () => { const o = edActive(); if (o) { edCanvas.remove(o); edCanvas.requestRenderAll(); $("ed_props").style.display = "none"; } });
  $("ed_front").addEventListener("click", () => { const o = edActive(); if (o) { o.bringToFront(); edCanvas.requestRenderAll(); } });
  $("ed_back2").addEventListener("click", () => { const o = edActive(); if (o) { o.sendToBack(); edCanvas.requestRenderAll(); } });
  document.querySelectorAll(".ed-align").forEach((b) => b.addEventListener("click", () => { const o = edActive(); if (o && o.type === "i-text") { o.set("textAlign", b.dataset.a); edCanvas.requestRenderAll(); } }));
  // 撤销/重做
  $("ed_undo").addEventListener("click", edUndo);
  $("ed_redo").addEventListener("click", edRedo);
  document.addEventListener("keydown", (e) => {
    if ($("edit_editor") && $("edit_editor").style.display !== "none" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      const ae = edCanvas && edCanvas.getActiveObject(); if (ae && ae.isEditing) return;
      e.preventDefault(); if (e.shiftKey) edRedo(); else edUndo();
    }
  });
  // 文字描边/阴影
  $("ed_tstrokec").addEventListener("input", (e) => { const o = txt(); if (o) { o.set({ stroke: e.target.value, paintFirst: "stroke" }); if (!o.strokeWidth) { o.set("strokeWidth", Math.max(2, Math.round(o.fontSize * 0.04))); $("ed_tstrokew").value = o.strokeWidth; } edCanvas.requestRenderAll(); edSaveState(); } });
  $("ed_tstrokew").addEventListener("input", (e) => { const o = txt(); if (o) { o.set({ strokeWidth: clamp(parseInt(e.target.value) || 0, 0, 60), paintFirst: "stroke" }); edCanvas.requestRenderAll(); } });
  $("ed_shadow").addEventListener("change", (e) => { const o = txt(); if (o) { o.set("shadow", e.target.checked ? new fabric.Shadow({ color: "rgba(0,0,0,0.35)", blur: Math.max(4, o.fontSize * 0.1), offsetX: Math.max(2, o.fontSize * 0.04), offsetY: Math.max(2, o.fontSize * 0.04) }) : null); edCanvas.requestRenderAll(); edSaveState(); } });
  // 导出选项（命名前后缀；下载统一高清）
  const eo = getExportOpts();
  $("exp_prefix").value = eo.prefix; $("exp_suffix").value = eo.suffix;
  $("exp_prefix").addEventListener("input", (e) => { const o = getExportOpts(); o.prefix = e.target.value; setExportOpts(o); });
  $("exp_suffix").addEventListener("input", (e) => { const o = getExportOpts(); o.suffix = e.target.value; setExportOpts(o); });
  // 文字属性
  const txt = () => { const o = edActive(); return (o && o.type === "i-text") ? o : null; };
  $("ed_text").addEventListener("input", (e) => { const o = txt(); if (o) { o.set("text", e.target.value); edCanvas.requestRenderAll(); } });
  $("ed_color").addEventListener("input", (e) => { const o = txt(); if (o) { o.set("fill", e.target.value); edCanvas.requestRenderAll(); } });
  $("ed_bold").addEventListener("change", (e) => { const o = txt(); if (o) { o.set("fontWeight", e.target.checked ? "bold" : "normal"); edCanvas.requestRenderAll(); } });
  $("ed_size").addEventListener("input", (e) => edApplySize(parseInt(e.target.value)));
  $("ed_size_n").addEventListener("input", (e) => edApplySize(parseInt(e.target.value)));
  $("ed_charspace").addEventListener("input", (e) => edApplyChar(parseInt(e.target.value)));
  $("ed_charspace_n").addEventListener("input", (e) => edApplyChar(parseInt(e.target.value)));
  $("ed_linespace").addEventListener("input", (e) => edApplyLine(parseInt(e.target.value) / 100));
  $("ed_linespace_n").addEventListener("input", (e) => edApplyLine(parseFloat(e.target.value)));
  $("ed_font").addEventListener("change", (e) => {
    const o = txt(); if (!o) return; const fam = e.target.value;
    const apply = () => { o.set("fontFamily", fam); edCanvas.requestRenderAll(); };
    if (document.fonts && document.fonts.load) { document.fonts.load(`30px ${fam}`).then(apply).catch(apply); } else apply();
  });
  // 方框属性
  const rect = () => { const o = edActive(); return (o && o.type === "rect") ? o : null; };
  $("ed_fill").addEventListener("input", (e) => { const o = rect(); if (o) { o.set("fill", e.target.value); edCanvas.requestRenderAll(); } });
  $("ed_strokec").addEventListener("input", (e) => { const o = rect(); if (o) { o.set("stroke", e.target.value); edCanvas.requestRenderAll(); } });
  $("ed_strokew").addEventListener("input", (e) => edApplyStrokeW(parseInt(e.target.value)));
  $("ed_strokew_n").addEventListener("input", (e) => edApplyStrokeW(parseInt(e.target.value)));
  $("ed_radius").addEventListener("input", (e) => edApplyRadius(parseInt(e.target.value)));
  $("ed_radius_n").addEventListener("input", (e) => edApplyRadius(parseInt(e.target.value)));
  $("ed_opacity").addEventListener("input", (e) => edApplyOpacity(parseInt(e.target.value)));
  $("ed_opacity_n").addEventListener("input", (e) => edApplyOpacity(parseInt(e.target.value)));

  $("btn_add_hospital").addEventListener("click", addHospital);
  $("btn_optimize").addEventListener("click", optimizeProfile);
  $("btn_adopt").addEventListener("click", adoptOptimized);
  $("btn_add_copy").addEventListener("click", addCopy);
  $("new_copy_text").addEventListener("keydown", (e) => { if (e.key === "Enter") addCopy(); });

  // 素材库
  $("logo_file").addEventListener("change", handleLogoUpload);
  $("logo_del").addEventListener("click", () => deleteImage("logo", "logo_preview", "logo_del"));
  $("brand_color").addEventListener("input", (e) => applyBrandColor(e.target.value));
  $("btn_gen_palette").addEventListener("click", () => applyBrandColor($("brand_hex").value));
  $("brand_hex").addEventListener("keydown", (e) => { if (e.key === "Enter") applyBrandColor($("brand_hex").value); });

  // AI 生成（批量）
  $("batch_use_logo").addEventListener("change", (e) => { patchGenConfig({ logoOn: e.target.checked }); renderBatchList(); });
  $("batch_logo_pos").addEventListener("change", (e) => patchGenConfig({ logoPos: e.target.value }));
  $("batch_logo_size").addEventListener("change", (e) => patchGenConfig({ logoSize: parseFloat(e.target.value) }));
  $("batch_extra").addEventListener("input", (e) => patchGenConfig({ extra: e.target.value }));
  $("batch_design_custom").addEventListener("input", (e) => { patchGenConfig({ customStyle: e.target.value }); updateStyleAux(); });
  $("btn_batch_gen").addEventListener("click", doBatchGenerate);

  $("btn_save").addEventListener("click", saveConfig);
  $("btn_clear").addEventListener("click", clearKeys);
  $("btn_netcheck").addEventListener("click", runNetCheck);
  $("btn_list_models").addEventListener("click", listModels);
  $("btn_test_text").addEventListener("click", testText);
  $("btn_test_image").addEventListener("click", testImage);

  pingProxy();
  setInterval(pingProxy, 8000);
});
