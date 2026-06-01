'use strict';

const KANBAN = 'https://kanban.devds.ru/api';

// ── State ────────────────────────────────────────────────────────────────────
let token = null;
try { token = localStorage.getItem('kanban_token'); } catch(e) { console.error('LocalStorage access error', e); }
let projects    = [];
let projectUsers = {};   // slug → [{id, name, …}]
let epicsByProject = {}; // slug → [epic]
let tasksByEpic = {};    // epicId → [task]  (undefined = not loaded yet)
let epicTaskCounts = {}; // epicId → count
let allEpics    = [];    // flat, each epic has ._project ref
let selectedProjects = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('wd_selected_projects') || '[]');
  selectedProjects = new Set(saved);
} catch {}
let epicSearchQuery = '';
let taskSearchQuery = ''; 
let globalTaskSearchQuery = ''; // Deprecated, but keeping for a moment to avoid break
let tasksWorkStore = {}; // taskId → hours
let taskUserFilter = '';
let taskStatusFilter = '';
let qaEstimates = {}; // Loaded from server
let qaTeamIds = [];   // Loaded from server
let qaTrackedStore = {}; // epicId → hours
let estimateTimers = {};
let hoverTimers = {}; // epicId → timer
let filterOpen  = false;
let selectedStatuses = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('wd_selected_statuses') || '[]');
  selectedStatuses = new Set(saved);
} catch {}
let workloadTimeFilter = 'week'; // 'today' | 'yesterday' | 'week' | 'month' | 'all'
let detailTab        = 'tasks';   // 'tasks' | 'worklog'
let workLogUserFilter = '__QA__'; // default: QA team
let taskWorkLogsStore = {};        // taskId → full work log array

// ── Task detail modal state ───────────────────────────────────────────────────
let taskDetailActiveTab = 'info'; // 'info' | 'comments' | 'worklog'
let taskDetailData = null;        // { task, workLogs, comments }

// ── Create task modal state ───────────────────────────────────────────────────
let taskTemplates    = [];
let createTaskEpicId = null;
let createTaskSlug   = null;

// ── Theme ────────────────────────────────────────────────────────────────────
function applyTheme() {
  const t = localStorage.getItem('dash_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : '');
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = t === 'light' ? '☀' : '☾';
}

function cycleTheme() {
  const current = localStorage.getItem('dash_theme') || 'dark';
  const t = current === 'light' ? 'dark' : 'light';
  localStorage.setItem('dash_theme', t);
  applyTheme();
}

// ── Auth screens ─────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('wdash').style.display = 'none';
}

function showDash() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('wdash').style.display = 'flex';
}

async function doLogin() {
  const email = document.getElementById('emailInput').value.trim();
  const pass  = document.getElementById('passInput').value;
  const err   = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');
  err.textContent = '';
  if (!email || !pass) { err.textContent = 'Enter email and password'; return; }

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(
      `${KANBAN}/auth/token?email=${encodeURIComponent(email)}&password=${encodeURIComponent(pass)}`,
      { method: 'POST' }
    );
    if (!res.ok) { err.textContent = 'Invalid credentials'; return; }
    const data = await res.json();
    const tok = data.token || data.access_token || (data.data && data.data.token) || null;
    if (!tok || typeof tok !== 'string') { err.textContent = 'Unexpected auth response'; return; }
    token = tok;
    localStorage.setItem('kanban_token', token);
    showDash();
    await loadAll();
  } catch (e) {
    err.textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

function doLogout() {
  localStorage.removeItem('kanban_token');
  token = null;
  projects = []; projectUsers = {}; epicsByProject = {};
  tasksByEpic = {}; allEpics = []; selectedProjects.clear();
  setGrid('<div class="wd-state-msg">Loading…</div>');
  showLogin();
}

// ── Kanban API ────────────────────────────────────────────────────────────────
async function kFetch(url) {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401) { showLogin(); throw new Error('401'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function kPost(url, body = {}, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { showLogin(); throw new Error('401'); }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : {};
}

async function loadTaskTemplates() {
  try {
    const res = await kFetch(`${KANBAN}/task/template`);
    taskTemplates = Array.isArray(res) ? res : res?.data || [];
  } catch {}
}

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_PREFIX = 'wd_cache_';

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {
    // sessionStorage might be full — ignore
    console.warn('[Cache] write failed:', e.message);
  }
}

function clearCache() {
  const keys = Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX));
  keys.forEach(k => sessionStorage.removeItem(k));
  // Reset in-memory stores too
  tasksByEpic = {};
  epicTaskCounts = {};
  tasksWorkStore = {};
  taskWorkLogsStore = {};
  qaTrackedStore = {};
  hoverTimers = {};
  // Re-render to show fresh state
  renderGrid();
  
  if (document.getElementById('workloadPanel').classList.contains('open')) {
    renderWorkloadPanel();
  }

  // Flash the button
  const btn = document.getElementById('clearCacheBtn');
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ cleared';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  }
}

function hydrateFromCache() {
  const keys = Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX + 'tasks_'));
  keys.forEach(k => {
    try {
      const eid = parseInt(k.replace(CACHE_PREFIX + 'tasks_', ''));
      if (!eid) return;

      const cached = readCache('tasks_' + eid);
      if (cached && cached.tasks) {
        tasksByEpic[eid] = cached.tasks;
        epicTaskCounts[eid] = cached.count;
        if (cached.workLogs) {
          Object.assign(taskWorkLogsStore, cached.workLogs);
          cached.tasks.forEach(t => {
            if (taskWorkLogsStore[t.id]) {
              const totalMin = taskWorkLogsStore[t.id].reduce((s, w) => s + (w.time || 0), 0);
              tasksWorkStore[t.id] = totalMin / 60;
            }
          });
        }
        const epicRef = allEpics.find(e => e.id === eid);
        if (epicRef) {
          if (cached.created_at) epicRef.created_at = cached.created_at;
          const qaCached = readCache('qa_report_' + eid);
          if (qaCached !== null) qaTrackedStore[eid] = qaCached;
        }
      }
    } catch (e) {
      console.warn('Hydration error for key', k, e);
    }
  });
}

async function loadAllEpicsData() {
  const btn = document.getElementById('loadAllBtn');
  if (!btn || btn.disabled) return;
  
  const orgText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('loading-pulse');

  // Find epics not yet loaded
  const pending = allEpics.filter(e => tasksByEpic[e.id] === undefined);
  const total = pending.length;
  
  if (total === 0) {
    btn.textContent = '✅';
    setTimeout(() => {
      btn.textContent = orgText;
      btn.disabled = false;
      btn.classList.remove('loading-pulse');
    }, 1500);
    return;
  }

  let current = 0;
  const chunkSize = 5;
  
  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    await Promise.all(chunk.map(e => loadEpicTasks(e.id, e._project.slug)));
    current += chunk.length;
    btn.textContent = `📥 ${current}/${total}`;
  }

  btn.classList.remove('loading-pulse');
  btn.textContent = '✅';
  
  // Refresh workload if open
  if (document.getElementById('workloadPanel').classList.contains('open')) {
    renderWorkloadPanel();
  }

  setTimeout(() => {
    btn.textContent = orgText;
    btn.disabled = false;
  }, 2000);
}

async function fetchList(projectSlug, extraParams) {
  let page = 1;
  const all = [];
  while (true) {
    const data = await kFetch(
      `${KANBAN}/project/${projectSlug}/list?${extraParams}&count=100&page=${page}`
    );
    const items = Array.isArray(data) ? data
      : Array.isArray(data?.data)     ? data.data
      : Array.isArray(data?.items)    ? data.items
      : [];
    all.push(...items);
    if (items.length < 100) break;
    if (data?.total && all.length >= data.total) break;
    page++;
  }
  return all;
}

// ── Load all data ─────────────────────────────────────────────────────────────
async function loadAll() {
  setGrid('<div class="wd-state-msg">Loading projects…</div>');
  try {
    // 1. Projects
    const raw = await kFetch(`${KANBAN}/project`);
    const list = Array.isArray(raw) ? raw : raw?.data ?? [];
    projects = list.filter(p => !p.is_archived && p.is_archived !== 1);

    // 2. Project users + epics in parallel
    setGrid('<div class="wd-state-msg">Loading epics…</div>');

    const epicStages = [1,2,3,4,5,6,7,8].map(i => `filter[stage_id][${i}]=${i}`).join('&');
    const epicParams = `filter[type_id][5]=5&${epicStages}`;

    // Optimization: only fetch projects that are in selectedProjects
    // If selectedProjects is empty, fetch all (default)
    const targetProjects = selectedProjects.size === 0 ? projects : projects.filter(p => selectedProjects.has(p.slug));

    await Promise.all(targetProjects.map(async p => {
      await fetchProjectData(p, epicParams);
    }));

    // 3. Flat list
    updateAllEpics();

    // Instant hydration from existing session cache
    hydrateFromCache();

    renderFilter();
    renderGrid();

  } catch (e) {
    if (e.message !== '401') setGrid(`<div class="wd-state-msg">Error: ${h(e.message)}</div>`);
  }
}

