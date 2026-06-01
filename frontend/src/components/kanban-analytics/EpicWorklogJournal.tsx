import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/formatDateTime";
import { Link } from "@/lib/router";
import type { KanbanAnalyticsEpicDetail, KanbanMemberProjectRole } from "@/lib/queries";
import { KANBAN_MEMBER_PROJECT_ROLE_ORDER } from "@/lib/queries";
import { cn } from "@/lib/utils";

const WORKLOG_DISPLAY_LIMIT = 200;
const DENSITY_STORAGE_KEY = "resonance:kanban-epic-worklog-density";

const VALID_MEMBER_ROLES = new Set<string>(KANBAN_MEMBER_PROJECT_ROLE_ORDER);

type WorklogRow = KanbanAnalyticsEpicDetail["worklogs"][number];
type Density = "compact" | "comfortable";

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function worklogAnchorId(w: WorklogRow): string {
  const s = [w.task_id, w.begin ?? "", w.user_name, w.minutes, w.comment].join("\0");
  return `wl-${fnv1a32(s).toString(16)}`;
}

function groupKey(w: WorklogRow): string {
  const kid = w.kanban_user_id != null && w.kanban_user_id > 0 ? String(w.kanban_user_id) : "";
  return `${w.user_name}\0${kid}`;
}

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (v === "compact" || v === "comfortable") return v;
  } catch {
    /* ignore */
  }
  return "compact";
}

/** Как подписи ролей на графиках эпика (`EpicAnalyticsOverview`). */
function roleAxisLabel(role: KanbanMemberProjectRole): string {
  if (role === "Other") return "Прочее";
  return role;
}

function effectiveMemberRole(w: WorklogRow): KanbanMemberProjectRole {
  const r = w.member_role;
  if (typeof r === "string" && VALID_MEMBER_ROLES.has(r)) return r as KanbanMemberProjectRole;
  return "Other";
}

