import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, Plus, Rocket } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { isCoordinatorRole } from "@/lib/mappers";
import { useCreateRelease, useDirectoryUsers, useProjects, useReleaseEpicOptions, useReleases } from "@/lib/queries";
import { useLocation } from "@/lib/router";
import type { ReleaseStatus } from "@/lib/types";

const STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Черновик",
  in_progress: "В работе",
  ready: "Готов",
  released: "Выпущен",
  cancelled: "Отменён",
};

function CreateReleaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const projects = useProjects();
  const owners = useDirectoryUsers(open);
  const create = useCreateRelease();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [ownerId, setOwnerId] = useState("none");
  const [epicSearch, setEpicSearch] = useState("");
  const [epicIds, setEpicIds] = useState<number[]>([]);
  const options = useReleaseEpicOptions(projectId, epicSearch, open);

  const submit = async () => {
    if (!projectId || !title.trim()) return;
    try {
      const release = await create.mutateAsync({
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || null,
        planned_release_at: plannedDate ? new Date(`${plannedDate}T12:00:00`).toISOString() : null,
        owner_user_id: ownerId === "none" ? null : Number(ownerId),
        epic_ids: epicIds,
      });
      toast.success(`Релиз ${release.key} создан`);
      onOpenChange(false);
      navigate(`/releases/${release.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать релиз");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Создать релиз</DialogTitle><DialogDescription>Объедините эпики одного проекта в контекст выпуска.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>Проект</Label><Select value={projectId?.toString() ?? ""} onValueChange={(value) => { setProjectId(Number(value)); setEpicIds([]); }}><SelectTrigger><SelectValue placeholder="Выберите проект" /></SelectTrigger><SelectContent>{(projects.data ?? []).map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Название</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Релиз личного кабинета" /></div>
          <div className="grid gap-2"><Label>Плановая дата</Label><Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></div>
          <div className="grid gap-2"><Label>Владелец</Label><Select value={ownerId} onValueChange={setOwnerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Не назначен</SelectItem>{(owners.data ?? []).filter((user) => user.is_approved && (user.role === "admin" || !projectId || user.project_ids?.includes(projectId))).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.username}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Описание</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          {projectId && <div className="grid gap-2"><Label>Эпики</Label><Input value={epicSearch} onChange={(event) => setEpicSearch(event.target.value)} placeholder="Поиск эпика" /><div className="max-h-52 overflow-y-auto rounded-md border border-border p-2 space-y-1">{(options.data?.items ?? []).map((epic) => <label key={epic.id} className={`flex items-start gap-2 rounded p-2 text-sm ${epic.available ? "hover:bg-muted cursor-pointer" : "opacity-60"}`}><Checkbox disabled={!epic.available} checked={epicIds.includes(epic.id)} onCheckedChange={(checked) => setEpicIds((current) => checked ? [...current, epic.id] : current.filter((id) => id !== epic.id))} /><span><span className="font-mono text-xs text-muted-foreground">{epic.key}</span> · {epic.title}{!epic.available && <span className="block text-xs text-destructive">{epic.disabled_reason}{epic.active_release ? `: ${epic.active_release.key}` : ""}</span>}</span></label>)}</div></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button disabled={!projectId || !title.trim() || create.isPending} onClick={submit}>Создать</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReleasesPage() {
  const [, navigate] = useLocation();
  const { me } = useAuth();
  const projects = useProjects();
  const owners = useDirectoryUsers(true);
  const [urlParams, setUrlParams] = useSearchParams();
  const page = Math.max(1, Number(urlParams.get("page")) || 1);
  const q = urlParams.get("q") ?? "";
  const project = urlParams.get("project") ?? "all";
  const status = urlParams.get("status") ?? "all";
  const owner = urlParams.get("owner") ?? "all";
  const plannedFrom = urlParams.get("planned_from") ?? "";
  const plannedTo = urlParams.get("planned_to") ?? "";
  const overdue = urlParams.get("overdue") === "1";
  const [createOpen, setCreateOpen] = useState(false);
  const updateFilters = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(urlParams);
    Object.entries(changes).forEach(([key, value]) => value && value !== "all" ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete("page");
    setUrlParams(next);
  };
  const query = useReleases({ q: q || undefined, project_id: project === "all" ? undefined : Number(project), status: status === "all" ? undefined : status as ReleaseStatus, owner_user_id: owner === "all" ? undefined : Number(owner), planned_from: plannedFrom ? new Date(`${plannedFrom}T00:00:00`).toISOString() : undefined, planned_to: plannedTo ? new Date(`${plannedTo}T23:59:59`).toISOString() : undefined, overdue: overdue || undefined, page, page_size: 25 });
  const canCreate = me?.role === "admin" || isCoordinatorRole(me?.role);

  return <div className="p-4 md:p-6 space-y-5">
    <div className="flex items-center justify-between gap-3 flex-wrap"><div><h1 className="text-lg font-semibold">Релизы</h1><p className="text-sm text-muted-foreground">Рабочие контексты принятия решения о выпуске</p></div>{canCreate && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} />Создать релиз</Button>}</div>
    <div className="flex flex-wrap gap-2"><Input className="w-64" value={q} onChange={(event) => updateFilters({ q: event.target.value || null })} placeholder="Поиск по ключу или названию" /><Select value={project} onValueChange={(value) => updateFilters({ project: value })}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все проекты</SelectItem>{(projects.data ?? []).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={(value) => updateFilters({ status: value })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все статусы</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={owner} onValueChange={(value) => updateFilters({ owner: value })}><SelectTrigger className="w-44"><SelectValue placeholder="Владелец" /></SelectTrigger><SelectContent><SelectItem value="all">Все владельцы</SelectItem>{(owners.data ?? []).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.username}</SelectItem>)}</SelectContent></Select><Input className="w-36" type="date" aria-label="План с" value={plannedFrom} onChange={(event) => updateFilters({ planned_from: event.target.value || null })} /><Input className="w-36" type="date" aria-label="План по" value={plannedTo} onChange={(event) => updateFilters({ planned_to: event.target.value || null })} /><Button variant={overdue ? "default" : "outline"} size="sm" onClick={() => updateFilters({ overdue: overdue ? null : "1" })}><CalendarClock size={14} />Просроченные</Button></div>
    {(query.data?.items.length ?? 0) === 0 ? <EmptyState icon={Rocket} title={query.isLoading ? "Загружаем релизы" : "Релизов не найдено"} description="Измените фильтры или создайте новый релиз" /> : <div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["Ключ", "Название", "Проект", "Статус", "Владелец", "План", "Эпики", "Риски", "Вопросы", "Обновлён"].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{query.data?.items.map((release) => { const risks = Object.values(release.risk_counts).reduce((sum, value) => sum + value, 0); return <tr key={release.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/releases/${release.id}`)}><td className="px-3 py-3 font-mono text-xs">{release.key}</td><td className="px-3 py-3 font-medium">{release.title}</td><td className="px-3 py-3">{release.project_name}</td><td className="px-3 py-3">{STATUS_LABELS[release.status]}</td><td className="px-3 py-3">{release.owner_username ?? "—"}</td><td className="px-3 py-3 whitespace-nowrap">{release.planned_release_at ? new Date(release.planned_release_at).toLocaleDateString("ru-RU") : "—"}</td><td className="px-3 py-3 text-center">{release.epic_count}</td><td className="px-3 py-3">{risks > 0 ? <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle size={13} />{risks}</span> : "0"}</td><td className="px-3 py-3 text-center">{release.open_questions_count}</td><td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">{new Date(release.updated_at).toLocaleString("ru-RU")}</td></tr>; })}</tbody></table></div>}
    <ListPagination page={page} pageSize={25} total={query.data?.total ?? 0} isLoading={query.isFetching} onPageChange={(nextPage) => updateFilters({ page: nextPage > 1 ? String(nextPage) : null }, false)} />
    <CreateReleaseDialog open={createOpen} onOpenChange={setCreateOpen} />
  </div>;
}
