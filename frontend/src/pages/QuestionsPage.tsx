import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "@/lib/router";
import { type Question, QuestionStatus, Priority } from "@/data/questions";
import { projects } from "@/data/projects";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { HelpCircle, Loader2, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useQuestionDraftPresence } from "@/hooks/useQuestionDraftPresence";
import { clearQuestionDraft } from "@/lib/questionDraftStorage";
import { formatDayMonth } from "@/lib/formatDateTime";
import { mapApiTicketToRefQuestion, PRIORITY_FROM_REF, refIdToNumeric, STATUS_FROM_REF } from "@/lib/mappers";
import { useTickets } from "@/lib/queries";

const statuses: QuestionStatus[] = ["На проверке", "У эксперта", "На уточнении", "Ожидает автора", "Закрыт", "Отменён"];
const priorities: Priority[] = ["Критический", "Высокий", "Средний", "Низкий"];

const PREVIEW_DELAY_MS = 2000;
const PREVIEW_LEN = 120;
const PREVIEW_MAX_W = 288;
const PREVIEW_GAP = 10;
const PAGE_SIZE = 25;
/** Оценка высоты панели для сдвига вверх, если снизу не хватает места */
const PREVIEW_EST_HEIGHT = 130;

function previewPanelStyle(point: { x: number; y: number }): CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = Math.min(PREVIEW_MAX_W, vw - 16);
  let left = point.x + PREVIEW_GAP;
  let top = point.y + PREVIEW_GAP;
  if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
  if (left < 8) left = 8;
  if (top + PREVIEW_EST_HEIGHT > vh - 8) top = Math.max(8, point.y - PREVIEW_EST_HEIGHT - PREVIEW_GAP);
  if (top < 8) top = 8;
  return {
    position: "fixed",
    left,
    top,
    width,
    zIndex: 100,
    pointerEvents: "none",
  };
}

function useDelayedPreview(delayMs: number) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef({ x: 0, y: 0 });

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onPointer = useCallback((e: MouseEvent) => {
    latestRef.current = { x: e.clientX, y: e.clientY };
    setPoint(latestRef.current);
  }, []);

  const onEnter = useCallback(
    (e: MouseEvent) => {
      latestRef.current = { x: e.clientX, y: e.clientY };
      setPoint(latestRef.current);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setPoint(latestRef.current);
        setOpen(true);
      }, delayMs);
    },
    [clearTimer, delayMs],
  );

  const onLeave = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  return { open, point, onEnter, onLeave, onPointer };
}

function ThreadPreviewPanel({ thread }: { thread: Question["thread"] }) {
  const last = thread.length ? thread[thread.length - 1] : null;
  const flat = last ? last.text.replace(/\s+/g, " ").trim() : "";
  const clipped = flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1)}…` : flat;

  return (
    <div className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-2.5 text-xs">
      <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Последнее сообщение</p>
      {last ? (
        <div className="flex gap-2 items-start">
          <UserAvatar userId={last.authorId} size="sm" />
          <p className="text-[11px] text-foreground/90 leading-snug break-words">{clipped || "—"}</p>
        </div>
      ) : (
        <p className="text-muted-foreground text-[11px]">Сообщений пока нет</p>
      )}
    </div>
  );
}

function QuestionCard({ q }: { q: Question }) {
  const preview = useDelayedPreview(PREVIEW_DELAY_MS);

  const portal =
    preview.open &&
    createPortal(
      <div style={previewPanelStyle(preview.point)}>
        <ThreadPreviewPanel thread={q.thread} />
      </div>,
      document.body,
    );

  return (
    <div
      className="relative"
      onMouseEnter={preview.onEnter}
      onMouseLeave={preview.onLeave}
      onMouseMove={preview.onPointer}
    >
      <Link href={`/questions/${q.id}`}>
        <div
          className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-card hover:border-primary/40 cursor-pointer transition-colors"
          data-testid={`question-card-${q.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">{q.id}</span>
              <p className="text-sm text-foreground line-clamp-2 leading-snug">{q.title}</p>
            </div>
            <PriorityBadge priority={q.priority} showLabel={false} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={q.status} size="sm" />
            <ProjectBadge projectId={q.projectId} />
            <QuestionStagnationBadge updatedAt={q.updatedAt} />
            <div className="ml-auto flex items-center gap-1">
              <UserAvatar userId={q.assigneeId} size="sm" />
              <span className="text-[10px] text-muted-foreground">{formatDayMonth(q.updatedAt)}</span>
            </div>
          </div>
        </div>
      </Link>
      {portal}
    </div>
  );
}

function QuestionsTableRow({ q, striped }: { q: Question; striped: boolean }) {
  const preview = useDelayedPreview(PREVIEW_DELAY_MS);

  const portal =
    preview.open &&
    createPortal(
      <div style={previewPanelStyle(preview.point)}>
        <ThreadPreviewPanel thread={q.thread} />
      </div>,
      document.body,
    );

  return (
    <>
      <tr
        onMouseEnter={preview.onEnter}
        onMouseLeave={preview.onLeave}
        onMouseMove={preview.onPointer}
        className={`border-b border-border/50 last:border-0 hover:bg-accent/40 cursor-pointer transition-colors ${striped ? "bg-muted/10" : ""}`}
        data-testid={`question-row-${q.id}`}
      >
        <td className="px-3 py-2.5">
          <Link href={`/questions/${q.id}`}>
            <span className="text-[11px] text-muted-foreground font-mono hover:text-primary">{q.id}</span>
          </Link>
        </td>
        <td className="px-3 py-2.5 max-w-0">
          <Link href={`/questions/${q.id}`}>
            <span className="text-sm text-foreground hover:text-primary cursor-pointer truncate block">{q.title}</span>
          </Link>
        </td>
        <td className="px-3 py-2.5">
          <StatusBadge status={q.status} size="sm" />
        </td>
        <td className="px-3 py-2.5">
          <PriorityBadge priority={q.priority} />
        </td>
        <td className="px-3 py-2.5">
          <ProjectBadge projectId={q.projectId} />
        </td>
        <td className="px-3 py-2.5">
          <UserAvatar userId={q.assigneeId} size="sm" />
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDayMonth(q.updatedAt)}</td>
        <td className="px-3 py-2.5">
          <QuestionStagnationBadge updatedAt={q.updatedAt} />
        </td>
      </tr>
      {portal}
    </>
  );
}

