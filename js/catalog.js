// 目录与配置：素材类型和尺寸、整体设计风格、团单版式模板库

// 「中心文字区」排版要求：功能上要留出干净的近正方形区域供后期叠字，
// 但设计上必须避免"背景上贴一个圆角方块"的死板做法——参考市面上好看的团单图，
// 中心区是靠构图与渐变"空出来"的，与两侧融为一体，元素还会跨越边界咬合。
function centerZoneLayout(w, h) {
  const side = Math.min(w, h);
  // 注意：本段只负责"中心留白"与"极简克制"，绝不指定具体元素或materials，
  // 否则会盖过上面的【整体设计风格】，导致换风格也出一样的图。
  return `这是一张【纯视觉背景模板】，画面上不要出现任何文字，也不要出现人。
【文字区】正中央留出约 ${side}×${side} 的干净区域（水平居中）供后期叠加文字：该区域内保持安静、明暗均匀、不放任何元素。
【★关键·不要画框★】不要在中间画一个圆角矩形卡片。中心的"干净"应当由背景本身自然形成——色彩到中间自然变浅、变透气，与两侧无缝融合。若确实要有浅色区域，其边缘必须柔和淡出或呈有机曲线，绝不能是四条直边围出的方框。
【★关键·极简克制★】整张图的元素要【极少】：最多一个视觉主体（放在画面一侧，可被画面边缘自然裁切），外加最多 1～2 个很小的点缀；其余大面积交给干净的纯色或简单渐变。宁可空，也不要满。
【数量上限·硬性】整张图的可辨识元素总数【不超过 3 个】。多于 3 个即为不合格，请删减到只剩最重要的。
【表现手法听风格的】用什么画法、什么色系、有没有宠物、宠物是插画还是照片，一律由上面指定的【整体设计风格】决定，本段不做限制。`;
}

// 美团团单图在列表中按【正方形缩略图】显示：16:9 的图会被裁掉左右两侧，
// 只留中间的正方形。所以整套设计必须完整落在中央正方形内，两侧只做背景延伸。
function squareSafeZone(w, h) {
  const side = Math.min(w, h);
  const pad = Math.round((Math.max(w, h) - side) / 2);
  if (w === h) return "";
  return `【★正方形安全区·硬性要求★】这张 ${w}×${h} 的图在美团列表里会被【裁切成中央的正方形缩略图】显示——只有中间 ${side}×${side} 的方形区域会被看到，左右各 ${pad} 像素会被切掉。
因此：★卡片、标题、所有文字、胶囊、宠物等主体内容必须【完整地】落在画面正中央 ${side}×${side} 的正方形范围之内★，不许越过这个正方形的左右边界，宠物的头、身体、爪子也不行。
左右两侧各 ${pad} 像素只放背景和装饰性元素（如爪印、医疗小物件，被裁掉也不影响），不放文字和宠物。
重要内容（卡片、文字、胶囊、主体）要【饱满地占满】这个正方形区域，构图紧凑居中，整体版式不要缩小——只是左右不要越界，并不是要把画面做小。`;
}

