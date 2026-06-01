import { useMemo, type ComponentType, type ReactNode } from "react";
import { CheckCircle2, Clock, ListTodo, Loader2, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  type KanbanAnalyticsEpicDetail,
  KANBAN_MEMBER_PROJECT_ROLE_ORDER,
  type KanbanMemberProjectRole,
} from "@/lib/queries";

const statusChartConfig = {
  progress: { label: "В работе", color: "hsl(var(--chart-1))" },
  done: { label: "Готово", color: "hsl(var(--chart-2))" },
  rest: { label: "Прочее", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

const roleHoursChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const stageChartConfig = {
  count: { label: "Задач", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const workloadChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

const timelineChartConfig = {
  hours: { label: "Часы за день", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

const ROLE_BAR_FILLS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-1))",
];

function pctOfTotal(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "0.0";
  return ((value / total) * 100).toFixed(1);
}

function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0";
  return h >= 10 ? h.toFixed(1) : h.toFixed(2);
}

function roleAxisLabel(role: KanbanMemberProjectRole): string {
  if (role === "Other") return "Прочее";
  return role;
}

export function EpicAnalyticsOverview({
  d,
  chartsReady,
}: {
  d: KanbanAnalyticsEpicDetail;
  /** `false` — только прелоудер (данные по новым правилам ещё не готовы). `undefined` — считать готовым (обратная совместимость). */
  chartsReady?: boolean;
}) {
  const ready = chartsReady !== false;

  const statusPieData = useMemo(() => {
    const { task_count, in_progress_count, done_count } = d.summary;
    const rest = Math.max(0, task_count - in_progress_count - done_count);
    return [
      { key: "progress" as const, name: "В работе", value: in_progress_count, fill: "var(--color-progress)" },
      { key: "done" as const, name: "Готово", value: done_count, fill: "var(--color-done)" },
      { key: "rest" as const, name: "Прочее", value: rest, fill: "var(--color-rest)" },
    ].filter((x) => x.value > 0);
  }, [d.summary]);

  const stageBars = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of d.tasks ?? []) {
      const name = t.stage?.name?.trim() || "—";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [d.tasks]);

  const hoursByRoleRows = useMemo(() => {
    const hbr = d.summary.hours_by_role ?? {};
    return KANBAN_MEMBER_PROJECT_ROLE_ORDER.map((role, i) => ({
      key: role,
      name: roleAxisLabel(role),
      hours: Number(hbr[role] ?? 0),
      fill: ROLE_BAR_FILLS[i] ?? ROLE_BAR_FILLS[0],
    }));
  }, [d.summary.hours_by_role]);

  const qaHoursDisplay = useMemo(() => {
    const fromRoles = d.summary.hours_by_role?.QA;
    if (fromRoles != null) return fromRoles;
    return d.summary.qa_tracked_hours ?? 0;
  }, [d.summary.hours_by_role, d.summary.qa_tracked_hours]);

  const workloadBars = useMemo(() => {
    return [...(d.workload ?? [])]
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 14)
      .map((row) => ({ name: row.user_name, hours: row.hours }));
  }, [d.workload]);

  const worklogTimeline = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of d.worklogs ?? []) {
      if (!w.begin) continue;
      const t = new Date(w.begin);
      if (Number.isNaN(t.getTime())) continue;
      const key = t.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + w.hours);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));
  }, [d.worklogs]);

  const statusPieTotal = useMemo(() => statusPieData.reduce((s, x) => s + x.value, 0), [statusPieData]);
  const hoursByRoleTotal = useMemo(() => hoursByRoleRows.reduce((s, r) => s + r.hours, 0), [hoursByRoleRows]);
  const stageBarsTotal = useMemo(() => stageBars.reduce((s, r) => s + r.count, 0), [stageBars]);
  const workloadBarsTotal = useMemo(() => workloadBars.reduce((s, r) => s + r.hours, 0), [workloadBars]);
  const worklogTimelineTotal = useMemo(() => worklogTimeline.reduce((s, r) => s + r.hours, 0), [worklogTimeline]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-80" aria-hidden />
        <span>Подготовка графиков…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard icon={ListTodo} label="Задач" value={d.summary.task_count} />
        <StatCard icon={Clock} label="В работе" value={d.summary.in_progress_count} />
        <StatCard icon={CheckCircle2} label="Готово" value={d.summary.done_count} />
        <StatCard icon={Clock} label="Часы" value={d.summary.tracked_hours} suffix="ч" />
        <StatCard icon={Users} label="Часы QA (роль)" value={qaHoursDisplay} suffix="ч" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Задачи по статусу">
          {statusPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет задач для диаграммы</p>
          ) : (
            <ChartContainer config={statusChartConfig} className="mx-auto h-[240px] w-full max-w-md aspect-auto">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      nameKey="key"
                      formatter={(value, _name, item) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, statusPieTotal);
                        const label = String(item?.payload?.name ?? _name ?? "");
                        return (
                          <div className="flex w-full min-w-[11rem] justify-between gap-3">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {v} ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie
                  data={statusPieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={88}
                  strokeWidth={2}
                  paddingAngle={2}
                  labelLine={false}
                  label={({ name, value, percent }) =>
                    `${String(name ?? "")}: ${value} (${((Number(percent) || 0) * 100).toFixed(1)}%)`
                  }
                  fontSize={10}
                >
                  {statusPieData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title="Учёт времени по отделам (роли)">
          {hoursByRoleRows.every((r) => r.hours === 0) ? (
            <p className="text-sm text-muted-foreground">Нет списанных часов в эпике</p>
          ) : (
            <ChartContainer config={roleHoursChartConfig} className="h-[min(280px,45vh)] w-full aspect-auto">
              <BarChart layout="vertical" data={hoursByRoleRows} margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, hoursByRoleTotal);
                        return (
                          <div className="flex w-full min-w-[9rem] justify-between gap-3">
                            <span className="text-muted-foreground">Часы</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {fmtHours(v)}ч ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                  {hoursByRoleRows.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="hours"
                    position="right"
                    className="fill-muted-foreground"
                    fontSize={10}
                    formatter={(v: number) => {
                      const n = Number(v) || 0;
                      if (n <= 0 || hoursByRoleTotal <= 0) return "";
                      return `${fmtHours(n)}ч · ${pctOfTotal(n, hoursByRoleTotal)}%`;
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Задачи по колонке Kanban">
          {stageBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет задач</p>
          ) : (
            <ChartContainer config={stageChartConfig} className="h-[min(360px,50vh)] w-full aspect-auto">
              <BarChart layout="vertical" data={stageBars} margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, stageBarsTotal);
                        return (
                          <div className="flex w-full min-w-[9rem] justify-between gap-3">
                            <span className="text-muted-foreground">Задач</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {Math.round(v)} ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="var(--color-count)">
                  <LabelList
                    dataKey="count"
                    position="right"
                    className="fill-muted-foreground"
                    fontSize={10}
                    formatter={(v: number) => {
                      const n = Number(v) || 0;
                      if (n <= 0 || stageBarsTotal <= 0) return "";
                      return `${Math.round(n)} · ${pctOfTotal(n, stageBarsTotal)}%`;
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title="Нагрузка (топ по часам)">
          {workloadBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных по команде</p>
          ) : (
            <ChartContainer config={workloadChartConfig} className="h-[min(360px,50vh)] w-full aspect-auto">
              <BarChart layout="vertical" data={workloadBars} margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={128}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, workloadBarsTotal);
                        return (
                          <div className="flex w-full min-w-[9rem] justify-between gap-3">
                            <span className="text-muted-foreground">Часы</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {fmtHours(v)}ч ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]} fill="var(--color-hours)">
                  <LabelList
                    dataKey="hours"
                    position="right"
                    className="fill-muted-foreground"
                    fontSize={10}
                    formatter={(v: number) => {
                      const n = Number(v) || 0;
                      if (n <= 0 || workloadBarsTotal <= 0) return "";
                      return `${fmtHours(n)}ч · ${pctOfTotal(n, workloadBarsTotal)}%`;
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Worklog по дням (все списания, сумма часов)">
        {worklogTimeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет дат в журнале или записей нет</p>
        ) : (
          <ChartContainer config={timelineChartConfig} className="h-[220px] w-full aspect-auto">
            <BarChart data={worklogTimeline} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis width={32} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => String(label)}
                    formatter={(value) => {
                      const v = Number(value) || 0;
                      const pct = pctOfTotal(v, worklogTimelineTotal);
                      return (
                        <div className="flex w-full min-w-[9rem] justify-between gap-3">
                          <span className="text-muted-foreground">Часы за день</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {fmtHours(v)}ч ({pct}%)
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]} fill="var(--color-hours)">
                <LabelList
                  dataKey="hours"
                  position="top"
                  className="fill-muted-foreground"
                  fontSize={9}
                  formatter={(v: number) => {
                    const n = Number(v) || 0;
                    if (n <= 0 || worklogTimelineTotal <= 0) return "";
                    return `${fmtHours(n)}ч · ${pctOfTotal(n, worklogTimelineTotal)}%`;
                  }}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 opacity-70" />
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground md:text-xl">
        {value}
        {suffix ? <span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span> : null}
      </div>
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