async function fetchProjectData(project, epicParams) {
  const p = project;
  if (epicsByProject[p.slug]) return; // Already loaded
  try {
    await Promise.all([
      // users
      kFetch(`${KANBAN}/project/${p.slug}`)
        .then(d => { projectUsers[p.slug] = d.users || d.members || []; })
        .catch(() => { projectUsers[p.slug] = []; }),
      // epics
      fetchList(p.slug, epicParams || `filter[type_id][5]=5`)
        .then(epics => { epicsByProject[p.slug] = epics; })
        .catch(() => { epicsByProject[p.slug] = []; })
    ]);
    updateAllEpics();
  } catch {}
}

function updateAllEpics() {
  allEpics = projects
    .filter(p => epicsByProject[p.slug] !== undefined)
    .flatMap(p => (epicsByProject[p.slug] || []).map(e => ({ ...e, _project: p })));
}

// ── Preferences (Server-side) ────────────────────────────────────────────────
async function loadPrefs() {
  try {
    const r = await fetch('/api/prefs', { headers: { 'Authorization': `Bearer ${token}` } });
    if (r.ok) {
      const p = await r.json();
      qaEstimates = p.qa_estimates || {};
      qaTeamIds = p.qa_team_ids || [];
    }
  } catch {}
}

async function savePrefs() {
  try {
    const body = { qa_estimates: qaEstimates, qa_team_ids: qaTeamIds };
    await fetch('/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  } catch(e) { console.error('savePrefs err', e); }
}

async function loadEpicTasks(epicId, slug) {
  if (tasksByEpic[epicId] !== undefined) return; // already in memory

  // Check sessionStorage cache first
  const cacheKey = `tasks_${epicId}`;
  const cached = readCache(cacheKey);
  if (cached) {
    tasksByEpic[epicId] = cached.tasks;
    epicTaskCounts[epicId] = cached.count;
    if (cached.workLogs) {
      Object.assign(taskWorkLogsStore, cached.workLogs);
      cached.tasks.forEach(t => {
        if (taskWorkLogsStore[t.id] !== undefined) {
          const totalMin = taskWorkLogsStore[t.id].reduce((s, w) => s + (w.time || 0), 0);
          tasksWorkStore[t.id] = totalMin / 60;
        }
      });
    }
    updateEpicCard(epicId);
    const panel = document.getElementById('detailPanel');
    if (panel?.classList.contains('open') && panel.dataset.epicId == epicId) refreshDetail();
    const epicRef = allEpics.find(e => e.id === epicId);
    // Restore created_at from cache so fetchQAReport can work
    if (epicRef && cached.created_at && !epicRef.created_at) {
      epicRef.created_at = cached.created_at;
    }
    if (epicRef?.created_at && !qaTrackedStore[epicId]) fetchQAReport(epicRef);
    return;
  }

  try {
    // Fetch epic detail which contains the full 'epic_by' array of tasks
    const eRes = await kFetch(`${KANBAN}/task/${epicId}`);
    const eData = eRes?.data || eRes;
    
    if (eData && Array.isArray(eData.epic_by)) {
      const tasks = eData.epic_by;
      epicTaskCounts[epicId] = tasks.length;
      tasksByEpic[epicId] = tasks;
    } else {
      // Fallback if epic_by is missing: fetch via filter
      const tasks = await fetchList(slug, `filter[epic_id][${epicId}]=${epicId}`);
      tasksByEpic[epicId] = tasks;
      epicTaskCounts[epicId] = tasks.length;
    }

    // Enrich epic in allEpics with created_at from full task detail
    // (list API doesn't return created_at, but /task/{id} does)
    if (eData?.created_at) {
      const epicRef = allEpics.find(e => e.id === epicId);
      if (epicRef && !epicRef.created_at) {
        epicRef.created_at = eData.created_at;
        // Now that we have the date, trigger QA report
        fetchQAReport(epicRef);
      }
    }

    updateEpicCard(epicId);
    if (epicSearchQuery) renderGrid();

    // Fetch work logs in background
    const tasks = tasksByEpic[epicId] || [];
    const taskIds = tasks.map(t => t.id);
    const logsCollected = {}; // accumulate before writing cache
    const fetchWork = async (tid) => {
      // Check cache for individual task work log
      const wCacheKey = `wl_${tid}`;
      const wCached = readCache(wCacheKey);
      if (wCached) {
        logsCollected[tid] = wCached;
        taskWorkLogsStore[tid] = wCached;
        const totalMin = wCached.reduce((s, w) => s + (w.time || 0), 0);
        tasksWorkStore[tid] = totalMin / 60;
        const panel = document.getElementById('detailPanel');
        if (panel?.classList.contains('open') && panel.dataset.epicId == epicId) refreshDetail();
        return;
      }
      try {
        const work = await kFetch(`${KANBAN}/task/${tid}/work`);
        const list = Array.isArray(work) ? work : work?.data || [];
        taskWorkLogsStore[tid] = list;
        logsCollected[tid] = list;
        writeCache(wCacheKey, list);
        const totalMin = list.reduce((s, w) => s + (w.time || 0), 0);
        tasksWorkStore[tid] = totalMin / 60;
        const panel = document.getElementById('detailPanel');
        if (panel?.classList.contains('open') && panel.dataset.epicId == epicId) refreshDetail();
      } catch(e) {}
    };

    for (let i = 0; i < taskIds.length; i += 10) {
      await Promise.all(taskIds.slice(i, i + 10).map(fetchWork));
    }

    // Write a consolidated tasks+workLogs+created_at entry to cache
    const epicRef = allEpics.find(e => e.id === epicId);
    writeCache(cacheKey, {
      tasks: tasksByEpic[epicId],
      count: epicTaskCounts[epicId],
      workLogs: logsCollected,
      created_at: epicRef?.created_at  // persist so QA report works on cache hit
    });
  } catch(e) { 
    console.error('loadEpicTasks err', e);
  }
}

function onEpicHover(epicId, slug) {
  if (tasksByEpic[epicId] !== undefined) return;
  clearTimeout(hoverTimers[epicId]);
  hoverTimers[epicId] = setTimeout(() => {
    loadEpicTasks(epicId, slug);
  }, 200);
}


// ── Rendering helpers ─────────────────────────────────────────────────────────
const STATUS = {
  1: { label: 'Новые',          cls: 'status-gray'   },
  2: { label: 'В работе',       cls: 'status-blue'   },
  3: { label: 'Выполнены',      cls: 'status-green'  },
  4: { label: 'В ревью',        cls: 'status-amber'  },
  5: { label: 'К тест.',        cls: 'status-orange' },
  6: { label: 'В тест.',        cls: 'status-green'  },
  7: { label: 'Решены',         cls: 'status-green'  },
  8: { label: 'Релиз',          cls: 'status-green'  },
};

const PRIORITY = {
  1: { label: 'critical', cls: 'status-red'   },
  2: { label: 'high',     cls: 'status-red'   },
  3: { label: 'medium',   cls: 'status-amber' },
  4: { label: 'low',      cls: 'status-gray'  },
  5: { label: 'lowest',   cls: 'status-gray'  },
  critical: { label: 'critical', cls: 'status-red'   },
  high:     { label: 'high',     cls: 'status-red'   },
  medium:   { label: 'medium',   cls: 'status-amber' },
  low:      { label: 'low',      cls: 'status-gray'  },
};

function statusBadge(item) {
  const sid = stageId(item);
  const sLabel = item.stage?.name || item.stage_name || item.status_name || (typeof sid === 'string' ? sid : null);
  
  const s = STATUS[sid] || { 
    label: sLabel || (item.state === 'closed' ? 'Closed' : (sid || '—')), 
    cls: 'status-gray' 
  };
  
  // If we still have nothing and it's a meeting, maybe show 'Event'
  if (s.label === '—' && (item.name || '').includes('[Созвон]')) s.label = 'Созвон';

  return `<span class="wd-badge ${s.cls}">${h(s.label)}</span>`;
}

function priorityBadge(p) {
  if (!p) return '';
  const s = PRIORITY[p];
  // If p is a string but not in map, show it directly
  const label = s ? s.label : (typeof p === 'string' ? p : null);
  if (!label) return '';
  return `<span class="wd-badge ${s ? s.cls : 'status-gray'}">${h(label)}</span>`;
}

function stageId(item) {
  const s = item.stage;
  const sid = (typeof s === 'object' && s !== null) ? s.id : s;
  return sid ?? item.stage_id ?? item.status_id ?? item.status ?? 0;
}

function trackedSecs(task) {
  return task.time_spent ?? task.time_tracked ?? task.spent_time ?? task.logged_time ?? 0;
}

function epicTracked(epicId) {
  return (tasksByEpic[epicId] || []).reduce((s, t) => s + (tasksWorkStore[t.id] ?? (trackedSecs(t) / 3600)), 0);
}

async function fetchQAReport(epic) {
  if (!qaTeamIds.length) return;
  const eid = epic.id;
  
  // Check cache first
  const cacheKey = `qa_report_${eid}`;
  const cachedTotal = readCache(cacheKey);
  if (cachedTotal !== null) {
    qaTrackedStore[eid] = cachedTotal;
    updateEpicCard(eid);
    const panel = document.getElementById('detailPanel');
    if (panel.classList.contains('open') && panel.dataset.epicId == eid) {
      refreshDetail();
    }
    return;
  }

  const pid = epic._project.id;

  const formatDate = (dateInput) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  };

  const from = formatDate(epic.created_at);
  const to   = formatDate(new Date());

  if (!from || !to) {
    console.warn(`[QA Report] Skipping Epic ${eid}: invalid created_at →`, epic.created_at);
    return;
  }
  
  let url = `${KANBAN}/report/time?filter[from]=${from}&filter[to]=${to}&filter[overtime]=included&group[user]=1`;
  url += `&filter[project_id][${pid}]=${pid}&filter[epic_ids][0]=${eid}`;
  qaTeamIds.forEach(uid => {
    url += `&filter[user_id][${uid}]=${uid}`;
  });


  try {
    console.log(`[QA Report] Requesting for Epic ${eid} (PID: ${pid}, From: ${from}):`, url);
    const res = await kFetch(url);
    console.log(`[QA Report] Response for Epic ${eid}:`, res);
    const list = Array.isArray(res) ? res : res?.data || [];
    
    // API returns per-user records; entries is a date→minutes object, e.g. {"2026-03-26": 300}
    let totalMin = 0;
    list.forEach(u => {
      if (u.entries && typeof u.entries === 'object' && !Array.isArray(u.entries)) {
        Object.values(u.entries).forEach(minutes => {
          totalMin += (parseInt(minutes) || 0);
        });
      } else {
        // fallback: try root `time` field
        totalMin += (parseInt(u.time) || 0);
      }
    });
    const result = totalMin / 60;
    qaTrackedStore[eid] = result;
    writeCache(cacheKey, result);

    // Update the epic card in the grid
    updateEpicCard(eid);

    // Refresh detail if still open
    const panel = document.getElementById('detailPanel');
    if (panel.classList.contains('open') && panel.dataset.epicId == eid) {
      refreshDetail();
    }
  } catch(e) { console.error('[QA Report] Error for Epic ' + eid, e); }
}


function assigneeNames(task, slug) {
  const arr = task.assignees || task.users || [];
  let names = [];
  if (arr.length) {
    names = arr.map(a => {
      if (typeof a === 'object' && a !== null) {
        // Use embedded name/surname if available (epic_by API returns full objects)
        if (a.name || a.surname) return [a.name, a.surname].filter(Boolean).join(' ');
        // Fall back to lookup by ID
        const uid = a.id ?? a.user_id;
        const m = (projectUsers[slug] || []).find(u => u.id === uid);
        return m ? (m.name || m.username || m.email || `#${uid}`) : `#${uid}`;
      }
      const m = (projectUsers[slug] || []).find(u => u.id === a);
      return m ? (m.name || m.username || m.email || `#${a}`) : `#${a}`;
    });
  } else if (task.responsible) {
    const r = task.responsible;
    names = [[r.name, r.surname].filter(Boolean).join(' ') || `#${r.id}`];
  } else if (task.responsible_id) {
    const m = (projectUsers[slug] || []).find(u => u.id === task.responsible_id);
    names = [m ? (m.name || m.username || `#${task.responsible_id}`) : `#${task.responsible_id}`];
  }
  return names.filter(Boolean).join(', ') || '';
}

function assigneeShort(task, slug) {
  const all = assigneeNames(task, slug).split(', ').filter(Boolean);
  if (!all.length) return '';
  if (all.length === 1) return all[0];
  return `${all[0]} +${all.length - 1}`;
}

function fmtH(hours) {
  if (!hours || hours <= 0) return '0h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function h(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setGrid(html) {
  document.getElementById('epicsGrid').innerHTML = html;
}

// ── Epic card ─────────────────────────────────────────────────────────────────
function epicCardHTML(epic) {
  const id        = epic.id;
  const qaTracked = qaTrackedStore[id] || 0;
  const estimate  = qaEstimates[id] || 0;
  const pct       = estimate > 0 ? Math.min(100, (qaTracked / estimate) * 100) : 0;
  const barColor  = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--blue)';
  const taskCount = epicTaskCounts[id];
  const taskLabel = taskCount === undefined ? '…' : `${taskCount} task${taskCount !== 1 ? 's' : ''}`;
  const slug      = epic._project.slug;
  const qaLabel   = qaTrackedStore[id] !== undefined ? fmtH(qaTracked) : '—';
  const overrunPct = (estimate > 0 && qaTracked > estimate) ? Math.round(((qaTracked - estimate) / estimate) * 100) : 0;
  const overrunBadge = `<span class="wd-overrun-badge" id="qa-overrun-${id}" style="${overrunPct > 0 ? '' : 'display:none'}">+${overrunPct}%</span>`;

  return `<div class="wd-card" data-epic-id="${id}" 
    onmouseenter="onEpicHover(${id}, '${h(slug)}')"
    onclick="openDetail(${id})">
  <div class="wd-card-header">
    <div class="wd-card-badges">
      <span class="wd-project-badge" title="${h(epic._project.name)}">${h(epic._project.name)}</span>
      ${statusBadge(epic)}
    </div>
  </div>
  <div class="wd-card-title">${h(epic.name || epic.title || '')}</div>
  <div class="wd-card-progress">
    <div class="wd-progress-labels">
      <span class="wd-progress-label">QA tracked ${overrunBadge}</span>
      <span class="wd-progress-label" id="qa-label-${id}">${qaLabel} / <span class="wd-estimate-display">${estimate > 0 ? fmtH(estimate) : '?h'}</span></span>
    </div>
    <div class="metric-track">
      <div class="metric-bar" id="qa-bar-${id}" style="width:${pct}%;background:${barColor};"></div>
    </div>
    <div class="wd-estimate-row" onclick="event.stopPropagation()">
      <label class="wd-input-label">estimate</label>
      <input class="wd-estimate-input" type="number" min="0" step="0.5"
        value="${estimate || ''}" placeholder="h"
        oninput="onEstimateInput(event,${id})"
        data-epic-id="${id}"/>
    </div>
  </div>
  <div class="wd-card-footer">
    <span class="wd-task-count" id="count-${id}">${taskLabel}</span>
  </div>
</div>`;
}

