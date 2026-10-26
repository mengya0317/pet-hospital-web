// ⑤ 图片编辑：fabric 画布叠加真实文字 / LOGO、字体管理、批量下载

const FONT_CN = '"PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';
let edCanvas = null, editingMat = null, edGuideV = null, edGuideH = null;
let edHistory = [], edHistIdx = -1, edRestoring = false, edReady = false;

function edSaveState() {
  if (!edReady || edRestoring || !edCanvas) return;
  const json = JSON.stringify(edCanvas.toJSON());   // 参考线 excludeFromExport，不会进历史
  edHistory = edHistory.slice(0, edHistIdx + 1);
  edHistory.push(json); edHistIdx = edHistory.length - 1;
  if (edHistory.length > 40) { edHistory.shift(); edHistIdx--; }
}
function edEnsureGuides() {
  // loadFromJSON 后参考线会丢失，重新建
  const W = editingMat.w, H = editingMat.h, gw = Math.max(1, 2 / edCanvas.getZoom());
  edGuideV = new fabric.Line([W / 2, 0, W / 2, H], { stroke: "#ff4d7d", strokeWidth: gw, selectable: false, evented: false, excludeFromExport: true, visible: false });
  edGuideH = new fabric.Line([0, H / 2, W, H / 2], { stroke: "#ff4d7d", strokeWidth: gw, selectable: false, evented: false, excludeFromExport: true, visible: false });
  edCanvas.add(edGuideV, edGuideH);
}
function edRestore(json) {
  edRestoring = true;
  edCanvas.loadFromJSON(json, () => { edEnsureGuides(); edCanvas.renderAll(); edRestoring = false; $("ed_props").style.display = "none"; });
}
function edUndo() { if (edHistIdx > 0) { edHistIdx--; edRestore(edHistory[edHistIdx]); } }
function edRedo() { if (edHistIdx < edHistory.length - 1) { edHistIdx++; edRestore(edHistory[edHistIdx]); } }

function renderEdit() {
  const h = getCurrentHospital();
  if (!h) { $("edit_need_hospital").style.display = "block"; $("edit_main").style.display = "none"; return; }
  $("edit_need_hospital").style.display = "none";
  $("edit_main").style.display = "block";
  $("edit_picker").style.display = "block";
  $("edit_editor").style.display = "none";
  renderEditGallery();
  renderBatchFillCard();
  syncGroupLogoOpts();
}

async function renderEditGallery() {
  const h = getCurrentHospital(); if (!h) return;
  const box = $("edit_gallery");
  const list = await listImagesFromServer(h.id);
  if (!list.length) { box.innerHTML = '<div class="hint">（暂无，请先到「AI 生成」生成素材）</div>'; return; }
  const byType = {};
  list.forEach((m) => { (byType[m.typeKey] = byType[m.typeKey] || []).push(m); });
  let html = "";
  MATERIAL_TYPES.forEach((g) => g.items.forEach((it) => {
    const arr = byType[it.key]; if (!arr || !arr.length) return;
    arr.sort((a, b) => b.createdAt - a.createdAt);
    html += `<div class="gv-row-title">${it.name} <span class="gv-count">${arr.length} 张 · ${it.w}×${it.h}</span></div>
      <div class="gv-row edit-gallery">
        ${arr.map((m) => `
          <div class="gv-cell">
            <div class="gv-imgwrap">
              <img class="gv-img" src="${thumbUrl(m.id)}" loading="lazy" decoding="async" style="aspect-ratio:${m.w} / ${m.h}" onclick="openLightbox('${imageFileUrl(m.id)}')" />
              ${qaBadgeHtml(m)}
            </div>
            <div class="g-actions" style="padding:6px 7px; flex-wrap:wrap;">
              <button class="btn btn-test btn-mini" onclick="editOpen('${m.id}')">编辑</button>
              <button class="btn btn-test btn-mini" onclick="editDuplicate('${m.id}')">复制</button>
              <button class="btn btn-test btn-mini" onclick="downloadMaterial('${m.id}')">下载</button>
              <button class="btn btn-danger btn-mini" onclick="deleteMaterial('${m.id}')">删除</button>
            </div>
          </div>`).join("")}
      </div>`;
  }));
  box.innerHTML = html;
}
window.editOpen = async (id) => {
  const h = getCurrentHospital(); if (!h) return;
  const m = (await listImagesFromServer(h.id)).find((x) => x.id === id);
  if (m) openEditor(m);
};

