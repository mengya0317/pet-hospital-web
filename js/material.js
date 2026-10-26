// ② 医院素材库：LOGO 上传、品牌色提取与配色方案

function saveDataSafe(id, data) {
  try { saveData(id, data); return true; }
  catch (e) {
    alert("保存失败：本地存储空间不足。\n图片太大或医院太多会占满浏览器存储。\n建议：换更小的图片，或删掉不用的医院/素材。");
    return false;
  }
}

// 把上传的图片压缩成 dataURL
function compressImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片解码失败"));
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const isPng = /png/i.test(file.type);
        resolve(c.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderMaterial() {
  const h = getCurrentHospital();
  if (!h) { $("material_need_hospital").style.display = "block"; $("material_main").style.display = "none"; return; }
  $("material_need_hospital").style.display = "none";
  $("material_main").style.display = "block";

  const d = getData(h.id);
  // LOGO
  setPreview("logo_preview", "logo_del", d.logo);
  // 品牌色
  const color = d.brandColor || "#1f8a8f";
  $("brand_color").value = color;
  $("brand_hex").value = color.toUpperCase();
  if (!d.palette) { const sc = buildSchemes(color, d.brandSecondary || null); d.paletteStyle = sc[0].key; d.palette = sc[0].palette; saveDataSafe(h.id, d); }
  renderPaletteStyles();
  renderPalette(d.palette);
}

function setPreview(previewId, delId, dataUrl) {
  const box = $(previewId);
  if (dataUrl) {
    box.className = "img-preview";
    box.innerHTML = `<img src="${dataUrl}" alt="预览" />`;
    $(delId).style.display = "inline-block";
  } else {
    box.className = "img-preview empty";
    box.textContent = "未上传";
    $(delId).style.display = "none";
  }
}

// 上传 LOGO：压缩 → 自动取色 → 生成配色 → 保存
async function handleLogoUpload() {
  const h = getCurrentHospital(); if (!h) return;
  const file = $("logo_file").files[0]; if (!file) return;
  const box = $("logo_preview");
  box.className = "img-preview"; box.textContent = "处理中…";
  try {
    const url = await compressImage(file, 500);
    const stored = await uploadAsset(url);   // 落盘成文件，localStorage 只存 URL
    const d = getData(h.id);
    d.logo = stored;
    // 自动从 LOGO 取色（用内存里的 dataURL，省一次请求）
    const colors = await extractLogoColors(url);
    if (colors && colors.primary) {
      d.brandColor = colors.primary;
      d.brandSecondary = colors.secondary || null;   // null 表示 LOGO 只有一个色
      // 默认套用第一种风格
      const schemes = buildSchemes(d.brandColor, d.brandSecondary);
      d.paletteStyle = schemes[0].key;
      d.palette = schemes[0].palette;
    }
    if (saveDataSafe(h.id, d)) { setPreview("logo_preview", "logo_del", url); renderMaterial(); }
  } catch (e) { alert("上传失败：" + e.message); setPreview("logo_preview", "logo_del", getData(h.id).logo); }
  finally { $("logo_file").value = ""; }
}

function deleteImage(field, previewId, delId) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); delete d[field];
  if (saveDataSafe(h.id, d)) setPreview(previewId, delId, null);
}

// 从 LOGO 像素中提取主色与辅色（忽略透明/白/黑/灰）
function extractLogoColors(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = 64;
      const c = document.createElement("canvas"); c.width = S; c.height = S;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, S, S);
      let data;
      try { data = ctx.getImageData(0, 0, S, S).data; } catch (e) { resolve(null); return; }
      const map = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max > 238 && min > 238) continue;           // 近白
        if (max < 20) continue;                          // 近黑
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat < 0.15) continue;                        // 太灰
        const key = (Math.round(r / 24) * 24) + "," + (Math.round(g / 24) * 24) + "," + (Math.round(b / 24) * 24);
        map[key] = (map[key] || 0) + 1;
      }
      const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k]) => k.split(",").map(Number));
      if (!sorted.length) { resolve(null); return; }
      const primary = sorted[0];
      const pHsl = rgbToHsl(primary[0], primary[1], primary[2]);
      let secondary = null;
      for (let k = 1; k < sorted.length; k++) {
        const hsl = rgbToHsl(sorted[k][0], sorted[k][1], sorted[k][2]);
        let dh = Math.abs(hsl.h - pHsl.h); if (dh > 180) dh = 360 - dh;
        if (dh > 25) { secondary = sorted[k]; break; }
      }
      resolve({
        primary: rgbToHex(primary[0], primary[1], primary[2]).toUpperCase(),
        secondary: secondary ? rgbToHex(secondary[0], secondary[1], secondary[2]).toUpperCase() : null,
      });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ---- 配色方案生成 ----
