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
let globalTaskSearchQuery = ''; // Deprecated
let mainTab = 'epics'; // 'epics' or 'tasks'
let allGlobalTasks = [];
let globalTasksLoaded = false;
let tasksOnlyMine = false;
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


let dictStages = {};     // id -> { id, name }
let dictPriorities = {}; // id -> { id, name }
let dictTaskTypes = {};  // id -> { id, name }
let dictComponents = {}; // id -> { id, name }

// Fallback color classes
const STATUS_COLORS = {
  1: 'status-gray', 2: 'status-blue', 3: 'status-green',
  4: 'status-amber', 5: 'status-orange', 6: 'status-green',
  7: 'status-green', 8: 'status-green'
};

const PRIORITY_COLORS = {
  1: 'status-red', 2: 'status-red', 3: 'status-amber',
  4: 'status-gray', 5: 'status-gray'
};

function getStatusInfo(id) {
  const stage = dictStages[id];
  return {
    label: stage ? stage.name : 'Unknown',
    cls: STATUS_COLORS[id] || 'status-gray'
  };
}

function getPriorityInfo(id) {
  const prio = dictPriorities[id];
  return {
    label: prio ? prio.name : 'Unknown',
    cls: PRIORITY_COLORS[id] || 'status-gray'
  };
}
