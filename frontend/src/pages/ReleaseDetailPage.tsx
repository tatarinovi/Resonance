import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRelease, useReleaseOverview, useReleaseTab, useRefreshRelease, useTransitionRelease, useUpdateRelease } from "@/lib/queries";
import { Link } from "@/lib/router";
import type { ApiRelease, ApiReleaseAssessment, ReleaseStatus } from "@/lib/types";

const STATUS_LABELS: Record<ReleaseStatus, string> = { draft: "Черновик", in_progress: "В работе", ready: "Готов", released: "Выпущен", cancelled: "Отменён" };
const TRANSITION_LABELS: Record<ReleaseStatus, string> = { draft: "В черновик", in_progress: "Начать", ready: "Готов", released: "Выпустить", cancelled: "Отменить" };
const TABS = [["overview", "Обзор"], ["tasks", "Задачи"], ["qa", "QA"], ["questions", "Вопросы"], ["time", "Тайм-менеджмент"], ["history", "История"]] as const;
type TimeSummary = { summary: { spent_hours: number; epic_count: number }; by_epic: Array<{ id: number; key: string; title: string; hours: number }>; by_user: Array<{ name: string; hours: number }>; dynamics: Array<{ day: string; hours: number }>; freshness: { status: string; updated_at?: string | null } };

