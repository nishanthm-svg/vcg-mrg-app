// ===== VCG/MRG Identification App =====
const App = (() => {

  // ---- State ----
  let state = {
    currentScreen: 'login',
    prevScreen: null,
    currentUser: null,   // { name, isAdmin }
    execData: null,      // full executive data (mpps + members)
    execIndex: null,     // lightweight index of all executives
    currentMPP: null,    // selected MPP object
    memberFilter: 'all',
    identifications: {}, // { unkey: { type, formNo, date, groupMembers, remarks, synced } }
    submissions: [],     // admin: all submissions
    selectedMemberUnkey: null,
    selectedIdentType: null,
    gasUrl: 'https://script.google.com/macros/s/AKfycbzAw94gTJZbdtzwIVPxvi0YnqwIFgbPYM7FO9wDoofNCieZdtgTFbtdbMCrLiY6n8Tpiw/exec',
  };

  // ---- Default passwords (executive name -> password) ----
  // Admin can reset. Default: first 4 chars of name + '1234'
  const DEFAULT_PASSWORDS = {
    'R VIJAY KUMAR': 'vijay1234', 'N MOHAN': 'mohan1234',
    'C NIROSHA': 'niro1234', 'N MURALI': 'mural1234',
    'G HARI': 'hari1234', 'T GOVARDHAN REDDY': 'govd1234',
    'C MANOJ': 'mano1234', 'A RAGHUNATH': 'ragh1234',
    'Y NAGHABHUSHAN': 'nagh1234', 'T SAHADEVA REDDY': 'saha1234',
    'M SANKAR': 'sank1234', 'T MARUTHI PRASAD': 'maru1234',
    'D KESAVA': 'kesa1234', 'S NARESH': 'nare1234',
    'M GANGADHAR': 'gang1234', 'RANJITH KUMAR': 'ranj1234',
    'G MAHESH': 'mahe1234',
    '__admin__': 'admin@2025'
  };

  // ---- DB (IndexedDB) ----
  let db = null;
  async function initDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('vcgmrg_db', 2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('identifications'))
          d.createObjectStore('identifications', { keyPath: 'unkey' });
        if (!d.objectStoreNames.contains('pending'))
          d.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('config'))
          d.createObjectStore('config', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('passwords'))
          d.createObjectStore('passwords', { keyPath: 'user' });
      };
      req.onsuccess = () => { db = req.result; res(db); };
      req.onerror = () => rej(req.error);
    });
  }

  function dbGet(store, key) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function dbPut(store, value) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function dbGetAll(store) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  // ---- Init ----
  async function init() {
    await initDB();

    // Load GAS URL — first try config.json (set by setup_google.py), then IndexedDB
    try {
      const res = await fetch('config.json');
      if (res.ok) {
        const appCfg = await res.json();
        if (appCfg.gasUrl) {
          state.gasUrl = appCfg.gasUrl;
          await dbPut('config', { key: 'gasUrl', value: appCfg.gasUrl });
        }
        if (appCfg.sheetUrl) localStorage.setItem('vcgmrg_sheets_url', appCfg.sheetUrl);
      }
    } catch {}

    if (!state.gasUrl) {
      const cfg = await dbGet('config', 'gasUrl');
      if (cfg) state.gasUrl = cfg.value;
    }

    // Load identifications
    const allIdents = await dbGetAll('identifications');
    allIdents.forEach(i => { state.identifications[i.unkey] = i; });

    // Populate executive dropdown
    await populateExecDropdown();

    // Check session
    const session = sessionStorage.getItem('vcgmrg_user');
    if (session) {
      const u = JSON.parse(session);
      state.currentUser = u;
      if (u.isAdmin) showAdminScreen();
      else await loadExecutiveDash(u.name);
      return;
    }

    showScreen('login');

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  async function populateExecDropdown() {
    const sel = document.getElementById('execSelect');
    // Hardcoded list from data
    const executives = [
      'R VIJAY KUMAR','N MOHAN','C NIROSHA','N MURALI','G HARI',
      'T GOVARDHAN REDDY','C MANOJ','A RAGHUNATH','Y NAGHABHUSHAN',
      'T SAHADEVA REDDY','M SANKAR','T MARUTHI PRASAD','D KESAVA',
      'S NARESH','M GANGADHAR','RANJITH KUMAR','G MAHESH'
    ];
    executives.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  // ---- Screen Management ----
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id + 'Screen');
    if (screen) screen.classList.add('active');
    state.prevScreen = state.currentScreen;
    state.currentScreen = id;
    window.scrollTo(0, 0);
  }

  // ---- Login ----
  async function login() {
    const execName = document.getElementById('execSelect').value;
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');

    if (!execName) { errEl.textContent = 'Please select your name.'; return; }
    if (!password) { errEl.textContent = 'Please enter password.'; return; }

    // Check password (custom or default)
    const storedPw = await dbGet('passwords', execName);
    const expectedPw = storedPw ? storedPw.password : DEFAULT_PASSWORDS[execName];

    if (password !== expectedPw) {
      errEl.textContent = 'Incorrect password. Please try again.';
      return;
    }

    errEl.textContent = '';
    state.currentUser = { name: execName, isAdmin: false };
    sessionStorage.setItem('vcgmrg_user', JSON.stringify(state.currentUser));
    await loadExecutiveDash(execName);
  }

  function showAdminLogin() {
    const execSel = document.getElementById('execSelect');
    // Add admin option if not present
    if (!document.querySelector('option[value="__admin__"]')) {
      const opt = document.createElement('option');
      opt.value = '__admin__'; opt.textContent = '🔒 Admin';
      execSel.appendChild(opt);
    }
    execSel.value = '__admin__';
    document.getElementById('loginPassword').focus();
  }

  function logout() {
    sessionStorage.removeItem('vcgmrg_user');
    state.currentUser = null;
    state.execData = null;
    state.currentMPP = null;
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').textContent = '';
    showScreen('login');
  }

  // ---- Load Executive Dashboard ----
  async function loadExecutiveDash(execName) {
    // Admin check
    if (execName === '__admin__') {
      state.currentUser = { name: 'Admin', isAdmin: true };
      sessionStorage.setItem('vcgmrg_user', JSON.stringify(state.currentUser));
      await showAdminScreen();
      return;
    }

    showScreen('dash');
    document.getElementById('mppList').innerHTML = '<div class="loader-wrap"><div class="spinner"></div></div>';

    const safeName = execName.replace(/ /g, '_').replace(/\//g, '_');
    try {
      const res = await fetch(`data/exec_${safeName}.json`);
      if (!res.ok) throw new Error('Data not found');
      state.execData = await res.json();
    } catch (e) {
      document.getElementById('mppList').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load data. Please check your connection.</p></div>';
      return;
    }

    updateDashHeader(execName);
    populateBMCUDropdown();
    renderMPPList(state.execData.mpps);
    setSyncStatus('online');
  }

  // ---- Cascading Dropdowns ----
  function populateBMCUDropdown() {
    const sel = document.getElementById('bmcuSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select BMCU --</option>';
    (state.execData.bmcus || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.bmcuName;
      opt.textContent = `${b.bmcuName} (${b.totalMPPs} MPPs)`;
      sel.appendChild(opt);
    });
    // Reset MPP dropdown
    const mppSel = document.getElementById('mppSelect');
    mppSel.innerHTML = '<option value="">-- Select MPP --</option>';
    mppSel.disabled = true;
  }

  function onBMCUSelect() {
    const bmcuName = document.getElementById('bmcuSelect').value;
    const mppSel = document.getElementById('mppSelect');
    mppSel.innerHTML = '<option value="">-- Select MPP --</option>';

    if (!bmcuName) {
      mppSel.disabled = true;
      renderMPPList(state.execData.mpps);
      document.getElementById('mppListHeader').textContent = 'All MPPs';
      return;
    }

    const bmcu = (state.execData.bmcus || []).find(b => b.bmcuName === bmcuName);
    if (!bmcu) return;

    bmcu.mpps.forEach(mpp => {
      const opt = document.createElement('option');
      opt.value = mpp.mppCode;
      opt.textContent = `${mpp.mppName} (${mpp.memberCount} members)`;
      mppSel.appendChild(opt);
    });
    mppSel.disabled = false;

    renderMPPList(bmcu.mpps);
    document.getElementById('mppListHeader').textContent = `${bmcuName} MPPs`;
  }

  function onMPPSelect() {
    const mppCode = document.getElementById('mppSelect').value;
    if (!mppCode) return;
    openMPP(mppCode);
  }

  function updateDashHeader(execName) {
    document.getElementById('dashTitle').textContent = execName;
    const mpps = state.execData.mpps;
    const completedMPPs = mpps.filter(m => isMPPCompleted(m)).length;
    const totalIdents = Object.keys(state.identifications).filter(k => state.identifications[k]).length;

    document.getElementById('dashSubtitle').textContent = `VCG/MRG Identification 2025`;
    document.getElementById('statTotalMPP').textContent = mpps.length;
    document.getElementById('statDoneMPP').textContent = completedMPPs;
    document.getElementById('statIdentified').textContent = totalIdents;

    const pct = mpps.length ? Math.round((completedMPPs / mpps.length) * 100) : 0;
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressDetail').textContent = `${completedMPPs} of ${mpps.length} MPPs completed`;

    renderBMCUProgress();
  }

  function renderBMCUProgress() {
    const section = document.getElementById('bmcuProgressSection');
    const container = document.getElementById('bmcuProgressList');
    if (!section || !container || !state.execData) return;

    const bmcus = state.execData.bmcus || [];
    if (!bmcus.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    container.innerHTML = bmcus.map(bmcu => {
      const allMembers = bmcu.mpps.reduce((acc, m) => acc + m.memberCount, 0);
      const identCount = bmcu.mpps.reduce((acc, mpp) => {
        return acc + mpp.members.filter(m => state.identifications[m.unkey]).length;
      }, 0);
      const doneMPPs = bmcu.mpps.filter(mpp => isMPPCompleted(mpp)).length;
      const pct = allMembers ? Math.round((identCount / allMembers) * 100) : 0;
      const barColor = pct === 100 ? '#2e7d32' : pct > 50 ? '#1a237e' : '#ff6f00';

      return `
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${bmcu.bmcuName}</div>
            <div style="font-size:12px;color:var(--text-muted)">${doneMPPs}/${bmcu.totalMPPs} MPPs &bull; ${identCount} identified</div>
          </div>
          <div style="height:6px;background:#f0f2f5;border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width 0.3s"></div>
          </div>
        </div>`;
    }).join('');
  }

  function isMPPCompleted(mpp) {
    // MPP is "completed" if at least one member identified OR if all priority members checked
    return mpp.members.some(m => state.identifications[m.unkey]);
  }

  function getMPPIdentifiedCount(mpp) {
    return mpp.members.filter(m => state.identifications[m.unkey]).length;
  }

  // ---- MPP List Rendering ----
  function renderMPPList(mpps) {
    const container = document.getElementById('mppList');
    if (!mpps.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No MPPs found</p></div>';
      return;
    }

    container.innerHTML = mpps.map(mpp => {
      const identCount = getMPPIdentifiedCount(mpp);
      const isDone = identCount > 0;
      const pct = mpp.memberCount ? Math.round((identCount / mpp.memberCount) * 100) : 0;

      let badge, badgeClass;
      if (identCount === 0) { badge = 'Pending'; badgeClass = 'pending'; }
      else if (identCount >= mpp.memberCount) { badge = 'Done'; badgeClass = 'done'; }
      else { badge = `${identCount} done`; badgeClass = 'partial'; }

      return `
        <div class="mpp-card" onclick="App.openMPP('${mpp.mppCode}')">
          <div class="mpp-card-inner">
            <div class="mpp-icon ${isDone ? 'done' : ''}">${isDone ? '✅' : '📋'}</div>
            <div class="mpp-info">
              <div class="mpp-name">${mpp.mppName}</div>
              <div class="mpp-meta">Code: ${mpp.mppCode} &bull; ${mpp.memberCount} members &bull; ⭐${mpp.priority1Count} priority</div>
            </div>
            <div class="mpp-right">
              <span class="mpp-badge ${badgeClass}">${badge}</span>
              <div class="mpp-progress-mini">${mpp.vcgMrgCount} last FY VCG/MRG</div>
            </div>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function filterMPPs() {
    if (!state.execData) return;
    const search = document.getElementById('mppSearch').value.toLowerCase();
    const filter = document.getElementById('mppFilter').value;

    let mpps = state.execData.mpps.filter(mpp => {
      const matchSearch = !search || mpp.mppName.toLowerCase().includes(search) || String(mpp.mppCode).includes(search);
      const identCount = getMPPIdentifiedCount(mpp);
      const matchFilter = filter === 'all' ||
        (filter === 'pending' && identCount === 0) ||
        (filter === 'done' && identCount > 0);
      return matchSearch && matchFilter;
    });

    renderMPPList(mpps);
  }

  // ---- Open MPP / Member List ----
  function openMPP(mppCode) {
    const mpp = state.execData.mpps.find(m => m.mppCode === mppCode);
    if (!mpp) return;
    state.currentMPP = mpp;
    state.memberFilter = 'all';

    showScreen('members');
    document.getElementById('mppTitle').textContent = mpp.mppName;
    document.getElementById('mppSubtitle').textContent =
      `Code: ${mpp.mppCode} | ${mpp.memberCount} members | ⭐ ${mpp.priority1Count} priority`;

    // Reset filters
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
    document.getElementById('memberSearch').value = '';

    renderMemberList(mpp.members);
  }

  // ---- Member List Rendering ----
  function renderMemberList(members) {
    const container = document.getElementById('memberList');
    if (!members.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>No members found</p></div>';
      return;
    }

    container.innerHTML = members.map(m => {
      const ident = state.identifications[m.unkey];
      const isPriority = m.priority === 1;
      const hasVCGMRG = m.vcgMrg === 'VCG' || m.vcgMrg === 'MRG';
      const initials = m.memberName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

      let avatarClass = ident ? 'identified' : (isPriority ? 'priority-1' : 'priority-2');

      let tags = '';
      if (isPriority) tags += `<span class="tag priority">⭐ 200D+500L Priority</span>`;
      if (m.vcgMrg === 'VCG') tags += `<span class="tag vcg">🏆 Last FY VCG</span>`;
      if (m.vcgMrg === 'MRG') tags += `<span class="tag mrg">🏅 Last FY MRG</span>`;
      if (ident) tags += `<span class="tag identified">✅ Identified as ${ident.type}</span>`;

      let actions = '';
      if (!ident) {
        actions = `
          <div class="member-actions">
            <button class="btn-identify btn-vcg" onclick="App.openIdentifyModal('${m.unkey}','VCG')">+ VCG</button>
            <button class="btn-identify btn-mrg" onclick="App.openIdentifyModal('${m.unkey}','MRG')">+ MRG</button>
          </div>`;
      } else {
        actions = `
          <div class="member-actions">
            <button class="btn-identify btn-identified" style="background:#e8f5e9;color:#2e7d32" disabled>✅ ${ident.type} Identified</button>
            <button class="btn-identify" style="background:#ffebee;color:#c62828;flex:0;padding:10px 14px" onclick="App.removeIdentification('${m.unkey}')">✕</button>
          </div>`;
      }

      return `
        <div class="member-card" id="mc_${m.unkey}">
          <div class="member-card-header">
            <div class="member-avatar ${avatarClass}">${initials}</div>
            <div class="member-info">
              <div class="member-name">${m.memberName}</div>
              <div class="member-code">Code: ${m.memberCode} | ${m.member}</div>
              <div class="member-tags">${tags}</div>
              <div class="member-stats">
                <div class="member-stat">📅 <strong>${m.totalDays}</strong> days</div>
                <div class="member-stat">🥛 <strong>${m.totalQty.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong> L</div>
                <div class="member-stat">ACO: <strong>${m.acoName}</strong></div>
              </div>
            </div>
          </div>
          ${actions}
        </div>`;
    }).join('');
  }

  function filterMembers(btn, filter) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.memberFilter = filter;
    applyMemberFilters();
  }

  function searchMembers() {
    applyMemberFilters();
  }

  function applyMemberFilters() {
    if (!state.currentMPP) return;
    const search = document.getElementById('memberSearch').value.toLowerCase();
    const filter = state.memberFilter;
    const allMembers = state.currentMPP.members;

    let members = allMembers.filter(m => {
      const matchSearch = !search || m.memberName.toLowerCase().includes(search) || String(m.memberCode).toLowerCase().includes(search);
      const ident = state.identifications[m.unkey];
      const matchFilter =
        filter === 'all' ||
        (filter === 'priority' && m.priority === 1) ||
        (filter === 'vcgmrg' && (m.vcgMrg === 'VCG' || m.vcgMrg === 'MRG')) ||
        (filter === 'identified' && ident) ||
        (filter === 'pending' && !ident);
      return matchSearch && matchFilter;
    });

    const countEl = document.getElementById('memberCount');
    if (countEl) {
      const identCount = allMembers.filter(m => state.identifications[m.unkey]).length;
      const pendingCount = allMembers.length - identCount;
      const priorityCount = allMembers.filter(m => m.priority === 1).length;
      const vcgmrgCount = allMembers.filter(m => m.vcgMrg === 'VCG' || m.vcgMrg === 'MRG').length;
      const labels = {
        all: `Showing all ${members.length} members`,
        priority: `⭐ ${members.length} priority members (200D+500L)`,
        vcgmrg: `🏆 ${members.length} last FY VCG/MRG members`,
        identified: `✅ ${members.length} identified`,
        pending: `⏳ ${members.length} pending`,
      };
      countEl.textContent = labels[filter] || `${members.length} members`;
    }

    renderMemberList(members);
    // Scroll member list into view
    const listEl = document.getElementById('memberList');
    if (listEl) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Identification Modal ----
  function openIdentifyModal(unkey, preselect) {
    state.selectedMemberUnkey = unkey;
    state.selectedIdentType = preselect || null;

    // Find member
    const member = state.currentMPP.members.find(m => m.unkey === unkey);
    if (!member) return;

    document.getElementById('modalMemberName').textContent = member.memberName;
    document.getElementById('modalMemberInfo').textContent =
      `${member.memberCode} | Days: ${member.totalDays} | Qty: ${member.totalQty.toLocaleString('en-IN', {maximumFractionDigits:0})} L`;

    document.getElementById('remarks').value = '';
    document.getElementById('modalError').textContent = '';

    document.getElementById('radioVCG').classList.remove('selected-vcg');
    document.getElementById('radioMRG').classList.remove('selected-mrg');
    if (preselect === 'VCG') document.getElementById('radioVCG').classList.add('selected-vcg');
    if (preselect === 'MRG') document.getElementById('radioMRG').classList.add('selected-mrg');

    document.getElementById('identifyModal').classList.add('open');
  }

  function selectType(type) {
    state.selectedIdentType = type;
    document.getElementById('radioVCG').classList.remove('selected-vcg');
    document.getElementById('radioMRG').classList.remove('selected-mrg');
    if (type === 'VCG') document.getElementById('radioVCG').classList.add('selected-vcg');
    if (type === 'MRG') document.getElementById('radioMRG').classList.add('selected-mrg');
  }

  function closeModal() {
    document.getElementById('identifyModal').classList.remove('open');
    state.selectedMemberUnkey = null;
    state.selectedIdentType = null;
  }

  async function submitIdentification() {
    const errEl = document.getElementById('modalError');
    if (!state.selectedIdentType) { errEl.textContent = 'Please select VCG or MRG.'; return; }

    const remarks = document.getElementById('remarks').value.trim();
    errEl.textContent = '';

    const unkey = state.selectedMemberUnkey;
    const member = state.currentMPP.members.find(m => m.unkey === unkey);

    const record = {
      unkey,
      type: state.selectedIdentType,
      remarks,
      executive: state.currentUser.name,
      bmcuName: member.bmcuName,
      mppCode: state.currentMPP.mppCode,
      mppName: state.currentMPP.mppName,
      memberName: member.memberName,
      memberCode: member.memberCode,
      acoName: member.acoName,
      plantCode: member.plantCode,
      totalDays: member.totalDays,
      totalQty: member.totalQty,
      lastFYVCGMRG: member.vcgMrg,
      submittedAt: new Date().toISOString(),
      synced: false
    };

    // Save to IndexedDB
    await dbPut('identifications', record);
    state.identifications[unkey] = record;

    // Add to pending sync queue
    await dbPut('pending', { data: record });

    // Try to sync immediately
    syncRecord(record);

    closeModal();
    applyMemberFilters();
    updateDashHeader(state.currentUser.name);
    showToast(`✅ ${member.memberName} identified as ${state.selectedIdentType}`);
  }

  async function removeIdentification(unkey) {
    if (!confirm('Remove this identification?')) return;
    const tx = db.transaction('identifications', 'readwrite');
    tx.objectStore('identifications').delete(unkey);
    delete state.identifications[unkey];
    applyMemberFilters();
    updateDashHeader(state.currentUser.name);
    showToast('Identification removed');

    // Notify server if online
    if (state.gasUrl) {
      try {
        await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', unkey })
        });
      } catch {}
    }
  }

  // ---- Sync to Google Sheets ----
  async function syncRecord(record) {
    if (!state.gasUrl) {
      console.warn('VCG-MRG: No GAS URL configured');
      return;
    }
    setSyncStatus('syncing');
    try {
      const params = new URLSearchParams({
        action: 'submit',
        data: JSON.stringify(record)
      });
      // Simple GET — follows GAS redirect automatically, no CORS preflight
      const res = await fetch(`${state.gasUrl}?${params}`);
      const json = await res.json();
      if (json.status === 'ok') {
        record.synced = true;
        await dbPut('identifications', record);
        state.identifications[record.unkey] = record;
        setSyncStatus('online');
        // Remove from pending queue
        const allPending = await dbGetAll('pending');
        const match = allPending.find(p => p.data && p.data.unkey === record.unkey);
        if (match) {
          const tx = db.transaction('pending', 'readwrite');
          tx.objectStore('pending').delete(match.id);
        }
      } else {
        console.error('GAS error:', json);
        setSyncStatus('error');
      }
    } catch (e) {
      console.error('Sync failed:', e);
      setSyncStatus('offline');
    }
  }

  async function forceSyncAll() {
    const pending = await dbGetAll('pending');
    document.getElementById('syncResult').textContent = `Syncing ${pending.length} items...`;
    let synced = 0;
    for (const item of pending) {
      try {
        const params = new URLSearchParams({ action: 'submit', data: JSON.stringify(item.data) });
        const res = await fetch(`${state.gasUrl}?${params}`);
        const json = await res.json();
        if (json.status === 'ok') {
          const tx = db.transaction('pending', 'readwrite');
          tx.objectStore('pending').delete(item.id);
          synced++;
        }
      } catch {}
    }
    document.getElementById('syncResult').textContent = `✅ Synced ${synced}/${pending.length} items.`;
    showToast(`Synced ${synced} records`);
  }

  function setSyncStatus(status) {
    const dot = document.getElementById('syncDot');
    const text = document.getElementById('syncText');
    if (!dot) return;
    const map = {
      online: ['green', 'Synced'],
      offline: ['orange', 'Offline – data saved locally'],
      syncing: ['orange', 'Syncing...'],
      error: ['red', 'Sync error']
    };
    const [color, label] = map[status] || ['green', 'Ready'];
    dot.className = `sync-dot ${color}`;
    text.textContent = label;
  }

  // ---- Admin ----
  async function showAdminScreen() {
    showScreen('admin');
    await refreshAdmin();
  }

  async function refreshAdmin() {
    // Load all identifications
    const allIdents = await dbGetAll('identifications');
    state.submissions = allIdents;

    // Load executive index for progress
    if (!state.execIndex) {
      try {
        const res = await fetch('data/executives.json');
        state.execIndex = await res.json();
      } catch {}
    }

    updateAdminOverview(allIdents);
    updateExecProgressTab(allIdents);
    updateSubmissionsTab(allIdents);
  }

  function updateAdminOverview(idents) {
    const vcgCount = idents.filter(i => i.type === 'VCG').length;
    const mrgCount = idents.filter(i => i.type === 'MRG').length;

    // Calc total MPPs across all executives
    let totalMPPs = 0, doneMPPs = 0;
    if (state.execIndex) {
      const mppSet = new Set();
      const doneMPPSet = new Set();
      Object.values(state.execIndex).forEach(ex =>
        ex.mpps.forEach(mpp => {
          mppSet.add(mpp.mppCode);
          const hasIdent = idents.some(i => i.mppCode === mpp.mppCode);
          if (hasIdent) doneMPPSet.add(mpp.mppCode);
        })
      );
      totalMPPs = mppSet.size;
      doneMPPs = doneMPPSet.size;
    }

    document.getElementById('aTotalMPPs').textContent = totalMPPs.toLocaleString('en-IN');
    document.getElementById('aDoneMPPs').textContent = doneMPPs.toLocaleString('en-IN');
    document.getElementById('aTotalIdentified').textContent = idents.length.toLocaleString('en-IN');
    document.getElementById('aTotalVCGMRG').textContent = (vcgCount + mrgCount).toLocaleString('en-IN');
    document.getElementById('aVCGCount').textContent = vcgCount.toLocaleString('en-IN');
    document.getElementById('aMRGCount').textContent = mrgCount.toLocaleString('en-IN');

    const pct = totalMPPs ? Math.round((doneMPPs / totalMPPs) * 100) : 0;
    document.getElementById('aProgressPct').textContent = pct + '%';
    document.getElementById('aProgressBar').style.width = pct + '%';
  }

  function updateExecProgressTab(idents) {
    if (!state.execIndex) return;
    const container = document.getElementById('execProgressList');
    const rows = Object.entries(state.execIndex).map(([execName, execData]) => {
      const execIdents = idents.filter(i => i.executive === execName);
      const doneMPPs = new Set(execIdents.map(i => i.mppCode)).size;
      const totalMPPs = execData.totalMPPs;
      const pct = totalMPPs ? Math.round((doneMPPs / totalMPPs) * 100) : 0;
      const vcg = execIdents.filter(i => i.type === 'VCG').length;
      const mrg = execIdents.filter(i => i.type === 'MRG').length;

      return `
        <div class="exec-row">
          <div class="exec-row-top">
            <div class="exec-name">👤 ${execName}</div>
            <div class="exec-pct">${pct}%</div>
          </div>
          <div class="exec-row-meta">${doneMPPs}/${totalMPPs} MPPs &bull; ${execIdents.length} identified &bull; VCG:${vcg} MRG:${mrg}</div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).sort((a, b) => b.includes('100%') ? 1 : -1).join('');

    container.innerHTML = rows || '<div class="empty-state"><div class="empty-icon">📭</div><p>No data yet</p></div>';
  }

  function updateSubmissionsTab(idents) {
    renderSubmissionsList(idents);
  }

  function filterSubmissions() {
    const search = document.getElementById('subSearch').value.toLowerCase();
    const filtered = state.submissions.filter(i =>
      !search ||
      i.memberName.toLowerCase().includes(search) ||
      i.executive.toLowerCase().includes(search) ||
      i.mppName.toLowerCase().includes(search) ||
      i.type.toLowerCase().includes(search)
    );
    renderSubmissionsList(filtered);
  }

  function renderSubmissionsList(idents) {
    const container = document.getElementById('submissionsList');
    if (!idents.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No submissions yet</p></div>';
      return;
    }
    const sorted = [...idents].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    container.innerHTML = sorted.map(i => {
      const date = new Date(i.submittedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' });
      const syncIcon = i.synced ? '☁️' : '💾';
      return `
        <div class="member-card" style="margin-bottom:8px">
          <div class="member-card-header">
            <div class="member-avatar ${i.type === 'VCG' ? '' : ''}" style="background:${i.type==='VCG'?'var(--vcg)':'var(--mrg)'}">${i.type}</div>
            <div class="member-info">
              <div class="member-name">${i.memberName}</div>
              <div class="member-code">${i.memberCode} | ${i.mppName}</div>
              <div class="member-stats">
                <div class="member-stat">👤 <strong>${i.executive}</strong></div>
                <div class="member-stat">📅 <strong>${date}</strong></div>
                <div class="member-stat">${syncIcon} ${i.synced ? 'Synced' : 'Local only'}</div>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function adminTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
    if (tab === 'submissions') renderSubmissionsList(state.submissions);
  }

  // ---- Export ----
  function exportCSV() {
    if (!state.submissions.length) { showToast('No data to export'); return; }
    const headers = ['Unkey','Executive','BMCU Name','MPP Code','MPP Name','Member Code','Member Name','ACO','Plant','Type','Total Days','Total Qty','Last FY VCG/MRG','Remarks','Submitted At','Synced'];
    const rows = state.submissions.map(i => [
      i.unkey, i.executive, i.bmcuName, i.mppCode, i.mppName, i.memberCode, i.memberName,
      i.acoName, i.plantCode, i.type,
      i.totalDays, i.totalQty, i.lastFYVCGMRG, i.remarks, i.submittedAt, i.synced ? 'Yes' : 'No'
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vcg_mrg_identifications_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  function openGoogleSheets() {
    const cfg = localStorage.getItem('vcgmrg_sheets_url');
    if (cfg) window.open(cfg, '_blank');
    else showToast('Set up Google Sheets URL in Settings');
  }

  // ---- Config ----
  function showConfig() {
    showScreen('config');
    const input = document.getElementById('gasUrlInput');
    if (state.gasUrl) input.value = state.gasUrl;
  }

  async function saveGASUrl() {
    const url = document.getElementById('gasUrlInput').value.trim();
    const resultEl = document.getElementById('gasTestResult');
    if (!url) { resultEl.textContent = '⚠ Please enter a URL'; resultEl.style.color = 'var(--warning)'; return; }

    await dbPut('config', { key: 'gasUrl', value: url });
    state.gasUrl = url;
    resultEl.textContent = '✅ URL saved! Testing connection...';
    resultEl.style.color = 'var(--success)';

    // Test connection
    try {
      const res = await fetch(url + '?action=ping');
      if (res.ok) {
        resultEl.textContent = '✅ Connected to Google Sheets!';
        showToast('Google Sheets connected!');
      }
    } catch {
      resultEl.textContent = '⚠ Saved. Could not ping (may be normal for GET-restricted scripts)';
      resultEl.style.color = 'var(--warning)';
    }
  }

  async function changePassword() {
    const newPass = document.getElementById('newPassInput').value;
    const confirm = document.getElementById('confirmPassInput').value;
    const resultEl = document.getElementById('passChangeResult');

    if (!newPass || newPass.length < 6) { resultEl.textContent = '⚠ Password must be at least 6 characters'; resultEl.style.color = 'var(--warning)'; return; }
    if (newPass !== confirm) { resultEl.textContent = '⚠ Passwords do not match'; resultEl.style.color = 'var(--danger)'; return; }

    await dbPut('passwords', { user: state.currentUser.name, password: newPass });
    resultEl.textContent = '✅ Password updated successfully!';
    resultEl.style.color = 'var(--success)';
    document.getElementById('newPassInput').value = '';
    document.getElementById('confirmPassInput').value = '';
  }

  // ---- Navigation ----
  function goBack() {
    if (state.prevScreen) showScreen(state.prevScreen);
    else showScreen('dash');
  }

  // ---- Toast ----
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ---- Network status ----
  window.addEventListener('online', () => {
    setSyncStatus('online');
    forceSyncPending();
  });
  window.addEventListener('offline', () => setSyncStatus('offline'));

  async function forceSyncPending() {
    if (!state.gasUrl) return;
    const pending = await dbGetAll('pending');
    for (const item of pending) {
      try {
        const params = new URLSearchParams({ action: 'submit', data: JSON.stringify(item.data) });
        const res = await fetch(`${state.gasUrl}?${params}`);
        const json = await res.json();
        if (json.status === 'ok') {
          const tx = db.transaction('pending', 'readwrite');
          tx.objectStore('pending').delete(item.id);
        }
      } catch {}
    }
  }

  // ---- Close modal on overlay click ----
  document.getElementById('identifyModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // ---- Init on load ----
  document.addEventListener('DOMContentLoaded', init);

  // Public API
  return {
    login, logout, showAdminLogin, goBack,
    onBMCUSelect, onMPPSelect,
    openMPP, filterMPPs, filterMembers, searchMembers,
    openIdentifyModal, selectType, closeModal, submitIdentification, removeIdentification,
    adminTab, refreshAdmin, filterSubmissions,
    showConfig, saveGASUrl, changePassword,
    exportCSV, openGoogleSheets, forceSyncAll,
  };
})();