// ---- 素材类型目录（尺寸来自《宠物医院美团设计尺寸要求》）----
const MATERIAL_TYPES = [
  { cat: "店铺首页", items: [
    { key: "entry",     name: "入口图",     w: 650,  h: 650,  ratio: "1:1",  brief: "店铺入口缩略图，吸睛、信息聚焦" },
    { key: "carousel",  name: "轮播图",     w: 1280, h: 720,  ratio: "16:9", brief: "店铺首页轮播，方向如综合/科室/设备/团队/服务/理念" },
  ]},
  { cat: "人员展示", items: [
    { key: "staff",     name: "服务人员图", w: 650,  h: 650,  ratio: "1:1",  brief: "服务人员/医生形象展示" },
  ]},
  { cat: "品牌馆", items: [
    { key: "brandlogo", name: "品牌LOGO图", w: 900,  h: 600,  ratio: "3:2",  brief: "白底居中展示 LOGO（不调用 AI、不花钱）", logoCanvas: true },
    { key: "brandbg",   name: "品牌背景图", w: 1242, h: 264,  ratio: "16:9", brief: "LOGO + 医院名称横幅（不调用 AI、不花钱）", nameLogoCanvas: true },
    { key: "feature",   name: "特色项目图", w: 1242, h: 264,  ratio: "16:9", fit: "cover", brief: "横向特色项目 banner（超宽横条）",
      layout: "这是一张超宽横幅，最终只会保留画面【垂直方向正中央的一条水平窄带】（上下大部分会被裁掉）。所以：① 背景必须满铺整张、延伸到最左最右两端，绝不留白边或空白条；② 所有重要内容（文字、主体、图标）都要集中放在画面垂直正中央的水平带内，画面最上方和最下方不要放重要内容（会被裁掉）。" },
  ]},
  { cat: "团单", items: [
    { key: "groupimg",  name: "美团团单配图",   w: 1600, h: 900,  ratio: "16:9", brief: "参考模板生成风格、框架类似的团单图；满意的图到第⑤步当套版模板", batchFill: true,
      centerZone: true, useTemplate: true, layout: centerZoneLayout(1600, 900) },
    { key: "groupdetail", name: "团单详情页", w: 640, h: 2000, ratio: "8:25", brief: "医院详情长图（竖向分板块介绍）", logoOffByDefault: true,
      layout: "请设计成一张专业规整、风格统一的【超长竖版】医院介绍长图，整张画面【从最顶部到最底部完全铺满、不要留任何空白边】。从上到下自然分成几个板块依次排列、填满整页：顶部标题/品牌区、医院简介、设备简介、人员/团队简介、服务项目简介、理念介绍等（依据提供的文字内容组织）。每个板块有清晰的小标题与简洁说明、板块之间有分隔，是一张完整连贯、首尾衔接的长图。【严禁】出现任何团购套餐、价格、￥金额、199/99 之类促销数字。" },
  ]},
  { cat: "抖音", items: [
    { key: "dycarousel", name: "抖音轮播图", w: 1440, h: 1080, ratio: "4:3", brief: "抖音店铺轮播图（4:3），方向如综合/科室/设备/团队/服务/理念" },
    { key: "dygroupimg", name: "抖音团单配图", w: 1600, h: 1200, ratio: "4:3", brief: "抖音团单：参考模板生成类似的图；满意的到第⑤步当套版模板", batchFill: true,
      centerZone: true, useTemplate: true, layout: centerZoneLayout(1600, 1200),
      // 模板参考图是 16:9 的美团版：先按 16:9 出图，再左右各裁掉一截成 4:3——中间正方形和美团版完全一样，不会被挤扁
      genAs: { w: 1600, h: 900, ratio: "16:9", layout: centerZoneLayout(1600, 900) } },
  ]},
  { cat: "诊疗案例", items: [
    { key: "case",      name: "诊疗案例介绍图", w: 400, h: 300, ratio: "3:2", brief: "诊疗案例背景模板（纯视觉，中间留正方形文字区）；到第⑤步可批量套入多组案例文字", forceNoText: true, batchFill: true,
      styleFromTpl: true,   // 风格跟第④步选的团单模板走，不用「整体设计风格」
      centerZone: true, layout: centerZoneLayout(400, 300) },
  ]},
  { cat: "寄养", items: [
    { key: "boarding",  name: "寄养项目图", w: 1600, h: 900,  ratio: "16:9", brief: "寄养项目展示（内容居中，两侧留背景）",
      layout: "请把寄养项目的主要内容（宠物、文字、主体元素）集中放在画面正中央约 1200×900 的区域内（即左右各空出约200像素的边缘），画面最左和最右两侧只用背景或场景自然延伸填充，不要在左右边缘放置重要内容或文字。" },
  ]},
];
function findType(key) { for (const g of MATERIAL_TYPES) for (const it of g.items) if (it.key === key) return it; return null; }