function openEditor(meta) {
  editingMat = meta;
  $("edit_picker").style.display = "none";
  $("edit_editor").style.display = "block";
  $("ed_props").style.display = "none";
  if (edCanvas) { edCanvas.dispose(); edCanvas = null; }
  edCanvas = new fabric.Canvas("ed_canvas", { backgroundColor: "#ffffff", preserveObjectStacking: true });
  const W = meta.w, H = meta.h;
  const scale = Math.min(720 / W, 560 / H, 1);
  edCanvas.setWidth(W * scale); edCanvas.setHeight(H * scale); edCanvas.setZoom(scale);
  edReady = false; edHistory = []; edHistIdx = -1;
  fabric.Image.fromURL(imageFileUrl(meta.id), (img) => {
    img.set({ left: 0, top: 0, scaleX: 1, scaleY: 1, selectable: false, evented: false });
    edCanvas.setBackgroundImage(img, () => { edCanvas.renderAll(); edReady = true; edHistory = []; edHistIdx = -1; edSaveState(); });
  });
  // 中线吸附参考线（不导出）
  const gw = Math.max(1, 2 / scale);
  edGuideV = new fabric.Line([W / 2, 0, W / 2, H], { stroke: "#ff4d7d", strokeWidth: gw, selectable: false, evented: false, excludeFromExport: true, visible: false });
  edGuideH = new fabric.Line([0, H / 2, W, H / 2], { stroke: "#ff4d7d", strokeWidth: gw, selectable: false, evented: false, excludeFromExport: true, visible: false });
  edCanvas.add(edGuideV, edGuideH);
  edCanvas.on("object:moving", edSnap);
  edCanvas.on("mouse:up", edHideGuides);
  edCanvas.on("selection:created", edOnSelect);
  edCanvas.on("selection:updated", edOnSelect);
  edCanvas.on("selection:cleared", () => { $("ed_props").style.display = "none"; });
  // 方框缩放后把缩放并入宽高，保证圆角始终是正圆（不被拉变形）
  edCanvas.on("object:modified", (e) => {
    const o = e.target;
    if (o && o.type === "rect" && (o.scaleX !== 1 || o.scaleY !== 1)) {
      o.set({ width: Math.round(o.width * o.scaleX), height: Math.round(o.height * o.scaleY), scaleX: 1, scaleY: 1 });
      edCanvas.requestRenderAll();
    }
    edSaveState();
  });
  edCanvas.on("object:added", edSaveState);
  edCanvas.on("object:removed", edSaveState);
}

