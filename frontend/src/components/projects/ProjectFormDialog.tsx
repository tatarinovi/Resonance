import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { users } from "@/data/users";
import { refIdToNumeric, userIdToRef } from "@/lib/mappers";
import { useReferenceData } from "@/lib/queries";
import type { ApiProject } from "@/lib/types";

export type ProjectFormValues = {
  name: string;
  config_json: Record<string, unknown>;
};

const MATRIX_DIRECTIONS = [
  ["analytics", "Аналитика"],
  ["design", "Дизайн"],
  ["back", "Backend"],
  ["front", "Frontend"],
  ["qa", "QA"],
] as const;

const PROJECT_FORM_TABS = [
  ["main", "Основное"],
  ["team", "Команда"],
  ["matrix", "Matrix"],
] as const;

type ProjectFormTab = typeof PROJECT_FORM_TABS[number][0];

interface ProjectFormDialogProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProject?: ApiProject | null;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  busy: boolean;
  /** Редактирование: удалить проект (обычно только для админа с родительской страницы). */
  onDelete?: () => void;
  deleteBusy?: boolean;
}

function userIdsFromConfig(config: Record<string, unknown> | undefined): number[] {
  const ids = config?.user_ids;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
}

function descriptionFromConfig(config: Record<string, unknown> | undefined): string {
  const description = config?.description;
  return typeof description === "string" ? description : "";
}

