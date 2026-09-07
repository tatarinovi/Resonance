import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, Database, Loader2, Plus, RefreshCw, Rocket, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useArchiveRelease, useDeleteRelease, useManageReleaseEpics, useRelease, useReleaseEpicOptions, useReleaseOverview, useReleaseTab, useRefreshRelease, useRemoveReleaseEpic, useTransitionRelease, useUpdateRelease } from "@/lib/queries";
import { Link } from "@/lib/router";
import type { ApiRelease, ApiReleaseAssessment, ReleaseStatus } from "@/lib/types";

const STATUS_LABELS: Record<ReleaseStatus, string> = { draft: "Черновик", in_progress: "В работе", ready: "Готов", released: "Выпущен", cancelled: "Отменён" };
const TRANSITION_LABELS: Record<ReleaseStatus, string> = { draft: "В черновик", in_progress: "Начать", ready: "Готов", released: "Выпустить", cancelled: "Отменить" };
const TABS = [["overview", "Обзор"], ["tasks", "Задачи"], ["qa", "QA"], ["questions", "Вопросы"], ["time", "Тайм-менеджмент"], ["history", "История"]] as const;
type TimeSummary = { summary: { spent_hours: number; epic_count: number }; by_epic: Array<{ id: number; key: string; title: string; hours: number }>; by_user: Array<{ name: string; hours: number }>; dynamics: Array<{ day: string; hours: number }>; freshness: { status: string; updated_at?: string | null } };

function Readiness({ assessment }: { assessment?: ApiReleaseAssessment }) {
  if (!assessment) return null;
  const value = assessment.readiness;
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 font-semibold">{value === "has_risks" ? <AlertTriangle className="text-destructive" size={18} /> : value === "ready" ? <CheckCircle2 className="text-primary" size={18} /> : <Database className="text-muted-foreground" size={18} />}{value === "has_risks" ? "Есть риски" : value === "ready" ? "Готов к выпуску" : "Нет данных"}</div><p className="mt-1 text-xs text-muted-foreground">{assessment.actual_risks.length} рисков · {assessment.warnings.length} предупреждений · {assessment.data_gaps.length} пробелов данных</p></div>;
}

