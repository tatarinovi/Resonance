import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { projects } from "@/data/projects";
import { users } from "@/data/users";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { epicIdToRef, projectIdToRef, refIdToNumeric, userIdToRef } from "@/lib/mappers";
import { useCreateEpic, useUpdateEpic } from "@/lib/queries";
import { useLocation } from "@/lib/router";
import type { ApiEpic, EpicStatus } from "@/lib/types";

interface EpicFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectRefId?: string | null;
  epic?: ApiEpic | null;
}

type FormState = {
  title: string; projectId: string; status: EpicStatus; startDate: string; targetDate: string;
  jiraUrl: string; jiraJql: string; confluenceUrl: string; kanbanUrl: string; designUrl: string;
  notes: string; leadAnalystId: string; leadDesignerId: string; expertId: string;
  qaEstimateHours: string; qaMemberIds: string[];
};

const emptyForm = (projectId = ""): FormState => ({
  title: "", projectId, status: "new", startDate: "", targetDate: "", jiraUrl: "", jiraJql: "",
  confluenceUrl: "", kanbanUrl: "", designUrl: "", notes: "", leadAnalystId: "none",
  leadDesignerId: "none", expertId: "none", qaEstimateHours: "", qaMemberIds: [],
});
const optionalId = (value: string) => value === "none" ? null : refIdToNumeric(value);
const fieldClass = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50";

