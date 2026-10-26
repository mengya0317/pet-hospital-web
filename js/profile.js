// ③ 医院简介文案：分项填写、AI 优化、文案池

// 引导填写的方面（顺序与美团轮播图方向对应）
const ASPECTS = [
  { key: "summary",    label: "医院简介",   ph: "整体定位、成立年限、规模、资质荣誉…" },
  { key: "team",       label: "团队简介",   ph: "医生数量、学历职称、擅长方向、从业年限…" },
  { key: "equipment",  label: "设备简介",   ph: "核心医疗设备，如 DR、彩超、血气生化、麻醉监护、ICU…" },
  { key: "dept",       label: "科室简介",   ph: "科室设置，如内科/外科/影像/口腔/皮肤/眼科…" },
  { key: "service",    label: "服务项目",   ph: "门诊、24h 急诊、手术、寄养、洗护、疫苗、体检…" },
  { key: "specialty",  label: "专科特色",   ph: "最擅长/招牌项目，如猫专科、骨科、心脏、眼科…" },
  { key: "philosophy", label: "理念介绍",   ph: "服务理念、对待宠物与主人的态度…" },
];
const LABEL_OF = {}; ASPECTS.forEach((x) => (LABEL_OF[x.key] = x.label));

let lastOptimizedMap = null;  // 解析成功的逐项结果 {方面名: 文案}
let lastOptimizedText = "";   // 解析失败时的原始文本兜底

function renderProfile() {
  const h = getCurrentHospital();
  if (!h) { $("profile_need_hospital").style.display = "block"; $("profile_main").style.display = "none"; return; }
  $("profile_need_hospital").style.display = "none";
  $("profile_main").style.display = "block";

  renderAspectFields();

  const d = getData(h.id);
  if (d.optimizedAspects) { lastOptimizedMap = d.optimizedAspects; renderOptimizeOut(d.optimizedAspects); $("btn_adopt").style.display = "block"; }
  else { lastOptimizedMap = null; $("optimize_out").className = "out"; $("optimize_out").textContent = "点击上方「AI 优化全部」后，这里逐项显示优化结果。"; $("btn_adopt").style.display = "none"; }
  renderCopyPool();
}

// 渲染分方面输入框（随填随存）
function renderAspectFields() {
  const h = getCurrentHospital(); if (!h) return;
  const a = getData(h.id).aspects || {};
  $("aspect_fields").innerHTML = ASPECTS.map((x) =>
    `<label>${x.label}</label>
     <textarea class="aspect-input" data-key="${x.key}" rows="2" placeholder="${x.ph}">${esc(a[x.key] || "")}</textarea>`
  ).join("");
  document.querySelectorAll(".aspect-input").forEach((t) => t.addEventListener("input", saveAspects));
}

function saveAspects() {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); d.aspects = {};
  document.querySelectorAll(".aspect-input").forEach((t) => { d.aspects[t.dataset.key] = t.value.trim(); });
  saveData(h.id, d);
}

function parseJSONLoose(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch (e) { return null; }
}

function renderOptimizeOut(map) {
  const out = $("optimize_out"); out.className = "out";
  out.innerHTML = Object.entries(map)
    .filter(([k, v]) => v && String(v).trim())
    .map(([k, v]) => `<div style="margin-bottom:10px;"><b>${esc(k)}：</b>${esc(String(v))}</div>`).join("");
}