function ReleaseOverviewDashboard({ assessment, release }: { assessment?: ApiReleaseAssessment; release: ApiRelease }) {
  const [showAllRisks, setShowAllRisks] = useState(false);
  if (!assessment) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  const qa = assessment.summary.qa ?? { total: 0, passed: 0, failed: 0, broken: 0, blocked: 0, in_progress: 0, completed: 0, progress_percent: 0 };
  const jira = assessment.summary.jira ?? { total: 0, by_status: {}, by_priority: {}, by_type: {} };
  const questions = assessment.summary.questions ?? { open: 0, overdue: 0, waiting_expert: 0 };
  const visibleAttention = showAllRisks ? assessment.attention : assessment.attention.slice(0, 6);
  const priority = (name: string) => Object.entries(jira.by_priority).filter(([key]) => key.toLowerCase().includes(name)).reduce((sum, [, count]) => sum + count, 0);
  const statusEntries = Object.entries(jira.by_status);
  const statusTotal = Math.max(1, statusEntries.reduce((sum, [, count]) => sum + count, 0));
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Readiness assessment={assessment} />
      <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs font-medium">QA · активные раны</div><div className="mt-1 flex items-end gap-3"><b className="text-3xl">{qa.progress_percent}%</b><span className="pb-1 text-xs text-muted-foreground">{qa.completed} / {qa.total}</span></div><div className="mt-3 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${qa.progress_percent}%` }} /></div><div className="mt-3 flex gap-3 text-xs"><span className="text-emerald-600 dark:text-emerald-400">{qa.passed} passed</span><span className="text-destructive">{qa.failed} failed</span><span className="text-amber-600 dark:text-amber-400">{qa.broken} broken</span></div></div>
      <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs font-medium">Jira</div><div className="mt-1 text-3xl font-semibold">{jira.total} <span className="text-sm font-normal text-muted-foreground">задач</span></div><div className="mt-3 space-y-1 text-xs"><div>{priority("blocker")} blocker</div><div>{priority("critical")} critical</div></div></div>
      <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs font-medium">Вопросы</div><div className="mt-1 text-3xl font-semibold">{questions.open} <span className="text-sm font-normal text-muted-foreground">открытых</span></div><div className="mt-3 space-y-1 text-xs"><div className={questions.overdue ? "text-destructive" : ""}>{questions.overdue} просрочено</div><div>{questions.waiting_expert} ожидают эксперта</div></div></div>
    </div>

    <section className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center gap-2"><h2 className="text-sm font-semibold">Требует внимания</h2><span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] text-destructive-foreground">{assessment.attention.length}</span></div>{visibleAttention.length ? <div className="divide-y divide-border">{visibleAttention.map((item, index) => <a key={`${item.kind}-${index}`} href={item.entity?.url || undefined} className="grid gap-1 py-2 text-xs hover:bg-muted/30 sm:grid-cols-[110px_90px_1fr_110px] sm:gap-3"><b className={item.severity === "blocker" ? "text-destructive" : "text-amber-600"}>{item.kind.replaceAll("_", " ")}</b><span className="font-mono text-muted-foreground">{item.epic.key}</span><span>{item.message}</span><span className="text-muted-foreground">{item.source}</span></a>)}</div> : <p className="text-sm text-muted-foreground">Нет элементов, требующих внимания.</p>}{assessment.attention.length > 6 && <button className="mt-2 text-xs font-medium text-primary" onClick={() => setShowAllRisks((value) => !value)}>{showAllRisks ? "Скрыть" : "Показать все риски"}</button>}</section>

    <div className="grid gap-3 xl:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Текущие тест-раны</h2><div className="mt-3 space-y-3">{assessment.current_test_runs?.map((item) => { const snapshot = item.run?.snapshot; const percent = snapshot?.total ? Math.round((snapshot.passed + snapshot.failed + snapshot.broken + snapshot.blocked) / snapshot.total * 100) : 0; return <div key={item.epic.id}><div className="flex justify-between gap-3 text-xs"><Link href={`/epics/${item.epic.key}`}><b>{item.epic.key} · {item.epic.title}</b></Link><span className="text-muted-foreground">{item.environment.toUpperCase()} · {snapshot ? `${percent}%` : "нет данных"}</span></div><div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div></div>; })}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Jira по статусам</h2><div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">{statusEntries.map(([name, count], index) => <div key={name} title={`${name}: ${count}`} className={["bg-primary", "bg-primary/80", "bg-primary/60", "bg-primary/40", "bg-muted-foreground/30"][index % 5]} style={{ width: `${count / statusTotal * 100}%` }} />)}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs">{statusEntries.map(([name, count]) => <div key={name} className="flex justify-between"><span className="text-muted-foreground">{name}</span><b>{count}</b></div>)}</div></section>
    </div>

    <div className="grid gap-3 xl:grid-cols-[1fr_1fr_280px]">
      <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Ключевые Jira-задачи</h2><div className="mt-2 divide-y divide-border">{assessment.key_jira_tasks?.map((task) => <a key={task.key} href={task.url} target="_blank" rel="noreferrer" className="block py-2 text-xs hover:text-primary"><b className="font-mono">{task.key}</b> · {task.title}<span className="block text-muted-foreground">{task.status} · {task.priority || "—"}</span></a>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Вопросы к экспертам</h2><div className="mt-2 divide-y divide-border">{assessment.key_questions?.map((question) => <Link key={question.id} href={question.url}><div className="py-2 text-xs hover:text-primary"><b className="font-mono">{question.key}</b> · {question.title}<span className={`block ${question.overdue ? "text-destructive" : "text-muted-foreground"}`}>{question.overdue ? "Просрочен" : question.status}</span></div></Link>)}</div></section>
      <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Свежесть данных</h2><div className="mt-3 space-y-3 text-xs">{Object.entries(release.freshness).map(([source, value]) => { const data = value as { status?: string; last_success_at?: string }; return <div key={source} className="flex justify-between gap-3"><span className="capitalize">{source}</span><span className={data.status === "fresh" ? "text-primary" : "text-amber-600 dark:text-amber-400"}>{data.status || "нет данных"}</span></div>; })}</div></section>
    </div>
  </div>;
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
  const navigate = useNavigate();
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
  const archive = useArchiveRelease(releaseId);
  const deleteRelease = useDeleteRelease(releaseId);
  const manageEpics = useManageReleaseEpics(releaseId);
  const removeEpic = useRemoveReleaseEpic(releaseId);
  const [editOpen, setEditOpen] = useState(false);
  const [epicsOpen, setEpicsOpen] = useState(false);
  const [epicSearch, setEpicSearch] = useState("");
  const [selectedEpicIds, setSelectedEpicIds] = useState<number[]>([]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [transitionTarget, setTransitionTarget] = useState<ReleaseStatus | null>(null);
  const [releaseNote, setReleaseNote] = useState("");
  const targetAssessment = useReleaseOverview(releaseId, transitionTarget, Boolean(transitionTarget));
  const release = releaseQuery.data;
  const epicOptions = useReleaseEpicOptions(release?.project_id ?? null, epicSearch, epicsOpen);

  if (releaseQuery.isLoading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!release) return <div className="p-6"><EmptyState icon={Rocket} title="Релиз не найден" description="Проверьте ссылку или доступ к проекту" /></div>;

  const runTransition = async () => {
    if (!transitionTarget) return;
    try { await transition.mutateAsync({ target_status: transitionTarget, release_note: releaseNote || null }); toast.success("Статус релиза обновлён"); setTransitionTarget(null); setReleaseNote(""); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось изменить статус"); }
  };

  return <div className="p-4 md:p-6 space-y-5">
    <Link href="/releases"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} />Релизы</span></Link>
    <header className="space-y-3"><div className="flex items-start justify-between gap-3 flex-wrap"><div><div className="font-mono text-xs text-muted-foreground">{release.key}</div><h1 className="text-xl font-semibold">{release.title}</h1><p className="mt-1 text-sm text-muted-foreground">{release.description || "Описание не задано"}</p></div><div className="flex gap-2 flex-wrap">{release.capabilities.can_refresh_data && <Button variant="default" size="sm" disabled={refresh.isPending} onClick={async () => { try { const result = await refresh.mutateAsync(); toast.success(result.outcome === "partial" ? "Источники обновлены частично" : "Источники обновлены"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка обновления"); } }}><RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} />Синхронизировать</Button>}{overview.data?.jira_search_url && <Button variant="outline" size="sm" asChild><a href={overview.data.jira_search_url} target="_blank" rel="noreferrer">Открыть Jira ↗</a></Button>}{release.capabilities.can_manage_epics && <Button variant="outline" size="sm" onClick={() => setEpicsOpen(true)}><Plus size={14} />Эпики</Button>}{release.capabilities.can_edit_release && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>Редактировать</Button>}{release.capabilities.can_archive && !release.archived_at && <Button variant="outline" size="sm" disabled={archive.isPending} onClick={async () => { try { await archive.mutateAsync(); toast.success("Релиз архивирован"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка архивации"); } }}><Archive size={14} />Архивировать</Button>}{release.capabilities.can_delete && <Button variant="destructive" size="sm" disabled={deleteRelease.isPending} onClick={async () => { if (!window.confirm("Удалить черновик релиза без возможности восстановления?")) return; try { await deleteRelease.mutateAsync(); navigate("/releases"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка удаления"); } }}><Trash2 size={14} />Удалить</Button>}{release.capabilities.allowed_status_transitions.map((target) => <Button key={target} size="sm" variant={target === "cancelled" ? "outline" : "default"} onClick={() => setTransitionTarget(target)}>{TRANSITION_LABELS[target]}</Button>)}</div></div><div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Статус: <b className="text-foreground">{STATUS_LABELS[release.status]}</b></span><span>Проект: <b className="text-foreground">{release.project_name}</b></span><span>Владелец: <b className="text-foreground">{release.owner_username ?? "—"}</b></span><span>План: <b className="text-foreground">{release.planned_release_at ? new Date(release.planned_release_at).toLocaleDateString("ru-RU") : "—"}</b></span><span>Эпики: <b className="text-foreground">{release.epic_count}</b></span></div></header>
    <div className="border-b border-border flex gap-1 overflow-x-auto">{TABS.map(([value, label]) => <button key={value} className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => setParams(value === "overview" ? {} : { tab: value })}>{label}</button>)}</div>
    {tab === "overview" && <ReleaseOverviewDashboard assessment={overview.data} release={release} />}
    {tab === "tasks" && <ReleaseRows data={tasks.data} kind="tasks" empty="Jira-задач нет" />}
    {tab === "qa" && <QaGroups data={qa.data} />}
    {tab === "questions" && <ReleaseRows data={questions.data} kind="questions" empty="Вопросов нет" />}
    {tab === "time" && <TimeManagement data={timeSummary.data} />}
    {tab === "history" && <ReleaseRows data={history.data} kind="history" empty="История пуста" />}
    <EditReleaseDialog open={editOpen} onOpenChange={setEditOpen} release={release} />
    <Dialog open={epicsOpen} onOpenChange={setEpicsOpen}><DialogContent><DialogHeader><DialogTitle>Добавить эпики</DialogTitle></DialogHeader><Input placeholder="Поиск эпика" value={epicSearch} onChange={(event) => setEpicSearch(event.target.value)} /><div className="max-h-72 overflow-auto space-y-1">{epicOptions.data?.items.filter((option) => !release.epics.some((epic) => epic.id === option.id)).map((option) => { const terminal = release.status === "released" || release.status === "cancelled"; const disabled = !terminal && !option.available; const checked = selectedEpicIds.includes(option.id); return <label key={option.id} className={`flex items-start gap-2 rounded p-2 text-sm ${disabled ? "opacity-50" : "hover:bg-muted cursor-pointer"}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={() => setSelectedEpicIds((current) => checked ? current.filter((value) => value !== option.id) : [...current, option.id])} /><span>{option.key} · {option.title}{option.disabled_reason && <span className="block text-xs text-muted-foreground">{option.disabled_reason}</span>}</span></label>; })}</div>{(release.status === "released" || release.status === "cancelled") && <div><Label>Причина исторической корректировки</Label><Textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></div>}<DialogFooter><Button variant="outline" onClick={() => setEpicsOpen(false)}>Отмена</Button><Button disabled={!selectedEpicIds.length || manageEpics.isPending || ((release.status === "released" || release.status === "cancelled") && !correctionReason.trim())} onClick={async () => { try { await manageEpics.mutateAsync({ epic_ids: selectedEpicIds, correction_reason: correctionReason.trim() || undefined }); toast.success("Состав релиза обновлён"); setSelectedEpicIds([]); setCorrectionReason(""); setEpicsOpen(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка изменения состава"); } }}>Добавить</Button></DialogFooter></DialogContent></Dialog>
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