function renderGrid() {
  let epics = selectedProjects.size === 0
    ? allEpics
    : allEpics.filter(e => selectedProjects.has(e._project.slug));

  if (epicSearchQuery) {
    const q = epicSearchQuery.toLowerCase();
    epics = epics.filter(e => (e.name || e.title || '').toLowerCase().includes(q));
  }

  // 3. Filter by selected statuses
  if (selectedStatuses.size > 0) {
    epics = epics.filter(e => selectedStatuses.has(String(stageId(e))));
  } else {
    // Default: hide "Release" (id 8)
    epics = epics.filter(e => stageId(e) != 8);
  }

  if (!epics.length) {
    setGrid('<div class="wd-state-msg">No epics found</div>');
    return;
  }
  setGrid(epics.map(epicCardHTML).join(''));
}

function onEpicSearch(q) {
  epicSearchQuery = q;
  renderGrid();
}

function updateEpicCard(epicId) {
  const card = document.querySelector(`.wd-card[data-epic-id="${epicId}"]`);
  if (!card) return;

  const count = epicTaskCounts[epicId];
  const qaTracked = qaTrackedStore[epicId];
  const estimate = qaEstimates[epicId] || 0;
  const pct = qaTracked !== undefined && estimate > 0 ? Math.min(100, (qaTracked / estimate) * 100) : 0;
  const barColor = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--blue)';
  const qaLabel = qaTracked !== undefined ? fmtH(qaTracked) : '—';

  const tc = card.querySelector(`#count-${epicId}`);
  if (tc) tc.textContent = count === undefined ? '…' : `${count} task${count !== 1 ? 's' : ''}`;

  const bar = card.querySelector(`#qa-bar-${epicId}`);
  if (bar) { bar.style.width = `${pct}%`; bar.style.background = barColor; }

  const disp = card.querySelector('.wd-estimate-display');
  if (disp) disp.textContent = estimate > 0 ? fmtH(estimate) : '?h';

  // Update the QA tracked label (first child text node of the second .wd-progress-label)
  const qaLabelEl = card.querySelector(`#qa-label-${epicId}`);
  if (qaLabelEl) {
    const firstNode = qaLabelEl.firstChild;
    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
      firstNode.textContent = `${qaLabel} / `;
    }
  }

  const overrunEl = card.querySelector(`#qa-overrun-${epicId}`);
  if (overrunEl) {
    const overrunPct = (estimate > 0 && qaTracked > estimate) ? Math.round(((qaTracked - estimate) / estimate) * 100) : 0;
    if (overrunPct > 0) {
      overrunEl.textContent = `+${overrunPct}%`;
      overrunEl.style.display = '';
    } else {
      overrunEl.style.display = 'none';
    }
  }
}