function Readiness({ assessment }: { assessment?: ApiReleaseAssessment }) {
  if (!assessment) return null;
  const value = assessment.readiness;
  return <div className={`rounded-xl border p-4 ${value === "has_risks" ? "border-destructive/40 bg-destructive/5" : value === "ready" ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}><div className="flex items-center gap-2 font-semibold">{value === "has_risks" ? <AlertTriangle className="text-destructive" size={18} /> : value === "ready" ? <CheckCircle2 className="text-emerald-500" size={18} /> : <Database className="text-amber-500" size={18} />}{value === "has_risks" ? "Есть риски" : value === "ready" ? "Готов к выпуску" : "Нет данных"}</div><p className="mt-1 text-xs text-muted-foreground">{assessment.actual_risks.length} рисков · {assessment.warnings.length} предупреждений · {assessment.data_gaps.length} пробелов данных</p></div>;
}

function EditReleaseDialog({ open, onOpenChange, release }: { open: boolean; onOpenChange: (value: boolean) => void; release: ApiRelease }) {
  const update = useUpdateRelease(release.id);
  const [title, setTitle] = useState(release.title);
  const [description, setDescription] = useState(release.description ?? "");
  const [note, setNote] = useState(release.release_note ?? "");
  const submit = async () => { try { await update.mutateAsync({ title, description: description || null, release_note: note || null }); toast.success("Релиз обновлён"); onOpenChange(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка обновления"); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Редактировать релиз</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>Название</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} /></div><div><Label>Описание</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div><div><Label>Release note</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={submit} disabled={!title.trim() || update.isPending}>Сохранить</Button></DialogFooter></DialogContent></Dialog>;
}

export default function ReleaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const releaseId = Number(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") || "overview") as typeof TABS[number][0];
  const releaseQuery = useRelease(Number.isFinite(releaseId) ? releaseId : null);
  const overview = useReleaseOverview(Number.isFinite(releaseId) ? releaseId : null);
  const tasks = useReleaseTab<{ items: Array<Record<string, unknown>>; total: number }>(releaseId, "tasks", {}, tab === "tasks");
  const qa = useReleaseTab<{ items: Array<Record<string, unknown>>; total: number }>(releaseId, "qa", {}, tab === "qa");
  const questions = useReleaseTab<{ items: Array<Record<string, unknown>>; total: number }>(releaseId, "questions", {}, tab === "questions");
  const history = useReleaseTab<{ items: Array<Record<string, unknown>>; total: number }>(releaseId, "history", {}, tab === "history");
  const timeSummary = useReleaseTab<TimeSummary>(releaseId, "time-management/summary", {}, tab === "time");
  const refresh = useRefreshRelease(releaseId);
  const transition = useTransitionRelease(releaseId);
  const [editOpen, setEditOpen] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<ReleaseStatus | null>(null);
  const [releaseNote, setReleaseNote] = useState("");
  const targetAssessment = useReleaseOverview(releaseId, transitionTarget, Boolean(transitionTarget));
  const release = releaseQuery.data;

  if (releaseQuery.isLoading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!release) return <div className="p-6"><EmptyState icon={Rocket} title="Релиз не найден" description="Проверьте ссылку или доступ к проекту" /></div>;

  const runTransition = async () => {
    if (!transitionTarget) return;
    try { await transition.mutateAsync({ target_status: transitionTarget, release_note: releaseNote || null }); toast.success("Статус релиза обновлён"); setTransitionTarget(null); setReleaseNote(""); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось изменить статус"); }
  };

  return <div className="p-4 md:p-6 space-y-5">
    <Link href="/releases"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} />Релизы</span></Link>
    <header className="space-y-3"><div className="flex items-start justify-between gap-3 flex-wrap"><div><div className="font-mono text-xs text-muted-foreground">{release.key}</div><h1 className="text-xl font-semibold">{release.title}</h1><p className="mt-1 text-sm text-muted-foreground">{release.description || "Описание не задано"}</p></div><div className="flex gap-2">{release.capabilities.can_refresh_data && <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={async () => { try { const result = await refresh.mutateAsync(); toast.success(result.outcome === "partial" ? "Данные обновлены частично" : "Данные обновлены"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка обновления"); } }}><RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} />Обновить данные</Button>}{release.capabilities.can_edit_release && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>Редактировать</Button>}{release.capabilities.allowed_status_transitions.map((target) => <Button key={target} size="sm" variant={target === "cancelled" ? "outline" : "default"} onClick={() => setTransitionTarget(target)}>{TRANSITION_LABELS[target]}</Button>)}</div></div><div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Статус: <b className="text-foreground">{STATUS_LABELS[release.status]}</b></span><span>Проект: <b className="text-foreground">{release.project_name}</b></span><span>Владелец: <b className="text-foreground">{release.owner_username ?? "—"}</b></span><span>План: <b className="text-foreground">{release.planned_release_at ? new Date(release.planned_release_at).toLocaleDateString("ru-RU") : "—"}</b></span><span>Эпики: <b className="text-foreground">{release.epic_count}</b></span></div></header>
    <div className="border-b border-border flex gap-1 overflow-x-auto">{TABS.map(([value, label]) => <button key={value} className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => setParams(value === "overview" ? {} : { tab: value })}>{label}</button>)}</div>
    {tab === "overview" && <div className="space-y-5"><Readiness assessment={overview.data} /><section><h2 className="text-sm font-semibold mb-2">Требует внимания</h2><div className="space-y-2">{overview.data?.attention.length ? overview.data.attention.map((item, index) => <div key={`${item.kind}-${index}`} className="rounded-lg border border-border p-3 flex items-start gap-3"><AlertTriangle size={15} className={item.severity === "info" ? "text-muted-foreground" : item.severity === "warning" ? "text-amber-500" : "text-destructive"} /><div><div className="text-sm font-medium">{item.message}</div><div className="text-xs text-muted-foreground">{item.epic.key} · {item.epic.title} · {item.source}</div></div></div>) : <p className="text-sm text-muted-foreground">Нет элементов, требующих внимания.</p>}</div></section><section><h2 className="text-sm font-semibold mb-2">Эпики</h2><div className="grid gap-2">{release.epics.map((epic) => <Link key={epic.id} href={`/epics/${epic.key}`}><div className="rounded-lg border border-border p-3 hover:bg-muted/30"><div className="font-medium text-sm">{epic.key} · {epic.title}</div><div className="text-xs text-muted-foreground mt-1">QA: {epic.qa_status ?? "—"} · Jira: {epic.jira_tasks_count} · Вопросы: {epic.open_questions_count} · Блокеры: {epic.blockers_count}</div></div></Link>)}</div></section></div>}
    {tab === "tasks" && <ReleaseRows data={tasks.data} kind="tasks" empty="Jira-задач нет" />}
    {tab === "qa" && <QaGroups data={qa.data} />}
    {tab === "questions" && <ReleaseRows data={questions.data} kind="questions" empty="Вопросов нет" />}
    {tab === "time" && <TimeManagement data={timeSummary.data} />}
    {tab === "history" && <ReleaseRows data={history.data} kind="history" empty="История пуста" />}
    <EditReleaseDialog open={editOpen} onOpenChange={setEditOpen} release={release} />
    <Dialog open={Boolean(transitionTarget)} onOpenChange={(open) => !open && setTransitionTarget(null)}><DialogContent><DialogHeader><DialogTitle>{transitionTarget ? TRANSITION_LABELS[transitionTarget] : "Изменить статус"}</DialogTitle></DialogHeader><Readiness assessment={targetAssessment.data ?? overview.data} />{transitionTarget && ["released", "cancelled"].includes(transitionTarget) && <div><Label>Release note</Label><Textarea value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} /></div>}<DialogFooter><Button variant="outline" onClick={() => setTransitionTarget(null)}>Отмена</Button><Button onClick={runTransition} disabled={transition.isPending}>Подтвердить</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function ReleaseRows({ data, empty, kind }: { data?: { items: Array<Record<string, unknown>>; total: number }; empty: string; kind: "tasks" | "questions" | "history" }) {
  if (!data?.items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <div className="rounded-xl border border-border divide-y divide-border">{data.items.map((item, index) => {
    const source = item.source_epic as { key?: string; title?: string } | undefined;
    const sourceList = item.source_epics as Array<{ key?: string }> | undefined;
    const title = String(item.title ?? item.action ?? item.key ?? "Запись");
    const subtitle = kind === "tasks" ? [item.status, item.priority, sourceList?.map((epic) => epic.key).join(", ")].filter(Boolean).join(" · ") : kind === "questions" ? [item.status, source?.key, item.overdue ? "Просрочен" : null].filter(Boolean).join(" · ") : [item.actor_username, item.created_at ? new Date(String(item.created_at)).toLocaleString("ru-RU") : null].filter(Boolean).join(" · ");
    const href = kind === "tasks" ? item.url : kind === "questions" ? item.url : null;
    const content = <div className="p-3"><div className="text-sm font-medium">{item.key ? <span className="font-mono mr-2">{String(item.key)}</span> : null}{title}</div><div className="mt-1 text-xs text-muted-foreground">{subtitle || "—"}</div>{kind === "history" && item.details_json ? <div className="mt-1 text-xs text-muted-foreground">{JSON.stringify(item.details_json)}</div> : null}</div>;
    return href ? <a key={index} href={String(href)} target={kind === "tasks" ? "_blank" : undefined} rel="noreferrer" className="block hover:bg-muted/30">{content}</a> : <div key={index}>{content}</div>;
  })}</div>;
}

function QaGroups({ data }: { data?: { items: Array<Record<string, unknown>>; total: number } }) {
  if (!data?.items.length) return <p className="text-sm text-muted-foreground">QA runs отсутствуют.</p>;
  return <div className="space-y-3">{data.items.map((item, index) => { const epic = item.epic as { key: string; title: string }; const runs = (item.runs as Array<Record<string, unknown>>) ?? []; return <section key={index} className="rounded-xl border border-border p-4"><div className="font-semibold text-sm">{epic.key} · {epic.title}</div><div className="mt-1 text-xs text-muted-foreground">QA: {String(item.qa_status ?? "—")} · Активная среда: {String(item.active_test_stage ?? "—")}</div><div className="mt-3 grid gap-2 md:grid-cols-3">{runs.length ? runs.map((run, runIndex) => { const snapshot = run.testops_snapshot as Record<string, unknown> | null; return <a key={runIndex} href={String(run.url ?? "#")} target="_blank" rel="noreferrer" className="rounded-lg border border-border p-3 hover:bg-muted/30"><div className="font-medium text-sm">{String(run.environment).toUpperCase()}</div><div className="text-xs text-muted-foreground">{String(run.status)}{snapshot ? ` · TestOps: ${String(snapshot.status)} · failed ${String(snapshot.failed ?? 0)}` : " · TestOps cache отсутствует"}</div></a>; }) : <p className="text-xs text-muted-foreground">Runs не созданы.</p>}</div></section>; })}</div>;
}

function TimeManagement({ data }: { data?: TimeSummary }) {
  if (!data) return <p className="text-sm text-muted-foreground">Kanban snapshot недоступен.</p>;
  const maxHours = Math.max(1, ...data.by_user.map((item) => item.hours));
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Затрачено</div><div className="text-2xl font-semibold">{data.summary.spent_hours} ч</div></div><div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Kanban-эпики</div><div className="text-2xl font-semibold">{data.summary.epic_count}</div></div></div><section className="rounded-xl border border-border p-4"><h3 className="text-sm font-semibold mb-3">По сотрудникам</h3><div className="space-y-2">{data.by_user.map((item) => <div key={item.name}><div className="flex justify-between text-xs"><span>{item.name}</span><span>{item.hours} ч</span></div><div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.round(item.hours / maxHours * 100)}%` }} /></div></div>)}</div></section><section className="rounded-xl border border-border p-4"><h3 className="text-sm font-semibold mb-3">По эпикам</h3>{data.by_epic.map((item) => <Link key={item.id} href={`/epics/${item.key}`}><div className="flex justify-between border-b border-border py-2 text-sm last:border-0"><span>{item.key} · {item.title}</span><span>{item.hours} ч</span></div></Link>)}</section><p className="text-xs text-muted-foreground">Kanban: {data.freshness.status}{data.freshness.updated_at ? ` · ${new Date(data.freshness.updated_at).toLocaleString("ru-RU")}` : ""}</p></div>;
}
