import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "@/lib/router";
import { epics } from "@/data/epics";
import { users } from "@/data/users";
import { questions } from "@/data/questions";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { EnvironmentPill } from "@/components/shared/EnvironmentPill";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { Timeline } from "@/components/shared/Timeline";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, ArrowLeft, ExternalLink, AlertTriangle, CheckSquare, Square, Send, Calendar, Loader2, Pencil, Plus, Trash2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import type { ApiEpicTestPlanItem } from "@/lib/types";

import {
  QA_STATUS_FROM_REF,
  isCoordinatorRole,
  mapApiTicketToRefQuestion,
  mapApiEpicToRefEpic,
  refIdToNumeric,
  userIdToRef,
  type RefQAStatus,
} from "@/lib/mappers";
import {
  useAddEpicComment,
  useCreateTestRun,
  useDeleteEpic,
  useEpic,
  useReferenceData,
  useTickets,
  useToggleEpicQAItem,
  useTransitionEpicQA,
  useUpdateEpic,
  useUpdateEpicQA,
  useUpdateTestRun,
} from "@/lib/queries";
import { isNotaWorkspace } from "@/lib/workspace";
import { formatDate } from "@/lib/formatDateTime";
import type { EpicStatus, EpicTestStage, TestRunStatus } from "@/lib/types";

const QA_STATUS_NEXT: Record<string, { label: string; next: string }[]> = {
  "Подготовка тест-плана": [{ label: "Начать тестирование", next: "В тестировании" }],
  "В тестировании": [{ label: "TEST complete", next: "TEST complete" }, { label: "Заблокировать", next: "Заблокировано" }],
  "Заблокировано": [{ label: "Возобновить", next: "В тестировании" }],
  // Backend: from test_complete / stage_complete → in_testing advances active_test_stage and resets checklist.
  "TEST complete": [{ label: "Перейти на STAGE", next: "В тестировании" }],
  "STAGE complete": [{ label: "Перейти на PROD", next: "В тестировании" }],
  "PROD complete": [{ label: "Закрыть эпик", next: "Закрыто" }],
};

function newEmptyPlanItem(): ApiEpicTestPlanItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return { id, title: "Новый пункт", description_markdown: "", is_checked: false, comment: "" };
}

function optionalUserIdFromRef(refId: string): number | null {
  if (!refId || refId === "none") return null;
  return refIdToNumeric(refId) ?? null;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : pct > 0 ? "bg-amber-500" : "bg-slate-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{value}/{total} ({pct}%)</span>
    </div>
  );
}