function safeHex(v, fb) { return (typeof v === "string" && v[0] === "#") ? v : fb; }
function edOnSelect() {
  const o = edCanvas.getActiveObject();
  if (!o) { $("ed_props").style.display = "none"; return; }
  $("ed_props").style.display = "block";
  const isText = o.type === "i-text", isRect = o.type === "rect";
  $("ed_textgroup").style.display = isText ? "block" : "none";
  $("ed_shapegroup").style.display = isRect ? "block" : "none";
  if (isText) {
    $("ed_text").value = o.text;
    $("ed_color").value = safeHex(o.fill, "#1f3a8f");
    $("ed_bold").checked = (o.fontWeight === "bold" || o.fontWeight === 700);
    $("ed_font").value = o.fontFamily || '"PingFang SC","Microsoft YaHei",sans-serif';
    const fs = Math.round(o.fontSize), cs = o.charSpacing || 0, lh = o.lineHeight || 1.16;
    $("ed_size").value = fs; $("ed_size_n").value = fs;
    $("ed_charspace").value = cs; $("ed_charspace_n").value = cs;
    $("ed_linespace").value = Math.round(lh * 100); $("ed_linespace_n").value = lh.toFixed(2);
    $("ed_tstrokec").value = safeHex(o.stroke, "#ffffff");
    $("ed_tstrokew").value = o.strokeWidth || 0;
    $("ed_shadow").checked = !!o.shadow;
  } else if (isRect) {
    $("ed_fill").value = safeHex(o.fill, "#dbe7ff");
    $("ed_strokec").value = safeHex(o.stroke, "#1f3a8f");
    const sw = o.strokeWidth || 0, rr = o.rx || 0, op = Math.round((o.opacity != null ? o.opacity : 1) * 100);
    $("ed_strokew").value = sw; $("ed_strokew_n").value = sw;
    $("ed_radius").value = rr; $("ed_radius_n").value = rr;
    $("ed_opacity").value = op; $("ed_opacity_n").value = op;
  }
}
// 参数应用（滑块与数字框共用，双向同步）
function edApplySize(v) { const o = edActive(); if (!o || o.type !== "i-text" || isNaN(v)) return; v = clamp(v, 4, 3000); o.set("fontSize", v); $("ed_size").value = v; $("ed_size_n").value = v; edCanvas.requestRenderAll(); }
function edApplyChar(v) { const o = edActive(); if (!o || o.type !== "i-text" || isNaN(v)) return; v = clamp(v, -200, 2000); o.set("charSpacing", v); $("ed_charspace").value = v; $("ed_charspace_n").value = v; edCanvas.requestRenderAll(); }
function edApplyLine(v) { const o = edActive(); if (!o || o.type !== "i-text" || isNaN(v)) return; v = clamp(v, 0.5, 5); o.set("lineHeight", v); $("ed_linespace").value = Math.round(v * 100); $("ed_linespace_n").value = v; edCanvas.requestRenderAll(); }
function edApplyStrokeW(v) { const o = edActive(); if (!o || o.type !== "rect" || isNaN(v)) return; v = clamp(v, 0, 300); o.set("strokeWidth", v); $("ed_strokew").value = v; $("ed_strokew_n").value = v; edCanvas.requestRenderAll(); }
function edApplyRadius(v) { const o = edActive(); if (!o || o.type !== "rect" || isNaN(v)) return; v = clamp(v, 0, 3000); o.set({ rx: v, ry: v }); $("ed_radius").value = v; $("ed_radius_n").value = v; edCanvas.requestRenderAll(); }
function edApplyOpacity(v) { const o = edActive(); if (!o || o.type !== "rect" || isNaN(v)) return; v = clamp(v, 0, 100); o.set("opacity", v / 100); $("ed_opacity").value = v; $("ed_opacity_n").value = v; edCanvas.requestRenderAll(); }

function edAddRect() {
  if (!edCanvas || !editingMat) return;
  const pal = (getData(getCurrentHospital().id).palette) || {};
  const W = editingMat.w, H = editingMat.h;
  const r = new fabric.Rect({
    left: W / 2, top: H / 2, originX: "center", originY: "center",
    width: W * 0.4, height: H * 0.25, rx: 48, ry: 48,
    fill: pal.bgSoft || "#dbe7ff", stroke: pal.primary || "#1f3a8f", strokeWidth: 0, opacity: 1,
    strokeUniform: true, objectCaching: false,
  });
  edCanvas.add(r); edCanvas.setActiveObject(r); edOnSelect(); edCanvas.requestRenderAll();
}

// 预加载本地字体，确保 fabric 渲染时字体已就绪
function preloadFonts() {
  const fonts = ["站酷快乐体", "站酷小薇", "站酷庆科黄油体", "思源黑体", "马善政楷书"];
  if (!document.fonts) return;
  fonts.forEach((f) => { try { document.fonts.load(`30px "${f}"`); } catch (e) {} });
}

