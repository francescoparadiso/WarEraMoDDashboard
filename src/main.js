import Chart from 'chart.js/auto';

// ==================== CONFIG ====================
const APP_BASE = 'https://app.warera.io';
const API_BASE = 'https://politicalview-proxy.fra-paradiso2.workers.dev/cache';
const HARDCODED_CSV_URL =
  'https://raw.githubusercontent.com/francescoparadiso/WarEraMoDDashboard/refs/heads/main/Mu.csv';


// ==================== STATO GLOBALE ====================
let battalions = [];
let selectedBattalionId = null;
const muDataCache = new Map();
const userCache = new Map();
const userAliasMap = new Map();

let csvSortColumn = 'weeklyDamage';
let csvSortDirection = 'desc';
let csvMuData = [];
let csvDamageChart = null;
let csvMembersChart = null;
let csvLevelChart = null;
let csvWeeklyPerMemberChart = null;
let lastRenderedDataHash = '';

// ==================== DOM REFS ====================
const battalionListDiv = document.getElementById('battalionListContainer');
const detailPanel = document.getElementById('detailPanel');
const newBtn = document.getElementById('newBattalionBtn');
const refreshAllBtn = document.getElementById('refreshAllBtn');
const battalionsView = document.getElementById('battalionsView');
const csvAnalysisView = document.getElementById('csvAnalysisView');
const modeBattalionsBtn = document.getElementById('modeBattalionsBtn');
const modeCsvAnalysisBtn = document.getElementById('modeCsvAnalysisBtn');
const showDamageBtn = document.getElementById('showDamageChartBtn');
const showLevelBtn = document.getElementById('showLevelChartBtn');
const showDonutBtn = document.getElementById('showDonutChartBtn');
const showWeeklyPerMemberBtn = document.getElementById('showWeeklyPerMemberChartBtn');
const damageContainer = document.getElementById('damageChartContainer');
const levelContainer = document.getElementById('levelChartContainer');
const donutContainer = document.getElementById('donutChartContainer');
const weeklyPerMemberContainer = document.getElementById('weeklyPerMemberChartContainer');

// ==================== TOAST ====================
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.style.cssText =
      'position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:10000;max-width:350px;';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, _type = 'info') {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.style.cssText =
    `background:#0e1117;border-left:3px solid ${_type==='error'?'#f87171':_type==='success'?'#3ecf8e':'#f5a623'};color:#e2e4ec;padding:11px 18px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.6);opacity:1;transition:opacity 0.3s;font-family:'DM Mono',monospace;font-size:12px;backdrop-filter:blur(10px);`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ==================== LOADER / PROGRESS ====================
// ==================== PROGRESS PANEL ====================
const _css = document.createElement('style');
_css.textContent = `
  @keyframes _spin{to{transform:rotate(360deg)}}
  #_progPanel{position:fixed;bottom:24px;right:24px;width:300px;background:#0c0e14;border:1px solid rgba(245,166,35,0.35);border-radius:14px;padding:18px;z-index:20001;box-shadow:0 8px 40px rgba(0,0,0,0.8);font-family:'DM Mono',monospace;font-size:12px;color:#e2e4ec;transition:opacity 0.4s;opacity:0;pointer-events:none;}
  #_progPanel.visible{opacity:1;}
  ._prow{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);}
  ._prow:last-child{border-bottom:none;}
  ._picon{width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;}
  ._spin{width:14px;height:14px;border:2px solid rgba(245,166,35,0.2);border-top-color:#f5a623;border-radius:50%;animation:_spin 0.7s linear infinite;}
  ._plabel{flex:1;color:#8891aa;}
  ._plabel.active{color:#e2e4ec;}
  ._pval{color:#f5a623;font-weight:600;min-width:60px;text-align:right;}
  ._pbar-wrap{margin-top:12px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;}
  ._pbar{height:100%;width:0%;background:linear-gradient(90deg,#f5a623,#ffd166);border-radius:2px;transition:width 0.25s;box-shadow:0 0 6px #f5a62366;}
`;
document.head.appendChild(_css);

const _panel = document.createElement('div');
_panel.id = '_progPanel';
_panel.innerHTML = `
  <div style="font-family:'Oxanium',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#f5a623;margin-bottom:10px;">⟳ Caricamento dati</div>
  <div id="_pr0" class="_prow"><span class="_picon">○</span><span class="_plabel">Download CSV</span><span class="_pval" id="_pv0">—</span></div>
  <div id="_pr1" class="_prow"><span class="_picon">○</span><span class="_plabel">Fetch MU</span><span class="_pval" id="_pv1">—</span></div>
  <div id="_pr2" class="_prow"><span class="_picon">○</span><span class="_plabel">Profili giocatori</span><span class="_pval" id="_pv2">—</span></div>
  <div class="_pbar-wrap"><div class="_pbar" id="_pbar"></div></div>
`;
document.body.appendChild(_panel);

let _totalPct = 0;
function _setStep(idx, state, val) {
  // state: 'pending'|'active'|'done'|'error'
  const row = document.getElementById('_pr'+idx);
  const icon = row.querySelector('._picon');
  const label = row.querySelector('._plabel');
  const valEl = document.getElementById('_pv'+idx);
  if (state==='active') { icon.innerHTML='<div class="_spin"></div>'; label.classList.add('active'); }
  else if (state==='done') { icon.textContent='✓'; icon.style.color='#3ecf8e'; label.style.color='#3ecf8e'; }
  else if (state==='error') { icon.textContent='✗'; icon.style.color='#f87171'; }
  if (val!=null) valEl.textContent = val;
}
function _setPct(pct) {
  _totalPct = pct;
  document.getElementById('_pbar').style.width = Math.min(pct,100)+'%';
}

function showLoader(msg) {
  _panel.classList.add('visible');
  // reset
  [0,1,2].forEach(i=>{ _setStep(i,'pending',null); document.getElementById('_pv'+i).textContent='—'; document.querySelectorAll('._plabel')[i]&&document.querySelectorAll('#_pr'+i+' ._plabel')[0]?.classList.remove('active'); });
  _setPct(5);
}
function updateLoader(msg, pct, stepData) {
  if (pct!=null) _setPct(pct);
  // stepData: {step:0|1|2, state, val}
  if (stepData) _setStep(stepData.step, stepData.state, stepData.val);
}
function hideLoader() {
  _setPct(100);
  setTimeout(()=>{ _panel.classList.remove('visible'); }, 1800);
}

// ==================== UTILITY ====================
function formatNumber(num, isDecimal = false) {
  if (num === null || num === undefined) return '0';
  if (isDecimal) return Number(num).toFixed(2);
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

function truncName(name) {
  return name.length > 15 ? name.substr(0, 12) + '...' : name;
}

// ==================== RADAR ANIMATO ====================
function initRadar() {
  const canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function drawRadar() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#f5a62360';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (w / 2) * i / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.strokeStyle = '#f5a62340';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.arc(w / 2, h / 2, w / 2, angle, angle + 0.5);
    ctx.closePath();
    ctx.fillStyle = '#f5a62320';
    ctx.fill();
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, angle, angle + 0.5);
    ctx.stroke();
    angle += 0.02;
    requestAnimationFrame(drawRadar);
  }
  drawRadar();
}

