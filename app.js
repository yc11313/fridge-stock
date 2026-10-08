'use strict';

/* =====================================================
   冰箱庫存管理
   結構：1 設定 → 2 資料層 → 3 小工具 → 4 畫面層 → 5 事件層
   ===================================================== */

/* ===== 1. 設定 ===== */
const KEY = 'fridge-inventory-v2';
const OLD_KEY = 'fridge-inventory-v1';
const ICON = {
  '蔬果': '🥬', '肉類海鮮': '🥩', '蛋奶': '🥛', '飲品': '🧃',
  '熟食剩菜': '🍱', '調味乾貨': '🧂', '其他': '📦',
};
const $ = (id) => document.getElementById(id);

// 畫面上的暫時狀態（不存檔）
let view = 'home';         // 'home' = 圓形主畫面；'list' = 某個儲存空間（或全部）的食材清單
let spaceFilter = 'all';   // 清單檢視時，目前看的儲存空間
let memberFilter = 'all';  // 目前選的購買者篩選
let editId = null;         // 正在編輯的食材 id；null 表示新增
let armed = null;          // 已按過一次「刪除」、等待第二次確認的 id
let pendingImport = null;  // 已讀入、等待確認覆蓋的備份資料

/* ===== 2. 資料層：讀取、儲存、示範資料、備份 ===== */
const offset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function demoData() {
  const spaces = [
    { id: 's1', name: '廚房冰箱（冷藏）' },
    { id: 's2', name: '冷凍庫' },
    { id: 's3', name: '儲藏櫃' },
  ];
  const members = [
    { id: 'm1', name: '爸爸' },
    { id: 'm2', name: '媽媽' },
    { id: 'm3', name: '小明' },
  ];
  // [名稱, 分類, 空間, 數量, 單位, 單價, 購買者, 距離到期天數]
  const rows = [
    ['雞蛋', '蛋奶', 's1', 8, '顆', 7, 'm2', 9],
    ['鮮奶', '蛋奶', 's1', 1, '瓶', 85, 'm1', 2],
    ['高麗菜', '蔬果', 's1', 1, '顆', 60, 'm2', 5],
    ['小番茄', '蔬果', 's1', 1, '盒', 70, 'm3', -1],
    ['雞胸肉', '肉類海鮮', 's2', 3, '片', 55, 'm2', 40],
    ['冷凍水餃', '熟食剩菜', 's2', 2, '袋', 140, 'm1', 75],
    ['昨晚的滷肉', '熟食剩菜', 's1', 1, '盒', 0, 'm2', 1],
    ['醬油', '調味乾貨', 's3', 1, '瓶', 95, 'm1', 210],
    ['柳橙汁', '飲品', 's1', 2, '瓶', 60, 'm3', -3],
  ];
  const items = rows.map(([name, cat, space, qty, unit, price, buyer, days], i) => ({
    id: 'i' + (i + 1), name, cat, space, qty, unit, price, buyer, date: offset(days),
  }));
  return { spaces, members, items };
}

// 第一版的資料沒有儲存空間與成員，搬進新格式
function migrateV1(oldItems) {
  const data = demoData();
  const spaceOf = { '冷藏': 's1', '冷凍': 's2', '常溫': 's3' };
  data.spaces = [
    { id: 's1', name: '冷藏' },
    { id: 's2', name: '冷凍' },
    { id: 's3', name: '常溫' },
  ];
  data.items = oldItems.map((x) => ({
    id: 'i' + x.id, name: x.name, cat: x.cat, space: spaceOf[x.loc] || 's1',
    qty: x.qty, unit: x.unit, price: 0, buyer: '', date: x.date,
  }));
  return data;
}

function loadData() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (data && data.spaces && data.members && data.items) return data;
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateV1(JSON.parse(old));
  } catch (e) { /* 讀不到就用示範資料 */ }
  return demoData();
}

let S = loadData();   // S = 整個應用的資料：{ spaces, members, items }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 無痕模式等情況存不了 */ }
}

