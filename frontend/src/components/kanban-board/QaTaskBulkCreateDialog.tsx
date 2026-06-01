import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { extractCreatedKanbanTaskId, KANBAN_DEFAULT_CHECKLIST_GROUP_NAME } from "@/lib/kanban-ds/createTaskTemplates";
import {
  findQaTaskDuplicate,
  QA_BULK_TASK_CHECKLISTS,
  QA_BULK_TASK_LABELS,
  qaTaskBaseTitle,
  qaTestingTaskTitle,
  type QaBulkTaskKind,
} from "@/lib/kanban-ds/qaTaskBulkCreate";
import { kanbanBoardBundleKey, kanbanTaskKey, useKanbanCreateTask } from "@/lib/kanban-ds/queries";
import {
  pickComponentIdByName,
  pickRequiredPriorityIdByLabel,
  pickTaskTypeIdByName,
} from "@/lib/kanban-ds/refs";
import type { KanbanColumn, KanbanTask } from "@/lib/kanban-ds/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type RowStatus = "idle" | "created" | "skipped" | "error";

type SubmitResult = {
  status: RowStatus;
  message?: string;
};

type TestingRow = {
  id: string;
  executorId: number | null;
};

type PlanRow = {
  key: string;
  kind: QaBulkTaskKind;
  title: string;
  executorIds: number[];
  duplicateTask: Pick<KanbanTask, "id" | "title"> | null;
};