// ==================== API: MU ====================
async function fetchMuById(muId) {
  try {
    const url = `${API_BASE}/mu?id=${encodeURIComponent(muId)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data) return null;
    // Assicura che la struttura sia come quella che usava tRPC
    if (!data.members) data.members = [];
    if (!data.rankings) data.rankings = {};
    return data;
  } catch (err) {
    console.error(`Errore fetch MU ${muId}:`, err);
    throw err;
  }
}

// ==================== API: UTENTE ====================
async function fetchUserById(userId) {
  if (userAliasMap.has(userId)) {
    return { name: userAliasMap.get(userId), id: userId, avatarUrl: null, level: 0 };
  }
  if (userCache.has(userId)) return userCache.get(userId);

  try {
    const url = `${API_BASE}/user?id=${encodeURIComponent(userId)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const name = data.username || data.name || `ID: ${userId.slice(-6)}`;
    const user = {
      name,
      id: userId,
      avatarUrl: data.avatarUrl || null,
      level: data.leveling?.level || 0,
    };
    userCache.set(userId, user);
    return user;
  } catch (err) {
    console.warn(`Utente ${userId} non caricato`, err);
    const fallback = { name: `ID: ${userId.slice(-6)}`, id: userId, avatarUrl: null, level: 0 };
    userCache.set(userId, fallback);
    return fallback;
  }
}

// ==================== API: BATCH HELPERS ====================
async function refreshAllMuData() {
  const allMuIds = new Set();
  battalions.forEach(b => b.muIds.forEach(id => allMuIds.add(id)));
  const ids = Array.from(allMuIds);
  if (ids.length === 0) return;

  showLoader(); _setStep(1,'active',`0 / ${ids.length}`);
  let done = 0;
  const results = await Promise.allSettled(ids.map(id => fetchMuById(id).then(r => { done++; _setStep(1,'active',`${done} / ${ids.length}`); _setPct(10+done/ids.length*85); return r; })));
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) { muDataCache.set(ids[i], result.value); }
    else { muDataCache.delete(ids[i]); }
  });
  _setStep(1,'done',`${ids.length} ok`); hideLoader();
}

async function loadMultipleMus(muIds) {
  const uniqueIds = [...new Set(muIds)];
  const results = await Promise.allSettled(uniqueIds.map(id => fetchMuById(id)));
  return results.map(r => (r.status === 'fulfilled' ? r.value : null));
}

async function preloadUserNames(userIds, showProgress = false) {
  const uniqueIds = [...new Set(userIds)];
  const toLoad = uniqueIds.filter(id => !userCache.has(id));
  if (toLoad.length === 0) return;
  if (showProgress) _setStep(2,'active',`0 / ${toLoad.length}`);
  let _p = 0;
  await Promise.allSettled(toLoad.map(id => fetchUserById(id).then(r => { _p++; if(showProgress) { _setStep(2,'active',`${_p} / ${toLoad.length}`); _setPct(80 + _p/toLoad.length*18); }; return r; })));
  if (showProgress) { _setStep(2,'done',toLoad.length+' ok'); }
}

// ==================== STORAGE ====================
function createBattalion(name, chiefUserId = '') {
  return {
    id: 'b_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    name,
    chiefUserId,
    muIds: [],
  };
}

function loadBattalions() {
  const stored = localStorage.getItem('warera_battalions_v2');
  if (stored) {
    try {
      battalions = JSON.parse(stored);
      return;
    } catch (e) {
      console.warn('Errore parsing battaglioni salvati', e);
    }
  }

  // --- Nessun dato salvato: crea i 4 battaglioni predefiniti ---
  battalions = [
    {
      id: 'b_default_I',
      name: 'Battaglione I',
      chiefUserId: '',
      muIds: [
        '69a1e22949bc4af6d2abaf3f',
        '69bb39bbd079dc7ca5d47276',
        '69de83ed0e1f8588dc487d4b',
        '69f0ff2b03e842494bcce2ed',
        '69e76833f7b095e977ca0c10',
        '6a00f61892e353276d7c6f34'
      ]
    },
    {
      id: 'b_default_II',
      name: 'Battaglione II',
      chiefUserId: '',
      muIds: [
        '6995cecc7bb099ced6e188e6',
        '69f9063c0770ed5cc6e7b346',
        '6886502bdb293829ac2d83ff',
        '69d769fe08b7bb649764c2d2',
        '69e7b760f9474bb158eb2952',
        '69f9f051d04c814cddf7458f'
      ]
    },
    {
      id: 'b_default_III',
      name: 'Battaglione III',
      chiefUserId: '',
      muIds: [
        '68fba5fc1e6dc00c9dc82823',
        '6995925be855fe967aeee814',
        '69f9bcd3b245fa3c49bb338f',
        '69fe0248c513525f28c2e031',
        '69daabf2f66a3dde50919054',
        '69df6a25a03070cad536d540'
      ]
    },
    {
      id: 'b_default_IV',
      name: 'Battaglione IV',
      chiefUserId: '',
      muIds: [
        '696555d7cde9ff82a479dffd',
        '6973b4d3eed64c805d54bd07',
        '69d0089dabdcd354687f45cc',
        '69e1e02e8515e0b071741bf6'
      ]
    }
  ];

  // Salva subito i battaglioni predefiniti per evitare di ricrearli al prossimo avvio
  saveBattalions();
}

