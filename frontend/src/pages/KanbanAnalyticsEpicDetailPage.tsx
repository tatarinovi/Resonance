import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart2,
  Calendar,
  CalendarClock,
  Clock,
  ExternalLink,
  ListTodo,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { EpicAnalyticsOverview } from "@/components/kanban-analytics/EpicAnalyticsOverview";
import { EpicReleasePlanningTab } from "@/components/kanban-analytics/EpicReleasePlanningTab";
import { EpicWorklogJournal } from "@/components/kanban-analytics/EpicWorklogJournal";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import {
  useKanbanAnalyticsBootstrap,
  useKanbanAnalyticsEpicDetail,
  useKanbanEpicCharts,
  type KanbanAnalyticsEpicCharts,
  type KanbanAnalyticsEpicDetail,
} from "@/lib/queries";
import { Link, useParams } from "@/lib/router";

/** Как на списке эпиков: максимум 72rem по ширине контента + контейнерные запросы для сеток. */
const KANBAN_EPIC_DETAIL_SHELL =
  "mx-auto box-border w-[min(100%,72rem)] min-w-0 px-4 py-4 md:px-6 md:py-6 @container/kanban-epic-detail";

const workloadChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

function normalizeEpicDetailTab(raw: string | null): string {
  if (raw === "tasks" || raw === "charts" || raw === "worklogs" || raw === "workload" || raw === "planning") return raw;
  return "tasks";
}

export default function KanbanAnalyticsEpicDetailPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const epicId = useMemo(() => {
    const raw = (params as { epicId?: string }).epicId;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [params]);

  const projectSlug = searchParams.get("project_slug");

  const [mainTab, setMainTab] = useState(() => normalizeEpicDetailTab(searchParams.get("tab")));

  useEffect(() => {
    const next = normalizeEpicDetailTab(searchParams.get("tab"));
    setMainTab((prev) => (next !== prev ? next : prev));
  }, [searchParams]);

  const handleMainTabChange = useCallback(
    (v: string) => {
      setMainTab(v);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === "tasks") next.delete("tab");
          else next.set("tab", v);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const bootstrap = useKanbanAnalyticsBootstrap(true);
  const detail = useKanbanAnalyticsEpicDetail(epicId, projectSlug, bootstrap.data?.snapshot_ready ?? false);
  const charts = useKanbanEpicCharts(epicId, projectSlug, mainTab === "charts");

  const kanbanUrl = useMemo(() => {
    const base = bootstrap.data?.kanban_web_base_url?.replace(/\/$/, "");
    const slug = projectSlug;
    const id = epicId;
    if (!base || !slug || !id) return null;
    return `${base}/projects/${slug}/${id}`;
  }, [bootstrap.data?.kanban_web_base_url, projectSlug, epicId]);

  if (!epicId || !projectSlug) {
    return (
      <div className={KANBAN_EPIC_DETAIL_SHELL}>
        <EmptyState title="Некорректная ссылка" icon={RefreshCw} description="Не хватает epicId или project_slug." />
      </div>
    );
  }

  if (bootstrap.isLoading || detail.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка эпика…
        </div>
      </div>
    );
  }

  if (bootstrap.isError || detail.isError || !detail.data) {
    const err = (bootstrap.error ?? detail.error) as unknown;
    const needsConnect = err instanceof ApiError && [401, 403, 409].includes(err.status);
    return (
      <div className={KANBAN_EPIC_DETAIL_SHELL}>
        <EmptyState
          title="Не удалось загрузить эпик"
          icon={RefreshCw}
          description={needsConnect ? "Подключите Kanban в сайдбаре и попробуйте снова." : "Попробуйте обновить снимок и повторить."}
          action={
            needsConnect ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                onClick={() => window.dispatchEvent(new Event("resonance:kanban-login"))}
              >
                Подключить Kanban
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <EpicDetailBody
      d={detail.data}
      projectSlug={projectSlug}
      kanbanUrl={kanbanUrl}
      mainTab={mainTab}
      onMainTabChange={handleMainTabChange}
      charts={charts}
    />
  );
}

function EpicDetailBody({
  d,
  projectSlug,
  kanbanUrl,
  mainTab,
  onMainTabChange,
  charts,
}: {
  d: KanbanAnalyticsEpicDetail;
  projectSlug: string;
  kanbanUrl: string | null;
  mainTab: string;
  onMainTabChange: (v: string) => void;
  charts: UseQueryResult<KanbanAnalyticsEpicCharts, Error>;
}) {
  const meta = d.epic.local_meta;

  const workloadBars = useMemo(() => {
    return [...(d.workload ?? [])]
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 14)
      .map((row) => ({ name: row.user_name, hours: row.hours }));
  }, [d.workload]);

  const taskCount = d.tasks?.length ?? 0;
  const worklogCount = d.worklogs?.length ?? 0;

  return (
    <div className={`${KANBAN_EPIC_DETAIL_SHELL} space-y-6`}>
      <div className="flex flex-col gap-4 @sm/kanban-epic-detail:flex-row @sm/kanban-epic-detail:items-start @sm/kanban-epic-detail:justify-between">
        <div className="min-w-0 space-y-3">
          <Link
            href="/admin/kanban/analytics/epics"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            К списку эпиков
          </Link>
          <div className="rounded-xl border border-border bg-card/80 p-4 md:p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">#{d.epic.id}</span>
              <span className="text-border">·</span>
              <span className="truncate">{d.epic.project?.name ?? projectSlug}</span>
              {d.epic.deadline ? (
                <>
                  <span className="text-border hidden @sm/kanban-epic-detail:inline">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {d.epic.deadline}
                  </span>
                </>
              ) : null}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground md:text-2xl">{d.epic.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-normal">
                {d.epic.stage?.name ?? "Статус неизвестен"}
              </Badge>
              {meta?.qa_status ? (
                <Badge variant="outline" className="font-normal">
                  QA: {meta.qa_status}
                </Badge>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {meta?.resonance_epic_id != null && meta.resonance_epic_id > 0 ? (
                <Link
                  href={`/epics/${meta.resonance_epic_id}`}
                  className="text-xs font-medium text-primary hover:underline"
                  data-testid="kanban-epic-link-resonance-card"
                >
                  Карточка эпика в Resonance →
                </Link>
              ) : null}
              <Link
                href={`/admin/kanban/analytics/epics/${d.epic.id}?project_slug=${encodeURIComponent(projectSlug)}&tab=planning`}
                className="text-xs font-medium text-primary hover:underline"
                data-testid="kanban-epic-link-planning"
              >
                Планирование →
              </Link>
            </div>
            {meta && (meta.qa_estimate_hours != null || meta.qa_fact_hours != null || meta.spent_total_hours != null) ? (
              <dl className="mt-4 grid gap-2 text-sm @sm/kanban-epic-detail:grid-cols-2 @lg/kanban-epic-detail:grid-cols-3">
                {meta.qa_estimate_hours != null ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Оценка QA</dt>
                    <dd className="font-medium tabular-nums">{meta.qa_estimate_hours} ч</dd>
                  </div>
                ) : null}
                {meta.qa_fact_hours != null ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Факт QA</dt>
                    <dd className="font-medium tabular-nums">{meta.qa_fact_hours} ч</dd>
                  </div>
                ) : null}
                {meta.spent_total_hours != null ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Потрачено (сводка)</dt>
                    <dd className="font-medium tabular-nums">{meta.spent_total_hours} ч</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {kanbanUrl ? (
            <a
              href={kanbanUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card text-sm font-medium hover:bg-accent transition-colors"
              data-testid="kanban-epic-detail-open"
            >
              <ExternalLink className="h-4 w-4" />
              Открыть в Kanban
            </a>
          ) : null}
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={onMainTabChange} className="w-full min-w-0">
        <div className="min-w-0 w-full overflow-x-auto overflow-y-visible pb-0.5 [-webkit-overflow-scrolling:touch]">
          <TabsList className="!flex h-auto min-h-9 w-max min-w-full flex-wrap items-center justify-start gap-1 rounded-lg bg-muted/60 p-1 text-muted-foreground sm:w-full sm:min-w-0">
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListTodo className="h-3.5 w-3.5" />
            Задачи
            {taskCount > 0 ? (
              <span className="ml-0.5 rounded-md bg-background/80 px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                {taskCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="charts" className="gap-1.5" data-testid="kanban-epic-tab-charts">
            <BarChart2 className="h-3.5 w-3.5" />
            Графы
          </TabsTrigger>
          <TabsTrigger value="worklogs" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Журнал
            {worklogCount > 0 ? (
              <span className="ml-0.5 rounded-md bg-background/80 px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                {worklogCount > 200 ? "200+" : worklogCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="workload" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Команда
          </TabsTrigger>
          <TabsTrigger value="planning" className="gap-1.5" data-testid="kanban-epic-tab-planning">
            <CalendarClock className="h-3.5 w-3.5" />
            Планирование
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="tasks" className="mt-4 focus-visible:ring-0">
          <Section title="Задачи эпика">
            {(d.tasks ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Нет задач</div>
            ) : (
              <ul className="max-h-[min(70vh,720px)] space-y-2 overflow-y-auto pr-1">
                {d.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-border bg-background/50 p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {t.url ? (
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-medium text-primary hover:underline truncate"
                            >
                              {t.name}
                            </a>
                          ) : (
                            <div className="text-sm font-medium text-foreground truncate">{t.name}</div>
                          )}
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                            {t.stage?.name ?? "—"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5 space-x-2">
                          <span className="font-mono">#{t.id}</span>
                          <span>·</span>
                          <span>{t.assignees?.join(", ") || "—"}</span>
                        </div>
                      </div>
                      {t.tracked_hours != null ? (
                        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{t.tracked_hours} ч</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="charts" className="mt-4 focus-visible:ring-0" data-testid="kanban-epic-panel-charts">
          {charts.isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка графиков…
            </div>
          ) : charts.isError || !charts.data ? (
            <EmptyState
              title="Не удалось загрузить графики"
              icon={RefreshCw}
              description={
                charts.error instanceof ApiError ? charts.error.message : "Проверьте Kanban и повторите."
              }
            />
          ) : (
            <EpicAnalyticsOverview d={charts.data} chartsReady={charts.data.charts_ready} />
          )}
        </TabsContent>

        <TabsContent value="worklogs" className="mt-4 focus-visible:ring-0">
          <Section title="Журнал списаний времени">
            <EpicWorklogJournal d={d} projectSlug={projectSlug} />
          </Section>
        </TabsContent>

        <TabsContent value="workload" className="mt-4 focus-visible:ring-0">
          <div className="grid gap-4 @lg/kanban-epic-detail:grid-cols-2">
            <ChartCard title="Часы по участникам">
              {workloadBars.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                <ChartContainer config={workloadChartConfig} className="h-[min(400px,55vh)] w-full aspect-auto">
                  <BarChart layout="vertical" data={workloadBars} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="hours" radius={[0, 4, 4, 0]} fill="var(--color-hours)" />
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>
            <Section title="Таблица нагрузки">
              {(d.workload ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">Нет данных</div>
              ) : (
                <ul className="max-h-[min(70vh,720px)] space-y-2 overflow-y-auto">
                  {d.workload.map((row) => (
                    <li key={row.user_name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-foreground">{row.user_name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{row.hours} ч</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="planning" className="mt-4 focus-visible:ring-0" data-testid="kanban-epic-panel-planning">
          <EpicReleasePlanningTab projectSlug={projectSlug} kanbanEpicId={d.epic.id} detail={d} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>
      {children}
    </div>
  );
}
