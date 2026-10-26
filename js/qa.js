// 出图后自动检查：用识图模型把刚生成的图"读"一遍，再由程序和这次的要求逐项核对。
//
// 判定原则——只有"有明确证据的错"才算没通过（可按设置自动重出），拿不准的只提醒：
//   没通过：用户给的字缺了、模板上该换的旧字还在、医院名明显不对、不该有动物却有、文字跑到会被裁掉的两侧、不该有字却有字
//   需看一眼：疑似错字（差一两个字，识图本身也可能看错）、模板上该保留的字没读到、空白、乱码、识图没读出字
// 这样识图看走眼时不会白花钱重出，真错的又能自动修掉。

// ---------- 设置 ----------
function qaSettings() { const c = cfg(); return { on: c.qa_on, retry: c.qa_retry }; }
function qaReady() { return qaSettings().on && visionAttempts(cfg()).length > 0; }

// ---------- 文字比对 ----------
// 统一写法再比：全角转半角、去掉空格和标点（排版时换行、加空格、全半角不同都不算错）
function qaNorm(s) {
  return String(s || "")
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s　，。、！？：；“”‘’"'（）()【】\[\]《》<>·•・\-—–_~～\/\\|｜.,!?:;…+*×¥￥]/g, "");
}
// needle 最少改几个字才能在 hay 的某一段里出现；同时给出最像的那一段（用来提示"图上像是……"）
function qaBestMatch(needle, hay) {
  const n = needle.length, m = hay.length;
  if (!n) return { dist: 0, seen: "" };
  if (!m) return { dist: n, seen: "" };
  let prev = [], prevSt = [];
  for (let i = 0; i <= n; i++) { prev[i] = i; prevSt[i] = 0; }
  let best = { dist: n, start: 0, end: 0 };
  for (let j = 1; j <= m; j++) {
    const cur = [0], curSt = [j];   // 可以从 hay 的任何位置开始
    for (let i = 1; i <= n; i++) {
      let v = prev[i - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1), st = prevSt[i - 1];
      if (prev[i] + 1 < v) { v = prev[i] + 1; st = prevSt[i]; }          // 图上多了一个字
      if (cur[i - 1] + 1 < v) { v = cur[i - 1] + 1; st = curSt[i - 1]; } // 图上少了一个字
      cur[i] = v; curSt[i] = st;
    }
    // 一样接近时，取长度和要找的字最接近的那段（提示"图上像是「6连」"比"「6」"有用）
    const diff = Math.abs(j - curSt[n] - n);
    if (cur[n] < best.dist || (cur[n] === best.dist && diff < Math.abs(best.end - best.start - n))) best = { dist: cur[n], start: curSt[n], end: j };
    prev = cur; prevSt = curSt;
  }
  return { dist: best.dist, seen: hay.slice(best.start, best.end) };
}
// 差几个字以内算"疑似错字"而不是"缺字"：4 个字差 1 个、8 个字差 2 个……
function qaTolerance(n) { return Math.max(1, Math.floor(n / 4)); }
function qaShort(s) { s = String(s || ""); return s.length > 16 ? s.slice(0, 16) + "…" : s; }

