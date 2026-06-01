
async function openTaskDetail(taskId) {
  taskDetailActiveTab = 'info';
  taskDetailData = null;
  document.getElementById('taskDetailOverlay').classList.add('open');
  document.getElementById('taskDetailPanel').classList.add('open');
  document.getElementById('taskDetailContent').innerHTML = '<div class="wd-state-msg">Loading...</div>';

  try {
    const [taskRes, workRes] = await Promise.all([
      kFetch(`${KANBAN}/task/${taskId}`),
      kFetch(`${KANBAN}/task/${taskId}/work`).catch(() => [])
    ]);
    taskDetailData = { 
      task: taskRes?.data || taskRes, 
      workLogs: Array.isArray(workRes) ? workRes : workRes?.data || []
    };
    renderTaskDetail();
  } catch(e) { document.getElementById('taskDetailContent').innerHTML = '<div class="wd-state-msg">Error: ' + h(e.message) + '</div>'; }
}

function renderTaskDetail() { if (taskDetailData) document.getElementById('taskDetailContent').innerHTML = taskDetailHTML(taskDetailData.task, taskDetailData.workLogs); }
function setTaskDetailTab(tab) { taskDetailActiveTab = tab; renderTaskDetail(); }
function closeTaskDetail() { document.getElementById('taskDetailOverlay').classList.remove('open'); document.getElementById('taskDetailPanel').classList.remove('open'); }