// ── QA estimate input ─────────────────────────────────────────────────────────
function onEstimateInput(e, epicId) {
  const val = parseFloat(e.target.value) || 0;
  clearTimeout(estimateTimers[epicId]);
  estimateTimers[epicId] = setTimeout(async () => {
    qaEstimates[epicId] = val;
    await savePrefs();
    updateEpicCard(epicId);
  }, 800);
}

// ── Project filter ────────────────────────────────────────────────────────────
function renderFilter() {
  const container = document.getElementById('projectFilters');
  const isAllProjects = selectedProjects.size === 0;

  const projectButtons = projects.map(p => {
    const isChecked = selectedProjects.has(p.slug);
    return `<button class="chip-btn ${isChecked ? 'active' : ''}" 
      onclick="onToggleProject('${p.slug.replace(/'/g,"\\'")}')">
      ${h(p.name)}
    </button>`;
  }).join('');

  // Status mapping from all loaded epics
  const statusMap = new Map();
  allEpics.forEach(e => {
    const sid = String(stageId(e));
    if (!statusMap.has(sid)) {
      const s = STATUS[sid];
      const label = s ? s.label : (e.stage?.name || e.stage_name || e.status_name || sid);
      statusMap.set(sid, label);
    }
  });
  
  const statusButtons = Array.from(statusMap.entries())
    .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([id, label]) => {
      const isChecked = selectedStatuses.has(id);
      return `<button class="chip-btn ${isChecked ? 'active' : ''}" onclick="onToggleStatus('${id}')">${h(label)}</button>`;
    }).join('');

  container.innerHTML = `
    <button class="chip-btn ${isAllProjects ? 'active' : ''}" onclick="onToggleAll()">All projects</button>
    <div class="filter-sep-v"></div>
    ${projectButtons}
    <div class="filter-sep-v" style="margin: 0 12px; height: 20px; border-left: 2px solid var(--border); opacity: 0.5;"></div>
    <button class="chip-btn ${selectedStatuses.size === 0 ? 'active' : ''}" onclick="onToggleAllStatuses()">All statuses</button>
    <div class="filter-sep-v"></div>
    ${statusButtons}
  `;
}

function onToggleStatus(id) {
  if (selectedStatuses.has(id)) {
    selectedStatuses.delete(id);
  } else {
    selectedStatuses.add(id);
  }
  localStorage.setItem('wd_selected_statuses', JSON.stringify(Array.from(selectedStatuses)));
  renderFilter();
  renderGrid();
}

function onToggleAllStatuses() {
  selectedStatuses.clear();
  localStorage.setItem('wd_selected_statuses', JSON.stringify([]));
  renderFilter();
  renderGrid();
}


function onToggleAll() {
  selectedProjects.clear();
  localStorage.setItem('wd_selected_projects', JSON.stringify([]));
  renderFilter();
  renderGrid();
}

async function onToggleProject(slug) {
  if (selectedProjects.has(slug)) {
    selectedProjects.delete(slug);
  } else {
    selectedProjects.add(slug);
    // If we newly added a project, make sure it's loaded
    const p = projects.find(pr => pr.slug === slug);
    if (p && !epicsByProject[slug]) {
      await fetchProjectData(p);
    }
  }
  localStorage.setItem('wd_selected_projects', JSON.stringify(Array.from(selectedProjects)));
  renderFilter();
  renderGrid();
}


// ── Detail panel ──────────────────────────────────────────────────────────────
function openDetail(epicId) {
  const epic = allEpics.find(e => e.id === epicId);
  if (!epic) return;

  const panel = document.getElementById('detailPanel');
  panel.dataset.epicId = epicId;
  taskSearchQuery = ''; 
  taskUserFilter = ''; 
  taskStatusFilter = ''; 
  document.getElementById('detailContent').innerHTML = detailHTML(epic, tasksByEpic[epicId]);
  document.getElementById('detailOverlay').classList.add('open');
  panel.classList.add('open');
  
  // Also fetch QA report
  fetchQAReport(epic);

  // If tasks not loaded yet, trigger load
  if (tasksByEpic[epicId] === undefined) {
    loadEpicTasks(epicId, epic._project.slug);
  }

  // Push to hash for "new page" feel / shareable link
  if (window.location.hash !== `#epic-${epicId}`) {
    window.history.pushState(null, '', `#epic-${epicId}`);
  }
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  document.getElementById('detailPanel').classList.remove('open');
  if (window.location.hash.startsWith('#epic-')) {
    window.history.pushState(null, '', window.location.pathname);
  }
}

function onTaskSearch(q) {
  taskSearchQuery = q;
  refreshDetail();
}

function onTaskUserFilter(val) {
  taskUserFilter = val;
  refreshDetail();
}

function onTaskStatusFilter(val) {
  taskStatusFilter = val;
  refreshDetail();
}

function setDetailTab(tab) {
  detailTab = tab;
  refreshDetail();
}

function graphTabHTML(epic) {
  const tasks = tasksByEpic[epic.id] || [];
  if (!tasks.length) return `<div class="wd-state-msg">No task data available for graphs</div>`;
  
  return `<div class="dp-graph-container">
    <div class="dp-chart-wrap">
      <div class="dp-chart-title">Трудозатраты по задачам (Top 15, ч)</div>
      <div class="dp-chart-canvas-wrap">
        <canvas id="taskChart"></canvas>
      </div>
    </div>
    <div class="dp-chart-wrap" style="padding-top: 16px; margin-top: 16px;">
      <div class="dp-chart-title">Распределение часов по QA (ч)</div>
      <div class="dp-chart-canvas-wrap">
        <canvas id="qaChart"></canvas>
      </div>
    </div>
    <div class="dp-chart-wrap" style="border-top: 1px solid var(--border); padding-top: 48px; margin-top: 16px;">
      <div class="dp-chart-title">Соотношение QA и разработки (%)</div>
      <div class="dp-chart-canvas-wrap" style="height: 320px;">
        <canvas id="ratioChart"></canvas>
      </div>
    </div>
  </div>`;
}