// ---------- 这张图该检查什么（和 buildPrompt 的分支一一对应）----------
function qaLines(copy, byBar) { return String(copy || "").split(byBar ? /\n|[｜|]/ : /\n/).map((x) => x.trim()).filter(Boolean); }
// p: { type, copy, stage, logoDesign, slots, pets, styleVal, hospitalName }
function qaSpecFor(p) {
  const type = p.type;
  // 本地合成的 LOGO 图/横幅不用查；详情长图字太多、本来就允许概括，逐字核对不现实
  if (!type || type.logoCanvas || type.nameLogoCanvas || type.key === "groupdetail") return null;
  const spec = { expect: [], soft: [], forbid: [], name: p.logoDesign ? (p.hospitalName || "") : "", noText: false, noAnimals: false, square: 0 };
  // 美团列表会把图裁成中间的正方形：记下左右各要裁掉的比例（团单图的提示词里要求过主体放在正方形里）
  const square = usesTemplate(type) && type.w > type.h ? Math.round((type.w - type.h) / 2 / type.w * 1000) / 1000 : 0;
  if (p.stage === "fill") {
    const allLines = qaLines(p.copy, false), lines = allLines.filter((x) => !isDelMark(x));
    const { slots, oldNames } = fillSlotsFor(p.slots || null, p.logoDesign, p.hospitalName);
    spec.expect = lines;
    if (slots && slots.length) {
      const mp = mapToSlots(slots, allLines);
      spec.soft = mp.keep.map((x) => x.t);   // 模板上"原样保留"的字是当初识图读出来的，未必一字不差，只作提醒
      spec.forbid = mp.pairs.map((x) => x.from).concat(mp.removed.map((x) => x.t), oldNames);
      // 旧字该换成什么（局部修字用）：别家院名换成本院名，被删掉的文字位没有对应
      spec.pairs = mp.pairs.map((x) => ({ from: x.from, to: x.to })).concat(p.logoDesign ? oldNames.map((x) => ({ from: x, to: p.hospitalName })) : []);
    }
    if (usesTemplate(type)) { spec.square = square; spec.noAnimals = p.pets === "none"; }
  } else if (type.forceNoText) {
    spec.noText = true;   // 诊疗案例底版：纯视觉背景，不该有字
  } else if (usesTemplate(type)) {
    const tplKey = DESIGN_STYLE_PROMPTS[p.styleVal] ? null : p.styleVal;
    const tpl = tplKey ? allTplEntries()[tplKey] : null;
    // 内置模板还没传参考图时，提示词让它照抄模板描述里「」中的字；其余情况写用户给的文字
    spec.expect = tpl && !tplRefOf(tplKey) && tpl.prompt ? [...tpl.prompt.matchAll(/「([^」]+)」/g)].map((m) => m[1]) : qaLines(p.copy, true);
    spec.square = square;
  } else {
    spec.expect = qaLines(p.copy, true);
  }
  // 很长的句子模型常会自己断行、概括，只作提醒
  spec.soft = spec.soft.concat(spec.expect.filter((t) => qaNorm(t).length > 24));
  spec.expect = spec.expect.filter((t) => qaNorm(t).length <= 24);
  // 旧字如果被新字包含（比如旧「常规体检」、新「常规体检8项」），图上出现它不算没换
  const want = spec.expect.concat(spec.soft, spec.name ? [spec.name] : []).map(qaNorm);
  spec.forbid = [...new Set(spec.forbid)].filter((t) => { const n = qaNorm(t); return n.length >= 2 && !want.some((w) => w.includes(n)); });
  const empty = !spec.expect.length && !spec.soft.length && !spec.forbid.length && !spec.name && !spec.noText && !spec.noAnimals && !spec.square;
  return empty ? null : spec;
}
// 老图重新检查：从记录里还原出当初的要求
function qaSpecFromRecord(m) {
  const type = findType(m.typeKey); if (!type) return null;
  const h = getCurrentHospital();
  const fill = m.stage === "fill";
  return qaSpecFor({ type, copy: fill ? (m.copy || "") : splitCopyReq(m.copy || "").copy, stage: fill ? "fill" : "", logoDesign: !!m.withLogo,
    slots: fill && m.srcId ? slotsOf(m.srcId) : null, pets: fill && m.srcId ? petsOf(m.srcId) : null,
    styleVal: m.tplKey || "", hospitalName: h ? h.name : "" });
}

