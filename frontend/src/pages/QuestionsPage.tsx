import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Loader2, Plus } from "lucide-react";

import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useDataBridgeVersion } from "@/data/_bridge";
import { epics } from "@/data/epics";
import { Priority, Question, QuestionStatus } from "@/data/questions";
import { projects } from "@/data/projects";
import { useQuestionDraftPresence } from "@/hooks/useQuestionDraftPresence";
import { formatDayMonth } from "@/lib/formatDateTime";
import { mapApiTicketToRefQuestion, refIdToNumeric } from "@/lib/mappers";
import {
  buildSavedViewTicketParams,
  normalizeQuestionView,
  QUESTION_SAVED_VIEWS,
  type QuestionSavedViewId,
} from "@/lib/questionViews";
import { useTickets } from "@/lib/queries";
import { Link, useLocation, useSearchParams } from "@/lib/router";
import { clearQuestionDraft } from "@/lib/questionDraftStorage";
import { cn } from "@/lib/utils";

const statuses: QuestionStatus[] = ["На проверке", "У эксперта", "На уточнении", "Ожидает автора", "Закрыт", "Отменён"];
const priorities: Priority[] = ["Критический", "Высокий", "Средний", "Низкий"];
const PAGE_SIZE = 25;
const PREVIEW_DELAY_MS = 2000;
const PREVIEW_LEN = 120;
const PREVIEW_MAX_W = 288;
const PREVIEW_GAP = 10;
const PREVIEW_EST_HEIGHT = 130;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable || Boolean(target.closest("[cmdk-root]"));
}