function initGraphs(epic) {
  if (detailTab !== 'graph') return;
  const tasks = tasksByEpic[epic.id] || [];
  
  // ── 1. Task Workload (Horizontal Bar) ─────────────────────
  const taskCtx = document.getElementById('taskChart')?.getContext('2d');
  if (taskCtx) {
    const qaIds = qaTeamIds.map(id => String(id));
    const data = tasks.map(t => {
      const logs = taskWorkLogsStore[t.id] || [];
      const qaTime = logs.reduce((s, w) => {
        return (w.user && qaIds.includes(String(w.user.id))) ? s + (w.time || 0) : s;
      }, 0);
      return { id: t.id, name: t.name || t.title || `#${t.id}`, hours: qaTime / 60 };
    })
    .filter(d => d.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 15);

    new Chart(taskCtx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          label: 'QA Hours',
          data: data.map(d => d.hours),
          backgroundColor: 'rgba(96, 165, 250, 0.6)',
          borderColor: 'rgb(96, 165, 250)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (e, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const tid = data[idx].id;
            window.open(`https://kanban.devds.ru/projects/${epic._project.slug}/${tid}`, '_blank');
          }
        },
        onHover: (e, elements) => {
          e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        },
        plugins: { 
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.parsed.x.toFixed(1)}h (QA)` }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { 
            grid: { display: false }, 
            ticks: { 
              color: '#94a3b8', 
              font: { size: 9 },
              callback: function(value) {
                const label = this.getLabelForValue(value);
                return label.length > 30 ? label.substr(0, 27) + '...' : label;
              }
            } 
          }
        }
      }
    });
  }

  // ── 2. QA Distribution (Pie) ──────────────────────────
  const qaCtx = document.getElementById('qaChart')?.getContext('2d');
  if (qaCtx) {
    const qaIds = qaTeamIds.map(id => String(id));
    const userTotals = {};
    tasks.forEach(t => {
      (taskWorkLogsStore[t.id] || []).forEach(w => {
        if (w.user && qaIds.includes(String(w.user.id))) {
          const name = [w.user.name, w.user.surname].filter(Boolean).join(' ') || 'QA';
          userTotals[name] = (userTotals[name] || 0) + (w.time || 0);
        }
      });
    });

    const entries = Object.entries(userTotals).sort((a,b) => b[1] - a[1]);
    
    new Chart(qaCtx, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => (e[1] / 60).toFixed(1)),
          backgroundColor: [
            '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#818cf8', '#a78bfa', '#2dd4bf', '#fb7185'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { 
            position: 'bottom', 
            labels: { color: '#94a3b8', boxWidth: 10, padding: 15, font: { size: 10, family: 'Inter' } } 
          }
        }
      }
    });
  }

  // ── 3. QA vs Dev Ratio (Doughnut with Center Text) ────────
  const ratioCtx = document.getElementById('ratioChart')?.getContext('2d');
  if (ratioCtx) {
    const qaIds = qaTeamIds.map(id => String(id));
    let qaMin = 0, backMin = 0, frontMin = 0, otherMin = 0;
    
    tasks.forEach(t => {
      const name = (t.name || t.title || '').trim().toUpperCase();
      const isBack = /\[\s*(BACK|CMS)\s*\]/i.test(name);
      const isFront = /\[\s*FRONT\s*\]/i.test(name);
      
      (taskWorkLogsStore[t.id] || []).forEach(w => {
        if (w.user && qaIds.includes(String(w.user.id))) {
          qaMin += (w.time || 0);
        } else if (isBack) {
          backMin += (w.time || 0);
        } else if (isFront) {
          frontMin += (w.time || 0);
        } else {
          otherMin += (w.time || 0);
        }
      });
    });

    const totalMin = qaMin + backMin + frontMin + otherMin;
    const qaPct = totalMin > 0 ? Math.round((qaMin / totalMin) * 100) : 0;

    new Chart(ratioCtx, {
      type: 'doughnut',
      data: {
        labels: ['QA Effort', 'Backend', 'Frontend', 'Other Dev'],
        datasets: [{
          data: [qaMin / 60, backMin / 60, frontMin / 60, otherMin / 60],
          backgroundColor: [
            '#60a5fa', // QA - Blue
            '#34d399', // BACK - Green
            '#fbbf24', // FRONT - Amber
            'rgba(148, 163, 184, 0.2)' // Other - Gray
          ],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '80%',
        plugins: {
          legend: { 
            position: 'bottom', 
            labels: { color: '#94a3b8', boxWidth: 10, padding: 15, font: { size: 10 } } 
          },
          tooltip: {
            yAlign: 'bottom',
            caretPadding: 20,
            displayColors: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const h = ctx.parsed.toFixed(1);
                const p = totalMin > 0 ? Math.round((ctx.parsed * 60 / totalMin) * 100) : 0;
                return ` ${ctx.label}: ${h}ч (${p}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerText',
        afterDraw: (chart) => {
          const { ctx, chartArea: { top, width, height } } = chart;
          ctx.save();
          ctx.font = 'bold 36px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#60a5fa';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${qaPct}%`, width / 2, top + (height / 2));
          
          ctx.font = '500 10px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('QA SHARE', width / 2, top + (height / 2) + 28);
          ctx.restore();
        }
      }]
    });
  }
}

function onWorkLogUserFilter(val) {
  workLogUserFilter = val;
  refreshDetail();
}

function workLogTabHTML(epic) {
  const epicId = epic.id;
  const tasks = tasksByEpic[epicId] || [];
  const loadedCount = tasks.filter(t => taskWorkLogsStore[t.id] !== undefined).length;

  if (loadedCount < tasks.length && tasks.length > 0) {
    return `<div class="wd-state-msg">Loading work logs… ${loadedCount}/${tasks.length}</div>`;
  }

  // Aggregate all entries
  let allLogs = [];
  tasks.forEach(t => {
    (taskWorkLogsStore[t.id] || []).forEach(w => {
      allLogs.push({ ...w, _task: t });
    });
  });

  // Build unique users from all logs
  const uniqueWLUsers = new Set();
  allLogs.forEach(w => {
    if (w.user) {
      const name = [w.user.name, w.user.surname].filter(Boolean).join(' ');
      if (name) uniqueWLUsers.add(name);
    }
  });

  // Apply user filter
  let filtered = allLogs;
  if (workLogUserFilter === '__QA__') {
    const qaIds = qaTeamIds.map(id => String(id));
    filtered = allLogs.filter(w => w.user && qaIds.includes(String(w.user.id)));
  } else if (workLogUserFilter) {
    filtered = allLogs.filter(w => {
      const name = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : '';
      return name === workLogUserFilter;
    });
  }

  // Sort newest first
  filtered.sort((a, b) => (b.begin || '').localeCompare(a.begin || ''));

  const totalMin = filtered.reduce((s, w) => s + (w.time || 0), 0);

  const usersArr = Array.from(uniqueWLUsers).sort();
  const qaOpt = qaTeamIds.length
    ? `<option value="__QA__" ${workLogUserFilter === '__QA__' ? 'selected' : ''}>QA team</option>` : '';
  const userOpts = usersArr.map(u =>
    `<option value="${h(u)}" ${workLogUserFilter === u ? 'selected' : ''}>${h(u)}</option>`
  ).join('');

  const rows = filtered.map(w => {
    const userName = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : '—';
    const date = w.begin ? new Date(w.begin).toLocaleDateString('ru-RU') : '—';
    const taskName = w._task.name || w._task.title || `#${w._task.id}`;
    const comment = (w.comment || '').trim();
    const taskUrl = `https://kanban.devds.ru/projects/${epic._project.slug}/${w._task.id}`;
    return `<div class="wl-row">
  <div class="wl-row-top">
    <span class="wl-who">${h(userName)}</span>
    <span class="wl-date">${h(date)}</span>
    <a class="wl-task-id" href="${taskUrl}" target="_blank">#${w._task.id}</a>
    <span class="wl-time">${fmtH(w.time / 60)}</span>
  </div>
  <a class="wl-task-name" href="${taskUrl}" target="_blank">${h(taskName)}</a>
  ${comment ? `<div class="wl-comment">${h(comment)}</div>` : ''}
</div>`;
  }).join('');

  const emptyMsg = filtered.length === 0
    ? `<div class="wd-state-msg">No entries found</div>` : '';

  // Calculate summary by user
  const userTotals = {};
  filtered.forEach(w => {
    const name = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : 'Unknown';
    userTotals[name] = (userTotals[name] || 0) + (w.time || 0);
  });
  const summaryRows = Object.entries(userTotals)
    .sort((a,b) => b[1] - a[1])
    .map(([name, time]) => `
      <div class="wl-summary-row">
        <span>${h(name)}</span>
        <b>${fmtH(time/60)}</b>
      </div>
    `).join('');

  const summaryHTML = filtered.length > 0 ? `
    <div class="wl-summary">
      <div class="wl-summary-title">Personal Breakdown</div>
      ${summaryRows}
    </div>
  ` : '';

  return `<div class="wl-filter-bar">
  <select class="dp-select" onchange="onWorkLogUserFilter(this.value)">
    <option value="" ${workLogUserFilter === '' ? 'selected' : ''}>all users</option>
    ${qaOpt}
    ${userOpts}
  </select>
  ${filtered.length > 0 ? `<span class="wl-total">${fmtH(totalMin / 60)} · ${filtered.length} entries</span>` : ''}
</div>
<div class="wl-list">${rows || emptyMsg}</div>
${summaryHTML}`;
}


