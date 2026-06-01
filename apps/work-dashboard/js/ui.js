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

// ── Rendering helpers ─────────────────────────────────────────────────────────

function statusBadge(item) {
  const sid = stageId(item);
  const sLabel = item.stage?.name || item.stage_name || item.status_name || (typeof sid === 'string' ? sid : null);
  
  const s = getStatusInfo(sid);
  if (s.label === 'Unknown') {
    s.label = sLabel || (item.state === 'closed' ? 'Closed' : (sid || '—'));
  }
  
  // If we still have nothing and it's a meeting, maybe show 'Event'
  if (s.label === '—' && (item.name || '').includes('[Созвон]')) s.label = 'Созвон';

  return `<span class="wd-badge ${s.cls}">${h(s.label)}</span>`;
}

function priorityBadge(p) {
  if (!p) return '';
  const s = getPriorityInfo(p);
  if (s.label === 'Unknown') {
    s.label = typeof p === 'string' ? p : '';
  }
  if (!s.label) return '';
  return `<span class="wd-badge ${s.cls}">${h(s.label)}</span>`;
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

function getDeadlineText(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  const now = new Date(); now.setHours(0,0,0,0);
  const time = d.getTime();
  if (time < now.getTime()) return `<span style="color:var(--red); font-size:10px; font-weight:600">Past Due: ${d.toLocaleDateString('ru-RU')}</span>`;
  if (time === now.getTime()) return `<span style="color:var(--orange); font-size:10px; font-weight:600">Today</span>`;
  if (time === now.getTime() + 86400000) return `<span style="color:var(--amber); font-size:10px; font-weight:600">Tomorrow</span>`;
  return `<span style="color:var(--muted); font-size:10px;">${d.toLocaleDateString('ru-RU')}</span>`;
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
  const deadlineTxt = getDeadlineText(epic.deadline || epic.deadline_date || epic.due_date);

  return `<div class="wd-card" data-epic-id="${id}" 
    onmouseenter="onEpicHover(${id}, '${h(slug)}')"
    onclick="openDetail(${id})">
  <div class="wd-card-header" style="justify-content:space-between; align-items:flex-start;">
    <div class="wd-card-badges" style="display:flex; flex-direction:column; gap:6px;">
      <span class="wd-project-badge" title="${h(epic._project.name)}">${h(epic._project.name)}</span>
      ${statusBadge(epic)}
    </div>
    <div style="text-align:right">
      ${deadlineTxt ? '<div style="margin-top:2px">' + deadlineTxt + '</div>' : ''}
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

// ── Epics Grid ────────────────────────────────────────────────────────────────
function renderGrid() {
  if (mainTab === 'tasks') {
    renderGlobalTasksGrid();
    return;
  }
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

function onMainSearch(q) {
  epicSearchQuery = q;
  renderGrid();
}

async function switchMainTab(tabName) {
  mainTab = tabName;
  document.querySelectorAll('.wd-main-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(tabName === 'epics' ? 'tabEpicsBtn' : 'tabTasksBtn').classList.add('active');
  
  const eg = document.getElementById('epicsGrid');
  const tg = document.getElementById('tasksGrid');
  
  if (tabName === 'epics') {
    eg.style.display = 'grid';
    tg.style.display = 'none';
    document.getElementById('tasksExtraFilters').style.display = 'none';
    document.getElementById('tasksExtraSep').style.display = 'none';
  } else {
    eg.style.display = 'none';
    tg.style.display = 'grid';
    document.getElementById('tasksExtraFilters').style.display = 'flex';
    document.getElementById('tasksExtraSep').style.display = 'block';
    if (!globalTasksLoaded) {
      tg.innerHTML = '<div class="wd-state-msg">Loading all tasks...</div>';
      await loadAllTasks();
    }
  }
  renderGrid();
}

function toggleOnlyMine() {
  tasksOnlyMine = !tasksOnlyMine;
  const btn = document.getElementById('onlyMineFilterBtn');
  if (tasksOnlyMine) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
  renderGrid();
}

// ── Global Tasks Grid ───────────────────────────────────────────────────────
function renderGlobalTasksGrid() {
  const tg = document.getElementById('tasksGrid');
  let tasks = selectedProjects.size === 0 
    ? allGlobalTasks 
    : allGlobalTasks.filter(t => selectedProjects.has(t.project_slug || (t._project && t._project.slug)));

  if (epicSearchQuery) {
    const q = epicSearchQuery.toLowerCase();
    tasks = tasks.filter(t => (t.name || t.title || '').toLowerCase().includes(q));
  }

  // "Only Mine" filter
  if (tasksOnlyMine && typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
    const uid = currentUser.id;
    tasks = tasks.filter(t => {
      // Direct ID fields
      if (t.user_id === uid || t.responsible_id === uid || t.created_by === uid) return true;
      
      // Object fields
      if (t.responsible && (t.responsible === uid || t.responsible.id === uid)) return true;
      if (t.user && (t.user === uid || t.user.id === uid)) return true;
      
      // Array fields (handles both Array of Objects and Array of IDs)
      if (t.assignees && t.assignees.some(a => (a.id || a) === uid)) return true;
      if (t.users && t.users.some(u => (u.id || u) === uid)) return true;
      if (t.executors && t.executors.some(ex => (ex.id || ex) === uid)) return true;
      
      return false;
    });
  }

  // Filter tasks based on selected statuses, applying the same rules as epics
  if (selectedStatuses.size > 0) {
    tasks = tasks.filter(t => selectedStatuses.has(String(stageId(t))));
  } else {
    tasks = tasks.filter(t => stageId(t) != 8); // Hide Releases
  }

  if (!tasks.length) {
    tg.innerHTML = '<div class="wd-state-msg">No tasks found</div>';
    return;
  }

  // Complex sorting
  tasks.sort((a, b) => {
    // 1. Deadlines
    const dtA = a.deadline || a.deadline_date || a.due_date;
    const dtB = b.deadline || b.deadline_date || b.due_date;
    
    // Helper to bucket dates:
    // 0 = Past/Today, 1 = Tomorrow, 2 = Others (No deadline or far future)
    const getDeadlineGroup = (dt) => {
      if (!dt) return 2;
      const t = new Date(dt).getTime();
      if (isNaN(t)) return 2;
      const now = new Date();
      now.setHours(0,0,0,0);
      const diffDays = Math.floor((t - now.getTime()) / 86400000);
      if (diffDays <= 0) return 0; // Past or Today
      if (diffDays === 1) return 1; // Tomorrow
      return 2;
    };
    
    const gA = getDeadlineGroup(dtA);
    const gB = getDeadlineGroup(dtB);
    if (gA !== gB) return gA - gB; // Overdue/Today -> Tomorrow -> None
    
    // 2. Super_task / Epics vs normal
    const isSuperA = (a.super_task || a.is_super_task) ? 1 : 0;
    const isSuperB = (b.super_task || b.is_super_task) ? 1 : 0;
    if (isSuperA !== isSuperB) return isSuperB - isSuperA;
    
    // 3. Fallback to newest first
    return b.id - a.id;
  });

  const html = tasks.map(t => {
    const pid = t.project_id || (t._project && t._project.id);
    const p = projects.find(pr => pr.id === pid) || t._project;
    const slug = t.project_slug || (p && p.slug) || '';
    const name = p ? p.name : (slug || 'Project');
    const deadlineTxt = getDeadlineText(t.deadline || t.deadline_date || t.due_date);
    const prio = t.priority || t.priority_id;
    return `
      <div class="wd-card wd-task-global-card" onclick="openGlobalTask(${t.id}, '${h(slug)}')">
        <div class="wd-card-header" style="justify-content:space-between; align-items:flex-start">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <span class="wd-project-badge" title="${h(name)}">${h(name)}</span>
            ${statusBadge(t)}
          </div>
          <div style="text-align:right">
            <div>${priorityBadge(prio)}</div>
            ${deadlineTxt ? '<div style="margin-top:6px">' + deadlineTxt + '</div>' : ''}
          </div>
        </div>
        <div class="wd-card-title" style="margin-top:12px; font-size:14px; line-height:1.4">${h(t.name || t.title || '')}</div>
        <div class="wd-card-footer" style="padding-top:10px; margin-top:10px; border-top:1px solid var(--border)">
          <span class="wd-task-count" style="font-family:'JetBrains Mono'; font-size:11px">#${t.id}</span>
          ${(t.super_task || t.is_super_task) ? '<span class="wd-badge status-purple" style="scale:0.9">Super Task</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
  tg.innerHTML = html;
}

function openGlobalTask(id, slug) {
  // Try to find if we already loaded it in tasksByEpic to reuse
  let found = null;
  for (const epicId in tasksByEpic) {
    const t = tasksByEpic[epicId].find(x => x.id === id);
    if (t) { found = t; break; }
  }
  // If not, we still just open it and logic fetches it
  taskSearchQuery = ''; 
  openTaskDetail(id); // reusing the existing modal logic!
}

function onEpicHover(epicId, slug) {
  if (tasksByEpic[epicId] !== undefined) return;
  clearTimeout(hoverTimers[epicId]);
  hoverTimers[epicId] = setTimeout(() => {
    loadEpicTasks(epicId, slug);
  }, 200);
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

  const tc = card.querySelector('#count-' + epicId);
  if (tc) tc.textContent = count === undefined ? '…' : `${count} task${count !== 1 ? 's' : ''}`;

  const bar = card.querySelector('#qa-bar-' + epicId);
  if (bar) { bar.style.width = `${pct}%`; bar.style.background = barColor; }

  const disp = card.querySelector('.wd-estimate-display');
  if (disp) disp.textContent = estimate > 0 ? fmtH(estimate) : '?h';

  // Update the QA tracked label (first child text node of the second .wd-progress-label)
  const qaLabelEl = card.querySelector('#qa-label-' + epicId);
  if (qaLabelEl) {
    const firstNode = qaLabelEl.firstChild;
    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
      firstNode.textContent = `${qaLabel} / `;
    }
  }

  const overrunEl = card.querySelector('#qa-overrun-' + epicId);
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

  const projectCheckboxes = projects.map(p => {
    const isChecked = selectedProjects.has(p.slug);
    return `<label class="wd-multiselect-option"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="onToggleProject('${p.slug.replace(/'/g,"\\'")}')"> ${h(p.name)}</label>`;
  }).join('');

  const statusMap = new Map();
  Object.values(dictStages).forEach(s => {
    if (s.name) statusMap.set(String(s.id), s.name);
  });
  
  const statusCheckboxes = Array.from(statusMap.entries())
    .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([id, label]) => {
      const isChecked = selectedStatuses.has(id);
      return `<label class="wd-multiselect-option"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="onToggleStatus('${id}')"> ${h(label)}</label>`;
    }).join('');

  const projectTitle = isAllProjects ? 'All projects' : `${selectedProjects.size} projects`;
  const statusTitle = selectedStatuses.size === 0 ? 'All statuses' : `${selectedStatuses.size} statuses`;

  container.innerHTML = `
    <div class="wd-multiselect" onclick="toggleMultiselect('msProjects', event)">
      <div class="wd-multiselect-title">${projectTitle} ▾</div>
      <div class="wd-multiselect-dropdown" id="msProjects" onclick="event.stopPropagation()">
         <label class="wd-multiselect-option" style="font-weight:bold; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px;"><input type="checkbox" ${isAllProjects ? 'checked' : ''} onchange="onToggleAll()"> All projects</label>
         ${projectCheckboxes}
      </div>
    </div>
    
    <div class="filter-sep-v" style="margin: 0 12px; height: 20px; border-left: 2px solid var(--border); opacity: 0.5;"></div>
    
    <div class="wd-multiselect" onclick="toggleMultiselect('msStatuses', event)">
      <div class="wd-multiselect-title">${statusTitle} ▾</div>
      <div class="wd-multiselect-dropdown" id="msStatuses" onclick="event.stopPropagation()">
         <label class="wd-multiselect-option" style="font-weight:bold; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px;"><input type="checkbox" ${selectedStatuses.size === 0 ? 'checked' : ''} onchange="onToggleAllStatuses()"> All statuses</label>
         ${statusCheckboxes}
      </div>
    </div>
  `;
}

function toggleMultiselect(id, e) {
  e.stopPropagation();
  const el = document.getElementById(id);
  if (!el) return;
  const wrapper = el.closest('.wd-multiselect');
  const wasOpen = wrapper.classList.contains('open');
  document.querySelectorAll('.wd-multiselect.open').forEach(d => d.classList.remove('open'));
  if (!wasOpen) wrapper.classList.add('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.wd-multiselect.open').forEach(d => d.classList.remove('open'));
});

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