function isCreateQuestionHotkey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return event.code === "KeyC" || key === "c" || key === "с";
}

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
  const clipped = flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1)}...` : flat;

  return (
    <div className="rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">Последнее сообщение</p>
      {last ? (
        <div className="flex items-start gap-2">
          <UserAvatar userId={last.authorId} size="sm" />
          <p className="break-words text-[11px] leading-snug text-foreground/90">{clipped || "-"}</p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Сообщений пока нет</p>
      )}
    </div>
  );
}

function QuestionMobileCard({ q, active }: { q: Question; active: boolean }) {
  return (
    <Link href={`/questions/${q.id}`}>
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-primary/40",
          active && "border-primary/50 bg-primary/5",
        )}
        data-testid={`question-card-${q.id}`}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{q.id}</span>
              <PriorityBadge priority={q.priority} showLabel={false} />
            </div>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{q.title}</p>
          </div>
          <UserAvatar userId={q.assigneeId} size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={q.status} size="sm" />
          <ProjectBadge projectId={q.projectId} />
          <QuestionStagnationBadge updatedAt={q.updatedAt} />
          <span className="ml-auto text-[10px] text-muted-foreground">{formatDayMonth(q.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function QuestionsTableRow({
  q,
  active,
  onActivate,
}: {
  q: Question;
  active: boolean;
  onActivate: () => void;
}) {
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
        className={cn(
          "h-9 border-b border-border/50 last:border-0 hover:bg-accent/35",
          active && "bg-accent/35 outline outline-1 outline-primary/25",
        )}
        onMouseEnter={(event) => {
          if (!active) onActivate();
          preview.onEnter(event);
        }}
        onMouseLeave={preview.onLeave}
        onMouseMove={preview.onPointer}
        data-testid={`question-row-${q.id}`}
      >
        <td className="w-16 px-2.5 py-0">
          <Link href={`/questions/${q.id}`}>
            <span className="font-mono text-[11px] text-muted-foreground hover:text-primary">{q.id}</span>
          </Link>
        </td>
        <td className="w-28 px-2.5 py-0">
          <StatusBadge status={q.status} size="sm" />
        </td>
        <td className="w-20 px-2.5 py-0">
          <PriorityBadge priority={q.priority} />
        </td>
        <td className="max-w-0 px-2.5 py-0">
          <Link href={`/questions/${q.id}`}>
            <span className="block truncate text-sm font-medium text-foreground hover:text-primary">{q.title}</span>
          </Link>
        </td>
        <td className="w-28 px-2.5 py-0">
          <ProjectBadge projectId={q.projectId} />
        </td>
        <td className="w-20 px-2.5 py-0">
          <UserAvatar userId={q.assigneeId} size="sm" />
        </td>
        <td className="w-20 whitespace-nowrap px-2.5 py-0 text-xs text-muted-foreground">{formatDayMonth(q.updatedAt)}</td>
        <td className="w-24 px-2.5 py-0">
          <QuestionStagnationBadge updatedAt={q.updatedAt} />
        </td>
      </tr>
      {portal}
    </>
  );
}

function QuestionRowsSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border/50 px-2.5 py-1.5 last:border-0">
          <div className="h-3 w-12 rounded bg-muted" />
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="h-5 w-20 rounded bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted" />
          <div className="h-5 w-20 rounded bg-muted" />
          <div className="h-6 w-6 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

export default function QuestionsPage() {
  useDataBridgeVersion();
  const { me } = useAuth();
  const draftUserId = me?.id ?? null;
  const hasQuestionDraft = useQuestionDraftPresence(draftUserId);
  const [searchParams] = useSearchParams();
  const [, setLocation] = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const initialEpicId = Number.parseInt(searchParams.get("epic_id") ?? "", 10);
  const authorMeFromUrl = searchParams.get("author") === "me";
  const savedView = normalizeQuestionView(searchParams.get("view"));

  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | "all">(savedView.status ?? "all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [mineOnly, setMineOnly] = useState(Boolean(savedView.mineOnly) || authorMeFromUrl);
  const [sortBy, setSortBy] = useState<"date" | "stagnation" | "priority">(savedView.sort);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setStatusFilter(savedView.status ?? "all");
    setMineOnly(Boolean(savedView.mineOnly) || authorMeFromUrl);
    setSortBy(savedView.sort);
    setPage(1);
    setActiveIndex(0);
  }, [authorMeFromUrl, savedView.id, savedView.mineOnly, savedView.sort, savedView.status]);

  useEffect(() => {
    setPage(1);
    setActiveIndex(0);
  }, [projectFilter, statusFilter, priorityFilter, mineOnly, sortBy, search]);

  const projectId = projectFilter === "all" ? undefined : refIdToNumeric(projectFilter) ?? undefined;
  const queryParams = buildSavedViewTicketParams(savedView, {
    meId: authorMeFromUrl ? null : mineOnly ? me?.id : null,
    projectId,
    status: statusFilter,
    priority: priorityFilter,
    search,
    sort: sortBy,
    page,
    pageSize: PAGE_SIZE,
  });

  if (authorMeFromUrl && me?.id) {
    queryParams.author_id = me.id;
  }
  if (Number.isFinite(initialEpicId) && initialEpicId > 0) {
    queryParams.epic_id = initialEpicId;
  }

  const ticketsQuery = useTickets(queryParams);
  const blockedEpicIds = useMemo(
    () => new Set(epics.filter((epic) => epic.blockers.length > 0).map((epic) => epic.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epics.length],
  );
  const mappedQuestions = (ticketsQuery.data?.items ?? []).map(mapApiTicketToRefQuestion);
  const pageQuestions =
    savedView.localFilter === "blocked"
      ? mappedQuestions.filter((question) => question.epicId && blockedEpicIds.has(question.epicId))
      : mappedQuestions;
  const totalQuestions = savedView.localFilter === "blocked" ? pageQuestions.length : ticketsQuery.data?.total ?? 0;
  const totalPages = savedView.localFilter === "blocked" ? 1 : Math.max(1, Math.ceil(totalQuestions / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleCount = pageQuestions.length;

  useEffect(() => {
    setActiveIndex((value) => Math.min(Math.max(value, 0), Math.max(0, pageQuestions.length - 1)));
  }, [pageQuestions.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.code === "KeyJ") {
        event.preventDefault();
        setActiveIndex((value) => Math.min(pageQuestions.length - 1, value + 1));
      } else if (event.code === "KeyK") {
        event.preventDefault();
        setActiveIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter") {
        const question = pageQuestions[activeIndex];
        if (question) {
          event.preventDefault();
          setLocation(`/questions/${question.id}`);
        }
      } else if (event.code === "Slash") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (isCreateQuestionHotkey(event)) {
        event.preventDefault();
        setShowCreate(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, pageQuestions, setLocation]);

  const changeSavedView = (viewId: QuestionSavedViewId) => {
    const next = QUESTION_SAVED_VIEWS.find((view) => view.id === viewId) ?? QUESTION_SAVED_VIEWS[0];
    setLocation(next.href);
  };

  return (
    <div className="p-2 md:p-3">
      <h1 className="sr-only">Вопросы</h1>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{savedView.label}</p>
            <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {visibleCount} из {totalQuestions}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{savedView.description}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          data-testid="button-create-question"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Задать вопрос</span>
          <span className="sm:hidden">Создать</span>
        </button>
      </div>

      {draftUserId != null && hasQuestionDraft ? (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm"
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
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid="banner-question-draft-delete"
            >
              Удалить
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5">
        <Select value={savedView.id} onValueChange={(value) => changeSavedView(value as QuestionSavedViewId)}>
          <SelectTrigger className="h-7 w-40 text-xs" data-testid="select-question-view">
            <SelectValue placeholder="Представление" />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_SAVED_VIEWS.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Быстрый поиск..."
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
            data-testid="input-question-search"
          />
        </div>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-7 w-36 text-xs sm:w-44" data-testid="select-question-page-project">
            <SelectValue placeholder="Проект" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все проекты</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as QuestionStatus | "all")}>
          <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as Priority | "all")}>
          <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-priority-filter">
            <SelectValue placeholder="Приоритет" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все приоритеты</SelectItem>
            {priorities.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="inline-flex h-7 shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs">
          <Switch
            checked={mineOnly}
            onCheckedChange={setMineOnly}
            className="scale-90"
            data-testid="toggle-mine-filter"
          />
          <span className="whitespace-nowrap text-muted-foreground">На мне</span>
        </label>

        <Select value={sortBy} onValueChange={(value) => setSortBy(value as "date" | "stagnation" | "priority")}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">По дате</SelectItem>
            <SelectItem value="stagnation">Без движения</SelectItem>
            <SelectItem value="priority">По приоритету</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {ticketsQuery.isFetching && !ticketsQuery.data ? (
        <QuestionRowsSkeleton />
      ) : pageQuestions.length === 0 ? (
        <EmptyState
          icon={ticketsQuery.isFetching ? Loader2 : HelpCircle}
          title={ticketsQuery.isFetching ? "Загружаем вопросы" : "Вопросов не найдено"}
          description="Измените фильтры или создайте первый вопрос"
        />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {pageQuestions.map((question, index) => (
              <QuestionMobileCard key={question.id} q={question} active={index === activeIndex} />
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="questions-table">
                <thead>
                  <tr className="border-b border-border bg-muted/25">
                    <th className="w-16 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">ID</th>
                    <th className="w-28 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Статус</th>
                    <th className="w-20 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Приор.</th>
                    <th className="px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Заголовок</th>
                    <th className="w-28 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Проект</th>
                    <th className="w-20 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Ответств.</th>
                    <th className="w-20 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Обновлён</th>
                    <th className="w-24 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">Без движ.</th>
                  </tr>
                </thead>
                <tbody>
                  {pageQuestions.map((question, index) => (
                    <QuestionsTableRow
                      key={question.id}
                      q={question}
                      active={index === activeIndex}
                      onActivate={() => setActiveIndex(index)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {savedView.localFilter !== "blocked" ? (
            <ListPagination
              page={currentPage}
              pageSize={PAGE_SIZE}
              total={totalQuestions}
              isLoading={ticketsQuery.isFetching}
              onPageChange={setPage}
            />
          ) : null}
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