function refreshDetail() {
  const epicId = parseInt(document.getElementById('detailPanel').dataset.epicId);
  const epic = allEpics.find(e => e.id === epicId);
  if (epic) {
    const active = document.activeElement;
    const focusId = active?.id;
    const selStart = active?.selectionStart;
    const selEnd   = active?.selectionEnd;
    document.getElementById('detailContent').innerHTML = detailHTML(epic, tasksByEpic[epicId]);
    if (detailTab === 'graph') initGraphs(epic);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        // Restore cursor position to fix reversed-text input bug
        if (selStart !== undefined && el.setSelectionRange) {
          el.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }
}

function detailHTML(epic, tasks) {
  const slug    = epic._project.slug;
  let taskArr   = tasks ? [...tasks] : [];
  
  // 1. Sort: New to Solve (assuming ID desc means new first)
  taskArr.sort((a, b) => b.id - a.id);

  // 2. Build unique users from embedded task data (list API has embedded user objects)
  const uniqueUsers = new Set();
  const uniqueStatusIds = new Set();
  (tasks || []).forEach(t => {
    const arr = t.assignees || t.users || [];
    arr.forEach(a => {
      if (typeof a === 'object' && a !== null) {
        // Prefer embedded name/surname
        const name = [a.name, a.surname].filter(Boolean).join(' ');
        if (name) { uniqueUsers.add(name); return; }
      }
      // Fall back to projectUsers lookup
      const uid = typeof a === 'object' ? (a.id ?? a.user_id) : a;
      const m = (projectUsers[slug] || []).find(u => u.id === uid);
      if (m) uniqueUsers.add(m.name || m.username || m.email);
    });
    if (!arr.length && t.responsible) {
      const r = t.responsible;
      const name = [r.name, r.surname].filter(Boolean).join(' ');
      if (name) uniqueUsers.add(name);
    }
    uniqueStatusIds.add(stageId(t));
  });

  // 3. Apply individual filters
  if (taskSearchQuery) {
    const q = taskSearchQuery.toLowerCase();
    taskArr = taskArr.filter(t => (t.name || t.title || '').toLowerCase().includes(q));
  }
  if (taskUserFilter === '__QA__') {
    const qaIds = qaTeamIds.map(id => String(id));
    taskArr = taskArr.filter(t => {
      const arr = t.assignees || t.users || [];
      return arr.some(a => {
        const uid = String(typeof a === 'object' ? (a.id ?? a.user_id) : a);
        return qaIds.includes(uid);
      }) || (t.responsible && qaIds.includes(String(t.responsible.id)));
    });
  } else if (taskUserFilter) {
    taskArr = taskArr.filter(t => assigneeNames(t, slug).includes(taskUserFilter));
  }
  if (taskStatusFilter) {
    taskArr = taskArr.filter(t => stageId(t) == taskStatusFilter);
  }

  const inProgress = taskArr.filter(t => [2,4,5,6].includes(stageId(t))).length;
  const done       = taskArr.filter(t => [3,7,8].includes(stageId(t))).length;
  const totalTracked = taskArr.reduce((s, t) => s + (tasksWorkStore[t.id] || 0), 0);
  const qaTracked = qaTrackedStore[epic.id];

  const taskRows = taskArr.map(t => {
    const tTracked  = tasksWorkStore[t.id] || (trackedSecs(t) / 3600);
    const prio      = t.priority || t.priority_id;
    const shortName = assigneeShort(t, slug);
    return `<div class="wd-task-row">
  <div class="wd-task-meta-row">
    <a class="wd-task-id" href="https://kanban.devds.ru/projects/${slug}/${t.id}" target="_blank" onclick="event.stopPropagation()">#${t.id}</a>
    ${statusBadge(t)}
    ${priorityBadge(prio)}
    <div class="wd-task-meta-right">
      ${shortName ? `<span class="wd-assignees">${h(shortName)}</span>` : ''}
      ${tTracked > 0 ? `<span class="wd-tracked">${fmtH(tTracked)}</span>` : ''}
    </div>
  </div>
  <div class="wd-task-name" onclick="openTaskDetail(${t.id})">${h(t.name || t.title || '')}</div>
</div>`;
  }).join('');

  const usersArr = Array.from(uniqueUsers).sort();
  const qaOption = qaTeamIds.length 
    ? `<option value="__QA__" ${taskUserFilter === '__QA__' ? 'selected' : ''}>QA team</option>` 
    : '';
  const userOptions = usersArr.map(u => `<option value="${h(u)}" ${taskUserFilter === u ? 'selected' : ''}>${h(u)}</option>`).join('');
  const statusOptions = Array.from(uniqueStatusIds).sort((a,b)=>a-b).map(id => {
    const label = STATUS[id]?.label || id;
    return `<option value="${id}" ${taskStatusFilter == id ? 'selected' : ''}>${h(label)}</option>`;
  }).join('');

  const tasksSection = tasks === undefined
    ? '<div class="wd-state-msg">Loading tasks…</div>'
    : taskArr.length
      ? taskRows
      : `<div class="wd-state-msg">${(taskSearchQuery || taskUserFilter || taskStatusFilter) ? 'No tasks matching filters' : 'No tasks in this epic'}</div>`;

  const tabsHTML = `<div class="dp-tabs">
  <button class="dp-tab ${detailTab === 'tasks' ? 'active' : ''}" onclick="setDetailTab('tasks')">Tasks</button>
  <button class="dp-tab ${detailTab === 'worklog' ? 'active' : ''}" onclick="setDetailTab('worklog')">Work Log</button>
  <button class="dp-tab ${detailTab === 'graph' ? 'active' : ''}" onclick="setDetailTab('graph')">Graph</button>
</div>`;

  let bodyContent = '';
  if (detailTab === 'worklog') {
    bodyContent = workLogTabHTML(epic);
  } else if (detailTab === 'graph') {
    bodyContent = graphTabHTML(epic);
  } else {
    bodyContent = `<div class="dp-filter-row">
  <input type="text" id="taskSearchInput" class="dp-filter-input" placeholder="🔍 filter tasks..." 
    value="${h(taskSearchQuery)}" oninput="onTaskSearch(this.value)">
  <select id="taskStatusFilter" class="dp-filter-select" onchange="onTaskStatusFilter(this.value)">
    <option value="">all statuses</option>
    ${statusOptions}
  </select>
  <select id="taskUserFilter" class="dp-filter-select" onchange="onTaskUserFilter(this.value)">
    <option value="">all users</option>
    ${qaOption}
    ${userOptions}
  </select>
  <span class="dp-filter-count">${taskArr.length} shown</span>
</div>
<div class="dp-tasks">${tasksSection}</div>`;
  }

  return `<div class="dp-header">
  <div class="dp-close" onclick="closeDetail()">✕</div>
  <div class="dp-badges">
    <span class="wd-project-badge">${h(epic._project.name)}</span>
    ${statusBadge(epic)}
  </div>
  <div class="dp-title">${h(epic.name || epic.title || '')}</div>
</div>
<div class="dp-body">
  <div class="dp-stats">
    <div class="dp-stat">
      <span class="dp-stat-label">total</span>
      <span class="dp-stat-val">${epicTaskCounts[epic.id] || '…'}</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-label">in work</span>
      <span class="dp-stat-val">${tasks === undefined ? '…' : inProgress}</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-label">done</span>
      <span class="dp-stat-val">${tasks === undefined ? '…' : done}</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-label">tracked</span>
      <span class="dp-stat-val" title="Total epic tracked">${fmtH(totalTracked)}</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-label">QA tracked</span>
      <span class="dp-stat-val" style="color:var(--blue)" title="Tracked by team QA">${fmtH(qaTracked)}</span>
    </div>
  </div>
  ${tabsHTML}
  ${bodyContent}
</div>`;
}

// ── Global event listeners ────────────────────────────────────────────────────
document.addEventListener('click', e => {
  if (filterOpen && !document.getElementById('filterWrap').contains(e.target)) {
    filterOpen = false;
    document.getElementById('filterDropdown').classList.remove('open');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('createTaskPanel').classList.contains('open')) {
      closeCreateTask();
    } else if (document.getElementById('taskDetailPanel').classList.contains('open')) {
      closeTaskDetail();
    } else if (document.getElementById('workloadPanel').classList.contains('open')) {
      toggleWorkload();
    } else if (document.getElementById('settingsPanel').classList.contains('open')) {
      toggleSettings();
    } else {
      closeDetail();
    }
  }
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#epic-')) {
    const id = parseInt(hash.replace('#epic-', ''));
    if (id) openDetail(id);
  } else if (!hash) {
    closeDetail();
  }
});

// ── Workload Panel ────────────────────────────────────────────────────────────
function toggleWorkload() {
  const panel = document.getElementById('workloadPanel');
  const overlay = document.getElementById('workloadOverlay');
  const isOpen = panel.classList.contains('open');
  
  if (isOpen) {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    renderWorkloadPanel();
    panel.classList.add('open');
    overlay.classList.add('open');
  }
}

