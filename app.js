'use strict';

/* =====================================================
   冰箱庫存管理（資料存在 Supabase 雲端資料庫）
   結構：1 設定 → 2 資料層 → 3 小工具 → 4 畫面層 → 5 事件層
   示範版權限：任何人都能「讀取」與「新增」，不能修改或刪除（由資料庫的 RLS 規則把關）
   ===================================================== */

/* ===== 1. 設定 ===== */
const sb = window.supabaseClient;   // 由 index.html 建立
const ICON = {
  '蔬果': '🥬', '肉類海鮮': '🥩', '蛋奶': '🥛', '飲品': '🧃',
  '熟食剩菜': '🍱', '調味乾貨': '🧂', '其他': '📦',
};
const $ = (id) => document.getElementById(id);

// 畫面上的暫時狀態（不存檔）
let view = 'home';         // 'home' = 圓形主畫面；'list' = 某個儲存空間（或全部）的食材清單
let spaceFilter = 'all';   // 清單檢視時，目前看的儲存空間
let memberFilter = 'all';  // 目前選的購買者篩選

/* ===== 2. 資料層：從 Supabase 讀取與新增 ===== */
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const offset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

let S = { spaces: [], members: [], items: [] };   // S = 整個應用的資料

// 資料庫欄位 → 畫面使用的格式
const toItem = (r) => ({
  id: r.id, name: r.name, cat: r.cat, space: r.space_id, qty: r.qty, unit: r.unit,
  price: Number(r.price), buyer: r.buyer_id || '', date: r.expiry,
});

async function loadData() {
  const [spaces, members, items] = await Promise.all([
    sb.from('fridge_spaces').select('id,name').order('created_at'),
    sb.from('fridge_members').select('id,name').order('created_at'),
    sb.from('fridge_items').select('*').order('expiry'),
  ]);
  const failed = [spaces, members, items].find((r) => r.error);
  if (failed) throw failed.error;
  S = { spaces: spaces.data, members: members.data, items: items.data.map(toItem) };
}

