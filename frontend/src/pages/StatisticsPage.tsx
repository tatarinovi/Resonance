import { useEffect, useState } from "react";
import type { Question } from "@/data/questions";
import { questions } from "@/data/questions";
import { epics } from "@/data/epics";
import { projects } from "@/data/projects";
import { users } from "@/data/users";
import { activityEvents } from "@/data/activity";
import { useReferenceData, useStatisticsSummary } from "@/lib/queries";
import { refIdToNumeric } from "@/lib/mappers";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { hoursSinceUpdated } from "@/lib/questionStagnation";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Link } from "@/lib/router";
import {
  HelpCircle,
  Layers,
  AlertTriangle,
  Clock,
  TrendingUp,
  Timer,
  MessageSquare,
  Filter,
  XCircle,
  BarChart3,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
}: {
  icon: typeof Clock;
  label: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${colorClass ?? "bg-muted"}`}>
          <Icon size={14} className="text-foreground/70" />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl md:text-3xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function formatDurationHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return "—";
  if (h < 1 / 60) return "< 1 мин";
  if (h < 1) return `${Math.round(h * 60)} мин`;
  if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)} ч`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} д`;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : ((s[m - 1]! + s[m]!) / 2);
}

/** Часы от создания тикета до первого сообщения не от автора вопроса (ответ команды). */
function firstTeamResponseHours(q: Question): number | null {
  const created = new Date(q.createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  const sorted = [...q.thread].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const first = sorted.find((m) => m.authorId !== q.authorId);
  if (!first) return null;
  const diffMs = new Date(first.createdAt).getTime() - created;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return diffMs / 3600000;
}

const Q_STATUS_ORDER = ["На проверке", "У эксперта", "На уточнении", "Ожидает автора", "Закрыт", "Отменён"] as const;

const EPIC_QA_ORDER = [
  "Подготовка тест-плана",
  "В тестировании",
  "Заблокировано",
  "TEST complete",
  "STAGE complete",
  "PROD complete",
  "Закрыто",
] as const;

export default function StatisticsPage() {
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const projectNumericId = projectFilter ? refIdToNumeric(projectFilter) : undefined;
  const epicNumericId = epicFilter ? refIdToNumeric(epicFilter) : undefined;
  const backendSummary = useStatisticsSummary({
    ...(projectNumericId ? { project_id: projectNumericId } : {}),
    ...(epicNumericId ? { epic_id: epicNumericId } : {}),
  });
  const reference = useReferenceData();
  const qStatusOrder = reference.data?.question_statuses?.length
    ? reference.data.question_statuses.map((option) => option.label)
    : [...Q_STATUS_ORDER];
  const epicQaOrder = reference.data?.qa_statuses?.length
    ? reference.data.qa_statuses.map((option) => option.label)
    : [...EPIC_QA_ORDER];

  const epicsForProject = projectFilter ? epics.filter((e) => e.projectId === projectFilter) : [];

  useEffect(() => {
    if (!projectFilter) {
      if (epicFilter != null) setEpicFilter(null);
      return;
    }
    if (!epicFilter) return;
    const epic = epics.find((e) => e.id === epicFilter);
    if (!epic || epic.projectId !== projectFilter) {
      setEpicFilter(null);
    }
  }, [projectFilter, epicFilter, epics.length]);

  let filteredQuestions = [...questions];
  if (projectFilter) filteredQuestions = filteredQuestions.filter((x) => x.projectId === projectFilter);
  if (epicFilter) filteredQuestions = filteredQuestions.filter((x) => x.epicId === epicFilter);

  let filteredEpics = [...epics];
  if (projectFilter) filteredEpics = filteredEpics.filter((ep) => ep.projectId === projectFilter);
  if (epicFilter) filteredEpics = filteredEpics.filter((ep) => ep.id === epicFilter);

  const qTotal = backendSummary.data?.questions_total ?? filteredQuestions.length;
  const qDenom = Math.max(qTotal, 1);

  const openQ = filteredQuestions.filter((q) => !["Закрыт", "Отменён"].includes(q.status));
  const closedQ = filteredQuestions.filter((q) => q.status === "Закрыт" || q.status === "Отменён");
  const longStagnantOpen = openQ.filter((q) => hoursSinceUpdated(q.updatedAt) > 48);
  const activeEpics = filteredEpics.filter((e) => e.epicStatus === "В работе");
  const blockedEpics = filteredEpics.filter((e) => e.blockers.length > 0);
  const openQCount = backendSummary.data?.questions_open ?? openQ.length;
  const closedQCount = backendSummary.data?.questions_closed ?? closedQ.length;
  const longStagnantOpenCount = backendSummary.data?.long_stagnant_open ?? longStagnantOpen.length;
  const activeEpicsCount = backendSummary.data?.active_epics ?? activeEpics.length;
  const blockedEpicsCount = backendSummary.data?.blocked_epics ?? blockedEpics.length;

  const responseHoursList = filteredQuestions
    .map(firstTeamResponseHours)
    .filter((h): h is number => h != null);
  const avgResponse =
    backendSummary.data?.avg_response_hours ??
    (responseHoursList.length > 0 ? responseHoursList.reduce((a, b) => a + b, 0) / responseHoursList.length : null);
  const medResponse = backendSummary.data?.median_response_hours ?? median(responseHoursList);

  const avgThreadMessages =
    backendSummary.data?.avg_thread_messages ?? (qTotal > 0 ? filteredQuestions.reduce((s, q) => s + q.thread.length, 0) / qTotal : null);

  const withTeamReply = backendSummary.data?.with_team_reply ?? filteredQuestions.filter((q) => firstTeamResponseHours(q) != null).length;

  const priorityOrder: Question["priority"][] = ["Критический", "Высокий", "Средний", "Низкий"];
  const priorityCounts = priorityOrder.map((p) => ({
    priority: p,
    count: backendSummary.data?.priority_counts?.[p] ?? filteredQuestions.filter((q) => q.priority === p).length,
  }));

  const testCasesTotal = filteredEpics.reduce((s, e) => s + e.testCasesTotal, 0);
  const testCasesDone = filteredEpics.reduce((s, e) => s + e.testCasesCompleted, 0);
  const testCoverage = {
    total: backendSummary.data?.test_coverage.total ?? testCasesTotal,
    done: backendSummary.data?.test_coverage.done ?? testCasesDone,
    pct: backendSummary.data?.test_coverage.pct ?? (testCasesTotal > 0 ? Math.round((testCasesDone / testCasesTotal) * 100) : null),
  };

  const qStatusCounts = qStatusOrder.map((s) => ({
    status: s,
    count: backendSummary.data?.question_status_counts?.[s] ?? filteredQuestions.filter((q) => q.status === s).length,
  }));

  const epicQaStatusCounts = epicQaOrder.map((s) => ({
    status: s,
    count: backendSummary.data?.epic_qa_status_counts?.[s] ?? filteredEpics.filter((e) => e.qaStatus === s).length,
  }));

  const fqIds = new Set(filteredQuestions.map((q) => q.id));
  const feIds = new Set(filteredEpics.map((e) => e.id));

  const filteredActivity = activityEvents.filter(
    (ev) =>
      (ev.targetType === "question" && fqIds.has(ev.targetId)) ||
      (ev.targetType === "epic" && feIds.has(ev.targetId)),
  );

  const userActivity = users
    .map((u) => ({
      user: u,
      count: filteredActivity.filter((e) => e.userId === u.id).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const filterActive = projectFilter != null || epicFilter != null;
  const filterSummary =
    !filterActive
      ? "Все проекты и эпики"
      : [
          projectFilter ? projects.find((p) => p.id === projectFilter)?.name ?? "Проект" : null,
          epicFilter ? epics.find((e) => e.id === epicFilter)?.name ?? "Эпик" : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Статистика</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Операционные метрики с фильтрами по области</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            <span className="inline-flex items-center gap-1">
              <Filter size={11} />
              {filterSummary}
            </span>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end w-full sm:w-auto">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1 min-w-[180px] flex-1 sm:flex-initial">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Проект</p>
              <Select
                value={projectFilter ?? "all"}
                onValueChange={(v) => {
                  setProjectFilter(v === "all" ? null : v);
                  setEpicFilter(null);
                }}
              >
                <SelectTrigger className="h-9" data-testid="stats-filter-project">
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
            </div>
            <div className="space-y-1 min-w-[200px] flex-1 sm:flex-initial">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Эпик</p>
              <Select
                value={epicFilter ?? "all"}
                onValueChange={(v) => setEpicFilter(v === "all" ? null : v)}
                disabled={!projectFilter || epicsForProject.length === 0}
              >
                <SelectTrigger className="h-9" data-testid="stats-filter-epic">
                  <SelectValue placeholder="Эпик" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все эпики выборки</SelectItem>
                  {epicsForProject.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterActive && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={() => {
                  setProjectFilter(null);
                  setEpicFilter(null);
                }}
                data-testid="stats-filter-reset"
              >
                <XCircle size={14} className="mr-1.5" />
                Сбросить
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard
          icon={HelpCircle}
          label="Открытых вопросов"
          value={openQCount}
          sub={`из ${qTotal} в выборке`}
          colorClass="bg-blue-500/15"
        />
        <StatCard
          icon={Clock}
          label="Долго без движения"
          value={longStagnantOpenCount}
          sub="открытые, >48 ч с последнего обновления"
          colorClass="bg-red-500/15"
        />
        <StatCard
          icon={Layers}
          label="Активных эпиков"
          value={activeEpicsCount}
          sub={`из ${filteredEpics.length} эпиков`}
          colorClass="bg-violet-500/15"
        />
        <StatCard
          icon={AlertTriangle}
          label="Эпиков с блокерами"
          value={blockedEpicsCount}
          colorClass="bg-amber-500/15"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={Timer}
          label="До 1-го ответа (медиана)"
          value={medResponse != null ? formatDurationHours(medResponse) : "—"}
          sub={
            responseHoursList.length > 0
              ? `по ${responseHoursList.length} из ${qTotal} вопросов`
              : "нет сообщений от команды в треде"
          }
          colorClass="bg-emerald-500/15"
        />
        <StatCard
          icon={Timer}
          label="До 1-го ответа (среднее)"
          value={avgResponse != null ? formatDurationHours(avgResponse) : "—"}
          sub="от создания до первого ответа не от автора"
          colorClass="bg-teal-500/15"
        />
        <StatCard
          icon={MessageSquare}
          label="С ответом команды"
          value={qTotal > 0 ? `${Math.round((withTeamReply / qTotal) * 100)}%` : "—"}
          sub={`${withTeamReply} из ${qTotal} вопросов`}
          colorClass="bg-cyan-500/15"
        />
        <StatCard
          icon={BarChart3}
          label="Закрыто / всего"
          value={qTotal > 0 ? `${closedQCount} / ${qTotal}` : "—"}
          sub={qTotal > 0 ? `${Math.round((closedQCount / qTotal) * 100)}% завершено` : undefined}
          colorClass="bg-slate-500/15"
        />
      </div>

      {(avgThreadMessages != null || testCoverage.total > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {avgThreadMessages != null && (
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Сообщений в обсуждении</p>
                  <p className="text-[11px] text-muted-foreground">Среднее на вопрос в выборке</p>
                </div>
              </div>
              <span className="text-lg font-semibold tabular-nums">{avgThreadMessages.toFixed(1)}</span>
            </div>
          )}
          {testCoverage.total > 0 && (
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Пункты тест-плана</p>
                  <p className="text-[11px] text-muted-foreground">Эпиков в выборке: {filteredEpics.length}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-lg font-semibold tabular-nums">
                  {testCoverage.done}/{testCoverage.total}
                </span>
                {testCoverage.pct != null && (
                  <p className="text-[11px] text-muted-foreground">{testCoverage.pct}% готово</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {priorityCounts.some((p) => p.count > 0) && (
        <div className="bg-card border border-border rounded-xl p-4 mb-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Вопросы по приоритету
          </h3>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {priorityCounts
              .filter((p) => p.count > 0)
              .map((p) => (
                <div key={p.priority} className="flex items-center gap-2 min-w-[140px]">
                  <span className="text-xs text-foreground w-24 truncate">{p.priority}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[48px]">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{ width: `${(p.count / qDenom) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums w-6 text-right">{p.count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Вопросы по статусам</h3>
          <div className="space-y-2">
            {qTotal === 0 ? (
              <p className="text-sm text-muted-foreground">Нет вопросов в выборке</p>
            ) : (
              qStatusCounts
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div key={s.status} className="flex items-center justify-between py-1">
                    <StatusBadge status={s.status as Question["status"]} size="sm" />
                    <div className="flex items-center gap-2">
                      <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{ width: `${(s.count / qDenom) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-foreground w-5 text-right">{s.count}</span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Эпики по QA-статусам</h3>
          <div className="space-y-2">
            {filteredEpics.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет эпиков в выборке</p>
            ) : (
              epicQaStatusCounts
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div key={s.status} className="flex items-center justify-between py-1">
                    <StatusBadge status={s.status as any} size="sm" />
                    <span className="text-sm font-semibold text-foreground">{s.count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Топ-5 активных</h3>
          <div className="space-y-3">
            {userActivity.every((ua) => ua.count === 0) ? (
              <p className="text-sm text-muted-foreground">Нет событий по выборке</p>
            ) : (
              userActivity.map((ua, i) => (
                <div key={ua.user.id} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-4">{i + 1}</span>
                  <UserAvatar userId={ua.user.id} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{ua.user.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ua.user.role}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <TrendingUp size={11} className="text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">{ua.count}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {longStagnantOpen.length > 0 && (
        <div className="bg-card border border-red-500/20 rounded-xl p-4 md:p-5">
          <h3 className="text-xs font-semibold text-destructive uppercase tracking-wide mb-4">Долго без движения</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">ID</th>
                  <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Заголовок</th>
                  <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Статус</th>
                  <th className="text-left pb-2 text-[11px] text-muted-foreground font-medium">Без движения</th>
                </tr>
              </thead>
              <tbody>
                {longStagnantOpen.map((q) => (
                  <tr key={q.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5">
                      <Link href={`/questions/${q.id}`}>
                        <span className="text-[11px] text-muted-foreground font-mono hover:text-primary cursor-pointer">
                          {q.id}
                        </span>
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <Link href={`/questions/${q.id}`}>
                        <span className="text-sm text-foreground hover:text-primary cursor-pointer">{q.title}</span>
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={q.status} size="sm" />
                    </td>
                    <td className="py-2.5">
                      <QuestionStagnationBadge updatedAt={q.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
