import { createAPIClient } from '@wareraprojects/api';
import Chart from 'chart.js/auto';

// ==================== CONFIG ====================
const APP_BASE = 'https://app.warera.io';
const HARDCODED_CSV_URL =
  'https://raw.githubusercontent.com/francescoparadiso/WarEraMoDDashboard/refs/heads/main/Mu.csv';

// ==================== API KEY ====================
let API_KEY = localStorage.getItem('warera_api_key');
if (!API_KEY) {
  API_KEY = prompt(
    'Inserisci la tua API key di WarEra (ottenibile dalle impostazioni del profilo su app.warera.io):'
  );
  if (API_KEY) {
    localStorage.setItem('warera_api_key', API_KEY);
  } else {
    alert('API key necessaria. La dashboard potrebbe non funzionare.');
  }
}

// Il client gestisce automaticamente: batching, rate limit, retry
const client = createAPIClient({ apiKey: API_KEY || '' });

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
    'background:#1a2e1a;border-left:4px solid #00ff88;color:#e0ffe0;padding:12px 20px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);opacity:1;transition:opacity 0.3s;';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    ctx.strokeStyle = '#00ff8860';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (w / 2) * i / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.strokeStyle = '#00ff8840';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.arc(w / 2, h / 2, w / 2, angle, angle + 0.5);
    ctx.closePath();
    ctx.fillStyle = '#00ff8820';
    ctx.fill();
    ctx.strokeStyle = '#00ff88';
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
    // @wareraprojects/api gestisce batching e rate limit automaticamente
    const data = await client.mu.getById({ muId });
    if (!data) { console.warn(`MU ${muId} restituisce dati nulli`); return null; }
    if (!data.members) data.members = [];
    if (!data.rankings) data.rankings = {};
    return data;
  } catch (err) {
    console.error(`❌ Errore fetch MU ${muId}:`, err);
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
    const data = await client.user.getUserLite({ userId });
    const name = data.username || data.name || `ID: ${userId.slice(-6)}`;
    const user = { name, id: userId, avatarUrl: data.avatarUrl || null, level: data.leveling?.level || 0 };
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

  showToast(`🔄 Aggiornamento ${ids.length} MU...`, 'info');
  // Promise.allSettled + il package batcha automaticamente le chiamate nello stesso tick
  const results = await Promise.allSettled(ids.map(id => fetchMuById(id)));
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      muDataCache.set(ids[i], result.value);
    } else {
      muDataCache.delete(ids[i]);
    }
  });
  showToast('✅ MU aggiornate', 'success');
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
  if (showProgress) showToast(`🔄 Caricamento ${toLoad.length} profili...`, 'info');
  await Promise.allSettled(toLoad.map(id => fetchUserById(id)));
  if (showProgress) showToast(`✅ ${toLoad.length} profili caricati`, 'success');
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
    try { battalions = JSON.parse(stored); } catch { battalions = []; }
  } else {
    const example = createBattalion('1ª Divisione Corazzata');
    example.chiefUserId = '69696382422cd6752173a622';
    example.muIds = ['6973b4d3eed64c805d54bd07'];
    battalions = [example];
  }
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
      html += `<a href="${APP_BASE}/user/${user.id}" target="_blank" class="badge" style="margin:4px;display:inline-flex;align-items:center;">${avatarHtml}${user.name} (Lv.${user.level || 0})</a>`;
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
      html += `<a href="${APP_BASE}/user/${user.id}" target="_blank" class="badge" style="margin:4px;display:inline-flex;align-items:center;">${avatarHtml}${user.name} (Lv.${user.level || 0})</a>`;
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
      datasets: [{ label: 'Danno Sett. (Top 10)', data: top10.map(m => m.weeklyDamage), backgroundColor: '#00ff8860', borderColor: '#00ff88', borderWidth: 1 }],
    },
    options: chartOpts,
  });

  csvLevelChart = new Chart(document.getElementById('csvLevelChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: csvMuData.map(m => truncName(m.name)),
      datasets: [{ label: 'Livello Totale', data: csvMuData.map(m => m.totalLevel), backgroundColor: '#00ff8860', borderColor: '#00ff88', borderWidth: 1 }],
    },
    options: chartOpts,
  });

  csvMembersChart = new Chart(document.getElementById('csvMembersChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: csvMuData.map(m => truncName(m.name)),
      datasets: [{
        data: csvMuData.map(m => m.weeklyDamage),
        backgroundColor: ['#00ff88','#2ecc71','#27ae60','#1abc9c','#16a085','#00d4ff','#3498db','#2980b9','#9b59b6','#8e44ad'],
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
      datasets: [{ label: 'Danno Sett./Membro (Top 10)', data: top10weekly.map(m => m.value), backgroundColor: '#00ff8860', borderColor: '#00ff88', borderWidth: 1 }],
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
    else { valA = a[column]; valB = b[column]; }
    if (column === 'name') { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
    if (typeof valA === 'string') return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return direction === 'asc' ? valA - valB : valB - valA;
  });
}

// ==================== CSV: LOAD ====================
async function loadCsvFromUrl(url) {
  showToast('📡 Scaricamento CSV in corso...', 'info');
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Impossibile scaricare il CSV');
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
    showToast(`🔍 Trovati ${muIds.length} ID MU. Avvio richieste API...`, 'info');
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
  const muData = await loadMultipleMus(uniqueIds);
  const allUserIds = new Set();
  muData.forEach(mu => { if (mu?.members) mu.members.forEach(uid => allUserIds.add(uid)); });
  if (allUserIds.size) await preloadUserNames(Array.from(allUserIds));
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
  if (!csvMuData.length) { tbody.innerHTML = '<tr><td colspan="11">Nessun dato</td></tr>'; return; }

  const enrichedData = csvMuData.map(mu => ({
    ...mu,
    dmgPerMember: mu.members ? mu.totalDamage / mu.members : 0,
    weeklyPerMember: mu.members ? mu.weeklyDamage / mu.members : 0,
    bountyPerMember: mu.members ? mu.bounty / mu.members : 0,
  }));
  const sortedData = sortCsvData(enrichedData, csvSortColumn, csvSortDirection);

  const totalMembers = sortedData.reduce((s, m) => s + m.members, 0);
  const totalLevel = sortedData.reduce((s, m) => s + m.totalLevel, 0);
  const totalWeekly = sortedData.reduce((s, m) => s + m.weeklyDamage, 0);
  const totalDamage = sortedData.reduce((s, m) => s + m.totalDamage, 0);
  const totalBounty = sortedData.reduce((s, m) => s + m.bounty, 0);
  const avgTerrain = (sortedData.reduce((s, m) => s + m.terrain, 0) / sortedData.length).toFixed(1);

  document.getElementById('csvStatsSummary').innerHTML = `
    <div class="stat"><span class="stat-label">Totale MU</span><span class="stat-value">${sortedData.length}</span></div>
    <div class="stat"><span class="stat-label">Membri</span><span class="stat-value">${totalMembers}</span></div>
    <div class="stat"><span class="stat-label">Livello Tot.</span><span class="stat-value">${totalLevel}</span></div>
    <div class="stat"><span class="stat-label">Danno Sett.</span><span class="stat-value">${formatNumber(totalWeekly)}</span></div>
    <div class="stat"><span class="stat-label">Danno Tot.</span><span class="stat-value">${formatNumber(totalDamage)}</span></div>
    <div class="stat"><span class="stat-label">Bounty</span><span class="stat-value">${formatNumber(totalBounty, true)}</span></div>
    <div class="stat"><span class="stat-label">Terreno medio</span><span class="stat-value">${avgTerrain}</span></div>`;

  tbody.innerHTML = sortedData
    .map(
      mu => `
    <tr>
      <td><a href="${APP_BASE}/mu/${mu.id}" target="_blank">${mu.name}</a></td>
      <td>${mu.members}</td>
      <td>${mu.totalLevel}</td>
      <td>${formatNumber(mu.weeklyDamage)}</td>
      <td>${formatNumber(mu.totalDamage)}</td>
      <td>${formatNumber(mu.bounty, true)}</td>
      <td>${mu.terrain}</td>
      <td>${formatNumber(Math.round(mu.dmgPerMember))}</td>
      <td>${formatNumber(Math.round(mu.weeklyPerMember))}</td>
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