// ---------- 让识图模型读图 ----------
// 发给识图模型的图：缩到 1280 以内；要查"出界"时画两条红色虚线标出会被裁掉的两侧
async function qaImage(src, spec) {
  const im = await loadImg(src);
  const sc = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * sc), h = Math.round(im.naturalHeight * sc);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
  if (spec.square) {
    x.strokeStyle = "#ff0000"; x.lineWidth = Math.max(2, Math.round(w / 400)); x.setLineDash([12, 8]);
    [spec.square * w, (1 - spec.square) * w].forEach((px) => { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, h); x.stroke(); });
  }
  return c.toDataURL("image/jpeg", 0.88);
}
// 不把"应该写什么"告诉识图模型——告诉了它容易顺着读成对的，查不出错字
function qaAsk(spec) {
  let q = `这是一张刚生成的宠物医院宣传图。请像质检员一样仔细看，只根据图上真实画出来的内容回答，不要猜测，也不要替它纠正。
1. texts：按阅读顺序（从上到下、从左到右）把图上每一处文字原样照抄，一处一条（LOGO 里的字也算）。看不清或笔画错乱的字用 □ 代替，不要自动改成你认为正确的字。
2. animals：画面里有没有猫、狗、兔等动物（照片、插画、卡通、剪影都算；爪印图案、LOGO 里的小图形不算）？没有写"无"，有就写是什么。
3. garbled：有没有乱码、笔画错误、明显不是正常汉字的字？没有写"无"，有就写在哪里。
4. blank：画面主体里有没有明显的大片空白，或者空着没写字的胶囊、色块、标签？没有写"无"，有就简单说位置。`;
  if (spec.square) q += `
5. outside：图上有两条红色竖虚线（这是我加的标记，不属于画面），虚线外侧最左边和最右边的两条区域在平台列表里会被裁掉。这两条区域里有没有文字（哪怕只露出一部分）？有没有动物的头或身体？都没有写"无"，有就说清是什么。`;
  q += `
只输出 JSON，不要任何解释：{"texts":["…"],"animals":"无","garbled":"无","blank":"无"${spec.square ? ',"outside":"无"' : ""}}`;
  return q;
}
function parseQaReply(raw) {
  const o = String(raw).match(/\{[\s\S]*\}/);
  if (!o) return null;
  try {
    const j = JSON.parse(o[0]);
    if (!Array.isArray(j.texts)) return null;
    const txt = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v == null ? "" : v));
    return { texts: j.texts.map((t) => (t && typeof t === "object" ? String(t.text || "") : String(t))).filter((t) => t.trim()),
      animals: txt(j.animals), garbled: txt(j.garbled), blank: txt(j.blank), outside: txt(j.outside) };
  } catch (e) { return null; }
}
// 识图模型说"没有"：开头是 无/没有/none/no，而且后面没接"有文字/有猫"之类
function qaNone(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return true;
  return /^(无|没有|none|no\b|否|null)/i.test(s) && !/有(文字|字|动物|猫|狗|兔)/.test(s.slice(1));
}