function isDateInRange(dateStr, range) {
  if (!dateStr || range === 'all') return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.getTime();
  
  if (range === 'today') return time >= todayStart;
  if (range === 'yesterday') {
    const yestStart = todayStart - 86400000;
    return time >= yestStart && time < todayStart;
  }
  if (range === 'week') {
    return time >= (now.getTime() - 7 * 86400000);
  }
  if (range === 'month') {
    return time >= (now.getTime() - 30 * 86400000);
  }
  return true;
}

function setWorkloadFilter(f) {
  workloadTimeFilter = f;
  renderWorkloadPanel();
}

function renderWorkloadPanel() {
  const team = {}; 
  const qaIds = (qaTeamIds || []).map(id => String(id));
  
  // Aggregate all work logs from memory AND cache
  const epicToProject = {};
  allEpics.forEach(e => epicToProject[e.id] = e._project.slug);

  // 1. Collect all logs (TaskId -> Array)
  const allLogsMap = { ...taskWorkLogsStore };
  const keys = Object.keys(sessionStorage).filter(k => k.startsWith('wd_cache_tasks_'));
  keys.forEach(k => {
    const raw = sessionStorage.getItem(k);
    if (raw) {
      try {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL && data.workLogs) {
          Object.entries(data.workLogs).forEach(([taskId, logs]) => {
            if (!allLogsMap[taskId]) allLogsMap[taskId] = logs;
          });
        }
      } catch {}
    }
  });

  // 2. Process logs
  const seenEpics = new Set();
  const activeTaskCount = new Set();

  Object.values(allLogsMap).forEach(logs => {
    logs.forEach(w => {
      if (!w.user) return;
      const uid = String(w.user.id);
      if (!qaIds.includes(uid)) return;
      if (!isDateInRange(w.begin, workloadTimeFilter)) return;
      
      const name = [w.user.name, w.user.surname].filter(Boolean).join(' ') || `#${uid}`;
      if (!team[name]) team[name] = { hours: 0, tasks: new Set(), epics: new Set() };
      
      team[name].hours += (w.time || 0);
      if (w.task_id) {
        team[name].tasks.add(w.task_id);
        activeTaskCount.add(w.task_id);
      }
      // Try to find epic from task metadata if available, otherwise we skip global counts
      // For now, these sets only tell us 'within this filter' range.
    });
  });

  const sortedNames = Object.keys(team).sort((a,b) => team[b].hours - team[a].hours);
  const rows = sortedNames.map(name => {
    const data = team[name];
    return `<tr>
      <td>${h(name)}</td>
      <td class="workload-hours">${fmtH(data.hours / 60)}</td>
      <td class="workload-meta">${data.tasks.size} tasks</td>
    </tr>`;
  }).join('');

  const filterBtn = (f, label) => `
    <button class="wl-filter-btn ${workloadTimeFilter === f ? 'active' : ''}" 
      onclick="setWorkloadFilter('${f}')">${label}</button>`;

  document.getElementById('workloadContent').innerHTML = `
    <div class="workload-title">Team Workload</div>
    
    <div class="workload-filters">
      ${filterBtn('today', 'Today')}
      ${filterBtn('yesterday', 'Yesterday')}
      ${filterBtn('week', 'Last 7d')}
      ${filterBtn('month', 'Last 30d')}
      ${filterBtn('all', 'All time')}
    </div>

    <div style="font-size:11px; color:var(--muted); margin-bottom:20px; opacity:0.8">
      Showing QA tracked time based on available cache.
    </div>

    <table class="workload-table">
      <thead>
        <tr>
          <th>Member</th>
          <th>Tracked</th>
          <th>Reach</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" class="wd-state-msg">No entries for this period</td></tr>'}
      </tbody>
    </table>
  `;
}

// ── Settings ────────────────────────────────────────────────────────────────
function toggleSettings() {
  const isOpening = !document.getElementById('settingsPanel').classList.contains('open');
  document.getElementById('settingsOverlay').classList.toggle('open', isOpening);
  document.getElementById('settingsPanel').classList.toggle('open', isOpening);
  if (isOpening) renderSettings();
}

function renderSettings() {
  const ids = qaTeamIds.join(', ');
  document.getElementById('settingsContent').innerHTML = `
    <div class="settings-group">
      <label class="settings-label">Team QA User IDs (comma separated)</label>
      <input type="text" id="qaIdsInput" class="wd-input" value="${h(ids)}" placeholder="e.g. 216, 220, 270">
      <p style="font-size:10px; color:var(--muted); margin-top:4px;">Used for 'QA Tracked' report</p>
    </div>
    <div style="margin-top:24px">
      <button class="chip-btn active" style="padding:10px 24px" onclick="saveSettings()">Save changes</button>
    </div>
  `;
}

async function saveSettings() {
  const idsVal = document.getElementById('qaIdsInput').value;
  qaTeamIds = idsVal.split(',').map(s => s.trim()).filter(Boolean);
  await savePrefs();
  toggleSettings();
  renderGrid(); // In case we need to redraw anything
}

// ── Task Detail ───────────────────────────────────────────────────────────────
async function openTaskDetail(taskId) {
  taskDetailActiveTab = 'info';
  taskDetailData = null;
  document.getElementById('taskDetailOverlay').classList.add('open');
  document.getElementById('taskDetailPanel').classList.add('open');
  document.getElementById('taskDetailContent').innerHTML = '<div class="wd-state-msg">Loading…</div>';

  try {
    const [taskRes, workRes, commentsRes] = await Promise.all([
      kFetch(`${KANBAN}/task/${taskId}`),
      kFetch(`${KANBAN}/task/${taskId}/work`).catch(() => []),
      kFetch(`${KANBAN}/task/${taskId}/comment`).catch(() => []),
    ]);
    const task     = taskRes?.data || taskRes;
    const workLogs = Array.isArray(workRes)     ? workRes     : workRes?.data     || [];
    const comments = Array.isArray(commentsRes) ? commentsRes : commentsRes?.data || [];
    taskDetailData = { task, workLogs, comments };
    renderTaskDetail();
  } catch(e) {
    document.getElementById('taskDetailContent').innerHTML =
      `<div class="wd-state-msg">Error: ${h(e.message)}</div>`;
  }
}

function renderTaskDetail() {
  if (!taskDetailData) return;
  document.getElementById('taskDetailContent').innerHTML =
    taskDetailHTML(taskDetailData.task, taskDetailData.workLogs, taskDetailData.comments);
}

function setTaskDetailTab(tab) {
  taskDetailActiveTab = tab;
  renderTaskDetail();
}

function closeTaskDetail() {
  document.getElementById('taskDetailOverlay').classList.remove('open');
  document.getElementById('taskDetailPanel').classList.remove('open');
}