function hexToRgb(hex) {
  hex = (hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    switch (max) { case r: h = (g - b) / dd + (g < b ? 6 : 0); break; case g: h = (b - r) / dd + 2; break; default: h = (r - g) / dd + 4; }
    h /= 6;
  }
  return { h: h * 360, s, l };
}
function hslToHex(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  return rgbToHex(r * 255, g * 255, b * 255);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 3 种风格：各自决定「强调色 / 文字色 / 浅底色」（主色、辅色锁定不动）
// 设计依据：60-30-10 法则（强调色少量点睛）+ Tailwind/Material 风格的「精致中性色」
// —— 文字色/底色都是低饱和近中性，仅带极淡主色相；颜色感由强调色承担
const PALETTE_STYLES = [
  {
    key: "fresh", name: "清新自然", desc: "邻近色和谐 · 柔和亲切",
    build: (h, s) => ({
      // 邻近色(+38°)做强调：与主色相邻、低对比、清爽
      accent: hslToHex((h + 38) % 360, clamp(s, 0.45, 0.7), 0.56),
      // 冷中性深字（极淡主色相，近 slate-800）
      textDark: hslToHex(h, 0.10, 0.18),
      // 极浅冷白底（近 slate-50）
      bgSoft: hslToHex(h, 0.10, 0.975),
    }),
  },
  {
    key: "pro", name: "专业可信", desc: "互补色对比 · 沉稳高级",
    build: (h, s) => ({
      // 互补色(+180°)做强调，压低明度更显高级、可信
      accent: hslToHex((h + 180) % 360, clamp(s * 0.7, 0.4, 0.6), 0.46),
      // 深蓝灰墨字（近 slate-900）
      textDark: hslToHex(218, 0.32, 0.16),
      // 冷中性近白底（近 slate-50）
      bgSoft: hslToHex(214, 0.16, 0.975),
    }),
  },
  {
    key: "warm", name: "温暖活泼", desc: "暖色点缀 · 温馨有活力",
    build: (h, s) => ({
      // 暖橙做强调（固定暖色相），活力焦点
      accent: hslToHex(26, 0.9, 0.57),
      // 暖中性深字（近 stone-800）
      textDark: hslToHex(28, 0.12, 0.17),
      // 暖奶油底（近 stone-50）
      bgSoft: hslToHex(35, 0.30, 0.975),
    }),
  },
];

// 根据主色 + (锁定的)辅色，生成 3 套风格方案
function buildSchemes(primaryHex, fixedSecondaryHex) {
  const { r, g, b } = hexToRgb(primaryHex);
  const { h, s } = rgbToHsl(r, g, b);
  const secondary = (fixedSecondaryHex || hslToHex((h + 22) % 360, clamp(s * 0.85, 0.32, 0.7), 0.58)).toUpperCase();
  return PALETTE_STYLES.map((st) => {
    const ext = st.build(h, s);
    return {
      key: st.key, name: st.name, desc: st.desc,
      palette: {
        primary: primaryHex.toUpperCase(), secondary,
        accent: ext.accent.toUpperCase(), textDark: ext.textDark.toUpperCase(), bgSoft: ext.bgSoft.toUpperCase(),
      },
    };
  });
}

// 渲染 3 个风格选项
function renderPaletteStyles() {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id);
  const schemes = buildSchemes(d.brandColor || "#1f8a8f", d.brandSecondary || null);
  const box = $("palette_styles");
  box.innerHTML = schemes.map((sc) => {
    const selected = d.paletteStyle === sc.key;
    const chips = PALETTE_ORDER.map((k) => `<span class="mini-chip" style="background:${sc.palette[k]}" title="${PALETTE_LABELS[k]} ${sc.palette[k]}"></span>`).join("");
    return `<div class="style-card ${selected ? "selected" : ""}" data-key="${sc.key}">
        <div class="style-head"><span class="style-name">${sc.name}</span><span class="style-desc">${sc.desc}</span>${selected ? '<span class="style-pick">✓ 已选</span>' : ""}</div>
        <div class="mini-chips">${chips}</div>
      </div>`;
  }).join("");
  box.querySelectorAll(".style-card").forEach((c) => c.addEventListener("click", () => selectPaletteStyle(c.dataset.key)));
}