// 檢查匯入的檔案格式，回傳整理過的資料；格式不對回傳 null
function validateBackup(raw) {
  if (!raw || !Array.isArray(raw.spaces) || !Array.isArray(raw.members) || !Array.isArray(raw.items)) return null;
  const spaces = raw.spaces
    .filter((s) => s && s.id && typeof s.name === 'string')
    .map((s) => ({ id: String(s.id), name: s.name.slice(0, 12) }));
  if (!spaces.length) return null;
  const members = raw.members
    .filter((m) => m && m.id && typeof m.name === 'string')
    .map((m) => ({ id: String(m.id), name: m.name.slice(0, 10) }));
  const items = raw.items
    .filter((i) => i && typeof i.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date))
    .map((i) => ({
      id: String(i.id || uid('i')),
      name: i.name.slice(0, 30),
      cat: ICON[i.cat] ? i.cat : '其他',
      space: spaces.some((s) => s.id === i.space) ? i.space : spaces[0].id,
      qty: Math.max(1, parseInt(i.qty, 10) || 1),
      unit: String(i.unit || '個').slice(0, 6),
      price: Math.max(0, Number(i.price) || 0),
      buyer: members.some((m) => m.id === i.buyer) ? i.buyer : '',
      date: i.date,
    }));
  return { spaces, members, items };
}