function stringFromConfig(config: Record<string, unknown> | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function stringRecordFromConfig(config: Record<string, unknown> | undefined, key: string): Record<string, string> {
  const value = config?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function ProjectFormDialog({
  title,
  open,
  onOpenChange,
  initialProject,
  onSubmit,
  busy,
  onDelete,
  deleteBusy = false,
}: ProjectFormDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [userIds, setUserIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<ProjectFormTab>("main");
  const [teamSearch, setTeamSearch] = useState("");
  const [mainProjectRoom, setMainProjectRoom] = useState("");
  const [expertRooms, setExpertRooms] = useState<Record<string, string>>({});
  const [morningDigestEnabled, setMorningDigestEnabled] = useState(false);
  const [eveningDigestEnabled, setEveningDigestEnabled] = useState(false);
  const [notifyExpertRooms, setNotifyExpertRooms] = useState(false);
  const reference = useReferenceData();
  const matrixDirections = reference.data?.matrix_directions?.length
    ? reference.data.matrix_directions
    : MATRIX_DIRECTIONS.map(([value, label]) => ({ value, label }));

  useEffect(() => {
    if (!open) return;
    const config = initialProject?.config_json;
    setActiveTab("main");
    setTeamSearch("");
    setName(initialProject?.name ?? "");
    setDescription(descriptionFromConfig(config));
    setUserIds(userIdsFromConfig(config));
    setMainProjectRoom(stringFromConfig(config, "main_project_room"));
    setExpertRooms(stringRecordFromConfig(config, "expert_rooms"));
    setMorningDigestEnabled(config?.morning_digest_enabled === true);
    setEveningDigestEnabled(config?.evening_digest_enabled === true);
    setNotifyExpertRooms(config?.notify_new_questions_to_expert_rooms === true);
  }, [open, initialProject]);

  const toggleUser = (id: number) => {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const updateRecordValue = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    key: string,
    value: string
  ) => {
    setter((prev) => ({ ...prev, [key]: value }));
  };

  const cleanRecord = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  const filteredUsers = users.filter((u) => {
    const query = teamSearch.trim().toLowerCase();
    if (!query) return true;
    return `${u.name} ${u.email}`.toLowerCase().includes(query);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Укажите название проекта");
      setActiveTab("main");
      return;
    }
    if ((morningDigestEnabled || eveningDigestEnabled) && !mainProjectRoom.trim()) {
      toast.error("Укажите главный чат проекта для дайджестов");
      setActiveTab("matrix");
      return;
    }

    await onSubmit({
      name: trimmedName,
      config_json: {
        ...(initialProject?.config_json ?? {}),
        description: description.trim(),
        user_ids: userIds,
        main_project_room: mainProjectRoom.trim(),
        expert_rooms: cleanRecord(expertRooms),
        morning_digest_enabled: morningDigestEnabled,
        evening_digest_enabled: eveningDigestEnabled,
        notify_new_questions_to_expert_rooms: notifyExpertRooms,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Форма проекта: название, описание и участники.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="flex gap-1 rounded-md bg-muted/40 p-1">
            {PROJECT_FORM_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "main" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Название *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-project-name"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Описание</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="textarea-project-description"
                />
              </div>
            </div>
          )}

          {activeTab === "team" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="project-team-search">
                  Поиск по логину
                </label>
                <input
                  id="project-team-search"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Начните вводить логин"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-project-team-search"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Команда проекта</label>
                <div className="rounded-md border border-border p-2 space-y-2 max-h-72 overflow-y-auto">
                  {filteredUsers.map((u) => {
                    const numericId = refIdToNumeric(u.id);
                    if (numericId == null) return null;
                    return (
                      <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox checked={userIds.includes(numericId)} onCheckedChange={() => toggleUser(numericId)} />
                        <span className="min-w-0 truncate">
                          {u.name} <span className="text-xs text-muted-foreground">({u.role})</span>
                        </span>
                      </label>
                    );
                  })}
                  {users.length === 0 && <p className="text-xs text-muted-foreground">Пользователи ещё не загружены</p>}
                  {users.length > 0 && filteredUsers.length === 0 && (
                    <p className="text-xs text-muted-foreground">По этому логину никого не нашли</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "matrix" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Главный чат проекта</label>
                <input
                  value={mainProjectRoom}
                  onChange={(e) => setMainProjectRoom(e.target.value)}
                  placeholder="!main-room:matrix.example.org"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Сюда уходят утренний и вечерний дайджесты проекта. Обязательно, если включён любой дайджест.
                </p>
              </div>

              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Комнаты направлений</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Сюда уходят короткие уведомления о вопросах, переданных экспертам по направлению. Несколько направлений могут указывать на один и тот же чат.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {matrixDirections.map(({ value: key, label }) => (
                    <div key={key}>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}: комната</label>
                      <input
                        value={expertRooms[key] ?? ""}
                        onChange={(e) => updateRecordValue(setExpertRooms, key, e.target.value)}
                        placeholder="!room:matrix.example.org"
                        className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={morningDigestEnabled} onCheckedChange={(v) => setMorningDigestEnabled(v === true)} />
                  <span>
                    Утренний дайджест
                    <span className="block text-xs text-muted-foreground">
                      Отправляется в главный чат проекта и показывает вопросы со статусом «У эксперта».
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={eveningDigestEnabled} onCheckedChange={(v) => setEveningDigestEnabled(v === true)} />
                  <span>
                    Вечерний дайджест
                    <span className="block text-xs text-muted-foreground">
                      Отправляется в главный чат проекта и считает «У эксперта», «На уточнении» и «Ожидает автора».
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={notifyExpertRooms} onCheckedChange={(v) => setNotifyExpertRooms(v === true)} />
                  <span>
                    Уведомлять комнаты экспертов
                    <span className="block text-xs text-muted-foreground">
                      Новые уведомления уходят в комнату выбранного направления, когда вопрос передан эксперту.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-border">
            <div>
              {initialProject != null && onDelete && (
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={onDelete}
                  className="px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-md disabled:opacity-70"
                  data-testid="button-delete-project-form"
                >
                  Удалить проект
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 ml-auto">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-70 flex items-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function apiProjectForRef(apiProjects: ApiProject[] | undefined, refId: string | null | undefined): ApiProject | null {
  if (!apiProjects || !refId) return null;
  const id = refIdToNumeric(refId);
  if (id == null) return null;
  return apiProjects.find((project) => project.id === id) ?? null;
}

export function projectTeamIds(project: ApiProject | null | undefined): string[] {
  return userIdsFromConfig(project?.config_json).map(userIdToRef);
}