// ---- 「整体设计风格」谱系（对整份美团参考图的整体视觉归纳，作用于所有素材）----
// 键 = 下拉选项的 value；对应一段可直接注入 prompt 的丰富风格描述。
// 目的：让不同风格真正拉开差异（旧版风格词太弱、又被配色硬锁，导致各风格出图雷同）。
const DESIGN_STYLE_PROMPTS = {
  "清新治愈插画风": "【画法·硬性】100% 扁平矢量插画（flat vector illustration），像 Illustrator 画出来的：纯色填充、简洁形状、无渐变阴影、无材质质感。★严禁写实照片、严禁3D渲染、严禁照片级宠物★。【配色】柔和粉彩，薄荷绿/奶油白/浅蓝/暖粉中选一个做主色，占据大面积。【构图】一条大的有机曲线把画面分成两块颜色；一只简笔卡通猫或狗放在一侧。温馨可爱。",
  "通透科技质感风": "【画法·硬性】玻璃拟态（glassmorphism）+ 柔和3D：半透明磨砂玻璃质感、通透高光、细腻反光、柔和光晕。★严禁写实摄影、严禁虚化实景照片★。【配色】蓝或蓝紫渐变为绝对主导，干净通透。【构图】大面积渐变背景 + 一两个半透明玻璃形体，现代科技感，极其干净。",
  "温暖真实照片风": "【画法·硬性】写实摄影（photography）：真实的宠物特写、柔和自然光、浅景深。★这是唯一允许用照片的风格★。【配色】暖调自然色。【构图】一只真实的猫或狗占据画面一侧并被边缘自然裁切，背景是干净的浅色，不要堆满诊室杂物。不要出现人的正脸。",
  "极简大字留白风": "【画法·硬性】极简线描（minimal line art）：只用细线条勾勒轮廓，大面积纯色留白。★严禁写实照片、严禁3D、严禁复杂插画、严禁渐变堆砌★。【配色】几乎纯白或单一浅色底，只用一种颜色画线。【构图】一个简洁的线描猫狗轮廓放在角落，其余全部留白。克制到极致。",
  "专业医疗信赖风": "【画法·硬性】干净的扁平图形设计：规整的几何形状与线性图标，理性克制。★严禁写实照片、严禁卡通萌宠、严禁花哨装饰★。【配色】浅蓝与白为主，稳重专业。【构图】用简洁的色块或斜切分割画面，最多几个统一风格的线性小图标，秩序感强、信息清晰。",
  "轻奢精致质感风": "【画法·硬性】高级质感平面设计：细腻的微妙渐变、考究留白、精致细节。★严禁卡通、严禁廉价感、严禁元素堆砌★。【配色】低饱和高级色（雾霾蓝/浅香槟/灰调莫兰迪），克制优雅。【构图】大面积留白，一条细金线或极简几何形作为点缀，气质安静高级。",
  "蓝绿活力医疗风": "【画法·硬性】扁平矢量 + 大色块：蓝到绿的渐变色块、有机波浪曲线、halftone 网点。★严禁写实照片、严禁虚化实景★。【配色】品牌蓝与清新绿的渐变为绝对灵魂，白色打底。【构图】用一条大的蓝绿渐变波浪切分画面，干净明亮有活力，点缀极少。",
};