// ---- 用户上传字体（存到服务端，永久可用）----
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("读取失败")); r.readAsDataURL(file); }); }
async function registerUserFont(name, url) {
  try {
    if (isDataUrl(url)) {
      const buf = await dataUrlToBlob(url).arrayBuffer();
      const ff = new FontFace(name, buf); await ff.load(); document.fonts.add(ff); return true;
    }
    const ff = new FontFace(name, `url(${url})`); await ff.load(); document.fonts.add(ff); return true;
  } catch (e) { return false; }
}
function addFontOption(name) {
  const sel = $("ed_font"); if (!sel) return;
  if (Array.from(sel.options).some((o) => o.value === name)) return;
  const opt = document.createElement("option"); opt.value = name; opt.textContent = name + "（我的字体）"; sel.appendChild(opt);
}
async function loadUserFonts() {
  try {
    const list = await IDB.listFonts();
    for (const f of list) { await registerUserFont(f.name, f.dataUrl); addFontOption(f.name); }
  } catch (e) {}
}
async function uploadFont(file) {
  const m = file.name.match(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/);
  const ext = m ? m[1].toLowerCase() : "woff2";
  const name = file.name.replace(/\.[^.]+$/, "").trim() || ("字体" + Date.now());
  const dataUrl = await fileToDataUrl(file);
  await IDB.putFont({ name, ext, dataUrl });
  await registerUserFont(name, dataUrl);
  addFontOption(name);
  const o = edActive(); if (o && o.type === "i-text") { o.set("fontFamily", name); $("ed_font").value = name; edCanvas.requestRenderAll(); }
  alert("字体已上传：" + name + "（已保存在本浏览器）");
}