async function submitComment() {
  if (!taskDetailData) return;
  const commentInput = document.getElementById('taskDetailCommentInput');
  const comment = (commentInput.value || '').trim();
  if (!comment) return;
  
  const btn = document.getElementById('taskDetailCommentBtn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  
  try {
    await kPost(`${KANBAN}/task/${taskDetailData.task.id}/comment`, { text: comment });
    commentInput.value = '';
    taskDetailData.comments.push({ text: comment, user: { name: 'You', surname: '' }, created_at: new Date().toISOString() });
    renderTaskDetail();
  } catch(e) {
    alert('Error adding comment: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function submitWorkLog() {
  if (!taskDetailData) return;
  const hours = parseFloat(document.getElementById('taskDetailLogHours').value || '0');
  const mins = Math.round((hours - Math.floor(hours)) * 60);
  const totalMinutes = Math.floor(hours) * 60 + mins;
  const comment = (document.getElementById('taskDetailLogComment').value || '').trim();
  
  if (totalMinutes <= 0) { alert('Enter time > 0'); return; }
  
  const btn = document.getElementById('taskDetailLogBtn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  
  try {
    await kPost(`${KANBAN}/task/${taskDetailData.task.id}/work`, { 
      time: totalMinutes, 
      comment: comment,
      begin: new Date().toISOString()
    });
    document.getElementById('taskDetailLogHours').value = '';
    document.getElementById('taskDetailLogComment').value = '';
    taskDetailData.workLogs.push({ 
      time: totalMinutes, 
      comment: comment, 
      user: { name: 'You', surname: '' },
      begin: new Date().toISOString()
    });
    renderTaskDetail();
  } catch(e) {
    alert('Error logging work: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Create Task Modal ────────────────────────────────────────────────────────
function openCreateTask(epicId, projectSlug) {
  createTaskEpicId = epicId;
  createTaskSlug = projectSlug;
  document.getElementById('createTaskOverlay').classList.add('open');
  document.getElementById('createTaskPanel').classList.add('open');
  renderCreateTask();
}

function renderCreateTask() {
  const content = document.getElementById('createTaskContent');
  if (!content) return;
  content.innerHTML = `<div class="ct-header">
  <div>
    <div class="ct-title">New Task</div>
    <div class="ct-subtitle">Create a new task in this epic</div>
  </div>
  <div class="ct-close" onclick="closeCreateTask()">✕</div>
</div>

<form class="ct-form" onsubmit="submitCreateTask(event)">
  <div class="ct-field">
    <label class="ct-label">Title <span class="ct-required">*</span></label>
    <input type="text" id="ctTitle" class="ct-input" placeholder="Task title" required>
  </div>
  
  <div class="ct-field">
    <label class="ct-label">Description</label>
    <textarea id="ctDescription" class="ct-textarea" placeholder="Task description" rows="3"></textarea>
  </div>

  ${taskTemplates.length > 0 ? `<div class="ct-field">
    <label class="ct-label">Template</label>
    <select id="ctTemplate" class="ct-input" onchange="applyTaskTemplate()">
      <option value="">— None —</option>
      ${taskTemplates.map((t, i) => `<option value="${i}">${h(t.name || 'Template ' + (i+1))}</option>`).join('')}
    </select>
  </div>` : ''}
  
  <button type="submit" class="ct-submit">Create Task</button>
</form>`;
}

async function submitCreateTask(e) {
  e.preventDefault();
  if (createTaskEpicId === null) return;
  
  const title = document.getElementById('ctTitle').value.trim();
  const desc = document.getElementById('ctDescription').value.trim();
  if (!title) return;
  
  const btn = e.target.querySelector('.ct-submit');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  
  try {
    await kPost(`${KANBAN}/task`, {
      name: title,
      description: desc,
      epic_id: createTaskEpicId,
      project_slug: createTaskSlug
    });
    closeCreateTask();
    // Reload epic tasks
    await loadEpicTasks(createTaskEpicId, createTaskSlug);
    renderGrid();
  } catch(e) {
    alert('Error creating task: ' + e.message);
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function applyTaskTemplate() {
  const select = document.getElementById('ctTemplate');
  if (!select) return;
  const idx = parseInt(select.value);
  if (isNaN(idx) || !taskTemplates[idx]) return;
  
  const template = taskTemplates[idx];
  if (template.description) {
    document.getElementById('ctDescription').value = template.description;
  }
}

function closeCreateTask() {
  document.getElementById('createTaskOverlay').classList.remove('open');
  document.getElementById('createTaskPanel').classList.remove('open');
}

function taskDetailHTML(task, workLogs, comments = []) {
  const prio = task.priority || task.priority_id;
  const totalMin = workLogs.reduce((s, w) => s + (w.time || 0), 0);
  const totalHours = totalMin / 60;

  const assigneesStr = (() => {
    const arr = task.assignees || task.users || [];
    if (arr.length && typeof arr[0] === 'object') {
      return arr.map(a => [a.name, a.surname].filter(Boolean).join(' ')).join(', ');
    }
    if (task.responsible) {
      return [task.responsible.name, task.responsible.surname].filter(Boolean).join(' ');
    }
    return '';
  })();

  const createdAt = task.created_at
    ? new Date(task.created_at).toLocaleDateString('ru-RU')
    : '—';

  const infoTab = `<div class="td-tab-content">
    <div class="td-section">
      <div class="td-section-label">details</div>
      ${assigneesStr ? `<div class="td-section-value">${h(assigneesStr)}</div>` : ''}
      ${totalHours > 0 ? `<div class="td-tracked-total">${fmtH(totalHours)} hours tracked</div>` : ''}
    </div>
    ${task.description ? `<div class="td-section">
      <div class="td-section-label">description</div>
      <div class="td-section-value td-desc">${h(task.description).replace(/\n/g, '<br>')}</div>
    </div>` : ''}
  </div>`;

  const commentsTab = `<div class="td-tab-content">
    <div class="td-comments-list">
      ${comments.length ? comments.slice().reverse().map(c => {
        const author = c.user ? [c.user.name, c.user.surname].filter(Boolean).join(' ') : '—';
        const date = c.created_at ? new Date(c.created_at).toLocaleDateString('ru-RU') : '—';
        return `<div class="td-comment-item">
          <div class="td-comment-header">
            <span class="td-comment-author">${h(author)}</span>
            <span class="td-comment-date">${date}</span>
          </div>
          <div class="td-comment-text">${h(c.text || '')}</div>
        </div>`;
      }).join('') : '<div style="color: var(--muted); font-size: 12px;">No comments yet</div>'}
    </div>
    <div class="td-comment-form">
      <textarea id="taskDetailCommentInput" class="td-form-input" placeholder="Add a comment…" rows="2"></textarea>
      <button id="taskDetailCommentBtn" class="td-form-btn" onclick="submitComment()">Post Comment</button>
    </div>
  </div>`;

  const workLogsTab = `<div class="td-tab-content">
    <div class="td-worklog-list">
      ${workLogs.length ? workLogs.slice(0, 30).map(w => {
        const userName = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : '—';
        const date = w.begin ? new Date(w.begin).toLocaleDateString('ru-RU') : '—';
        const comment = (w.comment || '').trim();
        return `<div class="td-work-row">
          <div class="td-work-row-top">
            <span class="td-work-who">${h(userName)}</span>
            <span class="td-work-date">${date}</span>
            <span class="td-work-time">${fmtH(w.time / 60)}</span>
          </div>
          ${comment ? `<div class="td-work-comment">${h(comment)}</div>` : ''}
        </div>`;
      }).join('') : '<div style="color: var(--muted); font-size: 12px;">No work logged yet</div>'}
    </div>
    <div class="td-worklog-form">
      <label class="td-form-label">Log Work</label>
      <div class="td-form-grid">
        <input type="number" id="taskDetailLogHours" class="td-form-input" placeholder="Hours (e.g., 2.5)" step="0.25" min="0">
        <button id="taskDetailLogBtn" class="td-form-btn" onclick="submitWorkLog()">Log Time</button>
      </div>
      <textarea id="taskDetailLogComment" class="td-form-input" placeholder="Comment (optional)" rows="2"></textarea>
    </div>
  </div>`;

  const tabContent = {
    'info': infoTab,
    'comments': commentsTab,
    'worklog': workLogsTab
  }[taskDetailActiveTab] || infoTab;

  return `<div class="td-header">
  <div>
    <a class="td-id" href="https://kanban.devds.ru/task/${task.id}" target="_blank">#${task.id}  ·  ${createdAt}</a>
    <div class="td-badges">
      ${statusBadge(task)}
      ${priorityBadge(prio)}
    </div>
  </div>
  <div class="td-close" onclick="closeTaskDetail()">✕</div>
</div>
<div class="td-title">${h(task.name || task.title || '')}</div>

<div class="td-tabs">
  <button class="td-tab-btn ${taskDetailActiveTab === 'info' ? 'active' : ''}" onclick="setTaskDetailTab('info')">Info</button>
  <button class="td-tab-btn ${taskDetailActiveTab === 'comments' ? 'active' : ''}" onclick="setTaskDetailTab('comments')">Comments</button>
  <button class="td-tab-btn ${taskDetailActiveTab === 'worklog' ? 'active' : ''}" onclick="setTaskDetailTab('worklog')">Work Log</button>
  <button class="td-tab-btn" onclick="openCreateTask()" title="New Task">➕ New Task</button>
</div>

${tabContent}`;
}

// ── Settings ────────────────────────────────────────────────────────────────

(async function init() {
  try {
    applyTheme();

    // Handle Login Form - Attach as early as possible
    const lform = document.getElementById('loginForm');
    if (lform) {
      lform.onsubmit = (e) => {
        e.preventDefault();
        doLogin();
        return false;
      };
    }

    if (!token) {
      showLogin();
      return;
    }

    showDash();
    await loadPrefs();
    await loadAll();
    await loadTaskTemplates();

    // Initial hash check
    if (window.location.hash.startsWith('#epic-')) {
      const id = parseInt(window.location.hash.replace('#epic-', ''));
      if (id) openDetail(id);
    }
  } catch (e) {
    console.error('App init error', e);
    // Explicitly alert the user to catch errors before page refresh clears console
    alert('Critical init error: ' + e.message);
    showLogin();
  }
})();