function saveBattalions() {
  localStorage.setItem('warera_battalions_v2', JSON.stringify(battalions));
}

// ==================== STATS ====================
function getAllMembersOfBattalion(battalion) {
  const membersSet = new Set();
  battalion.muIds.forEach(muId => {
    const mu = muDataCache.get(muId);
    if (mu?.members) mu.members.forEach(m => membersSet.add(m));
  });
  return Array.from(membersSet);
}

function getBattalionStats(battalion) {
  let totalMembers = 0, totalWeeklyDamage = 0, totalDamage = 0, totalBounty = 0, totalLevel = 0;
  battalion.muIds.forEach(muId => {
    const mu = muDataCache.get(muId);
    if (mu) {
      totalMembers += mu.members?.length || 0;
      totalWeeklyDamage += mu.rankings?.muWeeklyDamages?.value || 0;
      totalDamage += mu.rankings?.muDamages?.value || 0;
      totalBounty += mu.rankings?.muBounty?.value || 0;
    }
  });
  getAllMembersOfBattalion(battalion).forEach(uid => {
    const user = userCache.get(uid);
    if (user) totalLevel += user.level || 0;
  });
  return { totalMembers, totalWeeklyDamage, totalDamage, totalBounty, totalLevel };
}

// ==================== RENDERING LISTA BATTAGLIONI ====================
function renderBattalionList() {
  if (battalions.length === 0) {
    battalionListDiv.innerHTML =
      '<div style="color:#6a8a6a;text-align:center;padding:20px;">Nessun battaglione. Creane uno!</div>';
    return;
  }
  battalionListDiv.innerHTML = battalions
    .map(b => {
      const stats = getBattalionStats(b);
      return `
      <div class="battalion-card ${selectedBattalionId === b.id ? 'selected' : ''}" data-id="${b.id}">
        <div class="battalion-name">
          ${b.name}
          <span style="font-size:12px;color:#8aaa8a;">${b.muIds.length} MU</span>
        </div>
        <div class="battalion-stats">
          <div class="stat"><span class="stat-label">Membri</span><span class="stat-value">${stats.totalMembers}</span></div>
          <div class="stat"><span class="stat-label">Livello</span><span class="stat-value">${stats.totalLevel}</span></div>
          <div class="stat"><span class="stat-label">Danno Sett.</span><span class="stat-value">${formatNumber(stats.totalWeeklyDamage)}</span></div>
        </div>
      </div>`;
    })
    .join('');

  document.querySelectorAll('.battalion-card').forEach(card => {
    card.addEventListener('click', () => selectBattalion(card.dataset.id));
  });
}

// ==================== PANNELLO BILANCIAMENTO ====================
function renderBalancePanel() {
  const container = document.getElementById('balanceListContainer');
  if (!container) return;
  if (battalions.length === 0) {
    container.innerHTML = '<div style="color:#6a8a6a;text-align:center;padding:20px;">Nessun battaglione.</div>';
    return;
  }

  const withStats = battalions
    .map(b => {
      const stats = getBattalionStats(b);
      const muDetails = b.muIds.map(muId => {
        const mu = muDataCache.get(muId);
        let muLevel = 0;
        if (mu?.members) mu.members.forEach(uid => { const u = userCache.get(uid); if (u) muLevel += u.level || 0; });
        return { id: muId, name: mu?.name || muId.slice(-6), members: mu?.members?.length || 0, level: muLevel };
      });
      return { ...b, stats, muDetails };
    })
    .sort((a, b) => a.stats.totalLevel - b.stats.totalLevel);

  container.innerHTML = withStats
    .map(
      b => `
    <div class="battalion-balance-item" data-id="${b.id}" style="${selectedBattalionId === b.id ? 'border-color:#00ff88;' : ''}">
      <div class="battalion-balance-name">
        ${b.name}
        <span style="color:#00ff88;">Lv.${b.stats.totalLevel}</span>
      </div>
      <div class="battalion-balance-stats">
        <span>👥 ${b.stats.totalMembers}</span>
        <span>⚔️ ${formatNumber(b.stats.totalWeeklyDamage)}</span>
      </div>
      <div class="balance-mu-list">
        ${b.muDetails
          .map(mu => `<div class="balance-mu-item"><span>${mu.name}</span><span>Lv.${mu.level} (${mu.members})</span></div>`)
          .join('')}
      </div>
    </div>`
    )
    .join('');

  container.querySelectorAll('.battalion-balance-item').forEach(item => {
    item.addEventListener('click', () => selectBattalion(item.dataset.id));
  });
}

async function selectBattalion(id) {
  selectedBattalionId = id;
  renderBattalionList();
  renderBalancePanel();
  await renderBattalionDetail(id);
}

