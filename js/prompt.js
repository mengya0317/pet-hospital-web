// 提示词：按素材类型、风格/模板、LOGO、套图文字位拼出发给生图模型的提示词

// 画面文字 vs 对这张图的要求：大家常把要求顺手写在文字框里（"要求：设备图大一点""保持原图人像不变""不要加环境图"），
// 这些不能写到图上，也不能当成"缺字"去检查。能认出三种写法：
//   · 开头写了「要求：/备注：/注意：」
//   · 一整行是要求的说法（不要…、保持…不变、参考…图、…大一点、字…要大 等）
//   · 「文字大一点：18年老院」这种——冒号前是要求，冒号后才是要写到图上的字
const REQ_PREFIX = /^(要求|备注|注意|注|说明|提示|ps)\s*[:：]\s*/i;
const REQ_WORDS = /(不要|别加|别放|别用|不用加|不需要|保持.{0,12}不变|参考.{0,10}(图|风格)|大一点|小一点|加大|放大|缩小|加粗|醒目一点|字.{0,6}(要|也要)(大|小|粗)|去掉|删掉|换成|改成|风格|排版|布局|背景(要|干净|简洁|换)|居中|靠左|靠右)/;
function splitCopyReq(text) {
  const copy = [], req = [];
  String(text || "").split("\n").forEach((raw) => {
    const line = raw.trim(); if (!line) return;
    const pre = line.match(REQ_PREFIX);
    if (pre) { if (line.slice(pre[0].length).trim()) req.push(line.slice(pre[0].length).trim()); return; }
    const kv = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    if (kv && REQ_WORDS.test(kv[1])) { copy.push(kv[2].trim()); req.push(`「${kv[2].trim()}」${kv[1].trim()}`); return; }
    if (REQ_WORDS.test(line)) { req.push(line); return; }
    copy.push(line);
  });
  return { copy: copy.join("\n"), req };
}

// 套图文字里写「（删掉）」表示模板上这一处不要了（智能对位时某处没有合适内容就这么填，中间的也能删）
const DEL_MARK = "（删掉）";
function isDelMark(s) { return /^[（(]?删(掉|除)?[)）]?$/.test(String(s || "").trim()); }
// 一处文字位建议最多放几个字：原来的字数多给一点余量，太长会把胶囊、色块撑挤
function textLen(s) { return String(s || "").replace(/\s/g, "").length; }
function slotBudget(old) { const n = textLen(old); return Math.max(n + 2, Math.ceil(n * 1.5)); }

// 新文字按顺序对应模板上"替换"的文字位；少了删、多了照同类样式补；写「（删掉）」的那一处删掉
function mapToSlots(slots, lines) {
  const rep = slots.filter((x) => !x.keep), keep = slots.filter((x) => x.keep);
  const n = Math.min(rep.length, lines.length);
  const pairs = [], dropped = [];
  rep.slice(0, n).forEach((sl, i) => { if (isDelMark(lines[i])) dropped.push(sl); else pairs.push({ from: sl.t, kind: sl.kind, to: lines[i] }); });
  return {
    pairs, removed: dropped.concat(rep.slice(n)), added: lines.slice(n).filter((x) => !isDelMark(x)), keep,
    lastKind: rep.length ? rep[rep.length - 1] : null,
  };
}
// 套图 + 设计进 LOGO 时：模板上"保留"的文字里如果有别家医院的名字（比如上传的是别家的团单图当模板），
// 不能再原样保留，交给 LOGO/院名那一段去换成本院名称。返回 { slots: 去掉旧院名后的文字位, oldNames: 旧院名 }
function fillSlotsFor(slots, design, name) {
  if (!slots || !design) return { slots, oldNames: [] };
  const isOldName = (x) => x.keep && /医院|诊所|医疗中心/.test(x.t) && x.t.replace(/\s/g, "") !== String(name || "").replace(/\s/g, "");
  return { slots: slots.filter((x) => !isOldName(x)), oldNames: slots.filter(isOldName).map((x) => x.t) };
}
function slotFillInstruction(slots, lines) {
  const mp = mapToSlots(slots, lines);
  let q = `【文字改动·逐项照做】下面每一项都指模板图上的一处文字（用原文定位），在原位置换成新文字，沿用那一处原来的字体、字重、颜色、描边和底色胶囊／色块样式：\n`;
  q += mp.pairs.map((p, i) => `${i + 1}. 模板上的「${p.from}」${p.kind ? `（${p.kind}）` : ""} → 改成「${p.to}」`).join("\n");
  if (mp.removed.length) q += `\n【删除】模板上的${mp.removed.map((x) => `「${x.t}」`).join("")}这${mp.removed.length > 1 ? "几" : "一"}处，连同它们的底色胶囊或色块一起删掉；其余元素自然补位、适当放大，不要留下空胶囊或空白。`;
  if (mp.added.length) q += `\n【新增】在「${mp.lastKind ? mp.lastKind.t : "最后一处文字"}」同类元素的旁边或下方，按完全相同的样式再加${mp.added.map((x) => `「${x}」`).join("")}，排列整齐。`;
  if (mp.keep.length) q += `\n【原样保留】${mp.keep.map((x) => `「${x.t}」`).join("")}保持不变。`;
  q += `\n新文字比原文字长或短时，只在原位置调整字号或胶囊宽度，保证完整显示、不挤压其它元素。画面上除以上文字外不写任何字；所有新文字一字不差（规范简体中文，笔画完整，不得错字、漏字、繁体或乱码）。`;
  return q;
}