// ---- 批量下载全部素材（打包 zip）----
async function editBatchDownload() {
  const h = getCurrentHospital(); if (!h) return;
  if (typeof JSZip === "undefined") { alert("打包库未加载，请重启服务后重试。"); return; }
  const list = await listImagesFromServer(h.id);
  if (!list.length) { alert("暂无素材可下载。"); return; }
  const btn = $("edit_batch_download"); const old = btn.textContent; btn.disabled = true; btn.textContent = "打包中…";
  try {
    const o = getExportOpts();
    const zip = new JSZip();
    const counter = {};
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const { blob, ext } = await materialBlob(imageFileUrl(m.id), "hd");
      const tn = typeLabel(m);
      counter[tn] = (counter[tn] || 0) + 1;
      zip.folder(tn).file(`${o.prefix || ""}${tn}_${m.w}x${m.h}_${counter[tn]}${o.suffix || ""}.${ext}`, blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(content);
    a.download = `${h.name}_全部素材.zip`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  } catch (e) { alert("打包失败：" + e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
}

function edAddText() {
  if (!edCanvas || !editingMat) return;
  const pal = (getData(getCurrentHospital().id).palette) || {};
  const t = new fabric.IText("双击编辑文字", {
    left: editingMat.w / 2, top: editingMat.h / 2, originX: "center", originY: "center",
    fontSize: Math.max(24, Math.round(editingMat.w * 0.06)), fill: pal.primary || "#1f3a8f",
    fontFamily: FONT_CN, fontWeight: "bold", textAlign: "center",
  });
  edCanvas.add(t); edCanvas.setActiveObject(t); edOnSelect(); edCanvas.requestRenderAll();
}

function edAddLogo() {
  if (!edCanvas || !editingMat) return;
  const logo = getData(getCurrentHospital().id).logo;
  if (!logo) { alert("请先到「素材库」上传 LOGO。"); return; }
  fabric.Image.fromURL(logo, (img) => {
    img.scaleToWidth(editingMat.w * 0.2);
    img.set({ left: editingMat.w * 0.05, top: editingMat.h * 0.05 });
    edCanvas.add(img); edCanvas.setActiveObject(img); edCanvas.requestRenderAll();
  });
}

function edActive() { return edCanvas && edCanvas.getActiveObject(); }

// 拖动时吸附到画面中心（横/纵），并显示中线；同时把元素中心限制在画面内，防止拖丢
function edSnap(e) {
  const o = e.target; if (!o || o === edGuideV || o === edGuideH) return;
  // 先把中心点限制在画面范围内，元素至少有一半留在画面里，绝不会被拖出去找不到
  const c0 = o.getCenterPoint();
  const bx = clamp(c0.x, 0, editingMat.w), by = clamp(c0.y, 0, editingMat.h);
  if (bx !== c0.x || by !== c0.y) { o.setPositionByOrigin(new fabric.Point(bx, by), "center", "center"); o.setCoords(); }
  const W = editingMat.w, H = editingMat.h, th = 12 / edCanvas.getZoom();
  const c = o.getCenterPoint();
  const halfW = o.getScaledWidth() / 2, halfH = o.getScaledHeight() / 2;
  // X 方向候选：画面水平中心、左边缘、右边缘
  let tcx = null, gx = null;
  for (const k of [{ cx: W / 2, line: W / 2 }, { cx: halfW, line: 0 }, { cx: W - halfW, line: W }])
    if (Math.abs(c.x - k.cx) < th) { tcx = k.cx; gx = k.line; break; }
  let tcy = null, gy = null;
  for (const k of [{ cy: H / 2, line: H / 2 }, { cy: halfH, line: 0 }, { cy: H - halfH, line: H }])
    if (Math.abs(c.y - k.cy) < th) { tcy = k.cy; gy = k.line; break; }
  if (tcx != null || tcy != null) {
    o.setPositionByOrigin(new fabric.Point(tcx != null ? tcx : c.x, tcy != null ? tcy : c.y), "center", "center");
    o.setCoords();
  }
  if (edGuideV) { if (gx != null) { edGuideV.set({ x1: gx, x2: gx, visible: true }); edGuideV.bringToFront(); } else edGuideV.set("visible", false); }
  if (edGuideH) { if (gy != null) { edGuideH.set({ y1: gy, y2: gy, visible: true }); edGuideH.bringToFront(); } else edGuideH.set("visible", false); }
}
function edHideGuides() {
  if (edGuideV) edGuideV.set("visible", false);
  if (edGuideH) edGuideH.set("visible", false);
  if (edCanvas) edCanvas.requestRenderAll();
}

async function edExport() {
  edCanvas.discardActiveObject();
  edHideGuides();
  const z = edCanvas.getZoom(), dw = edCanvas.getWidth(), dh = edCanvas.getHeight();
  const bg = edCanvas.backgroundColor;
  edCanvas.setZoom(1); edCanvas.setDimensions({ width: editingMat.w, height: editingMat.h });
  edCanvas.backgroundColor = "#fff";   // 导出也铺白底，保证成品图不透明
  const dataUrl = edCanvas.toDataURL({ format: "png" });
  edCanvas.backgroundColor = bg;
  edCanvas.setZoom(z); edCanvas.setDimensions({ width: dw, height: dh }); edCanvas.requestRenderAll();
  return dataUrl;
}

async function edSave(asNew) {
  if (!edCanvas || !editingMat) return;
  const dataUrl = await edExport();
  const texts = edCanvas.getObjects().filter((o) => o.type === "i-text").map((o) => o.text).join(" ");
  const m = editingMat;
  const rec = { id: asNew ? uid() : m.id, hospitalId: getCurrentHospital().id, typeKey: m.typeKey, typeName: m.typeName, w: m.w, h: m.h, ratio: m.ratio, copy: texts || m.copy || "", styleName: m.styleName || "", dataUrl, createdAt: Date.now() };
  try { await saveImageToServer(rec); alert(asNew ? "已另存为新素材 ✓" : "已覆盖原图 ✓"); renderEdit(); }
  catch (e) { alert("保存失败：" + e.message); }
}

async function edDownload() {
  if (!edCanvas || !editingMat) return;
  const dataUrl = await edExport();
  const o = getExportOpts();
  const { blob, ext } = await materialBlob(dataUrl, "hd");
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = materialFilename(editingMat, ext);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// 复制素材一份，并直接打开编辑（团单等做多版很方便）
window.editDuplicate = async (id) => {
  const h = getCurrentHospital(); if (!h) return;
  const newId = uid();
  try {
    const src = await IDB.get(id);
    if (!src) throw new Error("原图不存在");
    await IDB.put(Object.assign({}, src, { id: newId, createdAt: Date.now() }));
    if (src.dataUrl) _imgCache[newId] = src.dataUrl;
    if (src.thumb) _thumbCache[newId] = src.thumb;
    const m = (await listImagesFromServer(h.id)).find((x) => x.id === newId);
    if (m) openEditor(m);
  } catch (e) { alert("复制失败：" + e.message); }
};