/** Дата начала списания в локальном календаре пользователя `YYYY-MM-DD`. */
function worklogDayLocal(iso: string): string | null {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function matchesDateRange(w: WorklogRow, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const day = w.begin ? worklogDayLocal(String(w.begin)) : null;
  if (!day) return false;
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
}

function recordsLabelRu(n: number): string {
  const m = n % 100;
  const m10 = n % 10;
  if (m >= 11 && m <= 14) return `${n} записей`;
  if (m10 === 1) return `${n} запись`;
  if (m10 >= 2 && m10 <= 4) return `${n} записи`;
  return `${n} записей`;
}

function parseYmdLocal(value: string): Date | undefined {
  const s = value.trim();
  if (!s) return undefined;
  const d = parse(s, "yyyy-MM-dd", new Date());
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function ymdTodayLocal(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function ymdYesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return format(d, "yyyy-MM-dd");
}

function JournalDateField({
  label,
  value,
  onChange,
  metaClass,
}: {
  label: string;
  value: string;
  onChange: (ymd: string) => void;
  metaClass: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseYmdLocal(value);
  const display =
    selected != null ? format(selected, "d MMM yyyy", { locale: ru }) : null;

  return (
    <div className="flex flex-col gap-1">
      <span className={cn(metaClass, "text-muted-foreground")}>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-[10.5rem] justify-start gap-2 px-2.5 text-xs font-normal text-foreground"
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{display ?? "Выбрать дату"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto border-border p-0 shadow-md" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onChange(d != null ? format(d, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            defaultMonth={selected}
            locale={ru}
          />
          {value ? (
            <div className="border-t border-border p-2">
              <Button type="button" variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={() => onChange("")}>
                Очистить
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function EpicWorklogJournal({
  d,
  projectSlug,
}: {
  d: KanbanAnalyticsEpicDetail;
  projectSlug: string;
}) {
  const params = useParams();
  const location = useLocation();
  const epicIdRaw = (params as { epicId?: string }).epicId;
  const epicId = epicIdRaw ? Number.parseInt(epicIdRaw, 10) : NaN;
  const [density, setDensity] = useState<Density>(() => readDensity());
  const [roleFilter, setRoleFilter] = useState<KanbanMemberProjectRole | "__all__">("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const qc = useQueryClient();
  const meta = d.epic.local_meta;
  const resonanceEpicId =
    typeof meta?.resonance_epic_id === "number" && meta.resonance_epic_id > 0 ? meta.resonance_epic_id : null;
  const qaEstimateMeta = meta?.qa_estimate_hours;

  const [qaDraft, setQaDraft] = useState("");
  const [qaSaving, setQaSaving] = useState(false);

  useEffect(() => {
    if (qaEstimateMeta != null && Number.isFinite(Number(qaEstimateMeta))) {
      setQaDraft(String(qaEstimateMeta));
    } else {
      setQaDraft("");
    }
  }, [qaEstimateMeta, resonanceEpicId, d.epic.id, projectSlug]);

  const saveQaEstimate = useCallback(async () => {
    const kid = d.epic.id;
    if (!Number.isFinite(kid) || kid <= 0) return;
    const raw = qaDraft.trim().replace(",", ".");
    let payload: { qa_estimate_hours: number | null };
    if (raw === "") {
      payload = { qa_estimate_hours: null };
    } else {
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Укажите неотрицательное число часов или оставьте поле пустым");
        return;
      }
      payload = { qa_estimate_hours: n };
    }
    setQaSaving(true);
    try {
      if (resonanceEpicId) {
        await api.put(`/epics/${resonanceEpicId}`, payload);
      } else {
        await api.put(`/analytics/kanban/epics/${kid}/qa-estimate`, payload, {
          query: { project_slug: projectSlug },
        });
      }
      await qc.invalidateQueries({ queryKey: ["kanban-analytics", "epic-detail"] });
      await qc.invalidateQueries({ queryKey: ["kanban-analytics", "epics"] });
      await qc.invalidateQueries({ queryKey: ["kanban-analytics", "epic-charts"] });
      toast.success("Оценка QA сохранена");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally {
      setQaSaving(false);
    }
  }, [resonanceEpicId, qaDraft, qc, d.epic.id, projectSlug]);

  const rawTotal = (d.worklogs ?? []).length;

  const filteredAll = useMemo(() => {
    let rows = [...(d.worklogs ?? [])];
    if (roleFilter !== "__all__") {
      rows = rows.filter((w) => effectiveMemberRole(w) === roleFilter);
    }
    rows = rows.filter((w) => matchesDateRange(w, dateFrom, dateTo));
    return rows;
  }, [d.worklogs, roleFilter, dateFrom, dateTo]);

  const limited = useMemo(() => {
    return {
      rows: filteredAll.slice(0, WORKLOG_DISPLAY_LIMIT),
      afterFilters: filteredAll.length,
    };
  }, [filteredAll]);

  const groups = useMemo(() => {
    const map = new Map<string, WorklogRow[]>();
    for (const w of limited.rows) {
      const k = groupKey(w);
      const arr = map.get(k) ?? [];
      arr.push(w);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => String(b.begin ?? "").localeCompare(String(a.begin ?? "")));
    }
    const entries = Array.from(map.entries()).map(([key, rows]) => {
      const minutes = rows.reduce((s, r) => s + (r.minutes || 0), 0);
      const hours = Math.round((minutes / 60) * 100) / 100;
      const label = rows[0]?.user_name ?? key.split("\0")[0];
      return { key, label, rows, minutes, hours, count: rows.length };
    });
    entries.sort((a, b) => {
      if (b.minutes !== a.minutes) return b.minutes - a.minutes;
      return a.label.localeCompare(b.label, "ru");
    });
    return entries;
  }, [limited.rows]);

  const epicCtx = useMemo(() => {
    const p = d.epic.project?.name?.trim() || projectSlug;
    const e = d.epic.name?.trim() || `Эпик #${d.epic.id}`;
    return { line: `${p} · ${e}`, project: p, epic: e };
  }, [d.epic, projectSlug]);

  const persistDensity = useCallback((v: Density) => {
    setDensity(v);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const buildJournalUrl = useCallback(
    (hash: string) => {
      if (!Number.isFinite(epicId)) return "";
      const qs = new URLSearchParams();
      qs.set("project_slug", projectSlug);
      qs.set("tab", "worklogs");
      const path = `/admin/kanban/analytics/epics/${epicId}`;
      return `${window.location.origin}${path}?${qs.toString()}${hash ? `#${hash}` : ""}`;
    },
    [epicId, projectSlug],
  );

  const copyWorklogLink = useCallback(
    (w: WorklogRow) => {
      const id = worklogAnchorId(w);
      const url = buildJournalUrl(id);
      if (!url) {
        toast.error("Не удалось собрать ссылку");
        return;
      }
      void navigator.clipboard.writeText(url).then(
        () => toast.success("Ссылка на запись скопирована"),
        () => toast.error("Не удалось скопировать"),
      );
    },
    [buildJournalUrl],
  );

  const scrolledRef = useRef<string | null>(null);
  const scrollSigRef = useRef<string>("");
  const hash = location.hash.replace(/^#/, "");
  const scrollSignature = `${d.epic.id}|${projectSlug}|${hash}`;

  useLayoutEffect(() => {
    if (scrollSigRef.current !== scrollSignature) {
      scrollSigRef.current = scrollSignature;
      scrolledRef.current = null;
    }
  }, [scrollSignature, d.epic.id, projectSlug, hash]);

  useLayoutEffect(() => {
    if (!hash.startsWith("wl-")) return;
    if (scrolledRef.current === hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    scrolledRef.current = hash;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("ring-2", "ring-primary/60", "rounded-md");
    const t = window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary/60", "rounded-md");
    }, 2000);
    return () => window.clearTimeout(t);
  }, [hash, groups, scrollSignature]);

  const pad = density === "compact" ? "p-2.5" : "p-3.5";
  const gap = density === "compact" ? "gap-1.5" : "gap-2.5";
  const metaText = density === "compact" ? "text-[11px]" : "text-xs";
  const commentText = density === "compact" ? "text-xs leading-snug" : "text-sm leading-relaxed";

  const filtersActive = roleFilter !== "__all__" || !!dateFrom || !!dateTo;

  const todayYmd = ymdTodayLocal();
  const yesterdayYmd = ymdYesterdayLocal();
  const quickTodayActive = dateFrom === todayYmd && dateTo === todayYmd;
  const quickYesterdayActive = dateFrom === yesterdayYmd && dateTo === yesterdayYmd;

  const hasWorklogs = rawTotal > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card px-3 py-3 shadow-sm">
          <div className={`${metaText} mb-2 font-medium text-muted-foreground`}>Оценка QA</div>
          <p className={`${metaText} mb-3 leading-relaxed text-muted-foreground`}>
            {resonanceEpicId
              ? "Значение хранится в эпике Resonance (поле qa_estimate_hours)."
              : "Эпик в Kanban не привязан к Resonance — оценка сохраняется в настройках аналитики по проекту и id эпика; после привязки переносите значение в карточку эпика при необходимости."}
          </p>
          <div className="flex flex-col gap-3 @sm/kanban-epic-detail:flex-row @sm/kanban-epic-detail:flex-wrap @sm/kanban-epic-detail:items-end">
            <div className="flex items-end gap-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Не задано"
                value={qaDraft}
                onChange={(e) => setQaDraft(e.target.value)}
                className="h-8 w-28 text-xs tabular-nums"
                disabled={qaSaving}
                aria-label="Оценка QA, часы"
              />
              <span className={`${metaText} shrink-0 pb-2 text-muted-foreground`}>ч</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={qaSaving}
                onClick={() => void saveQaEstimate()}
              >
                {qaSaving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : null}
                {qaSaving ? "Сохранение…" : "Сохранить"}
              </Button>
              {resonanceEpicId ? (
                <Link
                  href={`/epics/${resonanceEpicId}`}
                  className={`${metaText} text-primary hover:underline`}
                  data-testid="kanban-journal-link-resonance-epic"
                >
                  Карточка в Resonance →
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 @lg/kanban-epic-detail:flex-row @lg/kanban-epic-detail:items-start @lg/kanban-epic-detail:justify-between">
          <div className="rounded-lg border border-border bg-card px-3 py-3 shadow-sm">
            <div className={`${metaText} mb-2 font-medium text-muted-foreground`}>Период</div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className={cn(metaText, "text-muted-foreground")}>Быстро</span>
              <Button
                type="button"
                variant={quickTodayActive ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  setDateFrom(todayYmd);
                  setDateTo(todayYmd);
                }}
              >
                Сегодня
              </Button>
              <Button
                type="button"
                variant={quickYesterdayActive ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  setDateFrom(yesterdayYmd);
                  setDateTo(yesterdayYmd);
                }}
              >
                Вчера
              </Button>
            </div>
            <div className={`${metaText} mb-1.5 text-muted-foreground`}>По датам</div>
            <div className="flex flex-wrap items-end gap-3">
              <JournalDateField label="С даты" value={dateFrom} onChange={setDateFrom} metaClass={metaText} />
              <JournalDateField label="По дату" value={dateTo} onChange={setDateTo} metaClass={metaText} />
              {(dateFrom || dateTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Сбросить период
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
            <span className={`${metaText} text-muted-foreground whitespace-nowrap`}>Плотность</span>
            <ToggleGroup
              type="single"
              value={density}
              onValueChange={(v) => {
                if (v === "compact" || v === "comfortable") persistDensity(v);
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="compact" className="h-7 px-2 text-xs" aria-label="Компактно">
                Компакт
              </ToggleGroupItem>
              <ToggleGroupItem value="comfortable" className="h-7 px-2 text-xs" aria-label="Комфортно">
                Комфорт
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card px-3 py-3 shadow-sm">
          <div className={`${metaText} mb-2 font-medium text-muted-foreground`}>Направление</div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={roleFilter === "__all__" ? "secondary" : "outline"}
              className="h-7 rounded-md px-2 text-xs"
              onClick={() => setRoleFilter("__all__")}
            >
              Все
            </Button>
            {KANBAN_MEMBER_PROJECT_ROLE_ORDER.map((role) => (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={roleFilter === role ? "secondary" : "outline"}
                className="h-7 rounded-md px-2 text-xs"
                onClick={() => setRoleFilter(role)}
              >
                {roleAxisLabel(role)}
              </Button>
            ))}
          </div>
          <p className={`${metaText} mt-2 text-muted-foreground`}>
            Роль берётся из настроек Resonance по Kanban user id автора (как на графике по отделам). Если в снимке нет поля{" "}
            <span className="font-mono">member_role</span>, обновите снимок Kanban.
          </p>
        </div>
      </div>

      {!hasWorklogs ? (
        <p className="text-sm text-muted-foreground">Нет записей журнала времени за этот эпик.</p>
      ) : limited.afterFilters === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filtersActive ? "Нет записей по выбранным фильтрам." : "Нет записей журнала времени."}
        </p>
      ) : (
        <div className={`space-y-2 ${gap}`}>
          {groups.map((g) => {
            const isCollapsed = !!collapsed[g.key];
            return (
              <section key={g.key} className="overflow-hidden rounded-lg border border-border bg-card">
                <header
                  className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85 ${metaText}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleCollapsed(g.key)}
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <span className="truncate font-medium text-foreground">{g.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{g.hours} ч</span>
                    <span className="shrink-0 text-muted-foreground">·</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{recordsLabelRu(g.count)}</span>
                  </div>
                  <div className="max-w-full truncate text-muted-foreground" title={epicCtx.line}>
                    {epicCtx.line}
                  </div>
                </header>
                {!isCollapsed ? (
                  <ul className="divide-y divide-border">
                    {g.rows.map((w) => {
                      const tid = worklogAnchorId(w);
                      const role = effectiveMemberRole(w);
                      return (
                        <li key={tid} id={tid} className={`${pad} scroll-mt-24`}>
                          <div className={`flex flex-col ${gap} @md/kanban-epic-detail:flex-row @md/kanban-epic-detail:items-start @md/kanban-epic-detail:justify-between`}>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className={`flex flex-wrap items-center ${gap}`}>
                                {w.task_url ? (
                                  <a
                                    href={w.task_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`font-medium text-primary hover:underline ${density === "compact" ? "text-xs" : "text-sm"}`}
                                  >
                                    {w.task_name}
                                  </a>
                                ) : (
                                  <span className={`font-medium text-foreground ${density === "compact" ? "text-xs" : "text-sm"}`}>
                                    {w.task_name}
                                  </span>
                                )}
                                <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">
                                  {roleAxisLabel(role)}
                                </Badge>
                                <span className={`${metaText} text-muted-foreground`}>
                                  <span className="font-mono">#{w.task_id}</span>
                                </span>
                              </div>
                              <p className={`whitespace-pre-wrap break-words text-foreground ${commentText}`}>
                                {w.comment?.trim() ? w.comment.trim() : <span className="text-muted-foreground">Без описания</span>}
                              </p>
                              <p className={`${metaText} text-muted-foreground`}>{epicCtx.line}</p>
                            </div>
                            <div className={`flex shrink-0 flex-col items-end gap-1 ${metaText}`}>
                              <span className="tabular-nums text-foreground">{w.hours} ч</span>
                              <span className="text-right text-muted-foreground">{w.begin ? formatDateTime(w.begin) : "—"}</span>
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => copyWorklogLink(w)}
                                >
                                  <Copy className="mr-1 h-3 w-3" />
                                  Ссылка
                                </Button>
                                {w.task_url ? (
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                                    <a href={w.task_url} target="_blank" rel="noreferrer">
                                      <ExternalLink className="mr-1 h-3 w-3" />
                                      Задача
                                    </a>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {limited.afterFilters > WORKLOG_DISPLAY_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          По фильтрам найдено {limited.afterFilters} записей; показаны первые {WORKLOG_DISPLAY_LIMIT}. Сузьте период или направление, чтобы увидеть остальные в пределах лимита.
        </p>
      ) : filtersActive && rawTotal > 0 ? (
        <p className="text-xs text-muted-foreground">
          По фильтрам: {limited.afterFilters} из {rawTotal} записей в эпике.
        </p>
      ) : null}
    </div>
  );
}