// 本院 LOGO + 医院名称"设计进画面"：LOGO 原图作为最后一张参考图发给 AI，院名直接给出，由 AI 自然融入版式
// 动物跟着模板走：模板没有就绝不画，有才画（并按文字内容换猫/狗）
const NO_EXTRA_PET_RULE = `【动物·跟参考图走】先看参考图里有没有猫、狗等动物：参考图里【没有】动物，新图也【绝对不要画任何动物】（照片、插画、卡通、剪影都不要，只用文字、色块和装饰完成画面）；参考图里有动物，才在相近位置画动物，写"狗狗/犬"只画狗、"猫咪/猫"只画猫。`;
function fillPetRule(pets) {
  if (pets === "none") return `【动物·严禁】模板图里没有任何动物，新图也【绝对不要出现任何动物】——猫、狗、兔等的照片、插画、卡通、剪影一律不要，不要因为是宠物医院就自己加。画面只有模板原有的文字、色块和装饰。`;
  if (pets === "has") return `【动物】模板里的动物保留在原来的位置、大小和画法；只在和新文字内容不符时换种类（写"狗狗/犬"只画狗、"猫咪/猫"只画猫、"犬猫"画猫和狗），不要增加动物数量。`;
  return `【动物·跟模板走】模板图里没有动物，新图就【绝对不要画任何动物】；模板里有动物，才保留在原位置（和新文字内容不符时换种类：写"狗狗/犬"只画狗、"猫咪/猫"只画猫），不要增加数量。`;
}
function designLogoInstruction(name, forFill, oldNames) {
  return forFill
    ? `【本院 LOGO 与医院名称】模板图上已经设计了本院 LOGO 和医院名称，新图沿用同样的位置、大小和处理方式。我提供的图片中【最后一张】是本院 LOGO 原图，照它原样还原（图形、颜色、比例不要改）；医院名称写「${name}」，一字不差。`
      + (oldNames && oldNames.length ? `模板上原来的医院名称${oldNames.map((x) => `「${x}」`).join("")}要换成「${name}」，不能保留。` : "")
    : `【本院 LOGO 与医院名称·设计进画面】请把本院 LOGO 和医院名称作为画面设计的一部分自然地放进去——位置和处理方式可以参考参考图上 LOGO 的做法（比如放在卡片顶部、标题上方），与整体版式融为一体。★不要为它单独加一条突兀的白色横条、底框或色块★。
· LOGO：我提供的图片中【最后一张】就是本院 LOGO 原图，照它原样还原——图形、颜色、比例都不要改，不要重新设计。
· 医院名称：「${name}」，一字不差，字体和颜色与画面风格协调，放在 LOGO 旁边。
· 参考图上原来那家医院的 LOGO 和店名不要照搬。`;
}
function groupLogoOn() {
  const h = getCurrentHospital(); if (!h) return false;
  const d = getData(h.id), c = d.genConfig || {};
  return !!d.logo && c.groupLogo !== false;
}