async function submitWorkLog() {
  if (!taskDetailData) return;
  const timeInput = (document.getElementById('taskDetailLogTime').value || '').trim();
  let totalMinutes = 0;
  
  if (/^\d+:\d{2}$/.test(timeInput)) {
    const parts = timeInput.split(':');
    totalMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else if (/^\d+(\.\d+)?$/.test(timeInput)) {
    totalMinutes = Math.round(parseFloat(timeInput) * 60);
  } else {
    alert('Please enter time in HH:MM format (e.g. 01:30)');
    return;
  }

  if (totalMinutes <= 0) { alert('Enter time > 0'); return; }
  if (totalMinutes % 15 !== 0) { alert('Time must be a multiple of 15 minutes'); return; }

  const comment = (document.getElementById('taskDetailLogComment').value || '').trim();
  const btn = document.getElementById('taskDetailLogBtn');
  const origText = btn.textContent; btn.disabled = true; btn.textContent = '...';
  try {
    const res = await kPost(`${KANBAN}/task/${taskDetailData.task.id}/work`, { time: totalMinutes, comment: comment, begin: new Date().toISOString() });
    document.getElementById('taskDetailLogTime').value = ''; document.getElementById('taskDetailLogComment').value = '';
    taskDetailData.workLogs.unshift(res.data ? res.data : { id: Date.now(), time: totalMinutes, comment: comment, user: { name: 'You', surname: '' }, begin: new Date().toISOString() });
    renderTaskDetail();
  } catch(e) { alert('Error logging work: ' + e.message); } 
  finally { btn.disabled = false; btn.textContent = origText; }
}

async function handleUpdateTask(field, value) {
  if (!taskDetailData) return;
  try {
    await updateTask(taskDetailData.task.id, { [field]: value });
    taskDetailData.task[field] = value;
    if (field === 'stage_id') taskDetailData.task.stage = dictStages[value];
    if (field === 'priority_id') taskDetailData.task.priority = dictPriorities[value];
    renderTaskDetail();
    // Invalidate main epic cache and re-render grid if needed
  } catch(e) { alert(`Error updating ${field}: ` + e.message); }
}

async function promptEditWork(id, oldMin, oldComment) {
  const hours = prompt('Edit hours:', oldMin / 60);
  if (hours !== null) {
    const time = Math.round(parseFloat(hours || 0) * 60);
    const text = prompt('Edit comment:', oldComment) || '';
    if (time > 0) {
      try {
        await updateWork(id, { time, comment: text });
        taskDetailData.workLogs = taskDetailData.workLogs.map(w => w.id === id ? { ...w, time, comment: text } : w);
        renderTaskDetail();
      } catch(e) { alert('Error editing work log: ' + e.message); }
    }
  }
}

async function confirmDeleteWork(id) {
  if (!confirm('Delete this work log?')) return;
  try {
    await deleteWork(id);
    taskDetailData.workLogs = taskDetailData.workLogs.filter(w => w.id !== id);
    renderTaskDetail();
  } catch(e) { alert('Error deleting work log: ' + e.message); }
}

let localTaskTemplates = [];
try { localTaskTemplates = JSON.parse(localStorage.getItem('wd_task_templates') || '[]'); } catch(e){}

function openCreateTask(epicId = null, projectSlug = null) {
  createTaskEpicId = epicId; createTaskSlug = projectSlug;
  document.getElementById('createTaskOverlay').classList.add('open');
  document.getElementById('createTaskPanel').classList.add('open');
  renderCreateTask();
}

function saveTaskTemplate() {
  const name = prompt('Name for this template:', 'My Template');
  if (!name) return;
  const tpl = {
    name,
    title: document.getElementById('ctTitle')?.value || '',
    desc: document.getElementById('ctDescription')?.value || '',
    component_id: document.getElementById('ctComponent')?.value || '',
    type_id: document.getElementById('ctType')?.value || '',
    priority_id: document.getElementById('ctPriority')?.value || '',
    epic_id: document.getElementById('ctEpic')?.value || '',
    assignee_id: document.getElementById('ctAssignee')?.value || '',
    responsible_id: document.getElementById('ctResponsible')?.value || ''
  };
  localTaskTemplates.push(tpl);
  localStorage.setItem('wd_task_templates', JSON.stringify(localTaskTemplates));
  renderCreateTask();
  document.getElementById('ctTemplate').value = localTaskTemplates.length - 1;
  alert('Template saved!');
}

function applyTaskTemplate() {
  const select = document.getElementById('ctTemplate');
  if (!select) return;
  const v = select.value;
  if (!v) return;
  const t = localTaskTemplates[parseInt(v)];
  if (!t) return;
  if (t.title) document.getElementById('ctTitle').value = t.title;
  if (t.desc) document.getElementById('ctDescription').value = t.desc;
  if (t.component_id) document.getElementById('ctComponent').value = t.component_id;
  if (t.type_id) document.getElementById('ctType').value = t.type_id;
  if (t.priority_id) document.getElementById('ctPriority').value = t.priority_id;
  if (t.epic_id) document.getElementById('ctEpic').value = t.epic_id;
  if (t.assignee_id) document.getElementById('ctAssignee').value = t.assignee_id;
  if (t.responsible_id) document.getElementById('ctResponsible').value = t.responsible_id;
}

function renderCreateTask() {
  const content = document.getElementById('createTaskContent');
  if (!content) return;
  
  const epicDatas = allEpics.map(e => {
    const val = `[${h(e._project.slug)}] ${h(e.name || '')}`;
    return `<option value="${val}">`;
  }).join('');
  
  const compDatas = Object.values(dictComponents).map(c => `<option value="${h(c.name)}">`).join('');
  
  // Aggregate users from all epics' assignees/responsibles
  const allU = new Map();
  allEpics.forEach(e => {
    const tasks = tasksByEpic[e.id] || [];
    tasks.forEach(t => {
      if (t.responsible) allU.set(t.responsible.id, [t.responsible.name, t.responsible.surname].filter(Boolean).join(' '));
      if (t.user) allU.set(t.user.id, [t.user.name, t.user.surname].filter(Boolean).join(' '));
      (t.assignees || t.users || []).forEach(u => typeof u === 'object' ? allU.set(u.id, [u.name, u.surname].filter(Boolean).join(' ')) : null);
    });
  });
  const usrDatas = Array.from(allU.entries()).map(([id, name]) => `<option value="${h(name)}">`).join('');
  
  const typeOpts = Object.values(dictTaskTypes).map(t => `<option value="${t.id}">${h(t.name)}</option>`).join('');
  const priOpts = Object.values(dictPriorities).map(p => `<option value="${p.id}">${h(p.name)}</option>`).join('');
  const templateOpts = localTaskTemplates.length ? localTaskTemplates.map((t, i) => `<option value="${i}">${h(t.name)}</option>`).join('') : '';

  // Store lists globally so submitCreateTask can map strings back to IDs
  window._ctDataCache = { epics: allEpics, comps: Object.values(dictComponents), users: Array.from(allU.entries()) };

  content.innerHTML = `
    <div class="ct-header">
      <div><div class="ct-title">New Task</div><div class="ct-subtitle">Create a new task</div></div>
      <div class="ct-close" onclick="closeCreateTask()">✕</div>
    </div>
    
    <div style="padding: 16px 20px 0; display:flex; gap:12px; align-items:center;">
       <select id="ctTemplate" class="td-form-input" style="flex:1" onchange="applyTaskTemplate()">
         <option value="">-- Choose Template --</option>
         ${templateOpts}
       </select>
       <button class="td-form-btn" style="width:auto; height:32px" onclick="saveTaskTemplate()">Save as Template</button>
    </div>
    
    <form class="ct-form" onsubmit="submitCreateTask(event)">
      <div class="ct-field">
        <label class="ct-label">Title <span class="ct-required">*</span></label>
        <input type="text" id="ctTitle" class="ct-input" placeholder="Task title" required>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="ct-field">
          <label class="ct-label">Epic <span class="ct-required">*</span></label>
          <input list="ctEpicList" id="ctEpic" class="ct-input" placeholder="Type or select epic..." required autocomplete="off">
          <datalist id="ctEpicList">${epicDatas}</datalist>
        </div>
        <div class="ct-field">
          <label class="ct-label">Component</label>
          <input list="ctCompList" id="ctComponent" class="ct-input" placeholder="Type or select component..." autocomplete="off">
          <datalist id="ctCompList">${compDatas}</datalist>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="ct-field"><label class="ct-label">Task Type <span class="ct-required">*</span></label><select id="ctType" class="ct-input" required><option value="">-- Select --</option>${typeOpts}</select></div>
        <div class="ct-field"><label class="ct-label">Priority <span class="ct-required">*</span></label><select id="ctPriority" class="ct-input" required><option value="">-- Select --</option>${priOpts}</select></div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="ct-field">
          <label class="ct-label">Assignee</label>
          <input list="ctUsrList" id="ctAssignee" class="ct-input" placeholder="Unassigned" autocomplete="off">
          <datalist id="ctUsrList">${usrDatas}</datalist>
        </div>
        <div class="ct-field">
          <label class="ct-label">Responsible</label>
          <input list="ctUsrList2" id="ctResponsible" class="ct-input" placeholder="Unassigned" autocomplete="off">
          <datalist id="ctUsrList2">${usrDatas}</datalist>
        </div>
      </div>
      
      <div class="ct-field"><label class="ct-label">Description</label><textarea id="ctDescription" class="ct-textarea" placeholder="Task description" rows="3"></textarea></div>
      
      <button type="submit" class="ct-submit" style="margin-top:8px;">Create Task</button>
    </form>
  `;
}

async function submitCreateTask(e) {
  e.preventDefault();
  
  // Helpers to resolve text to ID
  const textEpic = document.getElementById('ctEpic').value.trim();
  const foundEpic = window._ctDataCache.epics.find(ep => `[${ep._project.slug}] ${ep.name||''}` === textEpic);
  const epicId = foundEpic ? foundEpic.id : null;
  
  if (!epicId && textEpic) { alert('Epic not found. Please select from dropdown.'); return; }
  if (!epicId) { alert('Please select an Epic'); return; }

  const textComp = document.getElementById('ctComponent').value.trim();
  const foundComp = window._ctDataCache.comps.find(c => c.name === textComp);
  const compId = foundComp ? foundComp.id : null;

  const textAss = document.getElementById('ctAssignee').value.trim();
  const foundAss = window._ctDataCache.users.find(u => u[1] === textAss);
  const assigneeId = foundAss ? foundAss[0] : null;

  const textResp = document.getElementById('ctResponsible').value.trim();
  const foundResp = window._ctDataCache.users.find(u => u[1] === textResp);
  const respId = foundResp ? foundResp[0] : null;

  const title = document.getElementById('ctTitle').value.trim();
  const desc = document.getElementById('ctDescription').value.trim();
  const typeId = document.getElementById('ctType').value;
  const prioId = document.getElementById('ctPriority').value;

  if (!title) return;
  const btn = e.target.querySelector('.ct-submit');
  const origText = btn.textContent; btn.disabled = true; btn.textContent = '...';
  
  const payload = {
    name: title,
    description: desc,
    epic_id: epicId,
    task_type_id: typeId,
    priority_id: prioId,
    stage_id: 1 // Default to New / first stage
  };
  
  if (compId) payload.component_id = compId;
  if (assigneeId) payload.executors = [parseInt(assigneeId)];
  if (respId) payload.responsible_id = parseInt(respId);
  if (respId) payload.user_id = parseInt(respId);

  // We need project_slug for refresh:
  const prjSlug = foundEpic ? foundEpic._project.slug : null;
  if (prjSlug) payload.project_slug = prjSlug;

  try {
    const res = await kPost(`${KANBAN}/task`, payload);
    closeCreateTask();
    if (prjSlug && epicId) {
       await loadEpicTasks(epicId, prjSlug);
       renderGrid();
    }
  } catch(e) { alert('Error creating task: ' + e.message); btn.disabled = false; btn.textContent = origText; }
}

function closeCreateTask() { document.getElementById('createTaskOverlay').classList.remove('open'); document.getElementById('createTaskPanel').classList.remove('open'); }

function taskDetailHTML(task, workLogs) {
  const prio = task.priority || task.priority_id;
  const totalMin = workLogs.reduce((s, w) => s + (w.time || 0), 0);
  const totalHours = totalMin / 60;
  
  let assigneesStr = '';
  const arr = task.assignees || task.users || [];
  if (arr.length && typeof arr[0] === 'object') assigneesStr = arr.map(a => [a.name, a.surname].filter(Boolean).join(' ')).join(', ');
  else if (task.responsible) assigneesStr = [task.responsible.name, task.responsible.surname].filter(Boolean).join(' ');

  const createdAt = task.created_at ? new Date(task.created_at).toLocaleDateString('ru-RU') : '-';

  const descHtml = (task.description || '').trim();
  const isHtml = /<[a-z][\s\S]*>/i.test(descHtml);
  const renderDesc = isHtml ? descHtml : h(descHtml).replace(/\\n/g, '<br>');

  const epicBadge = task.epic_id ? `<span class="wd-project-badge" style="cursor:pointer;" onclick="closeTaskDetail(); openDetail(${task.epic_id})">Epic ${task.epic_id}</span>` : '';

  const infoSection = '<div class="td-section"><div class="td-section-label">details</div>' +
    (epicBadge ? '<div style="margin-bottom:8px;">' + epicBadge + '</div>' : '') +
    (assigneesStr ? '<div class="td-section-value">' + h(assigneesStr) + '</div>' : '') +
    (totalHours > 0 ? '<div class="td-tracked-total">' + fmtH(totalHours) + ' tracked</div>' : '') + '</div>' +
    (descHtml ? '<div class="td-section"><div class="td-section-label">description</div><div class="td-section-value td-desc" style="max-height:unset;">' + renderDesc + '</div></div>' : '');

  const workLogsSection = '<div class="td-section"><div class="td-section-label" style="margin-top:24px; border-top:1px solid var(--border); padding-top:16px;">Work Log</div><div class="td-worklog-list" style="max-height:unset;">' +
    (workLogs.length ? workLogs.slice(0, 30).map(w => {
      const userName = h(w.user ? [w.user.name, w.user.surname].filter(Boolean).join(' ') : '-');
      const date = w.begin ? new Date(w.begin).toLocaleDateString('ru-RU') : '-';
      return '<div class="td-work-row"><div class="td-work-row-top"><div style="flex:1; display:flex; gap:12px; align-items:center;"><span class="td-work-who">' + userName + '</span><span class="td-work-date" style="color:var(--muted); font-size:12px">' + date + '</span><span class="td-work-time" style="font-weight:bold">' + fmtH(w.time / 60) + '</span></div>' + 
      `<div class="td-work-actions"><button class="td-btn-icon" onclick="promptEditWork(${w.id}, ${w.time}, '${h(w.comment||'')}')">✏️</button><button class="td-btn-icon" onclick="confirmDeleteWork(${w.id})">🗑️</button></div></div>` +
      (w.comment ? '<div class="td-work-comment">' + h(w.comment.trim()) + '</div>' : '') + '</div>';
    }).join('') : '<div style="color:var(--muted);font-size:12px; margin-bottom:8px;">No work logged yet</div>') +
    '</div><div class="td-worklog-form" style="margin-top:8px; border-top:none; padding-top:0;"><div class="td-form-grid"><input type="text" id="taskDetailLogTime" class="td-form-input" placeholder="HH:MM (e.g. 01:30)"><button class="td-form-btn" id="taskDetailLogBtn" onclick="submitWorkLog()">Log Time</button></div><textarea id="taskDetailLogComment" class="td-form-input" placeholder="Comment (optional)" rows="1" style="margin-top:4px"></textarea></div></div>';

  const allowedStatuses = ['Новая', 'В работе', 'Выполнена', 'Ревью', 'Готова к тестированию', 'В тестировании', 'Решены'].map(s => s.toLowerCase());
  
  const statusDropdown = Object.keys(dictStages).length 
    ? `<select class="td-inline-select" onchange="handleUpdateTask('stage_id', this.value)">` + Object.values(dictStages).filter(s => allowedStatuses.includes((s.name||'').toLowerCase())).map(s => `<option value="${s.id}" ${s.id == stageId(task) ? 'selected' : ''}>${h(s.name)}</option>`).join('') + `</select>`
    : statusBadge(task);
  
  const prioDropdown = Object.keys(dictPriorities).length
    ? `<select class="td-inline-select" onchange="handleUpdateTask('priority_id', this.value)">` + Object.values(dictPriorities).map(p => `<option value="${p.id}" ${p.id == prio ? 'selected' : ''}>${h(p.name)}</option>`).join('') + `</select>`
    : priorityBadge(prio);

  return '<div class="td-header"><div><a class="td-id" href="https://kanban.devds.ru/task/' + task.id + '" target="_blank">#' + task.id + ' · ' + createdAt + '</a><div class="td-badges">' + statusDropdown + prioDropdown + '</div></div><div class="td-close" onclick="closeTaskDetail()">✕</div></div>' +
    '<div class="td-title">' + h(task.name || task.title || '') + '</div>' +
    '<div style="display:flex; flex-direction:column; gap:8px;">' + infoSection + workLogsSection + '</div>';
}