function nextRowId(): string {
  return `testing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function executorPairs(memberIdToName: Map<number, string>): { id: number; name: string }[] {
  return [...memberIdToName.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function ExecutorSelect({
  value,
  members,
  onChange,
  disabled,
  testId,
}: {
  value: number | null;
  members: { id: number; name: string }[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <select
      className="mfield-select h-9 min-w-[180px] flex-1"
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) && n > 0 ? n : null);
      }}
      disabled={disabled}
      data-testid={testId}
    >
      <option value="">Без исполнителя</option>
      {members.map((member) => (
        <option key={member.id} value={String(member.id)}>
          {member.name}
        </option>
      ))}
    </select>
  );
}

export function QaTaskBulkCreateDialog({
  open,
  onOpenChange,
  projectSlug,
  epic,
  epicDescription,
  childTasks,
  columns,
  taskTypes,
  prioritiesList,
  componentsList,
  memberIdToName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  epic: KanbanTask;
  epicDescription: string;
  childTasks: KanbanTask[];
  columns: KanbanColumn[];
  taskTypes: unknown[] | undefined;
  prioritiesList: unknown[] | undefined;
  componentsList: unknown[] | undefined;
  memberIdToName: Map<number, string>;
}) {
  const qc = useQueryClient();
  const createTask = useKanbanCreateTask(projectSlug);
  const members = useMemo(() => executorPairs(memberIdToName), [memberIdToName]);

  const [testCasesExecutorId, setTestCasesExecutorId] = useState<number | null>(null);
  const [testingRows, setTestingRows] = useState<TestingRow[]>([{ id: "testing-1", executorId: null }]);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoExecutorId, setDemoExecutorId] = useState<number | null>(null);
  const [instructionEnabled, setInstructionEnabled] = useState(false);
  const [instructionExecutorId, setInstructionExecutorId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<Record<string, SubmitResult>>({});

  useEffect(() => {
    if (open) setResults({});
  }, [open]);

  const refs = useMemo(() => {
    const tt = pickTaskTypeIdByName(taskTypes ?? [], "Задача");
    const priority = pickRequiredPriorityIdByLabel(prioritiesList ?? [], "Средний");
    const component = pickComponentIdByName(componentsList ?? [], "Тестирование");
    const stage = columns[0]?.id ?? null;
    return { taskTypeId: tt, priorityId: priority, componentId: component, stageId: stage };
  }, [taskTypes, prioritiesList, componentsList, columns]);

  const missingRefs = useMemo(() => {
    const out: string[] = [];
    if (!refs.taskTypeId) out.push("тип задачи Задача");
    if (!refs.priorityId) out.push("приоритет Средний");
    if (!refs.componentId) out.push("компонент Тестирование");
    if (!refs.stageId) out.push("начальная колонка");
    return out;
  }, [refs]);

  const planRows = useMemo<PlanRow[]>(() => {
    const rows: Omit<PlanRow, "duplicateTask">[] = [
      {
        key: "test_cases",
        kind: "test_cases",
        title: qaTaskBaseTitle("test_cases", epic.title),
        executorIds: testCasesExecutorId == null ? [] : [testCasesExecutorId],
      },
      ...testingRows.map((row, index) => ({
        key: row.id,
        kind: "testing" as const,
        title: qaTestingTaskTitle(
          epic.title,
          row.executorId == null ? [] : [row.executorId],
          memberIdToName,
          index + 1,
          testingRows.length,
        ),
        executorIds: row.executorId == null ? [] : [row.executorId],
      })),
    ];

    if (demoEnabled) {
      rows.push({
        key: "demo",
        kind: "demo",
        title: qaTaskBaseTitle("demo", epic.title),
        executorIds: demoExecutorId == null ? [] : [demoExecutorId],
      });
    }
    if (instructionEnabled) {
      rows.push({
        key: "instruction",
        kind: "instruction",
        title: qaTaskBaseTitle("instruction", epic.title),
        executorIds: instructionExecutorId == null ? [] : [instructionExecutorId],
      });
    }

    return rows.map((row) => {
      return {
        ...row,
        duplicateTask: findQaTaskDuplicate(childTasks, row.title),
      };
    });
  }, [
    childTasks,
    demoEnabled,
    demoExecutorId,
    epic.title,
    instructionEnabled,
    instructionExecutorId,
    memberIdToName,
    testCasesExecutorId,
    testingRows,
  ]);

  const updateTestingExecutor = (id: string, executorId: number | null) => {
    setTestingRows((prev) => prev.map((row) => (row.id === id ? { ...row, executorId } : row)));
  };

  const addTestingRow = () => setTestingRows((prev) => [...prev, { id: nextRowId(), executorId: null }]);

  const removeTestingRow = (id: string) => {
    setTestingRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
  };

  const createSelected = async () => {
    if (missingRefs.length > 0 || submitting) return;
    setSubmitting(true);
    const nextResults: Record<string, SubmitResult> = {};

    for (const row of planRows) {
      if (row.duplicateTask) {
        nextResults[row.key] = { status: "skipped", message: `Уже есть #${row.duplicateTask.id}` };
        setResults({ ...nextResults });
        continue;
      }
      const body: Record<string, unknown> = {
        name: row.title,
        description: epicDescription.trim() || "",
        stage_id: refs.stageId,
        task_type_id: refs.taskTypeId,
        priority_id: refs.priorityId,
        component_id: refs.componentId,
        epic_id: epic.id,
      };
      if (row.executorIds.length > 0) body.executors = row.executorIds;

      try {
        const raw = await createTask.mutateAsync(body);
        const taskId = extractCreatedKanbanTaskId(raw);
        const checklistLines = QA_BULK_TASK_CHECKLISTS[row.kind] ?? [];
        if (taskId != null && checklistLines.length > 0) {
          await api.post(`/kanban/tasks/${taskId}/checklist`, {
            items: [
              {
                name: KANBAN_DEFAULT_CHECKLIST_GROUP_NAME,
                points: checklistLines.map((text) => ({ text, name: text, is_done: false })),
              },
            ],
          });
          void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
        }
        nextResults[row.key] = { status: "created", message: "Создано" };
      } catch (e) {
        nextResults[row.key] = {
          status: "error",
          message: e instanceof ApiError ? e.message : "Не удалось создать",
        };
      }
      setResults({ ...nextResults });
    }

    await Promise.all([
      qc.invalidateQueries({ queryKey: kanbanTaskKey(epic.id) }),
      qc.invalidateQueries({ queryKey: kanbanBoardBundleKey(projectSlug, false) }),
      qc.invalidateQueries({ queryKey: kanbanBoardBundleKey(projectSlug, true) }),
    ]);

    setSubmitting(false);
    const created = Object.values(nextResults).filter((r) => r.status === "created").length;
    const failed = Object.values(nextResults).filter((r) => r.status === "error").length;
    if (created > 0 && failed === 0) toast.success("QA-задачи созданы");
    else if (created > 0) toast.warning("Часть QA-задач создана");
    else if (failed > 0) toast.error("QA-задачи не созданы");
  };

  const renderStatus = (row: PlanRow) => {
    const result = results[row.key];
    if (result?.status === "created") {
      return <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} /> {result.message}</span>;
    }
    if (result?.status === "skipped") {
      return <span className="inline-flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> {result.message}</span>;
    }
    if (result?.status === "error") {
      return <span className="inline-flex items-center gap-1 text-[11px] text-red-300"><AlertTriangle size={12} /> {result.message}</span>;
    }
    if (row.duplicateTask) {
      return <span className="inline-flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Уже есть #{row.duplicateTask.id}</span>;
    }
    return null;
  };

  const renderRow = (row: PlanRow, control: ReactNode, removable?: ReactNode) => (
    <div
      key={row.key}
      className={cn(
        "rounded-md border bg-[#0D1117] p-3",
        row.duplicateTask ? "border-amber-400/40" : "border-[#2F363C]",
      )}
      data-testid={`qa-task-row-${row.kind}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#E6EEF4]">{QA_BULK_TASK_LABELS[row.kind]}</div>
          <div className="mt-1 break-words text-[12px] leading-snug text-[#8b949e]">{row.title}</div>
          <div className="mt-2 min-h-4">{renderStatus(row)}</div>
        </div>
        {removable}
      </div>
      <div className="mt-3">{control}</div>
    </div>
  );

  const testCasesPlan = planRows.find((row) => row.key === "test_cases")!;
  const demoPlan = planRows.find((row) => row.key === "demo");
  const instructionPlan = planRows.find((row) => row.key === "instruction");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,780px)] max-w-3xl overflow-y-auto border-[#2F363C] bg-[#161b22] p-0 text-[#E6EEF4]">
        <DialogHeader className="border-b border-[#2F363C] px-5 py-4">
          <DialogTitle>Создать задачи для QA</DialogTitle>
          <DialogDescription className="text-[#8b949e]">
            Эпик #{epic.id}: {epic.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {missingRefs.length > 0 ? (
            <div className="rounded-md border border-red-400/40 bg-red-950/20 p-3 text-[13px] text-red-200" data-testid="qa-task-missing-refs">
              Не хватает справочников Kanban: {missingRefs.join(", ")}.
            </div>
          ) : null}

          {renderRow(
            testCasesPlan,
            <ExecutorSelect
              value={testCasesExecutorId}
              members={members}
              onChange={setTestCasesExecutorId}
              disabled={submitting}
              testId="qa-test-cases-executor"
            />,
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold uppercase text-[#8b949e]">Тестирование</div>
              <button type="button" className="btn-secondary text-[12px]" onClick={addTestingRow} disabled={submitting} data-testid="button-add-qa-testing-row">
                <Plus size={13} /> Добавить
              </button>
            </div>
            {testingRows.map((testingRow) => {
              const plan = planRows.find((row) => row.key === testingRow.id)!;
              return renderRow(
                plan,
                <ExecutorSelect
                  value={testingRow.executorId}
                  members={members}
                  onChange={(executorId) => updateTestingExecutor(testingRow.id, executorId)}
                  disabled={submitting}
                  testId={`qa-testing-executor-${testingRow.id}`}
                />,
                testingRows.length > 1 ? (
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#2F363C] text-[#8b949e] hover:border-red-400/50 hover:text-red-300"
                    onClick={() => removeTestingRow(testingRow.id)}
                    disabled={submitting}
                    aria-label="Удалить задачу тестирования"
                    data-testid={`button-remove-qa-testing-row-${testingRow.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null,
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[13px] text-[#E6EEF4]">
              <input type="checkbox" checked={demoEnabled} onChange={(e) => setDemoEnabled(e.target.checked)} disabled={submitting} data-testid="checkbox-qa-demo" />
              Проведение демонстрации
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#E6EEF4]">
              <input type="checkbox" checked={instructionEnabled} onChange={(e) => setInstructionEnabled(e.target.checked)} disabled={submitting} data-testid="checkbox-qa-instruction" />
              Написание инструкции
            </label>
          </div>

          {demoPlan
            ? renderRow(
                demoPlan,
                <ExecutorSelect value={demoExecutorId} members={members} onChange={setDemoExecutorId} disabled={submitting} testId="qa-demo-executor" />,
              )
            : null}
          {instructionPlan
            ? renderRow(
                instructionPlan,
                <ExecutorSelect
                  value={instructionExecutorId}
                  members={members}
                  onChange={setInstructionExecutorId}
                  disabled={submitting}
                  testId="qa-instruction-executor"
                />,
              )
            : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#2F363C] px-5 py-4">
          <button type="button" className="btn-cancel" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void createSelected()}
            disabled={submitting || missingRefs.length > 0}
            data-testid="button-create-qa-tasks"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Создать задачи
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