// 新增一筆資料，成功後回傳資料庫實際存下的那一筆
async function insertRow(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

/* ===== 3. 小工具 ===== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const initial = (name) => esc(String(name).charAt(0));
const findMember = (id) => S.members.find((m) => m.id === id);
const spaceName = (id) => (S.spaces.find((s) => s.id === id) || { name: '未指定' }).name;
const valueOf = (item) => (item.price || 0) * item.qty;   // 成本 = 單價 × 數量

function daysLeft(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}
const statusOf = (d) => (d < 0 ? 'expired' : d <= 3 ? 'soon' : 'fresh');
function expiryLabel(d) {
  if (d < 0) return `過期 ${-d} 天`;
  if (d === 0) return '今天到期';
  if (d <= 3) return `${d} 天後到期`;
  return `剩 ${d} 天`;
}

// 頁面上方的提示列：載入中、新增成功、錯誤
let noticeTimer = null;
function showNotice(text, type = '', autoHide = false) {
  const el = $('notice');
  clearTimeout(noticeTimer);
  el.textContent = text;
  el.className = 'notice ' + type;
  el.hidden = !text;
  if (autoHide) noticeTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

/* ===== 4. 畫面層：只負責把資料畫出來 ===== */
function renderAll() {
  if (!['all', 'none'].includes(memberFilter) && !findMember(memberFilter)) memberFilter = 'all';
  if (view === 'list' && spaceFilter !== 'all' && !S.spaces.some((s) => s.id === spaceFilter)) {
    view = 'home'; spaceFilter = 'all';
  }
  $('home').hidden = view !== 'home';
  $('detail').hidden = view === 'home';
  renderStats();
  renderCost();
  renderLoss();
  if (view === 'home') renderHome();
  else { renderDetailHead(); renderMemberFilter(); renderList(); }
}

// 一組食材的統計：數量、3 天內到期、已過期、庫存價值、過期損失
function statsOf(items) {
  const r = { n: items.length, soon: 0, bad: 0, value: 0, loss: 0 };
  for (const item of items) {
    const d = daysLeft(item.date);
    if (d < 0) { r.bad++; r.loss += valueOf(item); }
    else { r.value += valueOf(item); if (d <= 3) r.soon++; }
  }
  return r;
}

function renderStats() {
  const s = statsOf(S.items);
  $('sTotal').textContent = s.n;
  $('sSoon').textContent = s.soon;
  $('sBad').textContent = s.bad;
  $('sValue').textContent = money(s.value);
  $('sLoss').textContent = money(s.loss);
}

// 主畫面：統計在中間，每個儲存空間是一顆繞著它轉的圓
function renderHome() {
  const k = S.spaces.length + 1;                 // +1 是「新增空間」那顆圓
  const size = k <= 6 ? 26 : k <= 8 ? 22 : 19;   // 圓的直徑（佔整體寬度 %）
  const R = 50 - size / 2 - 2;                   // 軌道半徑（%）
  const pos = (i) => {
    const a = ((-90 + (i * 360) / k) * Math.PI) / 180;
    return `left:${(50 + R * Math.cos(a)).toFixed(2)}%;top:${(50 + R * Math.sin(a)).toFixed(2)}%;width:${size}%`;
  };
  const circles = S.spaces.map((s, i) => {
    const st = statsOf(S.items.filter((x) => x.space === s.id));
    const tone = st.bad ? 'is-bad' : st.soon ? 'is-soon' : 'is-ok';
    const label = `${s.name}，${st.n} 項食材${st.bad ? `，${st.bad} 項已過期` : ''}`;
    return `<button type="button" class="sp ${tone}" data-space="${s.id}" style="${pos(i)}" aria-label="${esc(label)}">
      <span class="sp-in"><span class="sp-name">${esc(s.name)}</span><span class="sp-n">${st.n} 項</span>${st.bad ? `<span class="flag">${st.bad} 過期</span>` : ''}</span></button>`;
  });
  circles.push(`<button type="button" class="sp add" id="addSpaceCircle" style="${pos(S.spaces.length)}" aria-label="新增儲存空間">
    <span class="sp-in"><span class="sp-plus">＋</span><span class="sp-n">新增空間</span></span></button>`);
  $('orbit').style.setProperty('--R', R.toFixed(2));
  $('ring').innerHTML = circles.join('');
  // 圓圈重畫後，讓外圈與圈內文字的旋轉動畫一起從頭開始，文字才不會歪掉
  $('ring').style.animation = 'none';
  void $('ring').offsetWidth;
  $('ring').style.animation = '';
}

// 清單檢視的標題列
function renderDetailHead() {
  const all = spaceFilter === 'all';
  const items = all ? S.items : S.items.filter((i) => i.space === spaceFilter);
  const st = statsOf(items);
  $('dTitle').textContent = all ? '全部食材' : spaceName(spaceFilter);
  $('dMeta').textContent = `${st.n} 項・庫存 ${money(st.value)}・3 天內到期 ${st.soon}・已過期 ${st.bad}`;
}

// 依網址 # 後面的文字決定畫面：沒有 = 主畫面、all = 全部、其他 = 空間 id
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'all') { view = 'list'; spaceFilter = 'all'; }
  else if (S.spaces.some((s) => s.id === h)) { view = 'list'; spaceFilter = h; }
  else { view = 'home'; spaceFilter = 'all'; }
}

function renderMemberFilter() {
  const options = S.members.map((m) => `<option value="${m.id}">${esc(m.name)} 買的</option>`).join('');
  $('memberFilter').innerHTML = `<option value="all">所有成員</option>${options}<option value="none">未指定購買者</option>`;
  $('memberFilter').value = memberFilter;
}

// 庫存價值明細：各儲存空間裡尚未過期的食材成本（合計 = 統計列的「庫存價值」）
function renderCost() {
  const rows = S.spaces.map((s) => {
    const fresh = S.items.filter((i) => i.space === s.id && daysLeft(i.date) >= 0);
    return { name: s.name, n: fresh.length, v: fresh.reduce((t, i) => t + valueOf(i), 0) };
  });
  const max = Math.max(1, ...rows.map((r) => r.v));
  const total = rows.reduce((t, r) => t + r.v, 0);
  $('cost').innerHTML =
    `<h2>各儲存空間的食材成本 <span class="hint">合計 ${money(total)}・不含已過期</span></h2>` +
    rows.map((r) => `
      <div class="cost-row">
        <span class="who">${esc(r.name)} <span class="hint">${r.n} 項</span></span>
        <div class="track"><div class="fill" style="width:${Math.round((r.v / max) * 100)}%"></div></div>
        <span class="amt">${money(r.v)}</span>
      </div>`).join('');
}