// ==================== DETTAGLIO BATTAGLIONE ====================
async function renderBattalionDetail(battalionId) {
  const battalion = battalions.find(b => b.id === battalionId);
  if (!battalion) {
    detailPanel.innerHTML = '<div style="text-align:center;color:#6a8a6a;">Battaglione non trovato</div>';
    return;
  }

  const allMembers = getAllMembersOfBattalion(battalion);
  const userIdsToLoad = [...allMembers];
  if (battalion.chiefUserId) userIdsToLoad.push(battalion.chiefUserId);
  await preloadUserNames(userIdsToLoad);

  const stats = getBattalionStats(battalion);
  const chiefUser = battalion.chiefUserId ? await fetchUserById(battalion.chiefUserId) : null;

  let html = `
  <div class="detail-header">
    <h2>${battalion.name}</h2>
    <span class="badge">${battalion.muIds.length} MU</span>
    <div style="flex:1"></div>
    <button id="editBattalionBtn" class="secondary">✏️ Modifica</button>
    <button id="deleteBattalionBtn" class="danger-btn">🗑️ Elimina</button>
  </div>
  <div class="flex-row">
    <div><strong>Capo:</strong> ${
      chiefUser
        ? `<a href="${APP_BASE}/user/${battalion.chiefUserId}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;">
            ${chiefUser.avatarUrl ? `<img src="${chiefUser.avatarUrl}" style="width:24px;height:24px;border-radius:50%;border:1px solid #00ff88;object-fit:cover;">` : ''}
            ${chiefUser.name} (Liv. ${chiefUser.level || 0})
           </a>`
        : '<span style="color:#6a8a6a;">non assegnato</span>'
    }</div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:20px;margin-bottom:20px;">
    <div class="stat"><span class="stat-label">Membri totali</span><span class="stat-value" style="font-size:24px;">${stats.totalMembers}</span></div>
    <div class="stat"><span class="stat-label">Livello Totale</span><span class="stat-value" style="font-size:24px;">${stats.totalLevel}</span></div>
    <div class="stat"><span class="stat-label">Danno Settimanale</span><span class="stat-value" style="font-size:24px;">${formatNumber(stats.totalWeeklyDamage)}</span></div>
    <div class="stat"><span class="stat-label">Danno Totale</span><span class="stat-value" style="font-size:24px;">${formatNumber(stats.totalDamage)}</span></div>
    <div class="stat"><span class="stat-label">Bounty Totale</span><span class="stat-value" style="font-size:24px;">${formatNumber(stats.totalBounty, true)}</span></div>
  </div>
  <div class="section-title">📋 Military Units (${battalion.muIds.length})</div>
  <div style="margin-bottom:15px;">
    <button id="addMuToBattalionBtn">➕ Aggiungi MU</button>
    <button id="refreshBattalionMusBtn" class="secondary" style="margin-left:10px;">🔄 Aggiorna MU</button>
  </div>`;

  if (battalion.muIds.length > 0) {
    html += `<table class="mu-table">
      <thead><tr><th>Nome MU</th><th>Membri</th><th>Livello</th><th>Danno Sett.</th><th>Danno Tot.</th><th>Azioni</th></tr></thead>
      <tbody>`;
    for (const muId of battalion.muIds) {
      const mu = muDataCache.get(muId);
      if (mu) {
        let muLevel = 0;
        if (mu.members) mu.members.forEach(uid => { const u = userCache.get(uid); if (u) muLevel += u.level || 0; });
        html += `<tr class="clickable" data-mu-id="${muId}">
          <td><a href="${APP_BASE}/mu/${muId}" target="_blank" onclick="event.stopPropagation()">${mu.name || 'Sconosciuta'}</a></td>
          <td>${mu.members?.length || 0}</td>
          <td>${muLevel}</td>
          <td>${formatNumber(mu.rankings?.muWeeklyDamages?.value || 0)}</td>
          <td>${formatNumber(mu.rankings?.muDamages?.value || 0)}</td>
          <td>
            <button class="secondary view-mu-members" data-mu-id="${muId}" style="padding:4px 8px;font-size:12px;">👥 Membri</button>
            <button class="danger-btn remove-mu-btn" data-mu-id="${muId}" style="padding:4px 8px;font-size:12px;margin-left:5px;">✕</button>
          </td>
        </tr>`;
      } else {
        html += `<tr><td colspan="6" style="color:#6a8a6a;">⚠️ MU ${muId.slice(-6)} non caricata</td></tr>`;
      }
    }
    html += `</tbody></table>`;
  } else {
    html += '<p style="color:#6a8a6a;">Nessuna MU assegnata. Aggiungine una tramite ID.</p>';
  }

  html += `<div class="section-title">👥 Membri del Battaglione (${allMembers.length})</div>`;
  if (allMembers.length > 0) {
    const memberNames = await Promise.all(allMembers.map(id => fetchUserById(id)));
    html += `<div class="members-list">`;
    memberNames.forEach(user => {
      const avatarHtml = user.avatarUrl
        ? `<img src="${user.avatarUrl}" style="width:20px;height:20px;border-radius:50%;border:1px solid #00ff88;margin-right:4px;object-fit:cover;">`
        : '';
      const isElite = (user.level || 0) >= 20;
      html += `<a href="${APP_BASE}/user/${user.id}" target="_blank" class="badge${isElite ? ' badge-elite' : ''}" style="margin:4px;display:inline-flex;align-items:center;">${avatarHtml}${user.name} (Lv.${user.level || 0})</a>`;
    });
    html += `</div>`;
  } else {
    html += '<p style="color:#6a8a6a;">Nessun membro.</p>';
  }

  detailPanel.innerHTML = html;

  document.getElementById('editBattalionBtn')?.addEventListener('click', () => editBattalion(battalion));
  document.getElementById('deleteBattalionBtn')?.addEventListener('click', () => deleteBattalion(battalion.id));
  document.getElementById('addMuToBattalionBtn')?.addEventListener('click', () => addMuToBattalion(battalion.id));
  document.getElementById('refreshBattalionMusBtn')?.addEventListener('click', async () => {
    await refreshAllMuData();
    await renderBattalionDetail(battalion.id);
    renderBattalionList();
  });

  document.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      showMuDetail(row.dataset.muId, battalion.id);
    });
  });
  document.querySelectorAll('.view-mu-members').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); showMuDetail(btn.dataset.muId, battalion.id); });
  });
  document.querySelectorAll('.remove-mu-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeMuFromBattalion(battalion.id, btn.dataset.muId); });
  });
}

// ==================== GESTIONE BATTAGLIONI ====================
function editBattalion(battalion) {
  const newName = prompt('Nuovo nome del battaglione:', battalion.name);
  if (newName) battalion.name = newName;
  const newChief = prompt('ID del Capo (userId):', battalion.chiefUserId);
  if (newChief !== null) battalion.chiefUserId = newChief;
  saveBattalions();
  renderBattalionList();
  renderBalancePanel();
  renderBattalionDetail(battalion.id);
}

function deleteBattalion(id) {
  if (confirm('Eliminare questo battaglione?')) {
    battalions = battalions.filter(b => b.id !== id);
    if (selectedBattalionId === id) selectedBattalionId = null;
    saveBattalions();
    renderBattalionList();
    renderBalancePanel();
    if (!selectedBattalionId) {
      detailPanel.innerHTML =
        '<div style="text-align:center;color:#6a8a6a;padding:50px;">Seleziona un battaglione o creane uno nuovo</div>';
    } else {
      renderBattalionDetail(selectedBattalionId);
    }
  }
}

