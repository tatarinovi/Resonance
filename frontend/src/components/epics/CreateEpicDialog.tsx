import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { projects } from "@/data/projects";
import { users } from "@/data/users";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { useLocation } from "@/lib/router";
import { useCreateEpic } from "@/lib/queries";
import { epicIdToRef, refIdToNumeric } from "@/lib/mappers";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";

interface CreateEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Предзаполнить проект из фильтра сайдбара */
  defaultProjectRefId?: string | null;
}

function optionalUserId(refId: string): number | undefined {
  if (!refId || refId === "none") return undefined;
  return refIdToNumeric(refId) ?? undefined;
}

export function CreateEpicDialog({ open, onOpenChange, defaultProjectRefId }: CreateEpicDialogProps) {
  const [, setLocation] = useLocation();
  const createEpic = useCreateEpic();
  const hideKanban = useIsNotaWorkspace();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [kanbanUrl, setKanbanUrl] = useState("");
  const [designUrl, setDesignUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [leadAnalystId, setLeadAnalystId] = useState("none");
  const [leadDesignerId, setLeadDesignerId] = useState("none");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setProjectId(defaultProjectRefId ?? "");
    setJiraUrl("");
    setConfluenceUrl("");
    setKanbanUrl("");
    setDesignUrl("");
    setNotes("");
    setLeadAnalystId("none");
    setLeadDesignerId("none");
    setStartDate("");
    setTargetDate("");
  }, [open, defaultProjectRefId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      toast.error("Введите название эпика");
      return;
    }
    if (!projectId) {
      toast.error("Выберите проект");
      return;
    }
    const pid = refIdToNumeric(projectId);
    if (pid == null) {
      toast.error("Некорректный проект");
      return;
    }

    try {
      const created = await createEpic.mutateAsync({
        project_id: pid,
        title: t,
        jira_url: jiraUrl.trim() || "#",
        confluence_url: confluenceUrl.trim(),
        ...(hideKanban ? {} : { kanban_url: kanbanUrl.trim() || null }),
        design_url: designUrl.trim() || null,
        notes: notes.trim() || null,
        lead_analyst_id: optionalUserId(leadAnalystId) ?? null,
        lead_designer_id: optionalUserId(leadDesignerId) ?? null,
        expert_id: null,
        start_date: startDate.trim() || null,
        target_date: targetDate.trim() || null,
      });
      toast.success("Эпик создан");
      onOpenChange(false);
      setLocation(`/epics/${epicIdToRef(created.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать эпик";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-4 max-h-[min(90vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый эпик</DialogTitle>
          <DialogDescription className="sr-only">Форма создания эпика: название, проект и ссылки.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Название *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Краткое название эпика"
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="input-epic-title"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Проект *</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="text-sm" data-testid="select-epic-project">
                <SelectValue placeholder="Выберите проект" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Старт</label>
              <DatePickerButton value={startDate} onChange={setStartDate} testId="input-epic-start-date" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Целевая дата</label>
              <DatePickerButton value={targetDate} onChange={setTargetDate} testId="input-epic-target-date" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Jira</label>
              <input
                value={jiraUrl}
                onChange={(e) => setJiraUrl(e.target.value)}
                placeholder="https://… (пусто → заглушка)"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                data-testid="input-epic-jira"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Confluence</label>
              <input
                value={confluenceUrl}
                onChange={(e) => setConfluenceUrl(e.target.value)}
                placeholder="Необязательно"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
          {hideKanban ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Дизайн</label>
              <input
                value={designUrl}
                onChange={(e) => setDesignUrl(e.target.value)}
                placeholder="Необязательно"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Kanban</label>
                <input
                  value={kanbanUrl}
                  onChange={(e) => setKanbanUrl(e.target.value)}
                  placeholder="Необязательно"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Дизайн</label>
                <input
                  value={designUrl}
                  onChange={(e) => setDesignUrl(e.target.value)}
                  placeholder="Необязательно"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Заметки</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Контекст, ссылки в тексте…"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Лид аналитики</label>
              <Select value={leadAnalystId} onValueChange={setLeadAnalystId}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Лид дизайна</label>
              <Select value={leadDesignerId} onValueChange={setLeadDesignerId}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createEpic.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2 disabled:opacity-70"
              data-testid="button-submit-epic"
            >
              {createEpic.isPending && <Loader2 size={14} className="animate-spin" />}
              Создать
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