// 過期損失明細：列出已過期的食材，損失最大的排最前面
function renderLoss() {
  const expired = S.items
    .filter((i) => daysLeft(i.date) < 0)
    .sort((a, b) => valueOf(b) - valueOf(a));
  const total = expired.reduce((t, i) => t + valueOf(i), 0);
  const head = `<h2>過期損失 <span class="hint">合計 ${money(total)}・${expired.length} 項</span></h2>`;
  if (!expired.length) {
    $('loss').innerHTML = head + '<p class="hint">目前沒有過期食材。</p>';
    return;
  }
  $('loss').innerHTML = head + expired.map((i) => {
    const buyer = findMember(i.buyer);
    return `
      <div class="loss-row">
        <span class="ico" aria-hidden="true">${ICON[i.cat] || '📦'}</span>
        <div class="loss-main">
          <div class="name">${esc(i.name)} <span class="hint">${i.qty} ${esc(i.unit)}</span></div>
          <div class="meta">${esc(spaceName(i.space))}・過期 ${-daysLeft(i.date)} 天${buyer ? '・' + esc(buyer.name) + ' 買的' : ''}</div>
        </div>
        <span class="amt">${money(valueOf(i))}</span>
      </div>`;
  }).join('');
}

function renderList() {
  const q = $('q').value.trim().toLowerCase();
  const shown = S.items
    .filter((i) => {
      if (spaceFilter !== 'all' && i.space !== spaceFilter) return false;
      if (memberFilter === 'none') { if (findMember(i.buyer)) return false; }
      else if (memberFilter !== 'all' && i.buyer !== memberFilter) return false;
      return !q || (i.name + i.cat).toLowerCase().includes(q);
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));   // 最快到期的排最前面

  if (!shown.length) {
    $('list').innerHTML = `<li class="empty">${S.items.length ? '找不到符合的食材。' : '目前沒有食材，按右上角「新增食材」開始記錄。'}</li>`;
    return;
  }
  $('list').innerHTML = shown.map(itemCard).join('');
}

function itemCard(i) {
  const d = daysLeft(i.date);
  const buyer = findMember(i.buyer);
  const buyerHtml = buyer
    ? `<span class="av">${initial(buyer.name)}</span>${esc(buyer.name)} 買的`
    : '未指定購買者';
  return `
    <li class="item ${statusOf(d)}">
      <div class="top">
        <span class="ico" aria-hidden="true">${ICON[i.cat] || '📦'}</span>
        <div class="top-text">
          <div class="name">${esc(i.name)}</div>
          <div class="meta">${esc(i.cat)}・${esc(spaceName(i.space))}</div>
        </div>
        <span class="badge">${expiryLabel(d)}</span>
      </div>
      <div class="row">
        <span class="qty">${i.qty} ${esc(i.unit)}</span>
        <span class="date">${i.date}</span>
      </div>
      <div class="row">
        <span class="chip">${buyerHtml}</span>
        <span class="money">${money(valueOf(i))}</span>
      </div>
    </li>`;
}

// 管理面板的兩個清單（只能新增，所以只列出名稱與數量）
function renderManage() {
  $('spaceList').innerHTML = S.spaces.map((s) => {
    const n = S.items.filter((i) => i.space === s.id).length;
    return `<div class="edit-row"><span class="row-name">${esc(s.name)}</span><span class="cnt">${n} 項</span></div>`;
  }).join('') || '<p class="hint">還沒有儲存空間，請在下方新增。</p>';

  $('memberList').innerHTML = S.members.map((m) =>
    `<div class="edit-row"><span class="av">${initial(m.name)}</span><span class="row-name">${esc(m.name)}</span></div>`
  ).join('') || '<p class="hint">還沒有成員，請在下方新增。</p>';
}

function showBackupMessage(text, type = '') {
  const el = $('backupMsg');
  el.textContent = text;
  el.className = 'hint ' + type;
}

/* ===== 5. 事件層：按鈕與輸入 ===== */

/* --- 統計列的三個展開面板（成本、過期損失、管理），一次只開一個 --- */
const PANELS = { cost: 'costBtn', loss: 'lossBtn', manage: 'manageBtn' };
function setPanel(name) {
  for (const [key, btnId] of Object.entries(PANELS)) {
    $(key).hidden = key !== name;
    $(btnId).setAttribute('aria-expanded', key === name);
  }
  if (name === 'manage') renderManage();
}
const togglePanel = (name) => setPanel($(name).hidden ? name : null);
const toggleManage = (open) => {
  if (open) setPanel('manage');
  else if (!$('manage').hidden) setPanel(null);
};
$('costBtn').onclick = () => togglePanel('cost');
$('lossBtn').onclick = () => togglePanel('loss');
$('manageBtn').onclick = () => togglePanel('manage');
$('closeManage').onclick = () => toggleManage(false);