async function optimizeProfile() {
  const h = getCurrentHospital(); if (!h) return;
  saveAspects();
  const filled = {};
  ASPECTS.forEach((x) => { const v = (getData(h.id).aspects || {})[x.key]; if (v) filled[x.label] = v; });
  if (Object.keys(filled).length === 0) { alert("请至少填写一个方面的内容"); return; }

  const out = $("optimize_out");
  out.className = "out loading"; out.textContent = "正在请求 DeepSeek 优化…";
  $("btn_optimize").disabled = true; $("btn_adopt").style.display = "none";
  try {
    const lines = Object.entries(filled).map(([label, v]) => `【${label}】${v}`).join("\n");
    const reply = await chat([
      { role: "system", content: '你是美团点评平台的宠物医院营销文案专家，文案面向宠物主人（潜在客户），并且会被放置到店铺图片设计上，所以必须精炼、有吸引力、卖点突出，字数不能多。请：1) 把每个给出的方面润色成约50字（40~60字）的营销短文案：站在打动客户、建立信任、突出优势的角度去写，语言简洁有力、温暖可信，避免冗长的场景描写和华丽堆砌，不要编造虚假数字、资质或疗效承诺。2) 额外生成一条"综合简介"（约100字），适合放在店铺首页。严格只输出一个 JSON 对象：键用中文方面名（与输入的方面名完全一致），并额外包含键"综合简介"；值都是字符串。不要输出 JSON 以外的任何文字，不要用 markdown 代码块。' },
      { role: "user", content: lines },
    ], 0.7);
    const parsed = parseJSONLoose(reply);
    if (!parsed) {
      lastOptimizedMap = null; lastOptimizedText = reply.trim();
      out.className = "out"; out.textContent = lastOptimizedText;
      $("btn_adopt").style.display = "block";
      return;
    }
    lastOptimizedMap = parsed;
    const d = getData(h.id); d.optimizedAspects = parsed; d.profileOptimized = parsed["综合简介"] || ""; saveData(h.id, d);
    renderOptimizeOut(parsed);
    $("btn_adopt").style.display = "block";
  } catch (e) {
    out.className = "out error"; out.textContent = "❌ 优化失败：\n" + e.message;
  } finally {
    $("btn_optimize").disabled = false;
  }
}

function adoptOptimized() {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id); d.copyPool = d.copyPool || [];
  if (lastOptimizedMap) {
    Object.entries(lastOptimizedMap).forEach(([k, v]) => {
      if (v && String(v).trim()) d.copyPool.unshift({ id: uid(), tag: k, text: String(v).trim() });
    });
    d.profileOptimized = lastOptimizedMap["综合简介"] || d.profileOptimized;
  } else if (lastOptimizedText) {
    d.copyPool.unshift({ id: uid(), text: lastOptimizedText.trim() });
  } else { return; }
  saveData(h.id, d);
  renderCopyPool();
  flash($("btn_adopt"), "已全部存入文案池 ✓");
}

function addCopy() {
  const h = getCurrentHospital(); if (!h) return;
  const text = $("new_copy_text").value.trim();
  if (!text) return;
  const d = getData(h.id);
  d.copyPool = d.copyPool || [];
  d.copyPool.unshift({ id: uid(), text });
  saveData(h.id, d);
  $("new_copy_text").value = "";
  renderCopyPool();
}
function deleteCopy(cid) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id);
  d.copyPool = (d.copyPool || []).filter((c) => c.id !== cid);
  saveData(h.id, d);
  renderCopyPool();
}
function editCopy(cid) {
  const h = getCurrentHospital(); if (!h) return;
  const d = getData(h.id);
  const item = (d.copyPool || []).find((c) => c.id === cid); if (!item) return;
  const next = prompt("编辑文案：", item.text);
  if (next === null) return;
  item.text = next.trim();
  saveData(h.id, d);
  renderCopyPool();
}
function renderCopyPool() {
  const h = getCurrentHospital(); if (!h) return;
  const box = $("copy_pool");
  const pool = getData(h.id).copyPool || [];
  if (!pool.length) { box.innerHTML = '<div class="hint">（文案池为空）</div>'; return; }
  box.innerHTML = pool.map((c) => `
    <div class="copy-item">
      <div class="copy-text">${c.tag ? `<span class="copy-tag">${esc(c.tag)}</span>` : ""}${esc(c.text)}</div>
      <div class="copy-actions">
        <button class="btn btn-test btn-mini" onclick="editCopy('${c.id}')">编辑</button>
        <button class="btn btn-danger btn-mini" onclick="deleteCopy('${c.id}')">删除</button>
      </div>
    </div>`).join("");
}
