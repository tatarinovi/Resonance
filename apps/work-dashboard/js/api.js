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
    // const res = await kFetch(`${KANBAN}/task/template`);
    // taskTemplates = Array.isArray(res) ? res : res?.data || [];
  } catch {}
}


// ── Load all data ─────────────────────────────────────────────────────────────

async function updateTask(taskId, payload) {
  return await kPost(`${KANBAN}/task/${taskId}`, payload, 'PATCH');
}

async function updateComment(commentId, payload) {
  return await kPost(`${KANBAN}/comment/${commentId}`, payload, 'PATCH');
}

async function deleteComment(commentId) {
  return await kPost(`${KANBAN}/comment/${commentId}`, null, 'DELETE');
}

async function updateWork(workId, payload) {
  return await kPost(`${KANBAN}/work/${workId}`, payload, 'PATCH');
}

async function deleteWork(workId) {
  return await kPost(`${KANBAN}/work/${workId}`, null, 'DELETE');
}
let currentUser = null;

async function loadAll() {
  setGrid('<div class="wd-state-msg">Loading dictionaries…</div>');
  try {
    const [userRes, stagesRes, priorsRes, typesRes, compsRes] = await Promise.all([
      kFetch(`${KANBAN}/auth/user`).catch(() => null),
      kFetch(`${KANBAN}/stage`).catch(()=>[]),
      kFetch(`${KANBAN}/priority`).catch(()=>[]),
      kFetch(`${KANBAN}/task_type`).catch(()=>[]),
      kFetch(`${KANBAN}/component`).catch(()=>[])
    ]);
    const toMap = arr => (Array.isArray(arr) ? arr : arr?.data || []).reduce((acc, i) => { acc[i.id] = i; return acc; }, {});
    dictStages = toMap(stagesRes);
    dictPriorities = toMap(priorsRes);
    dictTaskTypes = toMap(typesRes);
    dictComponents = toMap(compsRes);
    if (userRes && (userRes.id || userRes.data?.id)) {
      currentUser = userRes.data || userRes;
    }

    setGrid('<div class="wd-state-msg">Loading projects…</div>');
    // 1. Projects
    const raw = await kFetch(`${KANBAN}/project`);
    const list = Array.isArray(raw) ? raw : raw?.data ?? [];
    projects = list.filter(p => !p.is_archived && p.is_archived !== 1);

    // 2. Project users + epics in parallel
    setGrid('<div class="wd-state-msg">Loading epics…</div>');

    // Default Kanban Epic Stages are usually up to 8, but let's dynamically fetch them or stick to safe ones
    const epicStagesParams = Object.keys(dictStages).length > 0
      ? Object.keys(dictStages).map(i => `filter[stage_id][${i}]=${i}`).join('&')
      : [1,2,3,4,5,6,7,8].map(i => `filter[stage_id][${i}]=${i}`).join('&');
    const epicParams = `filter[type_id][5]=5&${epicStagesParams}`;

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

async function loadAllTasks() {
  globalTasksLoaded = true;
  const targetProjects = selectedProjects.size === 0 ? projects : projects.filter(p => selectedProjects.has(p.slug));
  try {
    const params = Object.keys(dictStages).length > 0
      ? Object.keys(dictStages).filter(i => i != 8).map(i => `filter[stage_id][${i}]=${i}`).join('&')
      : [1,2,3,4,5,6,7].map(i => `filter[stage_id][${i}]=${i}`).join('&');

    const rawTasks = await Promise.all(targetProjects.map(async p => {
      const ts = await fetchList(p.slug, params).catch(() => []);
      // Client-side filter to exclude Epics (type_id == 5)
      return (ts || []).filter(t => t.type_id != 5).map(t => ({ ...t, _project: p }));
    }));

    allGlobalTasks = rawTasks.flat();
    renderGrid();
  } catch(e) {
    setGrid(`<div class="wd-state-msg">Error loading global tasks: ${h(e.message)}</div>`);
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

// ── Preferences (Local) ──────────────────────────────────────────────────────
async function loadPrefs() {
  try {
    const res = await fetch('/api/work-prefs');
    if (res.ok) {
      const p = await res.json();
      qaEstimates = p.qa_estimates || {};
      qaTeamIds = p.qa_team_ids || [];
    }
  } catch(e) { console.error('loadPrefs err', e); }
}

async function savePrefs() {
  try {
    const body = { qa_estimates: qaEstimates, qa_team_ids: qaTeamIds };
    await fetch('/api/work-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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



