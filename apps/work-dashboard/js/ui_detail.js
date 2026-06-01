// ── ui_detail ──────────────────────────────────────────────────────────────
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
  
  fetchQAReport(epic);
  if (tasksByEpic[epicId] === undefined) {
    loadEpicTasks(epicId, epic._project.slug);
  }
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

function onTaskSearch(q) { taskSearchQuery = q; refreshDetail(); }
function onTaskUserFilter(val) { taskUserFilter = val; refreshDetail(); }
function onTaskStatusFilter(val) { taskStatusFilter = val; refreshDetail(); }
function setDetailTab(tab) { detailTab = tab; refreshDetail(); }

function graphTabHTML(epic) {
  const tasks = tasksByEpic[epic.id] || [];
  if (!tasks.length) return `<div class="wd-state-msg">No task data available for graphs</div>`;
  
  return `<div class="dp-graph-container">
    <div class="dp-chart-wrap">
      <div class="dp-chart-title">Трудозатраты по задачам (Top 15, ч)</div>
      <div class="dp-chart-canvas-wrap"><canvas id="taskChart"></canvas></div>
    </div>
    <div class="dp-chart-wrap" style="padding-top: 16px; margin-top: 16px;">
      <div class="dp-chart-title">Распределение часов по QA (ч)</div>
      <div class="dp-chart-canvas-wrap"><canvas id="qaChart"></canvas></div>
    </div>
    <div class="dp-chart-wrap" style="border-top: 1px solid var(--border); padding-top: 48px; margin-top: 16px;">
      <div class="dp-chart-title">Соотношение QA и разработки (%)</div>
      <div class="dp-chart-canvas-wrap" style="height: 320px;"><canvas id="ratioChart"></canvas></div>
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
      const qaTime = logs.reduce((s, w) => (w.user && qaIds.includes(String(w.user.id))) ? s + (w.time || 0) : s, 0);
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
          label: 'QA Hours', data: data.map(d => d.hours),
          backgroundColor: 'rgba(96, 165, 250, 0.6)', borderColor: 'rgb(96, 165, 250)',
          borderWidth: 1, borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        onClick: (e, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            window.open(`https://kanban.devds.ru/projects/${epic._project.slug}/${data[idx].id}`, '_blank');
          }
        },
        onHover: (e, elements) => { e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default'; },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x.toFixed(1)}h (QA)` } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 9 }, callback: function(value) { const label = this.getLabelForValue(value); return label.length > 30 ? label.substr(0, 27) + '...' : label; } } }
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
          backgroundColor: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#818cf8', '#a78bfa', '#2dd4bf', '#fb7185'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, padding: 15, font: { size: 10, family: 'Inter' } } } }
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
        if (w.user && qaIds.includes(String(w.user.id))) qaMin += (w.time || 0);
        else if (isBack) backMin += (w.time || 0);
        else if (isFront) frontMin += (w.time || 0);
        else otherMin += (w.time || 0);
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
          backgroundColor: ['#60a5fa', '#34d399', '#fbbf24', 'rgba(148, 163, 184, 0.2)'],
          borderWidth: 0, hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '80%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, padding: 15, font: { size: 10 } } },
          tooltip: {
            yAlign: 'bottom', caretPadding: 20, displayColors: false, backgroundColor: 'rgba(15, 23, 42, 0.95)',
            cornerRadius: 8, padding: 10,
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
          ctx.fillStyle = '#60a5fa'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${qaPct}%`, width / 2, top + (height / 2));
          ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillStyle = '#94a3b8';
          ctx.fillText('QA SHARE', width / 2, top + (height / 2) + 28);
          ctx.restore();
        }
      }]
    });
  }
}

function onWorkLogUserFilter(val) { workLogUserFilter = val; refreshDetail(); }

function workLogTabHTML(epic) {
  const epicId = epic.id;
  const tasks = tasksByEpic[epicId] || [];
  const loadedCount = tasks.filter(t => taskWorkLogsStore[t.id] !== undefined).length;

  if (loadedCount < tasks.length && tasks.length > 0) return `<div class="wd-state-msg">Loading work logs... ${loadedCount}/${tasks.length}</div>`;

  let allLogs = [];
  tasks.forEach(t => { (taskWorkLogsStore[t.id] || []).forEach(w => { allLogs.push({ ...w, _task: t }); }); });

  const uniqueWLUsers = new Set();
  allLogs.forEach(w => {
    if (w.user) {
      const name = [w.user.name, w.user.surname].filter(Boolean).join(' ');
      if (name) uniqueWLUsers.add(name);
    }
  });

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

  filtered.sort((a, b) => (b.begin || '').localeCompare(a.begin || ''));

  const totalMin = filtered.reduce((s, w) => s + (w.time || 0), 0);
  const usersArr = Array.from(uniqueWLUsers).sort();
  const qaOpt = qaTeamIds.length ? `<option value="__QA__" ${workLogUserFilter === '__QA__' ? 'selected' : ''}>QA team</option>` : '';
  const userOpts = usersArr.map(u => `<option value="${h(u)}" ${workLogUserFilter === u ? 'selected' : ''}>${h(u)}</option>`).join('');

  const rows = filtered.map(w => {
    const userName = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : '-';
    const date = w.begin ? new Date(w.begin).toLocaleDateString('ru-RU') : '-';
    const taskName = w._task.name || w._task.title || '#' + w._task.id;
    const comment = (w.comment || '').trim();
    const taskUrl = `https://kanban.devds.ru/projects/${epic._project.slug}/${w._task.id}`;
    return '<div class="wl-row">' +
      '<div class="wl-row-top">' +
        '<span class="wl-who">' + h(userName) + '</span>' +
        '<span class="wl-date">' + h(date) + '</span>' +
        '<a class="wl-task-id" href="' + taskUrl + '" target="_blank">#' + w._task.id + '</a>' +
        '<span class="wl-time">' + fmtH(w.time / 60) + '</span>' +
      '</div>' +
      '<a class="wl-task-name" href="' + taskUrl + '" target="_blank">' + h(taskName) + '</a>' +
      (comment ? '<div class="wl-comment">' + h(comment) + '</div>' : '') +
    '</div>';
  }).join('');

  const userTotals = {};
  filtered.forEach(w => {
    const name = w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : 'Unknown';
    userTotals[name] = (userTotals[name] || 0) + (w.time || 0);
  });
  const summaryRows = Object.entries(userTotals)
    .sort((a,b) => b[1] - a[1])
    .map(([name, time]) => '<div class="wl-summary-row"><span>' + h(name) + '</span><b>' + fmtH(time/60) + '</b></div>').join('');

  const summaryHTML = filtered.length > 0 ? '<div class="wl-summary"><div class="wl-summary-title">Personal Breakdown</div>' + summaryRows + '</div>' : '';

  return '<div class="wl-filter-bar">' +
    '<select class="dp-select" onchange="onWorkLogUserFilter(this.value)">' +
      '<option value="" ' + (workLogUserFilter === '' ? 'selected' : '') + '>all users</option>' + qaOpt + userOpts +
    '</select>' +
    (filtered.length > 0 ? '<span class="wl-total">' + fmtH(totalMin / 60) + ' · ' + filtered.length + ' entries</span>' : '') +
  '</div><div class="wl-list">' + (rows || '<div class="wd-state-msg">No entries found</div>') + '</div>' + summaryHTML;
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
        if (selStart !== undefined && el.setSelectionRange) el.setSelectionRange(selStart, selEnd);
      }
    }
  }
}

