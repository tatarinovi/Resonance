import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Layers, ListFilter, Loader2, Plus, Search, SlidersHorizontal, Users, X, Link2 } from "lucide-react";
import { useKanbanAnalyticsBootstrap } from "@/lib/queries";
import {
  mapDsListItemToTask,
  mapDsStagesToColumns,
  mapProjectMembersToIdNameMap,
  mapProjectMembersToNames,
  isKanbanHighPriorityFromRefName,
  kanbanTaskRowIsEpicType,
  type KanbanPriorityRef,
  type KanbanTaskTypeRef,
} from "@/lib/kanban-ds/mappers";
import { formatEpicFilterOption, parseEpicIdFromFilterOption } from "@/lib/kanban-ds/epic-filter";
import { filterKanbanColumnsByAllowlist } from "@/lib/kanban-ds/status-allowlist";
import {
  useKanbanBoardBundle,
  useKanbanComponents,
  useKanbanPriorities,
  useKanbanProjectEpics,
  useKanbanTaskTypes,
} from "@/lib/kanban-ds/queries";
import {
  pickFirstComponentId,
  pickFirstTaskTypeId,
  pickPriorityIdByLabel,
  pickProjectComponentId,
  mapKanbanComponentsToIdNameMap,
} from "@/lib/kanban-ds/refs";
import type { KanbanColumn as KanbanColumnModel, KanbanTask } from "@/lib/kanban-ds/types";
import { ALL_TYPES } from "@/components/kanban-board/avatars";
import { CreateTaskContent } from "@/components/kanban-board/CreateTaskContent";
import { KanbanBoardDndShell } from "@/components/kanban-board/KanbanBoardDndShell";
import { FilterDropdown } from "@/components/kanban-board/kanban-ui";
import { KanbanListView, type KanbanListViewHandle } from "@/components/kanban-board/KanbanListView";
import { TaskDetailContent } from "@/components/kanban-board/TaskDetailContent";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import "./kanban.css";

function readInitialKanbanViewMode(): "board" | "list" {
  if (typeof window === "undefined") return "board";
  return new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "board";
}

function createPlaceholderKanbanTask(taskId: number, cols: KanbanColumnModel[]): KanbanTask {
  const col = cols[0];
  return {
    id: taskId,
    columnId: col?.id ?? 0,
    title: `Задача #${taskId}`,
    priority: "Средний",
    types: [],
    taskTypeId: null,
    assignees: [],
    epic: "—",
    epicFull: "—",
    status: col?.title ?? "",
    componentLabel: "—",
    deadlineStatus: null,
    trackedMinutes: 0,
    createdAt: "",
    commentCount: 0,
    attachmentCount: 0,
  };
}