export default function EpicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { currentUser } = useRole();
  const { me } = useAuth();
  const hideKanbanUi = isNotaWorkspace(me?.workspace);
  const numericId = id ? refIdToNumeric(id) : null;

  const epicQuery = useEpic(numericId);
  const reference = useReferenceData();
  const epicTicketsQuery = useTickets({ epic_id: numericId ?? -1, page: 1, page_size: 100 });
  const apiEpic = epicQuery.data;
  const qaApiStatus = apiEpic?.qa_block?.status ?? null;
  const isDraftQa = qaApiStatus === "draft";
  const isExecutionQa = qaApiStatus === "in_testing" || qaApiStatus === "blocked";

  const transitionQA = useTransitionEpicQA(numericId ?? -1);
  const toggleItem = useToggleEpicQAItem(numericId ?? -1);
  const updateEpicQa = useUpdateEpicQA(numericId ?? -1);
  const updateEpic = useUpdateEpic(numericId ?? -1);
  const addEpicComment = useAddEpicComment(numericId ?? -1);
  const createTestRun = useCreateTestRun(numericId ?? -1);
  const updateTestRun = useUpdateTestRun(numericId ?? -1);
  const deleteEpic = useDeleteEpic();

  const [comment, setComment] = useState("");
  const [editEpicOpen, setEditEpicOpen] = useState(false);
  const [deleteEpicOpen, setDeleteEpicOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<EpicStatus>("new");
  const [editJiraUrl, setEditJiraUrl] = useState("");
  const [editConfluenceUrl, setEditConfluenceUrl] = useState("");
  const [editKanbanUrl, setEditKanbanUrl] = useState("");
  const [editDesignUrl, setEditDesignUrl] = useState("");
  const [editLeadAnalystId, setEditLeadAnalystId] = useState("none");
  const [editLeadDesignerId, setEditLeadDesignerId] = useState("none");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [testRunEnv, setTestRunEnv] = useState<EpicTestStage>("test");
  const [testRunStatus, setTestRunStatus] = useState<TestRunStatus>("planned");
  const [testRunUrl, setTestRunUrl] = useState("");

  const serverPlanItems = apiEpic?.qa_block?.test_plan_items ?? [];
  const planFingerprint = JSON.stringify(
    serverPlanItems.map((i) => ({
      id: i.id,
      title: i.title,
      is_checked: i.is_checked,
      description_markdown: i.description_markdown,
      comment: i.comment,
    })),
  );
  const [draftPlanRows, setDraftPlanRows] = useState<ApiEpicTestPlanItem[]>([]);
  const [draftPlanFingerprint, setDraftPlanFingerprint] = useState("");

  useEffect(() => {
    if (!isDraftQa || !apiEpic) return;
    if (planFingerprint !== draftPlanFingerprint) {
      setDraftPlanRows(serverPlanItems.map((i) => ({ ...i })));
      setDraftPlanFingerprint(planFingerprint);
    }
  }, [isDraftQa, apiEpic, planFingerprint, draftPlanFingerprint, serverPlanItems]);

  useEffect(() => {
    if (!editEpicOpen || !apiEpic) return;
    setEditTitle(apiEpic.title);
    setEditNotes(apiEpic.notes ?? "");
    setEditStatus(apiEpic.status);
    setEditJiraUrl(apiEpic.jira_url ?? "");
    setEditConfluenceUrl(apiEpic.confluence_url ?? "");
    setEditKanbanUrl(apiEpic.kanban_url ?? "");
    setEditDesignUrl(apiEpic.design_url ?? "");
    setEditLeadAnalystId(apiEpic.lead_analyst_id != null ? userIdToRef(apiEpic.lead_analyst_id) : "none");
    setEditLeadDesignerId(apiEpic.lead_designer_id != null ? userIdToRef(apiEpic.lead_designer_id) : "none");
    setEditStartDate(apiEpic.start_date?.slice(0, 10) ?? "");
    setEditTargetDate(apiEpic.target_date?.slice(0, 10) ?? "");
  }, [editEpicOpen, apiEpic]);

  const epic = epicQuery.data
    ? mapApiEpicToRefEpic(epicQuery.data)
    : epics.find((e) => e.id === id);

  const epicQuestions = epicTicketsQuery.data
    ? [...(epicTicketsQuery.data.items ?? [])]
        .map(mapApiTicketToRefQuestion)
        .filter((q) => q.epicId === id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : questions
        .filter((q) => q.epicId === id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const epicQuestionsTotal = epicTicketsQuery.data?.total ?? epicQuestions.length;

  const canEditEpicLinks =
    me != null &&
    apiEpic != null &&
    (me.role === "admin" ||
      (isCoordinatorRole(me.role) && (me.project_ids ?? []).includes(apiEpic.project_id)));

  if (epicQuery.isLoading && !epic) {
    return (
      <div className="p-4 md:p-6">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!epic) {
    return <div className="p-4 md:p-6"><EmptyState icon={Layers} title="Эпик не найден" description={`Эпик ${id} не существует`} /></div>;
  }

  const currentQaStatus = epic.qaStatus;
  const envs = ["TEST", "STAGE", "PROD"] as const;
  const envOrder: Record<string, number> = { "TEST complete": 1, "STAGE complete": 2, "PROD complete": 3, "Закрыто": 3 };
  const completedUpTo = envOrder[currentQaStatus] ?? 0;

  const allChecklist = epic.checklist;
  const testRuns = epic.testRuns;
  const existingTestRunEnvs = new Set(testRuns.map((run) => run.env.toLowerCase()));
  const availableTestRunEnvs = (["test", "stage", "prod"] as EpicTestStage[]).filter((env) => !existingTestRunEnvs.has(env));
  const testRunEnvironmentLabels = Object.fromEntries(
    (reference.data?.test_run_environments ?? []).map((option) => [option.value, option.label]),
  );
  const testRunStatusOptions = reference.data?.test_run_statuses?.length
    ? reference.data.test_run_statuses
    : [
        { value: "planned", label: "Запланирован" },
        { value: "running", label: "Выполняется" },
        { value: "passed", label: "Успешно" },
        { value: "failed", label: "Упал" },
        { value: "skipped", label: "Пропущен" },
      ];
  const effectiveTestRunEnv = availableTestRunEnvs.includes(testRunEnv) ? testRunEnv : availableTestRunEnvs[0];
  const history = epic.history;
  const allComments = epic.comments;
  const canTransitionQaStatus =
    me?.role === "admin" ||
    (isCoordinatorRole(me?.role) && apiEpic != null && (me?.project_ids ?? []).includes(apiEpic.project_id));
  const canManageTestRuns = canTransitionQaStatus;
  const canAuthEdit = currentUser.id !== "guest";
  const qaStatusLabelByValue = Object.fromEntries(
    (reference.data?.qa_statuses ?? []).map((option) => [option.value, option.label]),
  );
  const currentQaStatusValue = QA_STATUS_FROM_REF[currentQaStatus];
  const qaActions = reference.data?.qa_status_transitions?.[currentQaStatusValue]?.length
    ? reference.data.qa_status_transitions[currentQaStatusValue].map((option) => ({
        label: option.label,
        next: (qaStatusLabelByValue[option.value] ?? option.label) as RefQAStatus,
      }))
    : QA_STATUS_NEXT[currentQaStatus] ?? [];

  const toggleCheck = async (itemId: string, currentlyChecked: boolean) => {
    if (!numericId) return;
    try {
      await toggleItem.mutateAsync({ item_id: itemId, is_checked: !currentlyChecked });
      toast.success("Тест-кейс обновлён");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось обновить";
      toast.error(message);
    }
  };

  const addComment = async () => {
    if (!comment.trim() || !numericId) return;
    try {
      await addEpicComment.mutateAsync({ body: comment });
      setComment("");
      toast.success("Комментарий добавлен");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось добавить";
      toast.error(message);
    }
  };

  const addTestRun = async () => {
    if (!numericId) return;
    const url = testRunUrl.trim();
    if (!url) {
      toast.error("Укажите ссылку на тест-ран");
      return;
    }
    if (!effectiveTestRunEnv || existingTestRunEnvs.has(effectiveTestRunEnv)) {
      toast.error("Для одной площадки можно добавить только один тест-ран");
      return;
    }
    try {
      await createTestRun.mutateAsync({
        environment: effectiveTestRunEnv,
        status: testRunStatus,
        url,
      });
      setTestRunUrl("");
      const nextEnv = availableTestRunEnvs.find((env) => env !== effectiveTestRunEnv);
      if (nextEnv) setTestRunEnv(nextEnv);
      toast.success("Тест-ран добавлен");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось добавить тест-ран";
      toast.error(message);
    }
  };

  const changeTestRunStatus = async (runRefId: string, status: TestRunStatus) => {
    const runId = refIdToNumeric(runRefId);
    if (!numericId || runId == null) return;
    try {
      await updateTestRun.mutateAsync({ runId, body: { status } });
      toast.success("Статус тест-рана обновлён");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось обновить статус тест-рана";
      toast.error(message);
    }
  };

  const transitionTo = async (next: RefQAStatus, label: string) => {
    if (!numericId) return;
    try {
      await transitionQA.mutateAsync({ target_status: QA_STATUS_FROM_REF[next] });
      toast.success(`QA-статус: ${label}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось перевести статус";
      toast.error(message);
    }
  };

  const saveEpicDetails = async () => {
    if (!numericId || !editTitle.trim()) {
      toast.error("Укажите название эпика");
      return;
    }
    try {
      await updateEpic.mutateAsync({
        title: editTitle.trim(),
        notes: editNotes.trim() || null,
        status: editStatus,
        ...(canEditEpicLinks
          ? {
              jira_url: editJiraUrl.trim() || "#",
              confluence_url: editConfluenceUrl.trim() || "",
              ...(hideKanbanUi ? {} : { kanban_url: editKanbanUrl.trim() || null }),
              design_url: editDesignUrl.trim() || null,
              lead_analyst_id: optionalUserIdFromRef(editLeadAnalystId),
              lead_designer_id: optionalUserIdFromRef(editLeadDesignerId),
              expert_id: null,
              start_date: editStartDate.trim() || null,
              target_date: editTargetDate.trim() || null,
            }
          : {}),
      });
      toast.success("Эпик обновлён");
      setEditEpicOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  };

  const saveDraftChecklist = async () => {
    if (!numericId) return;
    const cleaned = draftPlanRows
      .map((r) => ({ ...r, title: r.title.trim() }))
      .filter((r) => r.title.length > 0);
    try {
      await updateEpicQa.mutateAsync({
        test_plan_items: cleaned.map((i) => ({
          id: i.id,
          title: i.title,
          description_markdown: i.description_markdown ?? "",
          is_checked: Boolean(i.is_checked),
          comment: i.comment ?? "",
        })),
      });
      toast.success("Чеклист сохранён");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  };

  const removeEpic = async () => {
    if (!numericId) return;
    try {
      await deleteEpic.mutateAsync(numericId);
      toast.success("Эпик удалён");
      setDeleteEpicOpen(false);
      setLocation("/epics");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить эпик");
    }
  };

  const runStatusColor: Record<string, string> = { passed: "text-emerald-400", failed: "text-red-400", running: "text-amber-400" };
  const runStatusLabel: Record<string, string> = { passed: "Успешно", failed: "Упал", running: "Выполняется" };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/epics">
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft size={13} /> Эпики
        </button>
      </Link>

      {/* Hero */}
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 mb-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-sm text-muted-foreground font-mono">{epic.id}</span>
              <ProjectBadge projectId={epic.projectId} />
            </div>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h1 className="text-base md:text-lg font-semibold text-foreground flex-1 min-w-0">{epic.name}</h1>
              {((canEditEpicLinks && numericId && apiEpic) || epic.blockers.length > 0) && (
                <div className="flex flex-shrink-0 items-center gap-2 flex-wrap justify-end">
                  {canEditEpicLinks && numericId && apiEpic && (
                    <button
                      type="button"
                      onClick={() => setEditEpicOpen(true)}
                      className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      data-testid="button-edit-epic"
                    >
                      <Pencil size={12} />
                      Изменить
                    </button>
                  )}
                  {epic.blockers.length > 0 && (
                    <div className="flex h-7 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5">
                      <AlertTriangle size={13} className="text-destructive" />
                      <span className="text-xs font-medium text-destructive">{epic.blockers.length} блок.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-foreground/75 leading-relaxed">{epic.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground mb-2">Статусы</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Эпик</p>
                <StatusBadge status={epic.epicStatus} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">QA</p>
                <StatusBadge status={currentQaStatus} />
              </div>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-2">Окружения</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {envs.map((env, i) => (
                <EnvironmentPill key={env} env={env} active={epic.activeEnvironment === env} done={completedUpTo > i && epic.activeEnvironment !== env} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-2">Тест-план</p>
            <ProgressBar value={epic.testCasesCompleted} total={epic.testCasesTotal} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4 order-2 lg:order-1">
          {/* Checklist */}
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">QA Чеклист</h3>
            </div>
            {isDraftQa && apiEpic && (
              <p className="text-[11px] text-muted-foreground mb-4">
                На этапе подготовки тест-плана пункты чеклиста могут редактировать все участники проекта.
              </p>
            )}
            {isExecutionQa && (
              <p className="text-[11px] text-muted-foreground mb-4">
                Отмечайте пункты по мере прохождения тестирования.
              </p>
            )}
            {isDraftQa && apiEpic && canAuthEdit && numericId
              ? (
                <div className="space-y-3">
                  {draftPlanRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">Пока нет пунктов — добавьте первый.</p>
                  )}
                  {draftPlanRows.map((row, idx) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-mono w-6 flex-shrink-0">{idx + 1}</span>
                      <input
                        value={row.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftPlanRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, title: v } : r)));
                        }}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40"
                        placeholder="Название пункта"
                        data-testid={`checklist-draft-title-${row.id}`}
                      />
                      <button
                        type="button"
                        onClick={() => setDraftPlanRows((prev) => prev.filter((r) => r.id !== row.id))}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-md border border-transparent hover:border-border"
                        aria-label="Удалить пункт"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setDraftPlanRows((prev) => [...prev, newEmptyPlanItem()])}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted/40"
                    >
                      <Plus size={12} />
                      Добавить пункт
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveDraftChecklist()}
                      disabled={updateEpicQa.isPending}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      data-testid="button-save-checklist"
                    >
                      {updateEpicQa.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                      Сохранить чеклист
                    </button>
                  </div>
                </div>
              )
              : isExecutionQa
              ? (
                <div className="space-y-5">
                  {allChecklist.map((group) => (
                    <div key={group.area}>
                      <p className="text-xs font-semibold text-foreground/80 mb-2">{group.area}</p>
                      <div className="space-y-2">
                        {group.items.map((item) => {
                          const checked = item.checked;
                          return (
                            <label
                              key={item.id}
                              className="flex items-center gap-2.5 cursor-pointer group"
                              data-testid={`checklist-${item.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => void toggleCheck(item.id, checked)}
                                disabled={toggleItem.isPending}
                                className="sr-only peer"
                              />
                              <span className="peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 rounded flex-shrink-0">
                                {checked
                                  ? <CheckSquare size={15} className="text-emerald-400" />
                                  : <Square size={15} className="text-muted-foreground" />}
                              </span>
                              <span className={`text-sm ${checked ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.text}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
              : (
                <div className="space-y-5">
                  {allChecklist.map((group) => (
                    <div key={group.area}>
                      <p className="text-xs font-semibold text-foreground/80 mb-2">{group.area}</p>
                      <div className="space-y-2">
                        {group.items.map((item) => {
                          const checked = item.checked;
                          return (
                            <div key={item.id} className="flex items-center gap-2.5 text-sm" data-testid={`checklist-readonly-${item.id}`}>
                              {checked
                                ? <CheckSquare size={15} className="text-emerald-400 flex-shrink-0" />
                                : <Square size={15} className="text-muted-foreground flex-shrink-0" />}
                              <span className={checked ? "text-muted-foreground line-through" : "text-foreground"}>{item.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Questions */}
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Вопросы</h3>
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{epicQuestionsTotal}</span>
                {" "}
                привязано
              </span>
            </div>
            {epicTicketsQuery.isLoading && epicQuestions.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Загружаем вопросы...
              </div>
            ) : epicQuestions.length === 0 ? (
              <EmptyState icon={HelpCircle} title="Вопросов нет" description="К этому эпику пока не привязаны вопросы" />
            ) : (
              <div className="space-y-2">
                {epicQuestions.map((q) => (
                  <Link key={q.id} href={`/questions/${q.id}`}>
                    <div className="rounded-lg border border-border bg-background/40 p-3 transition-colors hover:border-primary/40 hover:bg-accent/30" data-testid={`epic-question-${q.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">{q.id}</span>
                            <p className="text-sm text-foreground line-clamp-2">{q.title}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge status={q.status} size="sm" />
                            <PriorityBadge priority={q.priority} />
                            <QuestionStagnationBadge updatedAt={q.updatedAt} />
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <UserAvatar userId={q.assigneeId} size="sm" />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDate(q.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {epicQuestionsTotal > epicQuestions.length && (
                  <Link href={`/questions?epic_id=${numericId}`}>
                    <span className="block pt-2 text-xs text-primary hover:underline">Все вопросы эпика</span>
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Test Runs */}
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Тест-раны</h3>
              {canManageTestRuns && availableTestRunEnvs.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_130px_minmax(160px,1fr)_auto] sm:items-center">
                  <Select value={effectiveTestRunEnv ?? "test"} onValueChange={(v) => setTestRunEnv(v as EpicTestStage)}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-test-run-env">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTestRunEnvs.map((env) => (
                        <SelectItem key={env} value={env}>
                          {testRunEnvironmentLabels[env] ?? env.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={testRunStatus} onValueChange={(v) => setTestRunStatus(v as TestRunStatus)}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-test-run-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {testRunStatusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    value={testRunUrl}
                    onChange={(e) => setTestRunUrl(e.target.value)}
                    placeholder="Ссылка *"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    required
                    data-testid="input-test-run-url"
                  />
                  <button
                    type="button"
                    onClick={() => void addTestRun()}
                    disabled={createTestRun.isPending || !testRunUrl.trim()}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
                    data-testid="button-add-test-run"
                  >
                    {createTestRun.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    Добавить
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">ID</th>
                    <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Окружение</th>
                    <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Статус</th>
                    <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Дата</th>
                    <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {testRuns.map(tr => (
                    <tr key={tr.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 text-xs text-muted-foreground font-mono">{tr.id}</td>
                      <td className="py-2 text-xs text-foreground">{tr.env}</td>
                      <td className="py-2">
                        {canManageTestRuns ? (
                          <Select
                            value={tr.status as TestRunStatus}
                            onValueChange={(v) => void changeTestRunStatus(tr.id, v as TestRunStatus)}
                            disabled={updateTestRun.isPending}
                          >
                            <SelectTrigger className="h-8 w-36 text-xs" data-testid={`select-test-run-status-${tr.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {testRunStatusOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className={`text-xs font-medium ${runStatusColor[tr.status] ?? "text-muted-foreground"}`}>
                            {runStatusLabel[tr.status] ?? tr.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(tr.date)}</td>
                      <td className="py-2">
                        <a href={tr.link} className="text-xs text-primary hover:underline flex items-center gap-0.5" target="_blank" rel="noreferrer">
                          <ExternalLink size={10} /> Открыть
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Comments */}
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Комментарии</h3>
            {allComments.length === 0
              ? <p className="text-sm text-muted-foreground">Комментариев нет</p>
              : (
                <div className="space-y-4 mb-4">
                  {allComments.map(c => {
                    const author = users.find(u => u.id === c.authorId);
                    return (
                      <div key={c.id} className="flex gap-3">
                        <UserAvatar userId={c.authorId} size="sm" />
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {author ? (
                              <Link href={`/users/${refIdToNumeric(author.id) ?? author.id}`}>
                                <span className="text-xs font-semibold text-foreground hover:underline">{author.name}</span>
                              </Link>
                            ) : (
                              <span className="text-xs font-semibold text-foreground">{c.authorId}</span>
                            )}
                            <span className="text-[10px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                          </div>
                          <p className="text-sm text-foreground/85">{c.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            <div className="pt-3 border-t border-border">
              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Добавить комментарий..." rows={2}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
                data-testid="textarea-epic-comment" />
              <button
                onClick={addComment}
                disabled={addEpicComment.isPending}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 disabled:opacity-70"
                data-testid="button-add-comment"
              >
                {addEpicComment.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Отправить
              </button>
            </div>
          </div>

          {/* History */}
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">История</h3>
            <Timeline events={history} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 order-1 lg:order-2">
          {canTransitionQaStatus && qaActions.length > 0 && (
            <div className="bg-card border border-primary/20 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">QA-статус тестирования</h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                Управляет прохождением тестирования и не меняет общий статус эпика.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {qaActions.map((a) => (
                  <button
                    key={a.next}
                    onClick={() => transitionTo(a.next as RefQAStatus, a.next)}
                    disabled={transitionQA.isPending}
                    className="py-2 px-3 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors text-left disabled:opacity-70"
                    data-testid={`qa-action-${a.next.replace(/\s/g, "-")}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ответственные</h3>
            {[["Лид аналитики", epic.leadAnalystId], ["Лид дизайна", epic.leadDesignerId]].map(([role, uid]) => {
              const user = users.find(u => u.id === uid);
              return (
                <div key={role as string} className="flex items-center gap-2">
                  <UserAvatar userId={uid as string} size="sm" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">{role as string}</p>
                    {user ? (
                      <Link href={`/users/${refIdToNumeric(user.id) ?? user.id}`}>
                        <span className="text-xs text-foreground font-medium hover:underline">{user.name}</span>
                      </Link>
                    ) : (
                      <p className="text-xs text-foreground font-medium">{uid as string}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ссылки</h3>
            {(hideKanbanUi
              ? [["Jira Epic", epic.jiraLink], ["Figma/Design", epic.designLink]]
              : [["Jira Epic", epic.jiraLink], ["Kanban Board", epic.kanbanLink], ["Figma/Design", epic.designLink]]
            ).map(([l, href]) => (
              <a key={l as string} href={href as string} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                <ExternalLink size={12} className="flex-shrink-0" />
                <span>{l as string}</span>
              </a>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Сроки</h3>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
              <InfoItem icon={Calendar} label="Старт" value={formatDate(epic.startDate)} />
              <InfoItem icon={Calendar} label="Целевая дата" value={formatDate(epic.targetDate)} />
            </div>
          </div>

          {epic.blockers.length > 0 && (
            <div className="bg-card border border-destructive/20 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-destructive uppercase tracking-wide mb-3">Блокеры</h3>
              <div className="space-y-2.5">
                {epic.blockers.map(b => {
                  const reporter = users.find(u => u.id === b.reportedBy);
                  return (
                    <div key={b.id} className="text-sm">
                      <p className="text-foreground/90">{b.text}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">— {reporter?.name}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {epicQuestions.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Открытые вопросы ({epicQuestionsTotal})</h3>
              {epicQuestions.map(q => (
                <Link key={q.id} href={`/questions/${q.id}`}>
                  <div className="flex items-center gap-2 py-1.5 cursor-pointer hover:text-primary transition-colors">
                    <span className="text-[10px] text-muted-foreground font-mono">{q.id}</span>
                    <span className="text-xs text-foreground truncate">{q.title}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={editEpicOpen} onOpenChange={setEditEpicOpen}>
        <DialogContent className="sm:max-w-lg mx-4 max-h-[min(90vh,720px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактировать эпик</DialogTitle>
            <DialogDescription className="sr-only">Редактирование полей эпика: название, ссылки и даты.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Основное</p>
              <div>
                <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-title">Название</label>
                <input
                  id="epic-edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-notes">Описание / заметки</label>
                <textarea
                  id="epic-edit-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              {canEditEpicLinks && (
                <div>
                  <label className="text-[11px] text-muted-foreground font-medium block mb-1">Статус эпика</label>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Общий жизненный цикл эпика: новый, в работе или выпущен. QA-статус меняется отдельно на странице эпика.
                  </p>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as EpicStatus)}>
                    <SelectTrigger className="text-sm" data-testid="select-edit-epic-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Новый</SelectItem>
                      <SelectItem value="in-progress">В работе</SelectItem>
                      <SelectItem value="released">Выпущен</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Ссылки</p>
              {canEditEpicLinks
                ? (
                  <>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-jira">Jira</label>
                        <input
                          id="epic-edit-jira"
                          value={editJiraUrl}
                          onChange={(e) => setEditJiraUrl(e.target.value)}
                          placeholder="https://…"
                          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-conf">Confluence</label>
                        <input
                          id="epic-edit-conf"
                          value={editConfluenceUrl}
                          onChange={(e) => setEditConfluenceUrl(e.target.value)}
                          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                      {!hideKanbanUi && (
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-kanban">Kanban</label>
                        <input
                          id="epic-edit-kanban"
                          value={editKanbanUrl}
                          onChange={(e) => setEditKanbanUrl(e.target.value)}
                          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                      )}
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-design">Дизайн (Figma и т.п.)</label>
                        <input
                          id="epic-edit-design"
                          value={editDesignUrl}
                          onChange={(e) => setEditDesignUrl(e.target.value)}
                          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-start">Старт</label>
                          <div className="mt-1">
                            <DatePickerButton value={editStartDate} onChange={setEditStartDate} testId="input-edit-epic-start-date" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground font-medium" htmlFor="epic-edit-target">Целевая дата</label>
                          <div className="mt-1">
                            <DatePickerButton value={editTargetDate} onChange={setEditTargetDate} testId="input-edit-epic-target-date" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )
                : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Ссылки может менять администратор или менеджер с доступом к этому проекту. Сейчас они заданы в карточке эпика ниже.
                  </p>
                )}
            </div>

            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Ответственные</p>
              {canEditEpicLinks
                ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground font-medium block mb-1">Лид аналитики</label>
                      <Select value={editLeadAnalystId} onValueChange={setEditLeadAnalystId}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground font-medium block mb-1">Лид дизайна</label>
                      <Select value={editLeadDesignerId} onValueChange={setEditLeadDesignerId}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )
                : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Ответственных может менять администратор или менеджер проекта. Текущие лица отображаются в боковой панели страницы.
                  </p>
                )}
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-0">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {me?.role === "admin" && numericId && apiEpic && (
                <button
                  type="button"
                  onClick={() => {
                    setEditEpicOpen(false);
                    setDeleteEpicOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-md"
                  data-testid="button-delete-epic"
                >
                  <Trash2 size={14} />
                  Удалить эпик
                </button>
              )}
            </div>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setEditEpicOpen(false)}
                className="px-3 py-2 text-xs font-medium rounded-md border border-border hover:bg-muted/50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void saveEpicDetails()}
                disabled={updateEpic.isPending}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {updateEpic.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                Сохранить
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEpicOpen} onOpenChange={setDeleteEpicOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить эпик?</AlertDialogTitle>
            <AlertDialogDescription>
              Эпик «{epic.name}» и связанные QA-данные будут удалены без восстановления. Тикеты останутся в системе, связь с эпиком будет снята.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteEpic.isPending}>Отмена</AlertDialogCancel>
            <button
              type="button"
              disabled={deleteEpic.isPending}
              onClick={() => void removeEpic()}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-70"
            >
              {deleteEpic.isPending && <Loader2 size={14} className="animate-spin" />}
              Удалить
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-muted-foreground flex-shrink-0" />
      <span className="text-[10px] text-muted-foreground">{label}:</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}