function detailHTML(epic, tasks) {
  const slug = epic._project.slug;
  let taskArr = tasks ? [...tasks] : [];
  taskArr.sort((a, b) => b.id - a.id);

  const uniqueUsers = new Set();
  const uniqueStatusIds = new Set();
  (tasks || []).forEach(t => {
    const arr = t.assignees || t.users || [];
    arr.forEach(a => {
      if (typeof a === 'object' && a !== null) {
        const name = [a.name, a.surname].filter(Boolean).join(' ');
        if (name) { uniqueUsers.add(name); return; }
      }
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
    return '<div class="wd-task-row">' +
      '<div class="wd-task-meta-row">' +
        '<a class="wd-task-id" href="https://kanban.devds.ru/projects/' + slug + '/' + t.id + '" target="_blank" onclick="event.stopPropagation()">#' + t.id + '</a>' +
        statusBadge(t) + priorityBadge(prio) +
        '<div class="wd-task-meta-right">' +
          (shortName ? '<span class="wd-assignees">' + h(shortName) + '</span>' : '') +
          (tTracked > 0 ? '<span class="wd-tracked">' + fmtH(tTracked) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="wd-task-name" onclick="openTaskDetail(' + t.id + ')">' + h(t.name || t.title || '') + '</div>' +
    '</div>';
  }).join('');

  const usersArr = Array.from(uniqueUsers).sort();
  const qaOption = qaTeamIds.length ? '<option value="__QA__" ' + (taskUserFilter === '__QA__' ? 'selected' : '') + '>QA team</option>' : '';
  const userOptions = usersArr.map(u => '<option value="' + h(u) + '" ' + (taskUserFilter === u ? 'selected' : '') + '>' + h(u) + '</option>').join('');
  const statusOptions = Array.from(uniqueStatusIds).sort((a,b)=>a-b).map(id => {
    const s = getStatusInfo(id);
    const label = s.label !== 'Unknown' ? s.label : id;
    return '<option value="' + id + '" ' + (taskStatusFilter == id ? 'selected' : '') + '>' + h(label) + '</option>';
  }).join('');

  const tasksSection = tasks === undefined ? '<div class="wd-state-msg">Loading tasks...</div>' : (taskArr.length ? taskRows : '<div class="wd-state-msg">' + ((taskSearchQuery || taskUserFilter || taskStatusFilter) ? 'No tasks matching filters' : 'No tasks in this epic') + '</div>');

  const tabsHTML = '<div class="dp-tabs">' +
    '<button class="dp-tab ' + (detailTab === 'tasks' ? 'active' : '') + '" onclick="setDetailTab(\'tasks\')">Tasks</button>' +
    '<button class="dp-tab ' + (detailTab === 'worklog' ? 'active' : '') + '" onclick="setDetailTab(\'worklog\')">Work Log</button>' +
    '<button class="dp-tab ' + (detailTab === 'graph' ? 'active' : '') + '" onclick="setDetailTab(\'graph\')">Graph</button>' +
  '</div>';

  let bodyContent = '';
  if (detailTab === 'worklog') bodyContent = workLogTabHTML(epic);
  else if (detailTab === 'graph') bodyContent = graphTabHTML(epic);
  else {
    bodyContent = '<div class="dp-filter-row">' +
      '<input type="text" id="taskSearchInput" class="dp-filter-input" placeholder="🔍 filter tasks..." value="' + h(taskSearchQuery) + '" oninput="onTaskSearch(this.value)">' +
      '<select id="taskStatusFilter" class="dp-filter-select" onchange="onTaskStatusFilter(this.value)">' +
        '<option value="">all statuses</option>' + statusOptions +
      '</select>' +
      '<select id="taskUserFilter" class="dp-filter-select" onchange="onTaskUserFilter(this.value)">' +
        '<option value="">all users</option>' + qaOption + userOptions +
      '</select>' +
      '<span class="dp-filter-count">' + taskArr.length + ' shown</span>' +
    '</div><div class="dp-tasks">' + tasksSection + '</div>';
  }

  return '<div class="dp-header">' +
    '<div class="dp-close" onclick="closeDetail()">✕</div>' +
    '<div class="dp-badges"><span class="wd-project-badge">' + h(epic._project.name) + '</span>' + statusBadge(epic) + '</div>' +
    '<div class="dp-title">' + h(epic.name || epic.title || '') + '</div>' +
  '</div><div class="dp-body">' +
    '<div class="dp-stats">' +
      '<div class="dp-stat"><span class="dp-stat-label">total</span><span class="dp-stat-val">' + (epicTaskCounts[epic.id] || '...') + '</span></div>' +
      '<div class="dp-stat"><span class="dp-stat-label">in work</span><span class="dp-stat-val">' + (tasks === undefined ? '...' : inProgress) + '</span></div>' +
      '<div class="dp-stat"><span class="dp-stat-label">done</span><span class="dp-stat-val">' + (tasks === undefined ? '...' : done) + '</span></div>' +
      '<div class="dp-stat"><span class="dp-stat-label">tracked</span><span class="dp-stat-val" title="Total epic tracked">' + fmtH(totalTracked) + '</span></div>' +
      '<div class="dp-stat"><span class="dp-stat-label">QA tracked</span><span class="dp-stat-val" style="color:var(--blue)" title="Tracked by team QA">' + fmtH(qaTracked) + '</span></div>' +
    '</div>' + tabsHTML + bodyContent + '</div>';
}

function toggleWorkload() {
  const panel = document.getElementById('workloadPanel');
  const overlay = document.getElementById('workloadOverlay');
  const isOpen = panel.classList.contains('open');
  if (isOpen) { panel.classList.remove('open'); overlay.classList.remove('open'); }
  else { renderWorkloadPanel(); panel.classList.add('open'); overlay.classList.add('open'); }
}

function isDateInRange(dateStr, range) {
  if (!dateStr || range === 'all') return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.getTime();
  if (range === 'today') return time >= todayStart;
  if (range === 'yesterday') return time >= (todayStart - 86400000) && time < todayStart;
  if (range === 'week') return time >= (now.getTime() - 7 * 86400000);
  if (range === 'month') return time >= (now.getTime() - 30 * 86400000);
  return true;
}

function setWorkloadFilter(f) { workloadTimeFilter = f; renderWorkloadPanel(); }

function renderWorkloadPanel() {
  const team = {}; 
  const qaIds = (qaTeamIds || []).map(id => String(id));
  const allLogsMap = { ...taskWorkLogsStore };
  Object.keys(sessionStorage).filter(k => k.startsWith('wd_cache_tasks_')).forEach(k => {
    const raw = sessionStorage.getItem(k);
    if (raw) {
      try {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL && data.workLogs) {
          Object.entries(data.workLogs).forEach(([taskId, logs]) => { if (!allLogsMap[taskId]) allLogsMap[taskId] = logs; });
        }
      } catch {}
    }
  });

  Object.values(allLogsMap).forEach(logs => {
    logs.forEach(w => {
      if (!w.user) return;
      const uid = String(w.user.id);
      if (!qaIds.includes(uid) || !isDateInRange(w.begin, workloadTimeFilter)) return;
      const name = [w.user.name, w.user.surname].filter(Boolean).join(' ') || '#' + uid;
      if (!team[name]) team[name] = { hours: 0, tasks: new Set() };
      team[name].hours += (w.time || 0);
      if (w.task_id) team[name].tasks.add(w.task_id);
    });
  });

  const sortedNames = Object.keys(team).sort((a,b) => team[b].hours - team[a].hours);
  const rows = sortedNames.map(name => {
    const data = team[name];
    return '<tr><td>' + h(name) + '</td><td class="workload-hours">' + fmtH(data.hours / 60) + '</td><td class="workload-meta">' + data.tasks.size + ' tasks</td></tr>';
  }).join('');

  const filterBtn = (f, label) => '<button class="wl-filter-btn ' + (workloadTimeFilter === f ? 'active' : '') + '" onclick="setWorkloadFilter(\'' + f + '\')">' + label + '</button>';

  document.getElementById('workloadContent').innerHTML = '<div class="workload-title">Team Workload</div>' +
    '<div class="workload-filters">' + filterBtn('today', 'Today') + filterBtn('yesterday', 'Yesterday') + filterBtn('week', 'Last 7d') + filterBtn('month', 'Last 30d') + filterBtn('all', 'All time') + '</div>' +
    '<div style="font-size:11px; color:var(--muted); margin-bottom:20px; opacity:0.8">Showing QA tracked time based on available cache.</div>' +
    '<table class="workload-table"><thead><tr><th>Member</th><th>Tracked</th><th>Reach</th></tr></thead><tbody>' + (rows || '<tr><td colspan="3" class="wd-state-msg">No entries for this period</td></tr>') + '</tbody></table>';
}

function toggleSettings() {
  const isOpening = !document.getElementById('settingsPanel').classList.contains('open');
  document.getElementById('settingsOverlay').classList.toggle('open', isOpening);
  document.getElementById('settingsPanel').classList.toggle('open', isOpening);
  if (isOpening) renderSettings();
}

function renderSettings() {
  document.getElementById('settingsContent').innerHTML = '<div class="settings-group">' +
    '<label class="settings-label">Team QA User IDs (comma separated)</label>' +
    '<input type="text" id="qaIdsInput" class="wd-input" value="' + h(qaTeamIds.join(', ')) + '" placeholder="e.g. 216, 220, 270">' +
    '<p style="font-size:10px; color:var(--muted); margin-top:4px;">Used for QA Tracked report</p></div>' +
    '<div style="margin-top:24px"><button class="chip-btn active" style="padding:10px 24px" onclick="saveSettings()">Save changes</button></div>';
}

async function saveSettings() {
  qaTeamIds = document.getElementById('qaIdsInput').value.split(',').map(s => s.trim()).filter(Boolean);
  await savePrefs();
  toggleSettings();
  renderGrid();
}