export function KanbanBoardView({ projectSlug, projectTitle }: { projectSlug: string; projectTitle: string }) {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const bootstrap = useKanbanAnalyticsBootstrap(true);
  const [onlyMine, setOnlyMine] = useState(false);
  const bundle = useKanbanBoardBundle(projectSlug, true, { onlyMine });
  const epicsCatalogQ = useKanbanProjectEpics(projectSlug, Boolean(bundle.data));
  const taskTypes = useKanbanTaskTypes(Boolean(bundle.data));
  const priorities = useKanbanPriorities(Boolean(bundle.data));
  const components = useKanbanComponents(Boolean(bundle.data));

  const componentIdToName = useMemo(() => mapKanbanComponentsToIdNameMap(components.data ?? []), [components.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [detailTask, setDetailTask] = useState<KanbanTask | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedEpicIds, setSelectedEpicIds] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedListStatuses, setSelectedListStatuses] = useState<string[]>([]);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "list">(readInitialKanbanViewMode);
  const kanbanListRef = useRef<KanbanListViewHandle>(null);
  const [listEpicGroupCount, setListEpicGroupCount] = useState(0);

  const onListEpicGroupsMeta = useCallback((meta: { epicGroupCount: number }) => {
    setListEpicGroupCount(meta.epicGroupCount);
  }, []);

  useEffect(() => {
    if (viewMode !== "list") {
      setListEpicGroupCount(0);
    }
  }, [viewMode]);

  useLayoutEffect(() => {
    setViewMode(searchParams.get("view") === "list" ? "list" : "board");
  }, [searchParams]);

  const priorityRefs: KanbanPriorityRef[] = useMemo(() => {
    const list = priorities.data ?? [];
    const out: KanbanPriorityRef[] = [];
    for (const p of list) {
      const o = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
      if (!o) continue;
      const id = Number(o.id);
      const name = String(o.name ?? "").trim();
      if (Number.isFinite(id) && id > 0 && name) out.push({ id, name });
    }
    return out;
  }, [priorities.data]);

  const taskTypeRefs: KanbanTaskTypeRef[] = useMemo(() => {
    const list = taskTypes.data ?? [];
    const out: KanbanTaskTypeRef[] = [];
    for (const p of list) {
      const o = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
      if (!o) continue;
      const id = Number(o.id);
      const name = String(o.name ?? "").trim();
      if (Number.isFinite(id) && id > 0 && name) out.push({ id, name });
    }
    return out;
  }, [taskTypes.data]);

  const memberIdToName = useMemo(() => mapProjectMembersToIdNameMap(bundle.data?.project), [bundle.data?.project]);

  const columnsRaw = useMemo(() => mapDsStagesToColumns(bundle.data?.stages ?? []), [bundle.data?.stages]);

  const columns: KanbanColumnModel[] = useMemo(() => filterKanbanColumnsByAllowlist(columnsRaw), [columnsRaw]);

  const filterUserOptions = useMemo(() => {
    const fromProject = mapProjectMembersToNames(bundle.data?.project);
    const fromAssignees = new Set<string>();
    const raw = bundle.data?.tasks ?? [];
    for (const row of raw) {
      const t = mapDsListItemToTask(row, columns, priorityRefs, memberIdToName, taskTypeRefs, componentIdToName);
      if (!t) continue;
      for (const a of t.assignees) fromAssignees.add(a);
    }
    const merged = new Set<string>([...fromProject, ...fromAssignees]);
    return [...merged].sort((a, b) => a.localeCompare(b, "ru"));
  }, [bundle.data?.project, bundle.data?.tasks, columns, priorityRefs, memberIdToName, taskTypeRefs, componentIdToName]);

  const boardTasks: KanbanTask[] = useMemo(() => {
    const raw = bundle.data?.tasks ?? [];
    const out: KanbanTask[] = [];
    for (const row of raw) {
      const t = mapDsListItemToTask(row, columns, priorityRefs, memberIdToName, taskTypeRefs, componentIdToName);
      if (t) out.push(t);
    }
    const colIds = new Set(columns.map((c) => c.id));
    const fallbackCol = columns[0]?.id ?? 0;
    const placed = out.map((t) => (colIds.has(t.columnId) ? t : { ...t, columnId: fallbackCol || t.columnId }));
    const byId = new Map(placed.map((t) => [t.id, t]));

    const stripped = placed.map((t) => {
      if (!t.epicRefIsParentLink || t.epicId == null || !(t.epicId > 0)) return t;
      const refRow = byId.get(t.epicId);
      if (!refRow) return t;
      if (kanbanTaskRowIsEpicType(refRow)) return t;
      const eid = t.epicId;
      const label = t.epicFull.trim();
      const isPlaceholder =
        !label ||
        label === "—" ||
        label === "-" ||
        label === `Эпик #${eid}` ||
        (label.startsWith("Эпик #") && label.slice("Эпик #".length) === String(eid));
      if (!isPlaceholder) return t;
      return { ...t, epicId: null, epicFull: "—", epic: "—", epicRefIsParentLink: undefined };
    });

    return stripped.map((t) => {
      const eid = t.epicId;
      if (eid == null || !(eid > 0)) return t;
      const label = t.epicFull.trim();
      const placeholder =
        !label ||
        label === "—" ||
        label === `Эпик #${eid}` ||
        (label.startsWith("Эпик #") && label.slice("Эпик #".length) === String(eid));
      if (!placeholder) return t;
      const epicRow = byId.get(eid);
      if (!epicRow || epicRow.id === t.id) return t;
      if (t.epicRefIsParentLink && !kanbanTaskRowIsEpicType(epicRow)) return t;
      const name = epicRow.title.trim() || `Задача #${eid}`;
      const short = name.length > 32 ? `${name.slice(0, 29)}…` : name;
      return { ...t, epic: short, epicFull: name, epicRefIsParentLink: undefined };
    });
  }, [bundle.data?.tasks, columns, priorityRefs, memberIdToName, taskTypeRefs, componentIdToName]);

  useLayoutEffect(() => {
    const raw = searchParams.get("task");
    const tid = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(tid) || tid <= 0) {
      setDetailTask(null);
      return;
    }
    const found = boardTasks.find((t) => t.id === tid);
    if (found) {
      setDetailTask(found);
      return;
    }
    setDetailTask((prev) => {
      if (prev && prev.id === tid) return prev;
      if (columns.length === 0) return null;
      return createPlaceholderKanbanTask(tid, columns);
    });
  }, [searchParams, boardTasks, columns]);

  const mergedEpicRows = useMemo(() => {
    const byId = new Map<number, string>();
    for (const row of epicsCatalogQ.data ?? []) {
      if (row.id > 0 && row.name.trim()) byId.set(row.id, row.name.trim());
    }
    for (const t of boardTasks) {
      const id = t.epicId;
      if (id == null || !(id > 0)) continue;
      const name = (t.epicFull || t.epic || "").trim();
      if (!name || name === "—" || name === "-") continue;
      const prev = byId.get(id);
      if (!prev || name.length > prev.length) byId.set(id, name);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [epicsCatalogQ.data, boardTasks]);

  const filterEpicOptions = useMemo(
    () => mergedEpicRows.map((e) => formatEpicFilterOption(e.id, e.name)),
    [mergedEpicRows],
  );

  const selectedEpicOptionStrings = useMemo(() => {
    return selectedEpicIds
      .map((id) => {
        const row = mergedEpicRows.find((e) => e.id === id);
        return row ? formatEpicFilterOption(row.id, row.name) : null;
      })
      .filter((x): x is string => Boolean(x));
  }, [selectedEpicIds, mergedEpicRows]);

  const epicFilterMatchOption = useMemo(
    () => (opt: string, q: string) => {
      const low = opt.toLowerCase();
      if (low.includes(q)) return true;
      const digits = q.replace(/\D/g, "");
      if (digits.length > 0) {
        const id = parseEpicIdFromFilterOption(opt);
        if (id != null && String(id).includes(digits)) return true;
      }
      return false;
    },
    [],
  );

  const epicFilterGetKey = useMemo(
    () => (opt: string, _index: number) => {
      const id = parseEpicIdFromFilterOption(opt);
      return id ?? opt;
    },
    [],
  );

  const isImportantTask = useCallback((task: KanbanTask): boolean => {
    if (task.priority === "Высокий") return true;
    const pid = task.priorityId;
    if (pid == null || !(pid > 0)) return false;
    const ref = priorityRefs.find((p) => p.id === pid);
    return Boolean(ref && isKanbanHighPriorityFromRefName(ref.name));
  }, [priorityRefs]);

  const createDefaults = useMemo(() => {
    if (!taskTypes.data || !priorities.data) return null;
    const taskTypeId = pickFirstTaskTypeId(taskTypes.data);
    const priorityId = pickPriorityIdByLabel(priorities.data, "средний");
    const fromProject = pickProjectComponentId(bundle.data?.project);
    const fromList = components.data ? pickFirstComponentId(components.data) : null;
    const componentId = fromProject ?? fromList;
    return { taskTypeId, priorityId, componentId };
  }, [taskTypes.data, priorities.data, components.data, bundle.data?.project]);

  const selectedEpicIdSet = useMemo(() => new Set(selectedEpicIds), [selectedEpicIds]);

  /** Общие фильтры доски; фильтр по эпикам только в режиме «Доска». */
  const baseFilteredTasks = useMemo(() => {
    return boardTasks.filter((task) => {
      if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (onlyImportant && !isImportantTask(task)) return false;
      if (selectedUsers.length > 0 && !task.assignees.some((a) => selectedUsers.includes(a))) return false;
      if (selectedTypes.length > 0 && !task.types.some((t) => selectedTypes.includes(t))) return false;
      return true;
    });
  }, [boardTasks, searchQuery, onlyImportant, isImportantTask, selectedUsers, selectedTypes]);

  const filteredTasks = useMemo(() => {
    if (viewMode !== "board" || selectedEpicIdSet.size === 0) return baseFilteredTasks;
    return baseFilteredTasks.filter((task) => {
      const eid = task.epicId;
      return eid != null && selectedEpicIdSet.has(eid);
    });
  }, [baseFilteredTasks, viewMode, selectedEpicIdSet]);

  const listStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of filteredTasks) {
      const s = t.status?.trim();
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [filteredTasks]);

  const listFilteredTasks = useMemo(() => {
    if (selectedListStatuses.length === 0) return filteredTasks;
    return filteredTasks.filter((t) => selectedListStatuses.includes(t.status));
  }, [filteredTasks, selectedListStatuses]);
  const hasFilters =
    Boolean(searchQuery) ||
    onlyMine ||
    onlyImportant ||
    selectedUsers.length > 0 ||
    (viewMode === "board" && selectedEpicIds.length > 0) ||
    selectedTypes.length > 0 ||
    selectedListStatuses.length > 0;

  const firstColId = columns[0]?.id;
  const kanbanBase = bootstrap.data?.kanban_web_base_url?.replace(/\/$/, "") ?? null;
  const externalProjectUrl = kanbanBase ? `${kanbanBase}/projects/${encodeURIComponent(projectSlug)}` : null;

  const isLoadingCols = bundle.isLoading || taskTypes.isLoading || priorities.isLoading;

  const panelOpen = Boolean(detailTask || showCreate);
  const closePanels = () => {
    setShowCreate(false);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("task");
        return n;
      },
      { replace: true },
    );
  };
  const openTaskDetail = (task: KanbanTask) => {
    setShowCreate(false);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("task", String(task.id));
        return n;
      },
      { replace: true },
    );
  };

  const openEpicFromList = (epicKanbanId: number, epicTitle: string) => {
    const col = columns[0];
    const stub: KanbanTask = {
      id: epicKanbanId,
      columnId: col?.id ?? 0,
      title: epicTitle,
      priority: "Средний",
      types: ["Эпик"],
      taskTypeId: 5,
      assignees: [],
      epic: "—",
      epicFull: "—",
      status: col?.title ?? "",
      componentLabel: "—",
      deadlineStatus: null,
      trackedMinutes: 0,
      createdAt: "",
      commentCount: 0,
      attachmentCount: 0,
    };
    setShowCreate(false);
    setDetailTask(stub);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("task", String(epicKanbanId));
        return n;
      },
      { replace: true },
    );
  };
  const openCreatePanel = () => {
    setShowCreate(true);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("task");
        return n;
      },
      { replace: true },
    );
  };

  const boardPanel = (
    <div className="kanban-root relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        style={{
          padding: "12px 20px 0",
          borderBottom: "1px solid #2F363C",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          background: "#0D1117",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#E6EEF4", marginBottom: 2 }}>{projectTitle}</h1>
          <div style={{ display: "flex", gap: 0, marginTop: 8 }}>
            {(["Доска", "Список"] as const).map((tab, i) => {
              const mode = i === 0 ? "board" : "list";
              const active = viewMode === mode;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setSearchParams(
                      (prev) => {
                        const n = new URLSearchParams(prev);
                        if (mode === "list") n.set("view", "list");
                        else n.delete("view");
                        return n;
                      },
                      { replace: true },
                    );
                  }}
                  style={{
                    padding: "6px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    color: active ? "#E6EEF4" : "#8b949e",
                    background: "transparent",
                    border: "none",
                    borderBottom: active ? "2px solid #8b5cf6" : "2px solid transparent",
                    fontFamily: "inherit",
                  }}
                  data-testid={i === 0 ? "tab-kanban-board" : "tab-kanban-list"}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8 }}>
          {externalProjectUrl && (
            <a
              href={externalProjectUrl}
              target="_blank"
              rel="noreferrer"
              title="Открыть в Kanban"
              style={{ color: "#8b5cf6", display: "flex", alignItems: "center" }}
              data-testid="kanban-board-open-external"
            >
              <Link2 size={18} />
            </a>
          )}
          <button type="button" className="btn-primary" onClick={openCreatePanel} data-testid="button-create-task">
            <Plus size={14} /> Добавить задачу
          </button>
        </div>
      </div>

      <div className="kanban-toolbar shrink-0" style={{ flexWrap: "wrap", height: "auto", minHeight: 44, paddingTop: 6, paddingBottom: 6 }}>
        <div style={{ position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#444d56" }} />
          <input
            style={{
              background: "#161b22",
              border: `1px solid ${searchQuery ? "#8b5cf6" : "#2F363C"}`,
              color: "#E6EEF4",
              fontSize: 12,
              padding: "4px 8px 4px 26px",
              borderRadius: 4,
              fontFamily: "inherit",
              outline: "none",
              width: 200,
            }}
            placeholder="Название задачи"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-tasks"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#444d56",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>

        <FilterDropdown
          label="Пользователи"
          icon={Users}
          options={filterUserOptions}
          selected={selectedUsers}
          searchable
          searchPlaceholder="Поиск по имени"
          onToggle={(u) => setSelectedUsers((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]))}
        />
        {viewMode === "board" ? (
          <FilterDropdown
            label="Эпики"
            icon={Layers}
            options={filterEpicOptions}
            selected={selectedEpicOptionStrings}
            searchable
            searchPlaceholder="Поиск по эпику"
            emptySearchMessage="Ничего не найдено"
            emptyOptionsMessage={
              epicsCatalogQ.isLoading ? "Загрузка эпиков…" : "Нет эпиков в этом проекте"
            }
            matchOption={epicFilterMatchOption}
            getOptionReactKey={epicFilterGetKey}
            onToggle={(opt) => {
              const id = parseEpicIdFromFilterOption(opt);
              if (id == null) return;
              setSelectedEpicIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
            }}
          />
        ) : null}
        <FilterDropdown
          label="Тип"
          icon={SlidersHorizontal}
          options={ALL_TYPES}
          selected={selectedTypes}
          onToggle={(t) => setSelectedTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}
        />
        {viewMode === "list" && listStatusOptions.length > 0 ? (
          <FilterDropdown
            label="Статусы"
            icon={ListFilter}
            options={listStatusOptions}
            selected={selectedListStatuses}
            searchable
            searchPlaceholder="Поиск по статусу"
            emptySearchMessage="Нет совпадений"
            onToggle={(s) => setSelectedListStatuses((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
          />
        ) : null}

        <div style={{ width: 1, height: 20, background: "#2F363C", margin: "0 4px" }} />

        <label className="toolbar-toggle" onClick={() => setOnlyMine(!onlyMine)} style={{ cursor: "pointer" }} data-testid="toggle-only-mine">
          <div className={`toggle-track${onlyMine ? " on" : ""}`}>
            <div className="toggle-thumb" />
          </div>
          <span style={{ color: onlyMine ? "#E6EEF4" : "#8b949e" }}>Только мои</span>
        </label>
        <label className="toolbar-toggle" onClick={() => setOnlyImportant(!onlyImportant)} style={{ cursor: "pointer" }} data-testid="toggle-only-important">
          <div className={`toggle-track${onlyImportant ? " on" : ""}`}>
            <div className="toggle-thumb" />
          </div>
          <span style={{ color: onlyImportant ? "#E6EEF4" : "#8b949e" }}>Только важные задачи</span>
        </label>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {viewMode === "list" && listEpicGroupCount > 0 ? (
            <>
              <button
                type="button"
                className="kanban-list-toolbar-btn"
                onClick={() => kanbanListRef.current?.collapseAll()}
                data-testid="kanban-list-collapse-all"
              >
                Свернуть все
              </button>
              <button
                type="button"
                className="kanban-list-toolbar-btn"
                onClick={() => kanbanListRef.current?.expandAll()}
                data-testid="kanban-list-expand-all"
              >
                Развернуть все
              </button>
            </>
          ) : null}
          {viewMode === "list" && listEpicGroupCount > 0 && hasFilters ? (
            <div style={{ width: 1, height: 16, background: "#2F363C", flexShrink: 0 }} aria-hidden />
          ) : null}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setOnlyMine(false);
                setOnlyImportant(false);
                setSelectedUsers([]);
                setSelectedEpicIds([]);
                setSelectedTypes([]);
                setSelectedListStatuses([]);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#f85149",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: "2px 6px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              data-testid="button-reset-filters"
            >
              <X size={11} /> Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {bundle.isError && (
        <div style={{ padding: 16, color: "#f85149", fontSize: 13 }}>
          Не удалось загрузить доску. Проверьте подключение Kanban.
        </div>
      )}

      <div
        className={cn(
          "kanban-scroll flex-1 min-h-0 bg-[#0a0d14] p-3",
          viewMode === "board" ? "flex gap-2 overflow-x-auto overflow-y-hidden" : "flex flex-col overflow-x-hidden overflow-y-auto",
        )}
      >
        {viewMode === "board" ? (
          <>
            {isLoadingCols ? (
              <div className="min-h-[min(280px,40vh)] min-w-[200px] flex-1 shrink-0" aria-hidden />
            ) : (
              <KanbanBoardDndShell
                columns={columns}
                filteredTasks={filteredTasks}
                onCardClick={openTaskDetail}
                projectSlug={projectSlug}
                allowQuickAdd={false}
                createDefaults={createDefaults}
                pointerActivationDistance={isMobile ? 12 : 8}
              />
            )}
          </>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {isLoadingCols ? (
              <div className="min-h-[min(280px,40vh)] min-w-[200px] flex-1 shrink-0" aria-hidden />
            ) : (
              <KanbanListView
                ref={kanbanListRef}
                tasks={listFilteredTasks}
                columns={columns}
                onRowClick={openTaskDetail}
                onEpicPanelOpen={openEpicFromList}
                onEpicGroupsMeta={onListEpicGroupsMeta}
              />
            )}
          </div>
        )}
      </div>

      {isLoadingCols && !bundle.isError && (
        <div className="kanban-preloader" data-testid="kanban-board-preloader">
          <Loader2 className="h-9 w-9 animate-spin text-[#8b5cf6]" aria-hidden />
          <p className="kanban-preloader-text">Загрузка доски…</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!isMobile ? (
        <ResizablePanelGroup direction="horizontal" className="flex min-h-0 flex-1 min-w-0">
          <ResizablePanel defaultSize={panelOpen ? 62 : 100} minSize={38} className="flex min-h-0 min-w-0 flex-col">
            {boardPanel}
          </ResizablePanel>
          {panelOpen && (
            <>
              <ResizableHandle withHandle className="w-2 shrink-0 bg-[#2F363C] hover:bg-[#444d56]" />
              <ResizablePanel defaultSize={38} minSize={28} maxSize={58} className="flex min-h-0 min-w-0 flex-col">
                <motion.aside
                  key={detailTask ? `task-${detailTask.id}` : "create"}
                  className="kanban-board-aside flex h-full min-h-0 flex-col border-l border-[#2F363C]"
                  initial={reduceMotion ? false : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  {detailTask ? (
                    <TaskDetailContent
                      key={detailTask.id}
                      projectSlug={projectSlug}
                      summary={detailTask}
                      columns={columns}
                      boardTasks={boardTasks}
                      onOpenTask={openTaskDetail}
                      projectMemberIdToName={memberIdToName}
                      priorityRefs={priorityRefs}
                      taskTypeRefs={taskTypeRefs}
                      onClose={closePanels}
                    />
                  ) : (
                    <CreateTaskContent
                      projectSlug={projectSlug}
                      onClose={closePanels}
                      defaultColumnId={firstColId}
                      createDefaults={createDefaults}
                      columns={columns}
                      taskTypes={taskTypes.data}
                      prioritiesList={priorities.data}
                      componentsList={components.data}
                      memberIdToName={memberIdToName}
                    />
                  )}
                </motion.aside>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      ) : (
        <>
          {boardPanel}
          <Sheet open={panelOpen} onOpenChange={(open) => !open && closePanels()}>
            <SheetContent
              side="right"
              className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-[#2F363C] bg-[#0D1117] p-0 sm:max-w-[min(640px,96vw)]"
            >
              <motion.div
                key={detailTask ? `task-${detailTask.id}` : "create"}
                className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                initial={reduceMotion ? false : { opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.26, ease: [0.22, 1, 0.36, 1], delay: 0.04 }
                }
              >
                {detailTask ? (
                  <TaskDetailContent
                    key={detailTask.id}
                    projectSlug={projectSlug}
                    summary={detailTask}
                    columns={columns}
                    boardTasks={boardTasks}
                    onOpenTask={openTaskDetail}
                    projectMemberIdToName={memberIdToName}
                    priorityRefs={priorityRefs}
                    taskTypeRefs={taskTypeRefs}
                    onClose={closePanels}
                  />
                ) : (
                  <CreateTaskContent
                    projectSlug={projectSlug}
                    onClose={closePanels}
                    defaultColumnId={firstColId}
                    createDefaults={createDefaults}
                    columns={columns}
                    taskTypes={taskTypes.data}
                    prioritiesList={priorities.data}
                    componentsList={components.data}
                    memberIdToName={memberIdToName}
                  />
                )}
              </motion.div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}
