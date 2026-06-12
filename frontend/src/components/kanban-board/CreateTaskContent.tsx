import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import {
  appendCreateTaskTemplate,
  extractCreatedKanbanTaskId,
  KANBAN_DEFAULT_CHECKLIST_GROUP_NAME,
  loadCreateTaskTemplates,
  type CreateTaskTemplate,
  type CreateTaskTemplatePayload,
} from "@/lib/kanban-ds/createTaskTemplates";
import { useKanbanCreateTask, useKanbanProjectEpics, kanbanTaskKey } from "@/lib/kanban-ds/queries";
import type { KanbanColumn } from "@/lib/kanban-ds/types";
import { MInput, MSelect } from "@/components/kanban-board/kanban-ui";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseIdNameRows(data: unknown[] | undefined): { id: number; name: string }[] {
  if (!Array.isArray(data)) return [];
  const out: { id: number; name: string }[] = [];
  for (const raw of data) {
    const o = asRecord(raw);
    if (!o) continue;
    const id = Number(o.id);
    const name = String(o.name ?? o.title ?? "").trim();
    if (Number.isFinite(id) && id > 0 && name) out.push({ id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Компоненты, доступные при создании задачи (остальные из справочника не показываем). */
const CREATE_TASK_COMPONENT_ORDER = ["Разработка", "Фронтенд", "Тестирование"] as const;

function filterCreateTaskComponents(options: { id: number; name: string }[]): { id: number; name: string }[] {
  const allowed = new Set<string>(CREATE_TASK_COMPONENT_ORDER);
  const list = options.filter((c) => allowed.has(c.name.trim()));
  const orderIdx = (name: string) => {
    const i = (CREATE_TASK_COMPONENT_ORDER as readonly string[]).indexOf(name.trim());
    return i === -1 ? 999 : i;
  };
  return [...list].sort((a, b) => orderIdx(a.name) - orderIdx(b.name));
}

function ExecutorMultiSelect({
  members,
  value,
  onChange,
}: {
  members: { id: number; name: string }[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  const summary =
    value.length === 0
      ? "Выберите исполнителей..."
      : value
          .map((id) => members.find((m) => m.id === id)?.name)
          .filter(Boolean)
          .join(", ");

  return (
    <div className="mfield" data-testid="input-group-Исполнитель">
      <label className="mfield-label">Исполнитель</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-[42px] w-full justify-between border-[var(--kanban-border)] bg-[var(--kanban-surface)] px-3 py-2 text-left font-normal text-[var(--kanban-text)] hover:bg-[var(--kanban-surface-2)] hover:text-[var(--kanban-text)]"
            data-testid="button-executor-select"
          >
            <span className="line-clamp-2 flex-1 pr-2 text-[13px] leading-snug">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] p-0 text-[var(--kanban-text)]"
          align="start"
        >
          <Command className="rounded-md bg-[var(--kanban-surface-2)] text-[var(--kanban-text)]" shouldFilter>
            <CommandInput placeholder="Поиск по имени..." className="h-9 border-[var(--kanban-border)] text-[var(--kanban-text)] placeholder:text-[var(--kanban-text-faint)]" />
            <CommandList className="max-h-[240px]">
              <CommandEmpty className="py-3 text-center text-[13px] text-[var(--kanban-text-muted)]">Никого не найдено</CommandEmpty>
              <CommandGroup>
                {members.map((m) => {
                  const selected = value.includes(m.id);
                  return (
                    <CommandItem
                      key={m.id}
                      value={m.name}
                      onSelect={() => toggle(m.id)}
                      className="cursor-pointer text-[var(--kanban-text)] aria-selected:bg-[var(--kanban-hover)]"
                      data-testid={`executor-option-${m.id}`}
                    >
                      <div
                        className="mr-2 flex h-4 w-4 items-center justify-center rounded border border-[var(--kanban-text-faint)] bg-[var(--kanban-surface)]"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {selected ? <Check className="h-3 w-3 text-[var(--kanban-accent-emphasis)]" /> : null}
                      </div>
                      <span className="flex-1">{m.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EpicSearchSelect({
  projectSlug,
  value,
  onChange,
}: {
  projectSlug: string;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const epicsQ = useKanbanProjectEpics(projectSlug);
  const rows = useMemo(() => {
    const list = epicsQ.data ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [epicsQ.data]);

  const summary =
    value == null
      ? "Без эпика"
      : rows.find((e) => e.id === value)?.name ?? (epicsQ.isLoading ? "Загрузка..." : `Эпик #${value}`);

  return (
    <div className="mfield" data-testid="input-group-Эпик">
      <label className="mfield-label">Эпик</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-[42px] w-full justify-between border-[var(--kanban-border)] bg-[var(--kanban-surface)] px-3 py-2 text-left font-normal text-[var(--kanban-text)] hover:bg-[var(--kanban-surface-2)] hover:text-[var(--kanban-text)]"
            data-testid="button-epic-select"
          >
            <span className="line-clamp-2 flex-1 pr-2 text-[13px] leading-snug">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] p-0 text-[var(--kanban-text)]"
          align="start"
        >
          <Command className="rounded-md bg-[var(--kanban-surface-2)] text-[var(--kanban-text)]" shouldFilter>
            <CommandInput placeholder="Поиск по названию или id..." className="h-9 border-[var(--kanban-border)] text-[var(--kanban-text)] placeholder:text-[var(--kanban-text-faint)]" />
            <CommandList className="max-h-[240px]">
              <CommandEmpty className="py-3 text-center text-[13px] text-[var(--kanban-text-muted)]">
                {epicsQ.isLoading ? "Загрузка..." : "Ничего не найдено"}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__ без эпика"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="cursor-pointer text-[var(--kanban-text)] aria-selected:bg-[var(--kanban-hover)]"
                  data-testid="epic-option-none"
                >
                  Без эпика
                </CommandItem>
                {rows.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.id}`}
                    onSelect={() => {
                      onChange(e.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer text-[var(--kanban-text)] aria-selected:bg-[var(--kanban-hover)]"
                    data-testid={`epic-option-${e.id}`}
                  >
                    <span className="flex-1">{e.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-[var(--kanban-text-muted)]">#{e.id}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CreateTaskContent({
  projectSlug,
  onClose,
  defaultColumnId,
  createDefaults,
  columns,
  taskTypes,
  prioritiesList,
  componentsList,
  memberIdToName,
}: {
  projectSlug: string;
  onClose: () => void;
  defaultColumnId?: number;
  createDefaults: { taskTypeId: number; priorityId: number; componentId: number | null } | null;
  columns: KanbanColumn[];
  taskTypes: unknown[] | undefined;
  prioritiesList: unknown[] | undefined;
  componentsList: unknown[] | undefined;
  memberIdToName: Map<number, string>;
}) {
  const typeOptions = useMemo(() => parseIdNameRows(taskTypes), [taskTypes]);
  const priorityOptions = useMemo(() => parseIdNameRows(prioritiesList), [prioritiesList]);
  const componentOptionsAll = useMemo(() => parseIdNameRows(componentsList), [componentsList]);
  const componentOptions = useMemo(() => filterCreateTaskComponents(componentOptionsAll), [componentOptionsAll]);

  const memberPairs = useMemo(() => {
    const pairs = [...memberIdToName.entries()].map(([id, name]) => ({ id, name }));
    return pairs.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [memberIdToName]);

  const stageIdForCreate = defaultColumnId ?? columns[0]?.id ?? 0;
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [taskTypeId, setTaskTypeId] = useState<number | null>(null);
  const [priorityId, setPriorityId] = useState<number | null>(null);
  const [componentId, setComponentId] = useState<number | null>(null);

  const [description, setDescription] = useState("");
  const [layoutLink, setLayoutLink] = useState("");
  const [markupLink, setMarkupLink] = useState("");
  const [devLink, setDevLink] = useState("");
  const [epicId, setEpicId] = useState<number | null>(null);
  const [executorIds, setExecutorIds] = useState<number[]>([]);
  const [checklistLines, setChecklistLines] = useState<string[]>([]);

  const [templates, setTemplates] = useState<CreateTaskTemplate[]>(() => loadCreateTaskTemplates(projectSlug));
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    setTemplates(loadCreateTaskTemplates(projectSlug));
    setSelectedTemplateId("");
  }, [projectSlug]);

  const collectPayload = useCallback((): CreateTaskTemplatePayload => {
    return {
      title,
      description,
      taskTypeId,
      priorityId,
      componentId,
      layoutLink,
      markupLink,
      devLink,
      epicId,
      executorIds: [...executorIds],
      checklistLines: checklistLines.map((l) => l.trim()).filter(Boolean),
    };
  }, [
    title,
    description,
    taskTypeId,
    priorityId,
    componentId,
    layoutLink,
    markupLink,
    devLink,
    epicId,
    executorIds,
    checklistLines,
  ]);

  const applyTemplatePayload = useCallback(
    (p: CreateTaskTemplatePayload) => {
      setTitle(p.title);
      setDescription(p.description);
      setLayoutLink(p.layoutLink);
      setMarkupLink(p.markupLink);
      setDevLink(p.devLink);
      setEpicId(p.epicId);
      setChecklistLines(p.checklistLines.length > 0 ? [...p.checklistLines] : []);

      const tt = p.taskTypeId != null && typeOptions.some((x) => x.id === p.taskTypeId) ? p.taskTypeId : null;
      const pr = p.priorityId != null && priorityOptions.some((x) => x.id === p.priorityId) ? p.priorityId : null;
      const comp =
        p.componentId != null && componentOptions.some((c) => c.id === p.componentId) ? p.componentId : null;
      setTaskTypeId(tt);
      setPriorityId(pr);
      setComponentId(comp);

      const allowed = new Set(memberPairs.map((m) => m.id));
      setExecutorIds(p.executorIds.filter((id) => allowed.has(id)));
    },
    [typeOptions, priorityOptions, componentOptions, memberPairs],
  );

  const handleSaveAsTemplate = () => {
    const name = window.prompt("Название шаблона", "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert("Введите название шаблона");
      return;
    }
    const payload = collectPayload();
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const next = appendCreateTaskTemplate(projectSlug, {
      id,
      name: trimmed,
      savedAt: new Date().toISOString(),
      payload,
    });
    setTemplates(next);
    toast.success("Шаблон сохранён");
  };

  useEffect(() => {
    if (taskTypeId != null) return;
    const def = createDefaults?.taskTypeId;
    if (def && typeOptions.some((t) => t.id === def)) setTaskTypeId(def);
    else if (typeOptions[0]) setTaskTypeId(typeOptions[0].id);
  }, [createDefaults?.taskTypeId, taskTypeId, typeOptions]);

  useEffect(() => {
    if (priorityId != null) return;
    const def = createDefaults?.priorityId;
    if (def && priorityOptions.some((p) => p.id === def)) setPriorityId(def);
    else if (priorityOptions[0]) setPriorityId(priorityOptions[0].id);
  }, [createDefaults?.priorityId, priorityId, priorityOptions]);

  useEffect(() => {
    if (componentId != null) return;
    const def = createDefaults?.componentId;
    if (def && componentOptions.some((c) => c.id === def)) setComponentId(def);
  }, [createDefaults?.componentId, componentId, componentOptions]);

  const create = useKanbanCreateTask(projectSlug);

  const taskTypeLabel = typeOptions.find((t) => t.id === taskTypeId)?.name ?? "";
  const priorityLabel = priorityOptions.find((p) => p.id === priorityId)?.name ?? "";

  const componentSelectOptions = useMemo(() => ["Не выбран", ...componentOptions.map((c) => c.name)], [componentOptions]);
  const componentLabel =
    componentId != null ? componentOptions.find((c) => c.id === componentId)?.name ?? "Не выбран" : "Не выбран";

  const handleSave = async () => {
    if (!title.trim()) {
      window.alert("Введите название задачи");
      return;
    }
    if (!stageIdForCreate) {
      window.alert("Не удалось определить колонку доски. Обновите страницу.");
      return;
    }
    const tt = taskTypeId ?? createDefaults?.taskTypeId;
    const pr = priorityId ?? createDefaults?.priorityId;
    if (!tt || !pr) {
      window.alert("Недостаточно данных справочников Kanban. Подождите загрузку или перезагрузите страницу.");
      return;
    }
    const body: Record<string, unknown> = {
      name: title.trim(),
      description: description.trim() || "",
      stage_id: stageIdForCreate,
      task_type_id: tt,
      priority_id: pr,
    };

    const comp = componentId ?? createDefaults?.componentId;
    if (comp != null && comp > 0 && componentOptions.some((c) => c.id === comp)) {
      body.component_id = comp;
    }

    const layout = layoutLink.trim();
    const markup = markupLink.trim();
    const dev = devLink.trim();
    if (layout) body.layout_link = layout;
    if (markup) body.markup_link = markup;
    if (dev) body.dev_link = dev;

    if (epicId != null && epicId > 0) {
      body.epic_id = epicId;
    }

    if (executorIds.length > 0) {
      body.executors = [...executorIds];
    }

    let raw: unknown;
    try {
      raw = await create.mutateAsync(body);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Не удалось создать задачу";
      toast.error(msg);
      return;
    }

    const taskId = extractCreatedKanbanTaskId(raw);
    const points = checklistLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ text, name: text, is_done: false }));

    if (taskId != null && points.length > 0) {
      try {
        await api.post(`/kanban/tasks/${taskId}/checklist`, {
          items: [{ name: KANBAN_DEFAULT_CHECKLIST_GROUP_NAME, points }],
        });
        void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Ошибка сохранения чек-листа";
        toast.error(`Задача создана, но чек-лист не записан: ${msg}`);
      }
    }

    void qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "kanban-board-bundle" && q.queryKey[1] === projectSlug,
    });
    onClose();
  };

  const refsMissing = !typeOptions.length || !priorityOptions.length;

  return (
    <div className="kanban-create-panel flex h-full min-h-0 flex-1 flex-col bg-[var(--kanban-surface-2)] text-[var(--kanban-text)]">
      <div className="modal-header shrink-0">
        <span className="modal-title">Создать задачу</span>
        <button
          type="button"
          className="modal-close kanban-create-panel-close hidden md:flex"
          onClick={onClose}
          aria-label="Закрыть"
          data-testid="button-close-create-modal"
        >
          <X size={16} />
        </button>
      </div>
      <div className="modal-body kanban-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mb-4 flex flex-col gap-2 border-b border-[var(--kanban-border)] pb-4">
          <div className="mfield mb-0">
            <label className="mfield-label">Шаблон</label>
            <select
              className="mfield-select w-full"
              value={selectedTemplateId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedTemplateId(id);
                const t = templates.find((x) => x.id === id);
                if (t) applyTemplatePayload(t.payload);
              }}
              data-testid="select-create-task-template"
            >
              <option value="">Не выбран</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary self-start text-[12px]"
            onClick={handleSaveAsTemplate}
            data-testid="button-save-create-task-template"
          >
            Создать шаблон...
          </button>
        </div>

        <MInput label="Название" required value={title} onChange={setTitle} />

        <div className="mfield" style={{ marginTop: 12 }} data-testid="input-group-Описание">
          <label className="mfield-label">Описание</label>
          <textarea
            className="mfield-textarea"
            placeholder="Описание задачи"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="input-Описание"
          />
        </div>

        {componentOptions.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <MSelect
              label="Компонент"
              options={componentSelectOptions}
              value={componentLabel}
              onChange={(label) => {
                if (label === "Не выбран") setComponentId(null);
                else {
                  const hit = componentOptions.find((c) => c.name === label);
                  if (hit) setComponentId(hit.id);
                }
              }}
            />
          </div>
        ) : null}

        {memberPairs.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <ExecutorMultiSelect members={memberPairs} value={executorIds} onChange={setExecutorIds} />
          </div>
        ) : null}

        <div className="mrow" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr" }}>
          <MSelect
            label="Тип задачи"
            required
            options={typeOptions.length ? typeOptions.map((x) => x.name) : ["—"]}
            value={taskTypeLabel || "—"}
            onChange={(label) => {
              const hit = typeOptions.find((x) => x.name === label);
              if (hit) setTaskTypeId(hit.id);
            }}
          />
          <MSelect
            label="Приоритет"
            required
            options={priorityOptions.length ? priorityOptions.map((x) => x.name) : ["—"]}
            value={priorityLabel || "—"}
            onChange={(label) => {
              const hit = priorityOptions.find((x) => x.name === label);
              if (hit) setPriorityId(hit.id);
            }}
          />
        </div>

        <div className="mfield" style={{ marginTop: 14 }} data-testid="create-task-checklist">
          <label className="mfield-label">Чек-лист</label>
          <p className="mb-2 text-[11px] leading-snug text-[var(--kanban-text-faint)]">Сохраняются в Kanban после создания задачи.</p>
          {checklistLines.length === 0 ? (
            <p className="mb-2 text-[12px] text-[var(--kanban-text-muted)]">Пока нет пунктов.</p>
          ) : (
            checklistLines.map((line, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input
                  className="mfield-input min-w-0 flex-1"
                  placeholder={`Пункт ${i + 1}`}
                  value={line}
                  onChange={(e) =>
                    setChecklistLines((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  data-testid={`input-checklist-line-${i}`}
                />
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--kanban-border)] bg-[var(--kanban-surface)] text-[var(--kanban-text-muted)] hover:border-[var(--kanban-danger)]/50 hover:text-[var(--kanban-danger)]"
                  aria-label="Удалить пункт"
                  onClick={() => setChecklistLines((prev) => prev.filter((_, j) => j !== i))}
                  data-testid={`button-remove-checklist-${i}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn-secondary mt-1 flex items-center gap-1.5 text-[12px]"
            onClick={() => setChecklistLines((prev) => [...prev, ""])}
            data-testid="button-add-checklist-line"
          >
            <Plus size={14} /> Добавить пункт
          </button>
        </div>

        <Accordion type="single" collapsible className="kanban-create-accordion mt-4 w-full border-0">
          <AccordionItem value="more" className="kanban-create-acc-item border-b border-[var(--kanban-border)]">
            <AccordionTrigger className={cn("kanban-create-acc-trigger hover:no-underline py-2 text-[var(--kanban-text)]")}>
              Дополнительные поля
            </AccordionTrigger>
            <AccordionContent className="kanban-create-acc-content space-y-3 pb-3">
              <MInput label="Ссылка на макет" value={layoutLink} onChange={setLayoutLink} />
              <MInput label="Ссылка на вёрстку" value={markupLink} onChange={setMarkupLink} />
              <MInput label="Ссылка на сборку" value={devLink} onChange={setDevLink} />

              <EpicSearchSelect projectSlug={projectSlug} value={epicId} onChange={setEpicId} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <div className="modal-footer shrink-0">
        <button type="button" className="btn-cancel" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={create.isPending || refsMissing}
          data-testid="submit-create-task"
        >
          Создать
        </button>
      </div>
    </div>
  );
}
