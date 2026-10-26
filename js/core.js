// 基础：通用小工具、浏览器本地存储（localStorage）、医院数据与服务端 state.json 的同步

// ===== 宠物医院视觉设计工具 · 前端逻辑（阶段 1）=====

function $(id) { return document.getElementById(id); }
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const CONFIG_KEY = "petvet_config_v1";       // 接口配置
const HOSPITALS_KEY = "petvet_hospitals_v1"; // 医院列表
const CURRENT_KEY = "petvet_current_v1";     // 当前选中的医院 id
const dataKey = (id) => "petvet_data_" + id; // 每家医院的数据

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch (e) { return fallback; }
}
function writeJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// 医院
function getHospitals() { return readJSON(HOSPITALS_KEY, []); }
function saveHospitals(list) { writeJSON(HOSPITALS_KEY, list); scheduleSync(); }
function getCurrentId() { return localStorage.getItem(CURRENT_KEY) || ""; }
function setCurrentId(id) { localStorage.setItem(CURRENT_KEY, id); scheduleSync(); }
function getCurrentHospital() { return getHospitals().find((h) => h.id === getCurrentId()) || null; }

// 单家医院数据：{ profileRaw, profileOptimized, copyPool:[{id,text}] }
function getData(id) { return readJSON(dataKey(id), { profileRaw: "", profileOptimized: "", copyPool: [] }); }
function saveData(id, data) { writeJSON(dataKey(id), data); scheduleSync(); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---- 数据持久化：存到服务端文件（换浏览器/网络/重启都不丢；不含 API Key）----
// ---- 模板参考图（全局共用，不分医院）：用户上传真实参考图，生成时直接喂给模型做图生图 ----
const TPLREF_KEY = "petvet_tplrefs_v1";
function getTplRefs() { return readJSON(TPLREF_KEY, {}); }
function setTplRef(k, url) { const m = getTplRefs(); if (url) m[k] = url; else delete m[k]; writeJSON(TPLREF_KEY, m); scheduleSync(); }
function tplRefOf(k) { return getTplRefs()[k] || ""; }
// 套图模板图上的「文字位」：按阅读顺序列出模板上每一处文字，keep=true 表示套图时保留不换
const TPLSLOT_KEY = "petvet_tplslots_v1";
function getAllSlots() { return readJSON(TPLSLOT_KEY, {}); }
function slotsOf(id) { return getAllSlots()[id] || null; }
// 模板画面里有没有动物："none" 没有 / "has" 有 / null 还没判断（和文字位存在同一份数据里，键名加 #pets）
function petsOf(id) { return getAllSlots()[id + "#pets"] || null; }
function setPets(id, v) { const m = getAllSlots(); if (v) m[id + "#pets"] = v; else delete m[id + "#pets"]; writeJSON(TPLSLOT_KEY, m); scheduleSync(); }
function setSlots(id, arr) { const m = getAllSlots(); if (arr) m[id] = arr; else delete m[id]; writeJSON(TPLSLOT_KEY, m); scheduleSync(); }

function collectState() {
  const hospitals = getHospitals();
  const data = {};
  hospitals.forEach((h) => { data[h.id] = getData(h.id); });
  return { v: 1, hospitals, current: getCurrentId(), data, tplRefs: getTplRefs(), tplSlots: getAllSlots(), myTpls: getMyTpls(), styleRefs2: getStyleRefs2() };
}
function applyState(state) {
  if (!state || !Array.isArray(state.hospitals) || !state.hospitals.length) return false;
  localStorage.setItem(HOSPITALS_KEY, JSON.stringify(state.hospitals));
  if (state.current) localStorage.setItem(CURRENT_KEY, state.current);
  Object.keys(state.data || {}).forEach((id) => localStorage.setItem(dataKey(id), JSON.stringify(state.data[id])));
  if (state.tplRefs) localStorage.setItem(TPLREF_KEY, JSON.stringify(state.tplRefs));
  if (state.myTpls) localStorage.setItem(MYTPL_KEY, JSON.stringify(state.myTpls));
  if (state.tplSlots) localStorage.setItem(TPLSLOT_KEY, JSON.stringify(state.tplSlots));
  if (state.styleRefs2) localStorage.setItem(STYLEREF_KEY, JSON.stringify(state.styleRefs2));
  return true;
}
let _syncTimer = null;
function scheduleSync() { clearTimeout(_syncTimer); _syncTimer = setTimeout(syncToServer, 600); }
async function syncToServer() { /* 网页版：医院数据本来就在 localStorage，无需同步到服务端 */ }
async function loadFromServer() { return false; /* 网页版：无服务端 state，直接返回 false（沿用 localStorage 数据） */ }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("图片加载失败")); i.src = src; }); }
