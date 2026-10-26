// 图片文件：成品图/缩略图/上传素材在服务端的存取、下载导出、老数据迁移

// ---- IndexedDB：存放生成的素材图（容量远大于 localStorage）----
const IDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("petvet_db", 2);
      r.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("materials")) {
          const os = db.createObjectStore("materials", { keyPath: "id" });
          os.createIndex("hospitalId", "hospitalId", { unique: false });
        }
        if (!db.objectStoreNames.contains("fonts")) {
          db.createObjectStore("fonts", { keyPath: "name" });
        }
      };
      r.onsuccess = (e) => { this._db = e.target.result; res(this._db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(rec) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("materials", "readwrite"); tx.objectStore("materials").put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  },
  async delete(id) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("materials", "readwrite"); tx.objectStore("materials").delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  },
  async listByHospital(hid) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("materials", "readonly"); const req = tx.objectStore("materials").index("hospitalId").getAll(hid); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("materials", "readonly"); const req = tx.objectStore("materials").get(id); req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); });
  },
  async patch(id, partial) {
    const m = await this.get(id);
    if (!m) return null;
    const merged = Object.assign({}, m, partial);
    await this.put(merged);
    return merged;
  },
  async getAll() {
    const db = await this.open();
    return new Promise((res) => { const tx = db.transaction("materials", "readonly"); const req = tx.objectStore("materials").getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => res([]); });
  },
  async putFont(font) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("fonts", "readwrite"); tx.objectStore("fonts").put(font); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  },
  async listFonts() {
    const db = await this.open();
    return new Promise((res) => { const tx = db.transaction("fonts", "readonly"); const req = tx.objectStore("fonts").getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => res([]); });
  },
};

// ---- 成品图存到 IndexedDB（网页版没有服务端文件，存浏览器本地；原图以 base64 存进 materials 表）----
// 内存缓存：id -> dataUrl / thumb，让 imageFileUrl/thumbUrl 能同步返回（页面刷新后由 listImagesFromServer 填充）
const _imgCache = {};
const _thumbCache = {};

async function saveImageToServer(rec) {
  // 顺手做一张小缩略图一起存：素材库列表只加载缩略图，原图只在放大/下载/编辑时才用
  let thumb = rec.thumb || "";
  if (rec.dataUrl && !thumb) { try { thumb = await makeThumb(rec.dataUrl); } catch (e) { /* 做不出来就不带，列表会自动补 */ } }
  const full = Object.assign({}, rec, { thumb });
  await IDB.put(full);
  if (full.dataUrl) _imgCache[rec.id] = full.dataUrl;
  if (full.thumb) _thumbCache[rec.id] = full.thumb;
  return full;
}
async function listImagesFromServer(hospitalId) {
  try {
    const all = await IDB.getAll();
    const list = all.filter((m) => m.hospitalId === hospitalId);
    list.forEach((m) => { if (m.dataUrl) _imgCache[m.id] = m.dataUrl; if (m.thumb) _thumbCache[m.id] = m.thumb; });
    return list;
  } catch (e) { return []; }
}
async function deleteImageFromServer(id) {
  await IDB.delete(id);
  delete _imgCache[id]; delete _thumbCache[id];
}
function imageFileUrl(id) { return _imgCache[id] || ""; }
function thumbUrl(id) { return _thumbCache[id] || _imgCache[id] || ""; }

// ---- 缩略图 ----
const THUMB_SIDE = 480;
async function makeThumb(src) {
  const im = await loadImg(src);
  const sc = Math.min(1, THUMB_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);   // JPEG 没有透明，先铺白底
  x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
// 老图还没有缩略图：先显示原图，再在后台补一张（同时最多补 2 张，别抢生图的带宽）
const _thumbQueue = [], _thumbDoing = new Set(); let _thumbActive = 0;
function queueThumb(id) {
  if (_thumbDoing.has(id)) return;
  _thumbDoing.add(id); _thumbQueue.push(id); pumpThumbs();
}
function pumpThumbs() {
  while (_thumbActive < 2 && _thumbQueue.length) {
    const id = _thumbQueue.shift(); _thumbActive++;
    makeThumb(imageFileUrl(id))
      .then(async (dataUrl) => {
        _thumbCache[id] = dataUrl;
        const m = await IDB.get(id); if (m) await IDB.put(Object.assign({}, m, { thumb: dataUrl }));
      })
      .catch(() => {})
      .finally(() => { _thumbActive--; pumpThumbs(); });
  }
}

// ---- 上传的参考图/LOGO（网页版没有服务端文件：直接以 dataUrl 存 localStorage，asset 数量少、5MB 内够用）----
function isDataUrl(s) { return typeof s === "string" && s.startsWith("data:"); }
async function uploadAsset(dataUrl) {
  return dataUrl;   // 原样返回（本就是 dataUrl，直接存 localStorage）
}
// URL → dataURL（生成时要把参考图变成 base64 发给外部图像接口）
async function assetToDataUrl(u) {
  if (isDataUrl(u)) return u;
  const blob = await fetch(u).then((r) => r.blob());
  return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("读取参考图失败")); fr.readAsDataURL(blob); });
}

// 网页版无服务端，以下两个「迁移到服务端」的函数不再需要，直接跳过
async function migrateImagesToServer() {}
async function migrateAssetsToServer() {}

async function downloadToDataUrl(url) {
  const resp = await fetch(workerBase() + "/download?url=" + encodeURIComponent(url));
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || !data.dataUrl) throw new Error((data && data.error) || "下载图片失败");
  return data.dataUrl;
}

// ---- 导出选项（清晰度/命名前后缀，存本地）----
function getExportOpts() { return readJSON("petvet_export_v1", { clarity: "hd", prefix: "", suffix: "" }); }
function setExportOpts(o) { writeJSON("petvet_export_v1", o); }
// dataUrl → Blob（网页版图片以 dataUrl 存储，导出/下载时转成文件）
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
// 按清晰度得到下载用的 blob：高清=原 PNG；标清=JPEG 压缩（文件更小）
async function materialBlob(src, clarity) {
  if (clarity !== "sd") return { blob: isDataUrl(src) ? dataUrlToBlob(src) : await fetch(src).then((r) => r.blob()), ext: "png" };
  const img = await loadImg(src);
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.72));
  return { blob, ext: "jpg" };
}
function materialFilename(m, ext) {
  const h = getCurrentHospital(); const o = getExportOpts();
  return `${o.prefix || ""}${h ? h.name : "素材"}_${typeLabel(m)}_${m.w}x${m.h}${o.suffix || ""}.${ext}`;
}

async function downloadMaterial(id) {
  const h = getCurrentHospital();
  const m = (await listImagesFromServer(h ? h.id : "")).find((x) => x.id === id);
  if (!m) return;
  const o = getExportOpts();
  const { blob, ext } = await materialBlob(imageFileUrl(id), "hd");
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = materialFilename(m, ext);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function deleteMaterial(id) {
  if (!confirm("确定删除这张素材吗？")) return;
  try { await deleteImageFromServer(id); renderGallery(); if ($("edit_main") && $("edit_main").style.display !== "none") renderEditGallery(); }
  catch (e) { alert("删除失败：" + e.message); }
}
window.downloadMaterial = downloadMaterial;
window.deleteMaterial = deleteMaterial;