// 整体设计风格：可多选；一批里同素材的多张按变体序号轮换所选风格。
// id：__default__=简洁专业默认，__custom__=自定义（用 customStyle 文本），其余=DESIGN_STYLE_PROMPTS 的键。
const GROUP_TEMPLATES = {
  lesheng: {
    name: "蓝底圆角卡",
    desc: "虚化蓝底＋米白圆角大卡＋橙色标题胶囊＋右下猫狗",
    prompt: "【1:1复刻这个版式】背景：柔和虚化的浅蓝色室内光影。正中偏上放一张【米白色圆角矩形大卡】（约占画面 55% 宽、80% 高，四角大圆角）。卡内从上到下：① 一个【橙色圆角胶囊色块】，里面是白色粗体大字「犬猫通用」；② 下方一行深蓝粗体字「耳道清理/剪指甲/喂药」；③ 再下一行放两个小胶囊标签，左边深蓝底白字「宠物医保」、右边深蓝字「放心严选」；④ 左下角一个金色圆形徽章，里面写「不满意 退」；⑤ 徽章右侧一行小字「售后无忧 支持退换」。卡片右下角有一只小狗和一只猫的形象，【压在卡片边缘上、一部分探出卡片外】。卡片左侧空白处放一个橙色爪印。卡片顶部上方居中留一小块空白给医院LOGO（不要画LOGO）。",
  },
  lingyi: {
    name: "白色丝带流光",
    desc: "纯白抽象丝带＋深蓝粗标题＋底部深色信息条",
    prompt: "【1:1复刻这个版式】背景：纯白到浅灰的干净渐变，画面上有几条大而柔和的【白色抽象丝带／曲面流光】掠过，形成微妙的立体光影。★没有任何宠物、没有卡片★。画面正中央从上到下依次是：① 深蓝色超粗黑体大标题「新宠体检」；② 下方两行稍小的深蓝色粗体字「进口高端设备」「智能精准检测」；③ 再下方一个【浅灰白色圆角矩形色块】，内含深蓝色粗体字「品质优选」；④ 画面最底部是一条通栏的【深蓝色横条】，其中是白色小字「24小时 · CT核磁」。整体极简、干净、高级。",
  },
  yuhe: {
    name: "粉紫渐变波纹",
    desc: "上白下粉紫渐变＋波纹肌理＋半透明文字底",
    prompt: "【1:1复刻这个版式】背景：上半部是白色带细密【波纹／等高线肌理】，下半部渐变成粉红到紫色，上下自然过渡。画面中央偏上放一块【极淡的半透明白色矩形】作为文字底衬，上面是两行玫红色超粗黑体大字「公猫绝育」「基础套餐」。半透明块下方、压在粉紫渐变上，是一行白色超粗黑体字「性价比之选」。画面左侧边缘放两个很小的白色线描小图标（一个医药箱、一个胶囊）。顶部居中留一小块空白给医院LOGO（不要画LOGO）。",
  },
  bear: {
    name: "橙底折角白卡",
    desc: "大面积纯橙＋白色圆角卡带折角＋极简三图标",
    prompt: "【1:1复刻这个版式】背景：★大面积纯橙色平涂★（不要渐变）。其上叠一张【白色圆角矩形卡片】，卡片左上角是小圆角、右下角是超大圆角，形成不对称的有机造型；卡片【向右侧溢出画面之外】。卡片左下角有一个【向下翻折的纸张折角】效果（折角内侧是稍深的橙色）。卡片内正中是两行黑色超粗黑体大字「公猫绝育」「标准套餐」。卡片右上角放一个橙色的爪印图案。卡片下方的橙色背景区域，放三个白色线描小图标（医药箱、爪印、爱心），横向排列。卡片左上角留一小块空白给医院LOGO（不要画LOGO）。★扁平矢量，严禁写实照片★。",
  },
  shouzheng: {
    name: "米色藏青双层卡",
    desc: "米色波浪＋藏青大卡＋背后露出橙色一角",
    prompt: "【1:1复刻这个版式】背景：上半米白色、下半【藏青色】，中间用一条【平缓的大波浪曲线】分割。画面正中放一张【米白色圆角矩形卡片】（约占画面 55% 宽、90% 高）。卡片内：① 顶部居中留一小块空白给医院LOGO（不要画LOGO）；② 中间偏上放一个【藏青色圆角矩形色块】，内含白色超粗黑体大字「基础绝育」；③ 这个藏青色块的【右上角背后露出一小角橙黄色】形成层次；④ 藏青块下方是一行藏青色粗体字「犬猫通用」。整体沉稳、有层次、配色克制。",
  },
};
// ---- 用户自建模板（上传参考图即可新增，图片走已有的 tplRefs 机制）----
const MYTPL_KEY = "petvet_mytpls_v1";
function getMyTpls() { return readJSON(MYTPL_KEY, []); }
function saveMyTpls(l) { writeJSON(MYTPL_KEY, l); scheduleSync(); }
// 内置 + 自建 合并；自建模板没有文字描述，完全靠参考图做图生图复刻
function allTplEntries() {
  const out = {};
  Object.keys(GROUP_TEMPLATES).forEach((k) => { out[k] = GROUP_TEMPLATES[k]; });
  getMyTpls().forEach((t) => { out[t.key] = { name: t.name, desc: "我上传的参考图", mine: true }; });
  return out;
}
async function addMyTpl(file, name) {
  const dataUrl = await compressImage(file, 1400);
  const url = await uploadAsset(dataUrl);
  const key = "u" + uid();
  const l = getMyTpls(); l.push({ key, name: (name || "我的模板").trim().slice(0, 10) }); saveMyTpls(l);
  setTplRef(key, url);
  return key;
}
function delMyTpl(key) {
  saveMyTpls(getMyTpls().filter((t) => t.key !== key));
  setTplRef(key, "");
  const sel = (curGenConfig().groupTpl || []).filter((k) => k !== key);
  patchGenConfig({ groupTpl: sel.length ? sel : GROUP_TPL_DEFAULT.slice() });
}