function buildPrompt(type, copy, extra, logo, hasRefs, hasStyleRefs, styleVal, stage) {
  const h = getCurrentHospital(); const d = getData(h.id);
  const styleName = (PALETTE_STYLES.find((s) => s.key === d.paletteStyle) || {}).name || "清新自然";
  styleVal = (styleVal || "").trim();
  const designStyle = DESIGN_STYLE_PROMPTS[styleVal] || styleVal || "简洁专业的现代设计，干净耐看、层次分明";
  const needWhitespace = /极简|留白/.test(styleVal);   // 极简/留白风允许保留干净留白，不强制铺满内容
  const pal = d.palette || {};
  // ── 批量套版：以一张满意的图为模板，只换文字，其余一切照搬（独立提示词，不复用通用指令）──
  if (stage === 'fill') {
    const allLines = (copy || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const lines = allLines.filter((x) => !isDelMark(x));   // 没有文字位对照时，「（删掉）」没有意义，直接去掉
    const { slots, oldNames } = fillSlotsFor((logo && logo.slots) || null, logo && logo.design, getCurrentHospital().name);
    const first = logo && logo.design ? "第一张图" : "图";
    let q;
    if (slots && slots.length) {
      q = `我提供的${first}是【模板图】（已确认满意的团单设计）。请输出同一套设计里的另一张团单图：除下面列出的文字改动外，模板上所有图形元素——背景、卡片、色块、胶囊、徽章、图标、装饰——的样式、位置和大小都保持不变，不要重新设计版式。

${slotFillInstruction(slots, allLines)}`;
    } else if (usesTemplate(type)) {
      q = `我提供的${first}是【模板图】（已确认满意的团单设计）。请输出同一套设计里的另一张团单图：模板上所有图形元素的样式、位置和大小保持不变，只把文字换成下面这组新文字——模板上的文字按阅读顺序依次换成新文字，每一处沿用原来的样式；新文字少就删掉多余的文字元素（连同底色胶囊）并自然补位，多了就照同类元素样式补上。模板上原来的文字不要残留。
${lines.map((t, i) => `  ${i + 1}. 「${t}」`).join("\n")}
画面上只写这些文字，一字不差（规范简体中文，笔画完整，不得错字、漏字、繁体或乱码）。`;
    } else {
      const list = lines.map((t, i) => `  ${i + 1}. 「${t}」`).join("\n");
      q = `我提供了一张【底版】（诊疗案例的背景模板）。请在它中间的文字区排入下面这组文字，其余背景和元素保持不变：
${list}
第 1 条为标题（最大），第 2 条为副标题，其余为说明；文字越少字号越大，版面居中饱满，不留大片空白。画面上只写这些文字，一字不差，不得错字乱码。`;
    }
    if (usesTemplate(type)) q += "\n\n" + fillPetRule(logo && logo.pets);
    if (usesTemplate(type)) q += "\n\n" + ((logo && logo.design) ? designLogoInstruction(getCurrentHospital().name, true, oldNames) : `模板图上没有医院 LOGO 就不要加；不要画任何水印。`);
    const sqf = squareSafeZone(type.w, type.h);
    if (sqf) q += "\n\n" + sqf;
    return q;
  }

  // ── 诊疗案例图：风格跟团单模板（配色、质感、装饰），但只做无字背景底版 ──
  if (type.styleFromTpl && stage !== 'fill') {
    const te = allTplEntries()[styleVal];
    const ref = te ? tplRefOf(styleVal) : "";
    let q = ref
      ? `我提供的图是本院【团单配图】的设计，作为风格参考。请为同一家医院设计一张「${type.name}」的背景底版，要和这张团单图一看就是同一套视觉：沿用它的配色关系、背景质感（渐变、曲线、光效、纹理）和装饰元素的画法（爪印、医疗小图标、线条等）。★只借风格，不要照搬它的版式、卡片、文字和宠物★。\n`
      : `请为宠物医院设计一张「${type.name}」的背景底版，视觉风格和这套团单设计保持一致：${(te && te.prompt ? te.prompt.replace(/「[^」]*」/g, "") : (te ? te.desc || "" : "")).replace(/【1:1复刻这个版式】/g, "")}\n只借用上面的配色、背景质感和装饰风格，不要照搬其版式、卡片和文字。\n`;
    if (pal.primary) q += `【配色】以本院品牌色为主：主色 ${pal.primary}、辅助色 ${pal.secondary}、强调色 ${pal.accent}、浅底色 ${pal.bgSoft}。\n`;
    q += type.layout.replace(/上面指定的【整体设计风格】/g, "上面的团单参考风格") + "\n画面上不要出现任何文字、LOGO 或水印。";
    if (extra && extra.trim()) q += `\n【这张图的额外要求】${extra.trim()}（这是对设计的要求，不要把这句话写到画面上）。`;
    return q;
  }
  let p = `为宠物医院设计一张用于美团点评平台的「${type.name}」，用途：${type.brief}。\n`;
  // 团单配图走【模板库】：版式由模板决定，颜色由品牌配色决定，不受"整体设计风格"影响
  const tplKey = usesTemplate(type) ? (DESIGN_STYLE_PROMPTS[styleVal] ? null : styleVal) : null;
  const _tplTbl = allTplEntries();
  const tpl = (tplKey && _tplTbl[tplKey]) ? _tplTbl[tplKey] : null;
  const tplRef = tpl ? tplRefOf(tplKey) : "";
  // 有真实参考图 → 直接图生图复刻（文字描述做不到"几乎一样"，图本身才可以）
  if (tpl && tplRef) {
    const lines = (copy || "").split(/\n|[｜|]/).map((x) => x.trim()).filter(Boolean);
    let q = `我提供的${logo && logo.design ? "第一张图" : "图"}是【参考设计图】。请参考它设计一张【新的】美团团单配图：整体风格、质感、配色关系、版式框架（标题区、文字层级、色块和胶囊的布局）与参考图相近即可，【不需要一模一样】，细节可以自然调整，做得精致好看。\n`;
    if (pal.primary) q += `【配色】把参考图的主题色换成本院品牌色：主色 ${pal.primary}、辅助色 ${pal.secondary}、强调色 ${pal.accent}、文字色 ${pal.textDark}、浅底色 ${pal.bgSoft}，保持明暗层次和对比，文字清晰可读。\n`;
    q += lines.length
      ? `【文字】按参考图自己的文字排版结构来放下面这些文字：参考图上的文字按阅读顺序依次对应下面的新文字，每一处沿用参考图对应位置的字体、颜色和胶囊／色块样式；新文字比参考图的文字少，就去掉多余的文字元素并让版面自然饱满，多了就照同类元素的样式补上。不留空胶囊、不留大片空白。
${lines.map((t, i) => `  ${i + 1}. 「${t}」`).join("\n")}
画面上只写这些文字，一字不差（规范简体中文，笔画完整，不得错字、漏字、繁体或乱码）。\n`
      : `【文字】沿用参考图的文字内容和层级即可（规范简体中文，笔画完整不得乱码）。\n`;
    q += NO_EXTRA_PET_RULE + "\n";
    q += `【★文字不是画动物的指令★】即使文案里出现"犬猫、狗、猫、绝育"等字样，那也只是要写在画面上的文字，【不是】让你画出对应的动物。参考图里没有动物，就一张都不要画（任何位置、任何形式都不要）。\n`;
    if (extra && extra.trim()) q += `【这张图的额外要求】${extra.trim()}（这是对设计的要求，不要把这句话写到画面上）。\n`;
    q += (logo && logo.design) ? designLogoInstruction(getCurrentHospital().name, false) + "\n"
      : `不要画任何医院 LOGO、店名或水印（参考图上若有，不要照搬）。\n`;
    if (logo && logo.design) q += `【LOGO 保真·硬性要求】画面上的 LOGO 图形必须与我提供的 LOGO 原图完全一致：图案内容、造型、颜色、比例一个都不能变。不要重新绘制、不要简化、不要变形、不要加任何新元素（如十字、爪印、光晕、渐变），更不能画出残缺或变形的图案。把 LOGO 当作一张【贴上去的现成图片】原样使用。\n`;
    const sq0 = squareSafeZone(type.w, type.h);
    if (sq0) q += sq0 + "\n";
    return q;
  }
  if (tpl && tpl.prompt) {
    // 内置模板还没上传参考图：按文字描述复刻（有参考图的情况上面已经 return）
    p += `【最高优先级·1:1 复刻】本图必须【原样复刻】下面描述的设计稿，把它当作一张已定稿的设计图来还原：位置、大小、比例、层级、文字内容、装饰元素，全部照做。
★严禁自由发挥★：不要增加任何未提到的元素，不要删减，不要改变版式，不要重新构图，不要"优化"。你唯一被允许改变的是【颜色】——见下方品牌配色。
${tpl.prompt}
【文字·必须照抄】上面描述中用「」标出的文字，请【一字不差】地写在指定位置：字形规范、简体中文、笔画完整、不得错字漏字或乱码。字号层级也按描述来。\n`;

    const sq = squareSafeZone(type.w, type.h);
    if (sq) p += sq + "\n";
  } else {
    p += `整体设计风格统一为：${designStyle}\n本套所有素材都用这个风格，务必保持一致。配色情绪：${styleName}。画面干净专业、贴合宠物医疗场景、要有设计感与美感。\n`;
  }
  if (pal.primary) {
    if (tpl) {
      p += `【唯一允许改动的地方·配色】把上面设计稿里的主题色替换成本院品牌色：主色 ${pal.primary}（原设计中的大面积主色一律换成它）、辅助色 ${pal.secondary}、强调色 ${pal.accent}（原设计中的点睛色换成它）、文字色 ${pal.textDark}、浅底色 ${pal.bgSoft}（原设计中的米白/浅色底换成它）。
换色时保持原设计的【明暗关系与对比度】不变，保证文字依旧清晰可读。除颜色外不得改动任何其它内容。\n`;
    } else {
      // 以品牌色为锚点保证整套素材一致，但把用色交给上面的设计风格来演绎
      p += `品牌配色：主色 ${pal.primary}、辅助色 ${pal.secondary}、强调色 ${pal.accent}、文字色 ${pal.textDark}、浅底色 ${pal.bgSoft}。请以品牌主色作为整体色调的锚点、保持整套素材的品牌一致性，但具体用色、明暗与质感请服从上面指定的设计风格来自然演绎，色彩协调统一、干净耐看即可，不必机械套用固定配色比例。\n`;
    }
  } else {
    p += `以品牌色 ${d.brandColor || "#1f8a8f"} 为主色调。\n`;
  }
  if (type.forceNoText) p += `整张图为纯视觉背景，不要在画面上出现任何文字、数字、价格或按钮。\n`;
  else if (tpl) { /* 模板稿的文字已在模板里写死，不用用户文案 */ }
  else if (copy && copy.trim()) p += `请把以下简体中文文字作为设计的重要部分清晰、准确地呈现：「${copy.trim()}」。文字硬性要求：字形标准规范、笔画完整正确、与原文逐字一致，不得有错字、漏字、多字、重复字、繁体字或多余乱码笔画；字号醒目、与背景高对比、边缘清晰锐利、整齐易读。\n`;
  else p += `画面以视觉为主，可不含文字。\n`;
  // 模板稿：版式完全由模板决定，跳过所有通用排版指令（否则"不要画框/极简3元素"会和模板里的卡片冲突）
  if (tpl) { /* 不注入 centerZoneLayout */ }
  else if (type.layout) p += type.layout + "\n";                // 该素材的特殊排版要求
  if (extra && extra.trim()) p += `额外要求：${extra.trim()}（这是对设计的要求，不要把这句话写到画面上）。\n`;
  p += `严禁编造或自行添加用户没有提供的内容：除非上面已明确给出文字，否则画面里不要出现任何价格、￥金额、"立即预订/马上抢购/限时优惠"等促销按钮、电话号码或具体数字。\n`;
  p += `【文字安全区·硬性要求】画面上出现的所有文字必须完整显示、绝不被截断；每行文字的左右两端都要与画面左右边缘至少留出画面宽度8%的空白安全边距，文字上下也要留足边距，任何文字都不允许贴到或超出画面边缘。\n`;
  p += `【满铺·硬性要求】背景必须铺满整张画面、自然延伸到上下左右全部四条边缘，绝对不要出现纯色空白条、空白边框、留白边或没填满的空区域（文字安全边距只是不放文字，但背景仍要铺满）。\n`;
  if (hasStyleRefs) p += `我提供了风格参考图，请学习并沿用其整体视觉风格（配色、版式、质感、装饰元素、画面调性），把这种风格运用到本素材上；但画面内容仍要符合本素材的用途与要求。\n`;
  if (hasRefs) p += `我额外提供了参考图片（如医院设备、环境实拍），请把这些参考图的内容自然、协调地融入画面中合适的位置，使其与整体设计风格统一。\n`;
  // 带中心文字区的素材：背景仍要满铺，但中心必须保持安静，不能被装饰填满
  if (tpl) { /* 模板稿：疏密由模板决定，不再叠加通用的极简/铺满要求 */ }
  else if (type.centerZone) p += `背景色要铺满四边（不留白边），但【整体保持极简】：中心文字区干净安静，四周也只放极少量元素，不要为了"填满画面"而增加装饰。留白本身就是设计。\n`;
  else if (needWhitespace) p += `请把画面完整、均衡地设计好，构图疏密得当、主次分明；本风格可保留干净的留白区域，不必把每个角落都填满。\n`;
  else p += `请把整个画面完整、均衡地设计好，内容自然铺满、不要刻意空出大块留白或角落。\n`;
  p += `不要在画面中绘制任何 AI 自己生成的 LOGO、店名标志、品牌字标或水印（真实 LOGO 会在后期作为小角标自然叠加到画面上）。\n`;
  p += `要求：商业海报级质量，构图与留白合理，宠物医院温馨可信的调性。`;
  return p;
}