function selectPaletteStyle(key) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id);
  const schemes = buildSchemes(d.brandColor || "#1f8a8f", d.brandSecondary || null);
  const sc = schemes.find((x) => x.key === key); if (!sc) return;
  d.paletteStyle = key;
  d.palette = sc.palette;
  saveDataSafe(h.id, d);
  renderPaletteStyles();
  renderPalette(d.palette);
}
const PALETTE_LABELS = { primary: "主色", secondary: "辅助色", accent: "强调色", textDark: "文字色", bgSoft: "浅底色" };
const PALETTE_ORDER = ["primary", "secondary", "accent", "textDark", "bgSoft"];
function renderPalette(palette) {
  const box = $("palette");
  box.innerHTML = PALETTE_ORDER.map((k) => `
    <div class="swatch">
      <label class="chip-label" style="background:${palette[k]}">
        <input type="color" class="chip-input" data-key="${k}" value="${palette[k]}" title="点击修改${PALETTE_LABELS[k]}" />
      </label>
      <div class="meta">
        <div class="sw-name">${PALETTE_LABELS[k]}</div>
        <input type="text" class="sw-hex-input" data-key="${k}" value="${palette[k]}" />
      </div>
    </div>`).join("");
  // 绑定单色编辑
  box.querySelectorAll(".chip-input").forEach((inp) =>
    inp.addEventListener("input", (e) => updatePaletteColor(e.target.dataset.key, e.target.value)));
  box.querySelectorAll(".sw-hex-input").forEach((inp) => {
    const commit = (e) => updatePaletteColor(e.target.dataset.key, e.target.value);
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(e); });
  });
}

// 单独修改某个色块（不影响其他色）
function updatePaletteColor(key, hex) {
  const h = getCurrentHospital(); if (!h) return;
  hex = (hex || "").trim(); if (!hex.startsWith("#")) hex = "#" + hex;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { alert("请输入合法的颜色（如 #1F8A8F）"); renderMaterial(); return; }
  hex = hex.toUpperCase();
  const d = getData(h.id);
  if (!d.palette) { const sc = buildSchemes(d.brandColor || "#1f8a8f", d.brandSecondary || null); d.palette = sc[0].palette; }
  d.palette[key] = hex;
  if (key === "primary") { d.brandColor = hex; $("brand_color").value = hex; $("brand_hex").value = hex; }
  saveDataSafe(h.id, d);
  renderPalette(d.palette);
}
// 改主色 → 按当前风格重算整套（辅色若来自 LOGO 仍锁定）
function applyBrandColor(hex) {
  const h = getCurrentHospital(); if (!h) return;
  hex = (hex || "").trim();
  if (!hex.startsWith("#")) hex = "#" + hex;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { alert("请输入合法的颜色（如 #1F8A8F）"); return; }
  hex = hex.toUpperCase();
  const d = getData(h.id);
  d.brandColor = hex;
  const schemes = buildSchemes(hex, d.brandSecondary || null);
  const sc = schemes.find((x) => x.key === d.paletteStyle) || schemes[0];
  d.paletteStyle = sc.key; d.palette = sc.palette;
  saveDataSafe(h.id, d);
  $("brand_color").value = hex; $("brand_hex").value = hex;
  renderPaletteStyles();
  renderPalette(d.palette);
}