// ---------- 核对 ----------
function qaEvaluate(spec, r) {
  const issues = [];
  const add = (lv, msg, fix, kind, extra) => issues.push(Object.assign({ lv, msg, fix, kind }, extra));
  const hay = qaNorm(r.texts.join(""));
  if (spec.noText) {
    if (hay.length >= 2) add("err", `这张图不该有文字，图上却有「${qaShort(r.texts.join(" "))}」`, "画面上不能出现任何文字、数字或字母", "notext");
  } else if (!hay && (spec.expect.length || spec.name)) {
    add("warn", "识图没读出任何文字，没法核对（可以点标记重新检查）", "", "unread");
  } else {
    const check = (want, strict, what) => {
      const n = qaNorm(want); if (n.length < 2) return;
      const { dist, seen } = qaBestMatch(n, hay);
      if (dist === 0) return;
      if (dist <= qaTolerance(n.length)) add("warn", `疑似错字：「${qaShort(want)}」图上像是「${seen}」`, `「${want}」要写对，不能写成「${seen}」`, "typo", { want, seen });
      else add(strict ? "err" : "warn", `${what}「${qaShort(want)}」没有出现在图上`, `「${want}」必须清楚地写在画面上，一字不差`, "missing", { want });
    };
    spec.expect.forEach((t) => check(t, true, "缺字："));
    spec.soft.forEach((t) => check(t, false, "没读到："));
    spec.forbid.forEach((t) => {
      if (!hay.includes(qaNorm(t))) return;
      const pair = (spec.pairs || []).find((x) => x.from === t);
      // 对应的新字已经在图上了，旧字就该整个去掉；新字没出现，就把旧字改成新字
      const to = pair && pair.to && !hay.includes(qaNorm(pair.to)) ? pair.to : "";
      add("err", `旧字没换：模板上的「${qaShort(t)}」还在`, `模板上的「${t}」必须换掉或删掉，不能再出现`, "leftover", { old: t, to });
    });
    if (spec.name) {
      const n = qaNorm(spec.name), { dist, seen } = qaBestMatch(n, hay);
      const fix = `医院名称必须写成「${spec.name}」，一字不差`;
      // 医院名常常字很小，识图没读到不一定是画错了：只有看到了别的院名才算没通过
      const otherName = r.texts.find((t) => /医院|诊所|医疗中心/.test(t) && !qaNorm(t).includes(n));
      if (dist > 0 && dist <= qaTolerance(n.length)) add("warn", `医院名疑似写错：应为「${spec.name}」，图上像是「${seen}」`, fix, "name", { want: spec.name, seen });
      else if (dist > 0 && otherName) add("err", `医院名不对：应为「${spec.name}」，图上是「${qaShort(otherName)}」`, fix, "name", { want: spec.name, seen: otherName });
      else if (dist > 0) add("warn", `没看到医院名「${spec.name}」（可能字太小没读出来）`, fix, "name-unseen");
    }
  }
  if (spec.noAnimals && !qaNone(r.animals)) add("err", `多了动物：${qaShort(r.animals)}`, "画面里不能出现任何动物（猫、狗、兔的照片、插画、卡通、剪影都不行）", "animal");
  if (spec.square && !qaNone(r.outside)) {
    if (/字|文|数字|字母|[「“"]/.test(r.outside)) add("err", `文字出界：${qaShort(r.outside)}（美团列表里会被裁掉）`, "所有文字都收进中间的正方形区域，左右两侧只放背景和装饰", "outside");
    else add("warn", `两侧有主体：${qaShort(r.outside)}（美团列表里会被裁掉一部分）`, "动物和主体都放在中间的正方形区域内", "outside");
  }
  if (!qaNone(r.garbled)) add("warn", `疑似乱码：${qaShort(r.garbled)}`, "所有文字必须是规范、笔画完整的简体中文，不能有乱码", "garbled");
  if (!spec.noText && !qaNone(r.blank)) add("warn", `可能有空白：${qaShort(r.blank)}`, "不要留大片空白，也不要留空着的胶囊或色块", "blank");
  const status = issues.some((x) => x.lv === "err") ? "fail" : (issues.length ? "warn" : "pass");
  return { status, issues, seen: r.texts.join(" / ").slice(0, 300) };
}

// 检查一张图。不会抛错：识图调不通时返回 status "error"，不影响出图
async function qaCheck(src, spec) {
  try {
    const img = await qaImage(src, spec);
    const { value, model, who } = await visionAsk(img, qaAsk(spec), parseQaReply);
    return Object.assign(qaEvaluate(spec, value), { model: `${who} ${model}`, at: Date.now(), spec });
  } catch (e) {
    return { status: "error", issues: [{ lv: "warn", msg: "没检查成功：" + String(e.message).split("\n")[0].slice(0, 60) }], at: Date.now(), spec };
  }
}
// 自动重出时追加在提示词后面：把上一版的问题逐条告诉生图模型
function qaFeedback(qa) {
  const fixes = [...new Set((qa.issues || []).map((x) => x.fix).filter(Boolean))];
  return "【上一版没通过检查，这次务必改正】\n" + fixes.map((f) => "· " + f).join("\n");
}
// 几版里挑问题最少的：先比"没通过"的条数，再比"需看一眼"的条数，一样就要后出的
function qaScore(qa) { if (!qa) return 0; const e = qa.issues.filter((x) => x.lv === "err").length; return e * 100 + (qa.issues.length - e); }
function qaPickBest(attempts) {
  return attempts.reduce((best, a) => (qaScore(a.qa) <= qaScore(best.qa) ? a : best));
}
function qaRecord(qa, tries) { return qa ? Object.assign({}, qa, { tries: tries || 1 }) : undefined; }

// ---------- 显示 ----------
function qaLogText(qa) {
  if (!qa) return "✅ 完成";
  const again = (qa.tries > 1 ? `（自动重出 ${qa.tries - 1} 次）` : "") + (qa.fixed ? "（局部修过字）" : "");
  const first = (lv) => (qa.issues.find((x) => x.lv === lv) || {}).msg || "";
  if (qa.status === "pass") return `✅ 完成 · 检查通过${again}`;
  if (qa.status === "warn") return `⚠️ 完成 · 需看一眼：${first("warn")}${again}`;
  if (qa.status === "fail") return `❌ 已生成，但没通过检查：${first("err")}${again}`;
  return `✅ 完成 · ${first("warn") || "没检查成功"}`;
}
const QA_LABEL = { pass: "✓ 已检查", warn: "! 看一眼", fail: "✕ 没通过", error: "? 没查成" };
function qaBadgeHtml(m) {
  const qa = m.qa;
  if (!qa) {
    return qaSpecFromRecord(m) ? `<button class="qa-badge qa-none" title="还没检查，点一下用识图模型检查（1 次识图调用）" onclick="event.stopPropagation(); showQa('${m.id}')">未检查</button>` : "";
  }
  const tip = qa.issues && qa.issues.length ? qa.issues.map((x) => x.msg).join("\n") : "文字、医院名、动物、出界都核对过了";
  return `<button class="qa-badge qa-${qa.status}" title="${esc(tip)}" onclick="event.stopPropagation(); showQa('${m.id}')">${QA_LABEL[qa.status] || "?"}</button>`;
}
// 点图上的检查标记：看详情，可以重新检查
async function showQa(id) {
  const h = getCurrentHospital(); if (!h) return;
  const m = (await listImagesFromServer(h.id)).find((x) => x.id === id); if (!m) return;
  const spec = (m.qa && m.qa.spec) || qaSpecFromRecord(m);
  if (!spec) { alert("这类图不需要检查。"); return; }
  let msg;
  if (m.qa) {
    const st = { pass: "通过", warn: "需要看一眼", fail: "没通过", error: "没检查成功" }[m.qa.status] || m.qa.status;
    msg = `检查结果：${st}${m.qa.tries > 1 ? `（自动重出 ${m.qa.tries - 1} 次）` : ""}\n`;
    msg += (m.qa.issues || []).map((x) => (x.lv === "err" ? "✕ " : "! ") + x.msg).join("\n") || "文字、医院名、动物、出界都核对过了，没发现问题。";
    if (m.qa.seen) msg += `\n\n识图读到的文字：${m.qa.seen}`;
    if (m.qa.model) msg += `\n（用 ${m.qa.model} 检查）`;
    // 只是字的问题：可以只重画出错的那几处
    if (fixReady() && qaFixable(m.qa)) {
      if (confirm(msg + "\n\n要只修改出错的这几处吗？\n（用 GPT Image 2.5 局部重画，约 1 次生图费用；其余画面保持不变，改完会自动再检查，没变好就保留原图）")) return fixExisting(m);
    }
    msg += "\n\n要重新检查一次吗？（1 次识图调用）";
  } else {
    msg = "这张图还没检查过。现在用识图模型检查一次吗？（1 次识图调用）";
  }
  if (!confirm(msg)) return;
  if (!visionAttempts(cfg()).length) { alert(NO_VISION_KEY_MSG); return; }
  const qa = qaRecord(await qaCheck(imageFileUrl(id), spec), m.qa ? m.qa.tries : 1);
  await IDB.patch(id, { qa });
  await renderGallery();
  if ($("edit_gallery")) renderEditGallery();
  alert("重新检查完成：\n" + (qa.issues.map((x) => (x.lv === "err" ? "✕ " : "! ") + x.msg).join("\n") || "没发现问题。"));
}

// 一次性整理：以前把"对这张图的要求"当成要写的字，检查报了"缺字"——这些提示去掉，状态重新算（不用再调识图）
async function migrateQaReqIssues() {
  let fixedCount = 0;
  try {
    const all = await IDB.getAll();
    for (const m of all) {
      if (!m.qa || !m.qa.issues || m.stage === "fill" || m.qa.reqFixed) continue;
      const req = splitCopyReq(m.copy || "").req;
      const isReq = (x) => {
        const t = x.want || ((x.msg || "").match(/^缺字：「(.+?)(…)?」没有出现在图上/) || [])[1];
        // 报的可能是整行（「要求：设备图大一点…」）或截短的开头，两个方向都比一下
        return t && req.some((r) => r.includes(t) || t.includes(r) || r.startsWith(t));
      };
      const keep = m.qa.issues.filter((x) => !isReq(x));
      const qa = Object.assign({}, m.qa, { issues: keep, reqFixed: true });
      if (keep.length !== m.qa.issues.length) {
        qa.status = keep.some((x) => x.lv === "err") ? "fail" : (keep.length ? "warn" : "pass");
        fixedCount++;
      }
      await IDB.patch(m.id, { qa });
    }
  } catch (e) { console.warn("[整理检查结果] 失败：", e); }
  return fixedCount;
}

// 素材库里已有的图：局部修字，变好了就替换原图（同一个 id），没变好原图不动
async function fixExisting(m) {
  const type = findType(m.typeKey); if (!type) return;
  const spec = qaSpecFromRecord(m) || m.qa.spec;
  const badges = document.querySelectorAll(`.qa-badge[onclick*="${m.id}"]`);
  badges.forEach((b) => { b.textContent = "修改中…"; b.disabled = true; });
  const fixed = await localFix(imageFileUrl(m.id), m.qa, spec, type.ratio, (t) => badges.forEach((b) => { b.title = t; }));
  if (fixed) {
    await saveImageToServer(Object.assign({}, m, { dataUrl: fixed.dataUrl, qa: qaRecord(fixed.qa, m.qa.tries || 1) }));
  }
  await renderGallery();
  if ($("edit_gallery")) renderEditGallery();
  alert(fixed ? "局部修改完成，已替换原图：\n" + (fixed.qa.issues.map((x) => (x.lv === "err" ? "✕ " : "! ") + x.msg).join("\n") || "再检查没发现问题。")
    : "这次没修成（没找准错字的位置，或者修完没有变好），原图保持不变。\n可以点「重新检查」确认问题，或者重新生成这张。");
}

// 生成按钮旁边的一行说明：让人知道开没开、会不会多花钱
function qaHintText() {
  const s = qaSettings();
  if (!s.on) return "出图后自动检查：已关闭（在「接口配置 → 识图模型」里可以打开）";
  if (!visionAttempts(cfg()).length) return "出图后自动检查：还没配识图模型的 Key，暂时跳过——到「接口配置 → 识图模型」填智谱 Key（免费）就能用";
  return `出图后自动检查：已开启，${s.retry ? `没通过的每张最多自动重出 ${s.retry} 次（重出也会产生生图费用）` : "没通过只标出来、不自动重出"}（点这里修改）`;
}
function renderQaHints() { document.querySelectorAll(".qa-hint").forEach((el) => { el.textContent = qaHintText(); }); }
// 批量生成前的确认框里补一句：自动重出也要花钱
function qaCostNote() {
  const s = qaSettings();
  return qaReady() && s.retry ? `\n\n已开启出图后自动检查：没通过的每张最多再自动重出 ${s.retry} 次，重出也会产生费用。` : "";
}