/* ===== 3. 小工具 ===== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const initial = (name) => esc(String(name).charAt(0));
const findMember = (id) => S.members.find((m) => m.id === id);
const spaceName = (id) => (S.spaces.find((s) => s.id === id) || { name: '未指定' }).name;
const valueOf = (item) => (item.price || 0) * item.qty;   // 成本 = 單價 × 目前數量

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

/* ===== 4. 畫面層：只負責把資料畫出來 ===== */
function renderAll() {
  // 篩選條件指到已被刪掉的空間或成員時，退回「全部」
  if (!['all', 'none'].includes(memberFilter) && !findMember(memberFilter)) memberFilter = 'all';
  // 正在看的空間被刪掉了，回到主畫面
  if (view === 'list' && spaceFilter !== 'all' && !S.spaces.some((s) => s.id === spaceFilter)) {
    view = 'home'; spaceFilter = 'all'; history.replaceState(null, '', location.pathname + location.search);
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
    <li class="item ${statusOf(d)}" data-id="${i.id}">
      <div class="top">
        <span class="ico" aria-hidden="true">${ICON[i.cat] || '📦'}</span>
        <div class="top-text">
          <div class="name">${esc(i.name)}</div>
          <div class="meta">${esc(i.cat)}・${esc(spaceName(i.space))}</div>
        </div>
        <span class="badge">${expiryLabel(d)}</span>
      </div>
      <div class="row">
        <div class="qty">
          <button type="button" data-act="dec" aria-label="減少數量">−</button>
          <span>${i.qty} ${esc(i.unit)}</span>
          <button type="button" data-act="inc" aria-label="增加數量">＋</button>
        </div>
        <span class="date">${i.date}</span>
      </div>
      <div class="row">
        <span class="chip">${buyerHtml}</span>
        <span class="money">${money(valueOf(i))}</span>
      </div>
      <div class="mini">
        <button type="button" data-act="edit">編輯</button>
        <button type="button" class="del" data-act="del">${armed === i.id ? '再按一次確認刪除' : '刪除'}</button>
      </div>
    </li>`;
}

// 管理面板的兩個清單（只在新增／刪除時重畫，改名時不重畫以免輸入框失去焦點）
function renderManage() {
  $('spaceList').innerHTML = S.spaces.map((s) => {
    const n = S.items.filter((i) => i.space === s.id).length;
    const isLast = S.spaces.length < 2;
    const isArmed = armed === s.id;
    return `
      <div class="edit-row" data-kind="space" data-id="${s.id}">
        <input value="${esc(s.name)}" maxlength="12" aria-label="儲存空間名稱">
        <span class="cnt">${n} 項</span>
        <button type="button" class="btn danger${isArmed ? ' armed' : ''}" data-del="space"${isLast ? ' disabled title="至少要保留一個儲存空間"' : ''}>${isArmed ? '確認刪除' : '刪除'}</button>
      </div>`;
  }).join('');

  $('memberList').innerHTML = S.members.length
    ? S.members.map((m) => {
        const isArmed = armed === m.id;
        return `
          <div class="edit-row" data-kind="member" data-id="${m.id}">
            <span class="av">${initial(m.name)}</span>
            <input value="${esc(m.name)}" maxlength="10" aria-label="成員名稱">
            <button type="button" class="btn danger${isArmed ? ' armed' : ''}" data-del="member">${isArmed ? '確認刪除' : '刪除'}</button>
          </div>`;
      }).join('')
    : '<p class="hint">還沒有成員，請在下方新增。</p>';
}

function showBackupMessage(text, type = '') {
  const el = $('backupMsg');
  el.textContent = text;
  el.className = 'hint ' + type;
}

/* ===== 5. 事件層：按鈕與輸入 ===== */

/* --- 管理儲存空間與成員 --- */
// 統計列的三個展開面板（成本、過期損失、管理）一次只開一個；name 傳 null 代表全部收起
const PANELS = { cost: 'costBtn', loss: 'lossBtn', manage: 'manageBtn' };
function setPanel(name) {
  for (const [key, btnId] of Object.entries(PANELS)) {
    $(key).hidden = key !== name;
    $(btnId).setAttribute('aria-expanded', key === name);
  }
  if (name === 'manage') { armed = null; renderManage(); }
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

function addNamed(inputId, list, prefix) {
  const name = $(inputId).value.trim();
  if (!name) return;
  list.push({ id: uid(prefix), name });
  $(inputId).value = '';
  save(); renderManage(); renderAll();
}
$('addSpace').onclick = () => addNamed('newSpace', S.spaces, 's');
$('addMember').onclick = () => addNamed('newMember', S.members, 'm');
for (const [inputId, btnId] of [['newSpace', 'addSpace'], ['newMember', 'addMember']]) {
  $(inputId).onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $(btnId).click(); }
  };
}

// 刪除：第一次按進入「待確認」，第二次才真的刪
function onManageClick(e) {
  const btn = e.target.closest('[data-del]');
  if (!btn || btn.disabled) return;
  const { id } = btn.closest('.edit-row').dataset;
  if (armed !== id) { armed = id; renderManage(); return; }
  armed = null;
  if (btn.dataset.del === 'space') {
    if (S.spaces.length < 2) return;
    S.spaces = S.spaces.filter((s) => s.id !== id);
    S.items = S.items.filter((i) => i.space !== id);   // 空間裡的食材一併移除
  } else {
    S.members = S.members.filter((m) => m.id !== id);
    S.items.forEach((i) => { if (i.buyer === id) i.buyer = ''; });
  }
  save(); renderManage(); renderAll();
}

// 改名：輸入框離開焦點時儲存
function onManageChange(e) {
  const input = e.target;
  if (input.tagName !== 'INPUT') return;
  const row = input.closest('.edit-row');
  const list = row.dataset.kind === 'space' ? S.spaces : S.members;
  const record = list.find((x) => x.id === row.dataset.id);
  if (!record) return;
  const name = input.value.trim();
  if (!name) { input.value = record.name; return; }
  record.name = name;
  const avatar = row.querySelector('.av');
  if (avatar) avatar.textContent = name.charAt(0);
  save(); renderAll();
}
for (const id of ['spaceList', 'memberList']) {
  $(id).onclick = onManageClick;
  $(id).onchange = onManageChange;
}

/* --- 備份：匯出與匯入 --- */
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

$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  pendingImport = null;
  $('importConfirm').hidden = true;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = validateBackup(JSON.parse(reader.result));
      if (!data) throw new Error('格式不符');
      pendingImport = data;
      $('importConfirm').hidden = false;
      showBackupMessage(`讀到 ${data.spaces.length} 個空間、${data.members.length} 位成員、${data.items.length} 筆食材。按下確認後會取代目前所有資料。`);
    } catch (err) {
      showBackupMessage('這不是有效的備份檔，請選擇由本頁匯出的 JSON 檔。', 'err');
    }
  };
  reader.onerror = () => showBackupMessage('讀取檔案失敗，請再試一次。', 'err');
  reader.readAsText(file);
};
$('importConfirm').onclick = () => {
  if (!pendingImport) return;
  S = pendingImport;
  pendingImport = null;
  $('importConfirm').hidden = true;
  armed = null;
  save(); renderManage(); renderAll();
  showBackupMessage('匯入完成。', 'ok');
};

/* --- 新增／編輯食材 --- */
function openForm(item) {
  editId = item ? item.id : null;
  $('formTitle').textContent = item ? '編輯食材' : '新增食材';
  $('fSpace').innerHTML = S.spaces.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('fBuyer').innerHTML = '<option value="">未指定</option>' +
    S.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('fName').value = item ? item.name : '';
  $('fCat').value = item ? item.cat : '蔬果';
  $('fSpace').value = item ? item.space : (view === 'list' && spaceFilter !== 'all' ? spaceFilter : S.spaces[0].id);
  $('fQty').value = item ? item.qty : 1;
  $('fUnit').value = item ? item.unit : '個';
  $('fPrice').value = item ? item.price : 0;
  $('fBuyer').value = item ? item.buyer : '';
  $('fDate').value = item ? item.date : offset(7);
  $('form').hidden = false;
  $('fName').focus();
  $('form').scrollIntoView({ block: 'nearest' });
}
function closeForm() { $('form').hidden = true; editId = null; }

$('addBtn').onclick = () => openForm(null);
$('cancelBtn').onclick = closeForm;
$('form').onsubmit = (e) => {
  e.preventDefault();
  const rec = {
    name: $('fName').value.trim(),
    cat: $('fCat').value,
    space: $('fSpace').value,
    qty: Math.max(1, parseInt($('fQty').value, 10) || 1),
    unit: $('fUnit').value.trim() || '個',
    price: Math.max(0, parseFloat($('fPrice').value) || 0),
    buyer: $('fBuyer').value,
    date: $('fDate').value,
  };
  if (!rec.name || !rec.date) return;
  if (editId !== null) S.items = S.items.map((i) => (i.id === editId ? { ...rec, id: i.id } : i));
  else S.items.push({ ...rec, id: uid('i') });
  save(); closeForm(); renderAll();
};

/* --- 篩選與卡片操作 --- */
$('q').oninput = renderList;
$('memberFilter').onchange = (e) => { memberFilter = e.target.value; renderList(); };

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
$('list').onclick = (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.item').dataset.id;
  const item = S.items.find((i) => i.id === id);
  if (!item) return;
  const act = btn.dataset.act;
  if (act === 'inc') { item.qty++; armed = null; }
  else if (act === 'dec') { if (item.qty > 1) item.qty--; armed = null; }
  else if (act === 'edit') { armed = null; openForm(item); return; }
  else if (act === 'del') {
    if (armed !== id) { armed = id; renderList(); return; }
    S.items = S.items.filter((i) => i.id !== id);
    armed = null;
  }
  save(); renderAll();
};
// 點到別處就取消「待確認刪除」
document.addEventListener('click', (e) => {
  if (armed === null || e.target.closest('.del') || e.target.closest('[data-del]')) return;
  armed = null;
  if (view === 'list') renderList();
  if (!$('manage').hidden) renderManage();
});

/* --- 啟動 --- */
const weekday = ['日', '一', '二', '三', '四', '五', '六'];
const now = new Date();
$('today').textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（週${weekday[now.getDay()]}）`;
route();
renderAll();