async function addMuToBattalion(battalionId) {
  const muId = prompt("Inserisci l'ID della MU da aggiungere:");
  if (!muId) return;
  const battalion = battalions.find(b => b.id === battalionId);
  if (battalion.muIds.includes(muId)) { alert('MU già presente nel battaglione.'); return; }
  try {
    const mu = await fetchMuById(muId);
    muDataCache.set(muId, mu);
    battalion.muIds.push(muId);
    saveBattalions();
    renderBattalionList();
    renderBalancePanel();
    await renderBattalionDetail(battalionId);
  } catch {
    alert('ID MU non valido o errore di rete.');
  }
}

function removeMuFromBattalion(battalionId, muId) {
  const battalion = battalions.find(b => b.id === battalionId);
  battalion.muIds = battalion.muIds.filter(id => id !== muId);
  saveBattalions();
  renderBattalionList();
  renderBalancePanel();
  renderBattalionDetail(battalionId);
}

// ==================== DETTAGLIO SINGOLA MU ====================
async function showMuDetail(muId, battalionId) {
  const mu = muDataCache.get(muId);
  if (!mu) return;
  await preloadUserNames(mu.members || []);

  let totalMuLevel = 0;
  if (mu.members) mu.members.forEach(uid => { const u = userCache.get(uid); if (u) totalMuLevel += u.level || 0; });

  let html = `
  <div style="margin-bottom:20px;">
    <button id="backToBattalionBtn" class="secondary">← Torna</button>
  </div>
  <h2><a href="${APP_BASE}/mu/${muId}" target="_blank">${mu.name}</a> <span class="badge">${mu._id}</span></h2>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:20px 0;">
    <div class="stat"><span class="stat-label">Membri</span><span class="stat-value">${mu.members?.length || 0}</span></div>
    <div class="stat"><span class="stat-label">Livello Totale</span><span class="stat-value">${totalMuLevel}</span></div>
    <div class="stat"><span class="stat-label">Danno Totale</span><span class="stat-value">${formatNumber(mu.rankings?.muDamages?.value || 0)}</span></div>
    <div class="stat"><span class="stat-label">Danno Sett.</span><span class="stat-value">${formatNumber(mu.rankings?.muWeeklyDamages?.value || 0)}</span></div>
    <div class="stat"><span class="stat-label">Bounty</span><span class="stat-value">${formatNumber(mu.rankings?.muBounty?.value || 0, true)}</span></div>
    <div class="stat"><span class="stat-label">Terreno</span><span class="stat-value">${mu.rankings?.muTerrain?.value || 0}</span></div>
  </div>
  <div class="section-title">👥 Membri della MU (${mu.members?.length || 0})</div>`;

  if (mu.members?.length > 0) {
    const memberNames = await Promise.all(mu.members.map(id => fetchUserById(id)));
    html += `<div class="members-list">`;
    memberNames.forEach(user => {
      const avatarHtml = user.avatarUrl
        ? `<img src="${user.avatarUrl}" style="width:20px;height:20px;border-radius:50%;border:1px solid #00ff88;margin-right:4px;object-fit:cover;">`
        : '';
      const isElite = (user.level || 0) >= 20;
      html += `<a href="${APP_BASE}/user/${user.id}" target="_blank" class="badge${isElite ? ' badge-elite' : ''}" style="margin:4px;display:inline-flex;align-items:center;">${avatarHtml}${user.name} (Lv.${user.level || 0})</a>`;
    });
    html += `</div>`;
  } else {
    html += '<p style="color:#6a8a6a;">Nessun membro.</p>';
  }

  detailPanel.innerHTML = html;
  document.getElementById('backToBattalionBtn').addEventListener('click', () => {
    if (battalionId) {
      renderBattalionDetail(battalionId);
    } else {
      csvAnalysisView.classList.add('active');
      battalionsView.classList.remove('active');
      renderCsvAnalysis();
    }
  });
}

// ==================== CREA NUOVO BATTAGLIONE ====================
function createNewBattalion() {
  const name = prompt('Nome del nuovo battaglione:');
  if (!name) return;
  const chief = prompt('ID del Capo (opzionale):') || '';
  const newB = createBattalion(name, chief);
  battalions.push(newB);
  saveBattalions();
  renderBattalionList();
  selectBattalion(newB.id);
}

// ==================== AUTO-BILANCIAMENTO ====================
async function autoBalanceBattalions() {
  const countStr = prompt('In quanti battaglioni vuoi dividere le MU?', '2');
  if (!countStr) return;
  const battalionCount = parseInt(countStr, 10);
  if (isNaN(battalionCount) || battalionCount < 2) { alert('Inserisci un numero valido (minimo 2).'); return; }

  const muListStr = prompt('Incolla la lista degli ID delle MU (separati da virgola, spazio o a capo):');
  if (!muListStr) return;

  const muIds = muListStr.split(/[\s,]+/).filter(id => id.trim().length > 0);
  if (muIds.length === 0) { alert('Nessun ID valido inserito.'); return; }

  showToast(`🔄 Caricamento ${muIds.length} MU...`, 'info');

  const muDataList = [];
  for (const muId of muIds) {
    try {
      let mu = muDataCache.get(muId);
      if (!mu) { mu = await fetchMuById(muId); muDataCache.set(muId, mu); }
      let muLevel = 0;
      if (mu.members) {
        await preloadUserNames(mu.members);
        mu.members.forEach(uid => { const u = userCache.get(uid); if (u) muLevel += u.level || 0; });
      }
      muDataList.push({ id: muId, name: mu.name || muId.slice(-6), level: muLevel, members: mu.members?.length || 0 });
    } catch { console.warn(`MU ${muId} non trovata, la salto.`); }
  }

  if (muDataList.length === 0) { alert('Nessuna MU valida trovata.'); return; }

  muDataList.sort((a, b) => b.level - a.level);
  const newBattalions = Array.from({ length: battalionCount }, (_, i) => ({
    name: `Battaglione ${i + 1}`, muIds: [], totalLevel: 0,
  }));

  for (const mu of muDataList) {
    const minIdx = newBattalions.reduce((mi, b, i, arr) => (b.totalLevel < arr[mi].totalLevel ? i : mi), 0);
    newBattalions[minIdx].muIds.push(mu.id);
    newBattalions[minIdx].totalLevel += mu.level;
  }

  let summary = `Distribuzione proposta per ${muDataList.length} MU in ${battalionCount} battaglioni:\n\n`;
  newBattalions.forEach(b => { summary += `${b.name}: ${b.muIds.length} MU, Livello: ${b.totalLevel}\n`; });
  summary += '\nVuoi creare questi battaglioni? (quelli esistenti non verranno cancellati)';
  if (!confirm(summary)) return;

  for (const b of newBattalions) {
    if (b.muIds.length > 0) {
      const newB = createBattalion(b.name);
      newB.muIds = b.muIds;
      battalions.push(newB);
    }
  }
  saveBattalions();
  renderBattalionList();
  renderBalancePanel();
  if (battalions.length > 0 && !selectedBattalionId) selectBattalion(battalions[0].id);
  showToast(`✅ Creati ${newBattalions.filter(b => b.muIds.length > 0).length} battaglioni!`, 'success');
}