export function CreateEpicDialog({ open, onOpenChange, defaultProjectRefId, epic }: EpicFormDialogProps) {
  const editing = Boolean(epic);
  const [, setLocation] = useLocation();
  const createEpic = useCreateEpic();
  const updateEpic = useUpdateEpic(epic?.id ?? -1);
  const hideKanban = useIsNotaWorkspace();
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultProjectRefId ?? ""));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    if (!epic) { setForm(emptyForm(defaultProjectRefId ?? "")); return; }
    setForm({
      title: epic.title, projectId: projectIdToRef(epic.project_id), status: epic.status,
      startDate: epic.start_date?.slice(0, 10) ?? "", targetDate: epic.target_date?.slice(0, 10) ?? "",
      jiraUrl: epic.jira_url ?? "", jiraJql: epic.jira_jql ?? "", confluenceUrl: epic.confluence_url ?? "",
      kanbanUrl: epic.kanban_url ?? "", designUrl: epic.design_url ?? "", notes: epic.notes ?? "",
      leadAnalystId: epic.lead_analyst_id == null ? "none" : userIdToRef(epic.lead_analyst_id),
      leadDesignerId: epic.lead_designer_id == null ? "none" : userIdToRef(epic.lead_designer_id),
      expertId: epic.expert_id == null ? "none" : userIdToRef(epic.expert_id),
      qaEstimateHours: epic.qa_estimate_hours == null ? "" : String(epic.qa_estimate_hours),
      qaMemberIds: epic.qa_member_ids.map(userIdToRef),
    });
  }, [open, epic, defaultProjectRefId]);

  const projectUsers = useMemo(() => {
    const pid = refIdToNumeric(form.projectId);
    return users.filter((user) => !pid || !user.projectIds?.length || user.projectIds.includes(projectIdToRef(pid)));
  }, [form.projectId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const projectId = refIdToNumeric(form.projectId);
    if (!form.title.trim()) return void toast.error("Введите название эпика");
    if (!projectId) return void toast.error("Выберите проект");
    const qaEstimate = form.qaEstimateHours.trim() ? Number(form.qaEstimateHours) : null;
    if (qaEstimate != null && (!Number.isFinite(qaEstimate) || qaEstimate < 0)) return void toast.error("Проверьте оценку QA");
    const body = {
      title: form.title.trim(), status: form.status, start_date: form.startDate || null, target_date: form.targetDate || null,
      jira_url: form.jiraUrl.trim(), jira_jql: form.jiraJql.trim() || null, confluence_url: form.confluenceUrl.trim(),
      ...(hideKanban ? {} : { kanban_url: form.kanbanUrl.trim() || null }), design_url: form.designUrl.trim() || null,
      notes: form.notes.trim() || null, lead_analyst_id: optionalId(form.leadAnalystId),
      lead_designer_id: optionalId(form.leadDesignerId), expert_id: optionalId(form.expertId),
      qa_estimate_hours: qaEstimate, qa_member_ids: form.qaMemberIds.map(refIdToNumeric).filter((id): id is number => id != null),
    };
    try {
      if (epic) {
        await updateEpic.mutateAsync(body);
        toast.success("Эпик обновлён");
      } else {
        const created = await createEpic.mutateAsync({ project_id: projectId, ...body });
        toast.success("Эпик создан");
        setLocation(`/epics/${epicIdToRef(created.id)}`);
      }
      onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить эпик"); }
  };

  const pending = createEpic.isPending || updateEpic.isPending;
  const textField = (label: string, key: keyof Pick<FormState, "jiraUrl"|"jiraJql"|"confluenceUrl"|"kanbanUrl"|"designUrl">, multiline = false) => <div><label className="text-xs font-medium text-muted-foreground">{label}</label>{multiline ? <textarea value={form[key]} onChange={(e) => set(key, e.target.value)} rows={2} className={fieldClass} /> : <input value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder="Необязательно" className={fieldClass} />}</div>;
  const userSelect = (label: string, key: "leadAnalystId"|"leadDesignerId"|"expertId") => <div><label className="text-xs font-medium text-muted-foreground">{label}</label><Select value={form[key]} onValueChange={(value) => set(key, value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{projectUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div>;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Редактировать эпик" : "Новый эпик"}</DialogTitle><DialogDescription>Основные данные, интеграции и QA-команда эпика.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-xs font-medium text-muted-foreground">Название *</label><input value={form.title} onChange={(e) => set("title", e.target.value)} className={fieldClass} data-testid="input-epic-title" /></div><div><label className="text-xs font-medium text-muted-foreground">Проект *</label><Select value={form.projectId} onValueChange={(value) => set("projectId", value)} disabled={editing}><SelectTrigger className="mt-1" data-testid="select-epic-project"><SelectValue placeholder="Выберите проект" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><div><label className="text-xs font-medium text-muted-foreground">Статус</label><Select value={form.status} onValueChange={(value) => set("status", value as EpicStatus)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Новый</SelectItem><SelectItem value="in-progress">В работе</SelectItem><SelectItem value="released">Выпущен</SelectItem></SelectContent></Select></div><div><label className="text-xs font-medium text-muted-foreground">Старт</label><DatePickerButton value={form.startDate} onChange={(value) => set("startDate", value)} /></div><div><label className="text-xs font-medium text-muted-foreground">Целевая дата</label><DatePickerButton value={form.targetDate} onChange={(value) => set("targetDate", value)} /></div></div>
    <div className="grid gap-3 sm:grid-cols-2">{textField("Jira", "jiraUrl")}{textField("Jira JQL", "jiraJql", true)}{textField("Confluence", "confluenceUrl")}{!hideKanban && textField("Kanban", "kanbanUrl")}{textField("Дизайн", "designUrl")}</div>
    <div><label className="text-xs font-medium text-muted-foreground">Описание / заметки</label><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={fieldClass} /></div>
    <div className="grid gap-3 sm:grid-cols-3">{userSelect("Лид аналитики", "leadAnalystId")}{userSelect("Лид дизайна", "leadDesignerId")}{userSelect("Эксперт", "expertId")}</div>
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]"><div><label className="text-xs font-medium text-muted-foreground">Оценка QA, ч</label><input type="number" min="0" step="0.5" value={form.qaEstimateHours} onChange={(e) => set("qaEstimateHours", e.target.value)} className={fieldClass} /></div><div><label className="text-xs font-medium text-muted-foreground">Участники QA</label><div className="mt-1 max-h-28 overflow-y-auto rounded-md border border-input p-2 grid gap-1 sm:grid-cols-2">{projectUsers.map((user) => <label key={user.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.qaMemberIds.includes(user.id)} onChange={() => set("qaMemberIds", form.qaMemberIds.includes(user.id) ? form.qaMemberIds.filter((id) => id !== user.id) : [...form.qaMemberIds, user.id])} />{user.name}</label>)}</div></div></div>
    <div className="flex justify-end gap-2"><button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm border border-border rounded-md">Отмена</button><button type="submit" disabled={pending} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2 disabled:opacity-60" data-testid="button-submit-epic">{pending && <Loader2 size={14} className="animate-spin" />}{editing ? "Сохранить" : "Создать"}</button></div>
  </form></DialogContent></Dialog>;
}