const GROUP_TPL_DEFAULT = ["bear", "lingyi", "shouzheng"];

// 已选模板列表（团单配图专用）
function tplPool() {
  const c = curGenConfig();
  const all = allTplEntries();
  const ids = (c.groupTpl && c.groupTpl.length) ? c.groupTpl : GROUP_TPL_DEFAULT;
  const out = ids.filter((k) => all[k]);
  return out.length ? out : [GROUP_TPL_DEFAULT[0]];
}
function tplName(k) { return (allTplEntries()[k] || {}).name || "模板"; }
// 该素材是否使用模板库（团单配图类）
function usesTemplate(type) { return !!(type && type.useTemplate); }
// 风格来自团单模板库（团单配图本身 + 跟团单同风格的诊疗案例图）
// 图片记录显示用的素材名：以当前类型名为准（老图存的是旧名，如"团单配图"）
function typeLabel(m) { return (findType(m.typeKey) || {}).name || m.typeName; }
function tplStyled(type) { return usesTemplate(type) || !!(type && type.styleFromTpl); }

const STYLE_OPTIONS = [
  { id: "__default__", label: "简洁专业（默认）" },
  { id: "清新治愈插画风", label: "清新治愈插画" },
  { id: "通透科技质感风", label: "通透科技质感" },
  { id: "温暖真实照片风", label: "温暖真实照片" },
  { id: "极简大字留白风", label: "极简大字留白" },
  { id: "专业医疗信赖风", label: "专业医疗信赖" },
  { id: "轻奢精致质感风", label: "轻奢精致质感" },
  { id: "蓝绿活力医疗风", label: "蓝绿活力医疗" },
  { id: "__custom__", label: "自定义…" },
];

// 已选风格解析成一串「风格值」（"" 代表默认；自定义取其文本）。轮换就在这串里按序号取。
function stylePool() {
  const c = curGenConfig();
  const ids = (c.styleSel && c.styleSel.length) ? c.styleSel : ["__default__"];
  const custom = (c.customStyle || "").trim();
  const vals = [];
  ids.forEach((id) => {
    if (id === "__custom__") { if (custom) vals.push(custom); }
    else if (id === "__default__") vals.push("");
    else if (DESIGN_STYLE_PROMPTS[id]) vals.push(id);
  });
  return vals.length ? vals : [""];
}
function pickStyle(variantIndex) { const p = stylePool(); return p[(variantIndex || 0) % p.length]; }
// 风格值 → 简短名（用于日志/展示）
function styleShortName(val) {
  if (!val) return "简洁专业";
  const o = STYLE_OPTIONS.find((x) => x.id === val);
  return o ? o.label : "自定义";
}