// 管理面板的分頁：儲存空間 / 家庭成員 / 資料備份
function showManageTab(name) {
  document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
}
document.querySelector('.seg').onclick = (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) showManageTab(btn.dataset.tab);
};

/* --- 新增儲存空間、新增成員 --- */
async function addNamed(inputId, table, list, label) {
  const name = $(inputId).value.trim();
  if (!name) return;
  try {
    const row = await insertRow(table, { name });
    list.push({ id: row.id, name: row.name });
    $(inputId).value = '';
    renderManage(); renderAll();
    showNotice(`已新增${label}「${row.name}」`, 'ok', true);
  } catch (err) {
    showNotice(`新增${label}失敗：${err.message}`, 'err');
  }
}
$('addSpace').onclick = () => addNamed('newSpace', 'fridge_spaces', S.spaces, '儲存空間');
$('addMember').onclick = () => addNamed('newMember', 'fridge_members', S.members, '成員');
for (const [inputId, btnId] of [['newSpace', 'addSpace'], ['newMember', 'addMember']]) {
  $(inputId).onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $(btnId).click(); }
  };
}

/* --- 備份：匯出目前資料 --- */
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fridge-backup-${iso(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showBackupMessage('已產生備份檔，請在下載資料夾找 fridge-backup 開頭的檔案。', 'ok');
};

/* --- 新增食材 --- */
function openForm() {
  $('fSpace').innerHTML = S.spaces.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('fBuyer').innerHTML = '<option value="">未指定</option>' +
    S.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('fName').value = '';
  $('fCat').value = '蔬果';
  $('fSpace').value = view === 'list' && spaceFilter !== 'all' ? spaceFilter : (S.spaces[0] || {}).id || '';
  $('fQty').value = 1;
  $('fUnit').value = '個';
  $('fPrice').value = 0;
  $('fBuyer').value = '';
  $('fDate').value = offset(7);
  $('form').hidden = false;
  $('fName').focus();
  $('form').scrollIntoView({ block: 'nearest' });
}
function closeForm() { $('form').hidden = true; }

$('addBtn').onclick = () => {
  if (!S.spaces.length) { showNotice('請先到「管理」新增一個儲存空間。', 'err'); return; }
  openForm();
};
$('cancelBtn').onclick = closeForm;
$('form').onsubmit = async (e) => {
  e.preventDefault();
  const row = {
    name: $('fName').value.trim(),
    cat: $('fCat').value,
    space_id: $('fSpace').value,
    qty: Math.max(1, parseInt($('fQty').value, 10) || 1),
    unit: $('fUnit').value.trim() || '個',
    price: Math.max(0, parseFloat($('fPrice').value) || 0),
    buyer_id: $('fBuyer').value || null,
    expiry: $('fDate').value,
  };
  if (!row.name || !row.expiry || !row.space_id) return;
  const submit = e.submitter;
  if (submit) submit.disabled = true;
  try {
    S.items.push(toItem(await insertRow('fridge_items', row)));
    closeForm(); renderAll();
    showNotice(`已新增「${row.name}」`, 'ok', true);
  } catch (err) {
    showNotice(`新增食材失敗：${err.message}`, 'err');
  } finally {
    if (submit) submit.disabled = false;
  }
};

/* --- 主畫面：點圓圈進入空間、點中間看全部 --- */
$('ring').onclick = (e) => {
  const circle = e.target.closest('.sp');
  if (!circle) return;
  if (circle.id === 'addSpaceCircle') {
    toggleManage(true);
    showManageTab('spaces');
    $('manage').scrollIntoView({ block: 'nearest' });
    $('newSpace').focus();
  } else {
    location.hash = circle.dataset.space;
  }
};
$('hub').onclick = () => { location.hash = 'all'; };
$('backBtn').onclick = () => { location.hash = ''; };
window.addEventListener('hashchange', () => { route(); renderAll(); window.scrollTo(0, 0); });

/* --- 清單頁的篩選 --- */
$('q').oninput = renderList;
$('memberFilter').onchange = (e) => { memberFilter = e.target.value; renderList(); };

/* --- 啟動：先顯示今天日期，再從雲端載入資料 --- */
const weekday = ['日', '一', '二', '三', '四', '五', '六'];
const now = new Date();
$('today').textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（週${weekday[now.getDay()]}）`;

async function start() {
  showNotice('資料載入中…');
  renderAll();
  try {
    await loadData();
    showNotice('');
  } catch (err) {
    showNotice(`無法讀取雲端資料：${err.message}。請重新整理頁面再試。`, 'err');
  }
  route();
  renderAll();
}
start();
