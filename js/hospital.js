// ① 医院档案：新建 / 切换 / 删除医院

function addHospital() {
  const name = $("new_h_name").value.trim();
  const phone = $("new_h_phone").value.trim();
  if (!name) { alert("请填写医院名称"); return; }
  const list = getHospitals();
  const h = { id: uid(), name, phone, createdAt: Date.now() };
  list.push(h);
  saveHospitals(list);
  setCurrentId(h.id);              // 新建后自动设为当前
  $("new_h_name").value = ""; $("new_h_phone").value = "";
  renderHospitals();
  updateCurrentTag();
}
function selectHospital(id) { setCurrentId(id); renderHospitals(); updateCurrentTag(); }
function deleteHospital(id) {
  const h = getHospitals().find((x) => x.id === id);
  if (!confirm(`确定删除「${h ? h.name : ""}」吗？该医院的简介、文案、已生成的素材图会一并删除，且不可恢复。`)) return;
  saveHospitals(getHospitals().filter((x) => x.id !== id));
  localStorage.removeItem(dataKey(id));
  if (getCurrentId() === id) setCurrentId("");
  // 连带清理该医院的所有成品图（后台进行，防止孤儿图一直占硬盘）
  listImagesFromServer(id).then((list) => list.forEach((m) => deleteImageFromServer(m.id).catch(() => {}))).catch(() => {});
  renderHospitals();
  updateCurrentTag();
}
function renderHospitals() {
  const box = $("hospital_list");
  const list = getHospitals();
  const cur = getCurrentId();
  if (!list.length) { box.innerHTML = '<div class="hint">（还没有医院，请先在上方创建）</div>'; return; }
  box.innerHTML = list.map((h) => `
    <div class="h-row ${h.id === cur ? "current" : ""}">
      <div class="h-info">
        <span class="h-name">${esc(h.name)}</span>
        ${h.phone ? `<span class="h-phone">${esc(h.phone)}</span>` : ""}
        ${h.id === cur ? '<span class="h-badge">● 当前</span>' : ""}
      </div>
      <div class="h-actions">
        ${h.id === cur ? "" : `<button class="btn btn-test btn-mini" onclick="selectHospital('${h.id}')">切换到这家</button>`}
        <button class="btn btn-danger btn-mini" onclick="deleteHospital('${h.id}')">删除</button>
      </div>
    </div>`).join("");
}
function updateCurrentTag() {
  const h = getCurrentHospital();
  $("current_hospital_tag").textContent = h ? "当前：" + h.name : "未选择医院";
}
