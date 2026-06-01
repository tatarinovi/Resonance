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