export default function QuestionsPage() {
  const { me } = useAuth();
  const draftUserId = me?.id ?? null;
  const hasQuestionDraft = useQuestionDraftPresence(draftUserId);
  const initialSearch = new URLSearchParams(window.location.search);
  const initialEpicId = Number.parseInt(initialSearch.get("epic_id") ?? "", 10);
  const authorMeFromUrl = initialSearch.get("author") === "me";

  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [mineOnly, setMineOnly] = useState(authorMeFromUrl);
  const [sortBy, setSortBy] = useState<"date" | "stagnation" | "priority">("date");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, statusFilter, priorityFilter, mineOnly, sortBy]);

  const projectId = projectFilter === "all" ? undefined : refIdToNumeric(projectFilter) ?? undefined;
  const ticketsQuery = useTickets({
    page,
    page_size: PAGE_SIZE,
    project_id: projectId,
    status: statusFilter === "all" ? undefined : STATUS_FROM_REF[statusFilter as QuestionStatus],
    priority: priorityFilter === "all" ? undefined : PRIORITY_FROM_REF[priorityFilter as Priority],
    assignee_id: mineOnly && !authorMeFromUrl && me ? me.id : undefined,
    author_id: authorMeFromUrl && me ? me.id : undefined,
    epic_id: Number.isFinite(initialEpicId) && initialEpicId > 0 ? initialEpicId : undefined,
    sort: sortBy === "date" ? "-updated_at" : sortBy === "stagnation" ? "updated_at" : "priority",
  });

  const pageQuestions = (ticketsQuery.data?.items ?? []).map(mapApiTicketToRefQuestion);
  const totalQuestions = ticketsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalQuestions / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const shownFrom = totalQuestions === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const shownTo = Math.min(currentPage * PAGE_SIZE, totalQuestions);

  return (
    <div className="p-4 md:p-6">
      <h1 className="sr-only">Вопросы</h1>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          <span className="text-lg font-semibold tabular-nums text-foreground">{totalQuestions}</span> вопросов
          {totalQuestions > 0 && (
            <span className="ml-2 text-xs">показано {shownFrom}-{shownTo}</span>
          )}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          data-testid="button-create-question"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Задать вопрос</span>
          <span className="sm:hidden">Создать</span>
        </button>
      </div>

      {draftUserId != null && hasQuestionDraft ? (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm"
          data-testid="banner-question-draft"
        >
          <p className="text-muted-foreground">Есть несохранённый черновик вопроса в этом браузере.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="text-xs font-medium text-primary hover:underline"
              data-testid="banner-question-draft-open"
            >
              Открыть
            </button>
            <button
              type="button"
              onClick={() => clearQuestionDraft(draftUserId)}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
              data-testid="banner-question-draft-delete"
            >
              Удалить
            </button>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-7 text-xs w-36 sm:w-44" data-testid="select-question-page-project">
            <SelectValue placeholder="Проект" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все проекты</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 text-xs w-32 sm:w-36" data-testid="select-status-filter">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-7 text-xs w-[8.5rem] sm:w-36" data-testid="select-priority-filter">
            <SelectValue placeholder="Приоритет" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все приоритеты</SelectItem>
            {priorities.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="inline-flex items-center gap-2 h-7 px-2.5 rounded-md border border-border bg-background text-xs shrink-0 cursor-pointer select-none">
          <Switch
            checked={mineOnly}
            onCheckedChange={setMineOnly}
            className="scale-90"
            data-testid="toggle-mine-filter"
          />
          <span className="text-muted-foreground whitespace-nowrap">На мне</span>
        </label>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as "date" | "stagnation" | "priority")}>
          <SelectTrigger className="h-7 text-xs w-28 sm:w-32 ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">По дате</SelectItem>
            <SelectItem value="stagnation">По времени без движения</SelectItem>
            <SelectItem value="priority">По приоритету</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mobile: card list */}
      {ticketsQuery.isFetching && !ticketsQuery.data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 size={16} className="animate-spin" />
          Загружаем вопросы...
        </div>
      ) : pageQuestions.length === 0 ? (
        <EmptyState icon={HelpCircle} title="Вопросов не найдено" description="Измените фильтры или создайте первый вопрос" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {pageQuestions.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="questions-table">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-16">ID</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground">Заголовок</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-32">Статус</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-24">Приоритет</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-28">Проект</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-24">Ответств.</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-20">Обновлён</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-24">Без движ.</th>
                  </tr>
                </thead>
                <tbody>
                  {pageQuestions.map((q, idx) => (
                    <QuestionsTableRow key={q.id} q={q} striped={idx % 2 === 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ListPagination page={currentPage} pageSize={PAGE_SIZE} total={totalQuestions} isLoading={ticketsQuery.isFetching} onPageChange={setPage} />
        </>
      )}

      <CreateQuestionDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        defaultProjectRefId={projectFilter === "all" ? null : projectFilter}
      />
    </div>
  );
}