// ==================== CSV: GRAFICI ====================
function setActiveChartButton(activeBtn) {
  [showDamageBtn, showLevelBtn, showDonutBtn, showWeeklyPerMemberBtn].forEach(btn =>
    btn.classList.remove('active-chart-btn')
  );
  activeBtn.classList.add('active-chart-btn');
}

function destroyCharts() {
  if (csvDamageChart) { csvDamageChart.destroy(); csvDamageChart = null; }
  if (csvLevelChart) { csvLevelChart.destroy(); csvLevelChart = null; }
  if (csvMembersChart) { csvMembersChart.destroy(); csvMembersChart = null; }
  if (csvWeeklyPerMemberChart) { csvWeeklyPerMemberChart.destroy(); csvWeeklyPerMemberChart = null; }
}

function buildCharts() {
  const top10 = [...csvMuData].sort((a, b) => b.weeklyDamage - a.weeklyDamage).slice(0, 10);
  const top10weekly = [...csvMuData]
    .map(mu => ({ ...mu, value: mu.members ? mu.weeklyDamage / mu.members : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#d0e0d0' } } },
  };

  destroyCharts();

  csvDamageChart = new Chart(document.getElementById('csvDamageChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: top10.map(m => truncName(m.name)),
      datasets: [{ label: 'Danno Sett. (Top 10)', data: top10.map(m => m.weeklyDamage), backgroundColor: '#f5a62360', borderColor: '#f5a623', borderWidth: 1 }],
    },
    options: chartOpts,
  });

  csvLevelChart = new Chart(document.getElementById('csvLevelChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: csvMuData.map(m => truncName(m.name)),
      datasets: [{ label: 'Livello Totale', data: csvMuData.map(m => m.totalLevel), backgroundColor: '#f5a62360', borderColor: '#f5a623', borderWidth: 1 }],
    },
    options: chartOpts,
  });

  csvMembersChart = new Chart(document.getElementById('csvMembersChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: csvMuData.map(m => truncName(m.name)),
      datasets: [{
        data: csvMuData.map(m => m.weeklyDamage),
        backgroundColor: ['#f5a623','#2ecc71','#27ae60','#1abc9c','#16a085','#00d4ff','#3498db','#2980b9','#9b59b6','#8e44ad'],
        borderColor: '#0a0f0c', borderWidth: 1,
      }],
    },
    options: {
      ...chartOpts,
      plugins: {
        ...chartOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatNumber(ctx.raw)}` } },
      },
    },
  });

  csvWeeklyPerMemberChart = new Chart(document.getElementById('csvWeeklyPerMemberChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: top10weekly.map(m => truncName(m.name)),
      datasets: [{ label: 'Danno Sett./Membro (Top 10)', data: top10weekly.map(m => m.value), backgroundColor: '#f5a62360', borderColor: '#f5a623', borderWidth: 1 }],
    },
    options: chartOpts,
  });
}

// ==================== CSV: SORT ====================
function sortCsvData(data, column, direction) {
  return [...data].sort((a, b) => {
    let valA, valB;
    if (column === 'dmgPerMember') { valA = a.members ? a.totalDamage / a.members : 0; valB = b.members ? b.totalDamage / b.members : 0; }
    else if (column === 'weeklyPerMember') { valA = a.members ? a.weeklyDamage / a.members : 0; valB = b.members ? b.weeklyDamage / b.members : 0; }
    else if (column === 'bountyPerMember') { valA = a.members ? a.bounty / a.members : 0; valB = b.members ? b.bounty / b.members : 0; }
    else if (column === 'efficiency') { valA = a.totalLevel ? a.weeklyDamage / a.totalLevel : 0; valB = b.totalLevel ? b.weeklyDamage / b.totalLevel : 0; }
    else { valA = a[column]; valB = b[column]; }
    if (column === 'name') { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
    if (typeof valA === 'string') return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return direction === 'asc' ? valA - valB : valB - valA;
  });
}

// ==================== CSV: LOAD ====================
async function loadCsvFromUrl(url) {
  showLoader(); _setStep(0,'active','...');
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Impossibile scaricare il CSV');
    _setStep(0,'active','parsing...'); _setPct(20);
    const text = await resp.text();
    const cleanText = text.replace(/["']/g, ' ');
    const matches = cleanText.match(/[a-f0-9]{24}/gi);
    let muIds = [];
    if (matches?.length > 0) {
      muIds = [...new Set(matches.map(id => id.toLowerCase()))];
    } else {
      const tokens = cleanText.split(/[\s,]+/).filter(t => t.length === 24 && /^[a-f0-9]+$/i.test(t));
      muIds = [...new Set(tokens.map(t => t.toLowerCase()))];
    }
    if (!muIds.length) throw new Error('Nessun ID MU valido trovato nel CSV');
    _setStep(0,'done',`${muIds.length} ID`); _setStep(1,'active','0 / '+muIds.length); _setPct(30);
    await loadCsvMuData(muIds);
    renderCsvAnalysis();
    damageContainer.style.display = 'block';
    levelContainer.style.display = 'none';
    donutContainer.style.display = 'none';
    weeklyPerMemberContainer.style.display = 'none';
    setActiveChartButton(showDamageBtn);
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

async function loadCsvMuData(muIds) {
  csvMuData = [];
  const uniqueIds = [...new Set(muIds)];
  let _cm = 0;
  _setStep(1,'active',`0 / ${uniqueIds.length}`);
  const muData = await Promise.allSettled(uniqueIds.map(id => fetchMuById(id).then(r => { _cm++; _setStep(1,'active',`${_cm} / ${uniqueIds.length}`); _setPct(30 + _cm/uniqueIds.length*50); return r; }))).then(rs => rs.map(r => r.status==='fulfilled'?r.value:null));
  const allUserIds = new Set();
  muData.forEach(mu => { if (mu?.members) mu.members.forEach(uid => allUserIds.add(uid)); });
  if (allUserIds.size) { _setStep(1,'done',`${uniqueIds.length} ok`); _setStep(2,'active',`0 / ${allUserIds.size}`); _setPct(80); await preloadUserNames(Array.from(allUserIds), true); } else { _setStep(1,'done',`${uniqueIds.length} ok`); }
  _setStep(2,'done','ok'); hideLoader();
  csvMuData = muData
    .map(mu => {
      if (!mu) return null;
      let totalLevel = 0;
      if (mu.members) mu.members.forEach(uid => { const u = userCache.get(uid); if (u) totalLevel += u.level || 0; });
      return {
        id: mu._id,
        name: mu.name || 'Sconosciuta',
        members: mu.members?.length || 0,
        totalLevel,
        weeklyDamage: mu.rankings?.muWeeklyDamages?.value || 0,
        totalDamage: mu.rankings?.muDamages?.value || 0,
        bounty: mu.rankings?.muBounty?.value || 0,
        terrain: mu.rankings?.muTerrain?.value || 0,
      };
    })
    .filter(Boolean);
  showToast(`✅ ${csvMuData.length} MU caricate`);
  lastRenderedDataHash = '';
}

// ==================== CSV: RENDER ====================
function renderCsvAnalysis() {
  const tbody = document.getElementById('csvAnalysisBody');
  if (!csvMuData.length) { tbody.innerHTML = '<tr><td colspan="13">Nessun dato</td></tr>'; return; }

  const enrichedData = csvMuData.map(mu => ({
    ...mu,
    dmgPerMember:    mu.members ? mu.totalDamage  / mu.members : 0,
    weeklyPerMember: mu.members ? mu.weeklyDamage / mu.members : 0,
    bountyPerMember: mu.members ? mu.bounty       / mu.members : 0,
    // Efficienza offensiva: danno settimanale per punto livello (misura quanto ogni livello "produce")
    efficiency:      mu.totalLevel ? (mu.weeklyDamage / mu.totalLevel) : 0,
  }));
  const sortedData = sortCsvData(enrichedData, csvSortColumn, csvSortDirection);

  const totalMembers = sortedData.reduce((s, m) => s + m.members, 0);
  const totalLevel   = sortedData.reduce((s, m) => s + m.totalLevel, 0);
  const totalWeekly  = sortedData.reduce((s, m) => s + m.weeklyDamage, 0);
  const totalDamage  = sortedData.reduce((s, m) => s + m.totalDamage, 0);
  const totalBounty  = sortedData.reduce((s, m) => s + m.bounty, 0);
  const avgTerrain   = (sortedData.reduce((s, m) => s + m.terrain, 0) / sortedData.length).toFixed(1);
  const avgLvPerMem  = totalMembers ? Math.round(totalLevel / totalMembers) : 0;
  const topMu        = [...sortedData].sort((a,b) => b.weeklyDamage - a.weeklyDamage)[0];
  const topEffMu     = [...sortedData].sort((a,b) => b.efficiency - a.efficiency)[0];

  document.getElementById('csvStatsSummary').innerHTML = `
    <div class="stat"><span class="stat-label">Totale MU</span><span class="stat-value">${sortedData.length}</span></div>
    <div class="stat"><span class="stat-label">Membri</span><span class="stat-value">${totalMembers}</span></div>
    <div class="stat"><span class="stat-label">Livello Tot.</span><span class="stat-value">${formatNumber(totalLevel)}</span></div>
    <div class="stat"><span class="stat-label">Lv. Medio/Mem</span><span class="stat-value">${avgLvPerMem}</span></div>
    <div class="stat"><span class="stat-label">Danno Sett.</span><span class="stat-value">${formatNumber(totalWeekly)}</span></div>
    <div class="stat"><span class="stat-label">Danno Tot.</span><span class="stat-value">${formatNumber(totalDamage)}</span></div>
    <div class="stat"><span class="stat-label">Bounty Tot.</span><span class="stat-value">${formatNumber(totalBounty, true)}</span></div>
    <div class="stat"><span class="stat-label">Terreno Medio</span><span class="stat-value">${avgTerrain}</span></div>
    ${topMu ? `<div class="stat"><span class="stat-label">🏆 Top Danno Sett.</span><span class="stat-value" style="font-size:12px;color:var(--success)">${topMu.name}</span></div>` : ''}
    ${topEffMu ? `<div class="stat"><span class="stat-label">⚡ Top Efficienza</span><span class="stat-value" style="font-size:12px;color:var(--accent2)">${topEffMu.name}</span></div>` : ''}`;

  // Performance percentile: top 33% = green, mid = amber, bottom = red
  const maxWeekly = Math.max(...sortedData.map(m => m.weeklyDamage));
  const p66 = maxWeekly * 0.66, p33 = maxWeekly * 0.33;
  function perfDot(val) {
    if (val >= p66) return '<span class="perf-dot perf-top"></span>';
    if (val >= p33) return '<span class="perf-dot perf-mid"></span>';
    return '<span class="perf-dot perf-low"></span>';
  }

  tbody.innerHTML = sortedData
    .map(
      (mu, i) => `
    <tr>
      <td style="color:var(--muted);font-size:11px;">${i + 1}</td>
      <td>${perfDot(mu.weeklyDamage)}<a href="${APP_BASE}/mu/${mu.id}" target="_blank">${mu.name}</a></td>
      <td>${mu.members}</td>
      <td>${mu.totalLevel}</td>
      <td>${formatNumber(mu.weeklyDamage)}</td>
      <td>${formatNumber(mu.totalDamage)}</td>
      <td>${formatNumber(mu.bounty, true)}</td>
      <td>${mu.terrain}</td>
      <td>${formatNumber(Math.round(mu.dmgPerMember))}</td>
      <td>${formatNumber(Math.round(mu.weeklyPerMember))}</td>
      <td style="color:var(--accent2)">${mu.efficiency.toFixed(2)}</td>
      <td>${mu.bountyPerMember.toFixed(2)}</td>
      <td><button class="secondary view-csv-mu-members" data-mu-id="${mu.id}"><i class="fas fa-users"></i></button></td>
    </tr>`
    )
    .join('');

  // Aggiorna icone sort
  document.querySelectorAll('#csvAnalysisTable th[data-sort] i').forEach(icon => { icon.className = 'fas fa-sort'; });
  const activeHeader = document.querySelector(`#csvAnalysisTable th[data-sort="${csvSortColumn}"] i`);
  if (activeHeader) activeHeader.className = csvSortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

  document.querySelectorAll('.view-csv-mu-members').forEach(btn => {
    btn.addEventListener('click', () => showMuDetail(btn.dataset.muId, null));
  });

  // Grafici: ricostruisci solo se i dati sono cambiati
  const currentDataHash = JSON.stringify(csvMuData.map(m => m.id).sort());
  if (currentDataHash !== lastRenderedDataHash) {
    lastRenderedDataHash = currentDataHash;
    buildCharts();
  }
}

// ==================== INIT ====================
async function init() {
  loadBattalions();
  renderBattalionList();
  renderBalancePanel();

  await refreshAllMuData();

  const allUserIds = new Set();
  battalions.forEach(b => {
    b.muIds.forEach(muId => { const mu = muDataCache.get(muId); if (mu?.members) mu.members.forEach(uid => allUserIds.add(uid)); });
    if (b.chiefUserId) allUserIds.add(b.chiefUserId);
  });
  if (allUserIds.size > 0) await preloadUserNames(Array.from(allUserIds), true);

  renderBattalionList();
  renderBalancePanel();

  if (selectedBattalionId) await renderBattalionDetail(selectedBattalionId);
  else if (battalions.length > 0) await selectBattalion(battalions[0].id);

  // ---- Event listeners ----
  newBtn.addEventListener('click', createNewBattalion);
  document.getElementById('autoBalanceBtn').addEventListener('click', autoBalanceBattalions);

  refreshAllBtn.addEventListener('click', async () => {
    await refreshAllMuData();
    const userIds = new Set();
    battalions.forEach(b => {
      b.muIds.forEach(muId => { const mu = muDataCache.get(muId); if (mu?.members) mu.members.forEach(uid => userIds.add(uid)); });
      if (b.chiefUserId) userIds.add(b.chiefUserId);
    });
    if (userIds.size > 0) await preloadUserNames(Array.from(userIds), true);
    renderBattalionList();
    renderBalancePanel();
    if (selectedBattalionId) await renderBattalionDetail(selectedBattalionId);
  });

  // Bottoni grafici
  showDamageBtn.addEventListener('click', () => {
    damageContainer.style.display = 'block'; levelContainer.style.display = 'none';
    donutContainer.style.display = 'none'; weeklyPerMemberContainer.style.display = 'none';
    setActiveChartButton(showDamageBtn); renderCsvAnalysis();
  });
  showLevelBtn.addEventListener('click', () => {
    damageContainer.style.display = 'none'; levelContainer.style.display = 'block';
    donutContainer.style.display = 'none'; weeklyPerMemberContainer.style.display = 'none';
    setActiveChartButton(showLevelBtn); renderCsvAnalysis();
  });
  showDonutBtn.addEventListener('click', () => {
    damageContainer.style.display = 'none'; levelContainer.style.display = 'none';
    donutContainer.style.display = 'block'; weeklyPerMemberContainer.style.display = 'none';
    setActiveChartButton(showDonutBtn); renderCsvAnalysis();
  });
  showWeeklyPerMemberBtn.addEventListener('click', () => {
    damageContainer.style.display = 'none'; levelContainer.style.display = 'none';
    donutContainer.style.display = 'none'; weeklyPerMemberContainer.style.display = 'block';
    setActiveChartButton(showWeeklyPerMemberBtn); renderCsvAnalysis();
  });

  // Sort colonne CSV
  document.getElementById('csvAnalysisTable')?.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const column = th.dataset.sort;
    if (csvSortColumn === column) csvSortDirection = csvSortDirection === 'asc' ? 'desc' : 'asc';
    else { csvSortColumn = column; csvSortDirection = 'desc'; }
    renderCsvAnalysis();
  });

  // Cambio vista
  modeCsvAnalysisBtn.addEventListener('click', () => {
    battalionsView.classList.remove('active');
    csvAnalysisView.classList.add('active');
    modeCsvAnalysisBtn.classList.add('active');
    modeBattalionsBtn.classList.remove('active');
    if (csvMuData.length === 0) loadCsvFromUrl(HARDCODED_CSV_URL);
  });
  modeBattalionsBtn.addEventListener('click', () => {
    battalionsView.classList.add('active');
    csvAnalysisView.classList.remove('active');
    modeBattalionsBtn.classList.add('active');
    modeCsvAnalysisBtn.classList.remove('active');
  });

  // CSV buttons
  document.getElementById('refreshCsvBtn').addEventListener('click', () => loadCsvFromUrl(HARDCODED_CSV_URL));
  document.getElementById('clearCsvBtn').addEventListener('click', () => {
    csvMuData = [];
    document.getElementById('csvStatsSummary').innerHTML = '';
    document.getElementById('csvAnalysisBody').innerHTML =
      '<tr><td colspan="11" style="text-align:center;">Carica i dati per iniziare</td></tr>';
    destroyCharts();
    lastRenderedDataHash = '';
  });
}

window.addEventListener('load', initRadar);
init();
