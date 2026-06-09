import { useMemo, useState, type ComponentType, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";

const roleHoursChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const workloadChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

const qaTaskChartConfig = {
  hours: { label: "QA часы", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const qaUserChartConfig = {
  hours: { label: "QA часы", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const effortMixChartConfig = {
  QA: { label: "QA", color: "hsl(var(--chart-1))" },
  Manager: { label: "Manager", color: "hsl(var(--chart-2))" },
  Frontend: { label: "Frontend", color: "hsl(var(--chart-3))" },
  Backend: { label: "Backend", color: "hsl(var(--chart-4))" },
  Java: { label: "Java", color: "hsl(var(--chart-5))" },
  Other: { label: "Прочее", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

const estimateFactChartConfig = {
  hours: { label: "Часы", color: "hsl(var(--chart-4))" },
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

const QA_TASK_BAR_LIMIT = 8;

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
  const [timelineUser, setTimelineUser] = useState("__all__");
  const [workloadRole, setWorkloadRole] = useState<KanbanMemberProjectRole | "__all__">("__all__");

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
    const worklogs = d.worklogs ?? [];
    if (worklogs.length > 0) {
      const map = new Map<string, number>();
      for (const w of worklogs) {
        if (workloadRole !== "__all__" && w.member_role !== workloadRole) continue;
        const name = w.user_name?.trim() || "Unknown";
        map.set(name, (map.get(name) ?? 0) + w.hours);
      }
      return Array.from(map.entries())
        .map(([name, hours]) => ({ name, hours }))
        .filter((row) => row.hours > 0)
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 14);
    }
    if (workloadRole !== "__all__") return [];
    return [...(d.workload ?? [])]
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 14)
      .map((row) => ({ name: row.user_name, hours: row.hours }));
  }, [d.workload, d.worklogs, workloadRole]);

  const qaTaskBars = useMemo(() => {
    const map = new Map<number, { id: number; name: string; hours: number; url: string }>();
    for (const w of d.worklogs ?? []) {
      if (w.member_role !== "QA") continue;
      const current = map.get(w.task_id) ?? {
        id: w.task_id,
        name: w.task_name || `#${w.task_id}`,
        hours: 0,
        url: w.task_url,
      };
      current.hours += w.hours;
      map.set(w.task_id, current);
    }
    return Array.from(map.values())
      .sort((a, b) => b.hours - a.hours)
      .slice(0, QA_TASK_BAR_LIMIT);
  }, [d.worklogs]);

  const qaUserPieData = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of d.worklogs ?? []) {
      if (w.member_role !== "QA") continue;
      const name = w.user_name?.trim() || "QA";
      map.set(name, (map.get(name) ?? 0) + w.hours);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, hours], i) => ({
        key: name,
        name,
        hours,
        fill: ROLE_BAR_FILLS[i % ROLE_BAR_FILLS.length],
      }));
  }, [d.worklogs]);

  const effortMixData = useMemo(() => {
    return hoursByRoleRows
      .filter((row) => row.hours > 0)
      .map((row) => ({
        key: row.key,
        name: row.name,
        hours: row.hours,
        fill: row.fill,
      }));
  }, [hoursByRoleRows]);

  const estimateFactBars = useMemo(() => {
    const meta = d.epic.local_meta;
    return [
      { name: "QA оценка", hours: Number(meta?.qa_estimate_hours ?? 0), fill: "hsl(var(--chart-2))" },
      { name: "QA факт", hours: Number(meta?.qa_fact_hours ?? qaHoursDisplay ?? 0), fill: "hsl(var(--chart-1))" },
      { name: "Всего факт", hours: Number(meta?.tracked_hours ?? d.summary.tracked_hours ?? 0), fill: "hsl(var(--chart-4))" },
    ].filter((row) => Number.isFinite(row.hours) && row.hours > 0);
  }, [d.epic.local_meta, d.summary.tracked_hours, qaHoursDisplay]);

  const worklogTimeline = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of d.worklogs ?? []) {
      if (timelineUser !== "__all__" && w.user_name !== timelineUser) continue;
      if (!w.begin) continue;
      const t = new Date(w.begin);
      if (Number.isNaN(t.getTime())) continue;
      const key = t.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + w.hours);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));
  }, [d.worklogs, timelineUser]);

  const worklogUsers = useMemo(() => {
    return Array.from(new Set((d.worklogs ?? []).map((w) => w.user_name?.trim()).filter((name): name is string => Boolean(name))))
      .sort((a, b) => a.localeCompare(b, "ru"));
  }, [d.worklogs]);

  const hoursByRoleTotal = useMemo(() => hoursByRoleRows.reduce((s, r) => s + r.hours, 0), [hoursByRoleRows]);
  const workloadBarsTotal = useMemo(() => workloadBars.reduce((s, r) => s + r.hours, 0), [workloadBars]);
  const qaTaskBarsTotal = useMemo(() => qaTaskBars.reduce((s, r) => s + r.hours, 0), [qaTaskBars]);
  const qaUserPieTotal = useMemo(() => qaUserPieData.reduce((s, r) => s + r.hours, 0), [qaUserPieData]);
  const effortMixTotal = useMemo(() => effortMixData.reduce((s, r) => s + r.hours, 0), [effortMixData]);
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
        <ChartCard title="QA: оценка и факт">
          {estimateFactBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет QA-оценки или списаний для сравнения</p>
          ) : (
            <ChartContainer config={estimateFactChartConfig} className="h-[220px] w-full aspect-auto">
              <BarChart layout="vertical" data={estimateFactBars} margin={{ top: 8, right: 48, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => {
                        const v = Number(value) || 0;
                        return (
                          <div className="flex w-full min-w-[8rem] justify-between gap-3">
                            <span className="text-muted-foreground">Часы</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">{fmtHours(v)}ч</span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                  {estimateFactBars.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                  <LabelList dataKey="hours" position="right" className="fill-muted-foreground" fontSize={10} formatter={(v: number) => `${fmtHours(Number(v) || 0)}ч`} />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title="Доля QA и разработки">
          {effortMixData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет списаний времени</p>
          ) : (
            <ChartContainer config={effortMixChartConfig} className="mx-auto h-[240px] w-full max-w-md aspect-auto">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      nameKey="key"
                      formatter={(value, _name, item) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, effortMixTotal);
                        const label = String(item?.payload?.name ?? _name ?? "");
                        return (
                          <div className="flex w-full min-w-[11rem] justify-between gap-3">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {fmtHours(v)}ч ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie data={effortMixData} dataKey="hours" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2}>
                  {effortMixData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="QA трудозатраты по задачам (топ)">
          {qaTaskBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет QA-списаний по задачам</p>
          ) : (
            <ChartContainer config={qaTaskChartConfig} className="h-[360px] w-full aspect-auto">
              <BarChart layout="vertical" data={qaTaskBars} margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, qaTaskBarsTotal);
                        const taskId = item?.payload?.id;
                        return (
                          <div className="flex w-full min-w-[10rem] justify-between gap-3">
                            <span className="text-muted-foreground">#{taskId}</span>
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
                      if (n <= 0 || qaTaskBarsTotal <= 0) return "";
                      return `${fmtHours(n)}ч · ${pctOfTotal(n, qaTaskBarsTotal)}%`;
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title="QA часы по участникам">
          {qaUserPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет QA-списаний по участникам</p>
          ) : (
            <ChartContainer config={qaUserChartConfig} className="mx-auto h-[280px] w-full max-w-md aspect-auto">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => {
                        const v = Number(value) || 0;
                        const pct = pctOfTotal(v, qaUserPieTotal);
                        const label = String(item?.payload?.name ?? _name ?? "");
                        return (
                          <div className="flex w-full min-w-[12rem] justify-between gap-3">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {fmtHours(v)}ч ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie data={qaUserPieData} dataKey="hours" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2}>
                  {qaUserPieData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Учёт времени по отделам (роли)">
          {hoursByRoleRows.every((r) => r.hours === 0) ? (
            <p className="text-sm text-muted-foreground">Нет списанных часов в эпике</p>
          ) : (
            <ChartContainer config={roleHoursChartConfig} className="h-[380px] w-full aspect-auto">
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

        <ChartCard title="Нагрузка (топ по часам)">
          <SegmentedFilter
            className="mb-4"
            value={workloadRole}
            options={[
              { value: "__all__", label: "Все" },
              ...KANBAN_MEMBER_PROJECT_ROLE_ORDER.map((role) => ({ value: role, label: roleAxisLabel(role) })),
            ]}
            onChange={(value) => setWorkloadRole(value as KanbanMemberProjectRole | "__all__")}
          />
          {workloadBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {workloadRole === "__all__" ? "Нет данных по команде" : "Нет списаний по выбранному отделу"}
            </p>
          ) : (
            <ChartContainer config={workloadChartConfig} className="h-[300px] w-full aspect-auto">
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

      <ChartCard
        title="Worklog по дням"
        controls={
          worklogUsers.length > 0 ? (
            <ChartSelect id="worklog-timeline-user" value={timelineUser} onChange={setTimelineUser}>
              <option value="__all__">Все пользователи</option>
              {worklogUsers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </ChartSelect>
          ) : null
        }
      >
        {worklogTimeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {timelineUser === "__all__" ? "Нет дат в журнале или записей нет" : "У выбранного пользователя нет списаний по дням"}
          </p>
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

function ChartSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-[9rem] rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm outline-none transition-colors hover:bg-accent focus:ring-1 focus:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

function SegmentedFilter({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-lg border border-border/70 bg-background/45 p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ChartCard({ title, children, controls }: { title: string; children: ReactNode; controls?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {controls ? <div className="flex flex-wrap items-center gap-2">{controls}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
