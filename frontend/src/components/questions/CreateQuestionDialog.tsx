import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TicketMarkdown } from "@/components/shared/TicketMarkdown";
import { MarkdownEditorToolbar } from "@/components/shared/MarkdownEditorToolbar";
import { projects } from "@/data/projects";
import { useAuth } from "@/contexts/AuthContext";
import { useQuestionDraftPresence } from "@/hooks/useQuestionDraftPresence";
import { formatDateTime } from "@/lib/formatDateTime";
import { useCreateTicket, useEpics, useReferenceData } from "@/lib/queries";
import {
  clearQuestionDraft,
  draftToFormFields,
  QUESTION_DRAFT_IDLE_MS,
  readQuestionDraft,
  shouldPersistQuestionDraft,
  writeQuestionDraft,
} from "@/lib/questionDraftStorage";
import { PRIORITY_FROM_REF, isCoordinatorRole, refIdToNumeric, type RefPriority } from "@/lib/mappers";
import type { ApiEpic, ApiMe } from "@/lib/types";
import {
  QUESTION_AUDIENCE_ALL_LABELS,
  QUESTION_AUDIENCE_ALL_SLUGS,
  QUESTION_AUDIENCE_DOMAIN_SLUGS,
  QUESTION_AUDIENCE_ENG_SLUGS,
  type QuestionAudienceAllSlug,
} from "@/lib/validationTeam";
import { cn } from "@/lib/utils";

const priorities = ["Критический", "Высокий", "Средний", "Низкий"] as const;

function isEpicOpenForNewQuestions(epic: ApiEpic): boolean {
  return epic.status !== "released";
}

type CreateAudienceMode = "domain" | "engineering" | "admin";

function audienceModeForUser(me: ApiMe | null): CreateAudienceMode {
  if (!me) return "domain";
  if (me.role === "admin") return "admin";
  if (me.role === "expert") return "engineering";
  if (isCoordinatorRole(me.role)) return "admin";
  return "domain";
}

function audienceOptionsForMode(mode: CreateAudienceMode): readonly QuestionAudienceAllSlug[] {
  if (mode === "admin") return QUESTION_AUDIENCE_ALL_SLUGS;
  if (mode === "engineering") return QUESTION_AUDIENCE_ENG_SLUGS;
  return QUESTION_AUDIENCE_DOMAIN_SLUGS;
}

interface CreateQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectRefId?: string | null;
}

type QuestionFormState = {
  title: string;
  description: string;
  projectId: string;
  priority: RefPriority;
  audience: QuestionAudienceAllSlug | "";
  epicId: number | null;
};

function emptyForm(defaultProjectRefId?: string | null): QuestionFormState {
  return {
    title: "",
    description: "",
    projectId: defaultProjectRefId?.trim() ? defaultProjectRefId : "",
    priority: "Средний",
    audience: "",
    epicId: null,
  };
}

export function CreateQuestionDialog({ open, onOpenChange, defaultProjectRefId }: CreateQuestionDialogProps) {
  const { me, isLoading } = useAuth();
  const userId = me?.id ?? null;
  const hasDraftInStorage = useQuestionDraftPresence(userId);
  const audienceMode = useMemo(() => audienceModeForUser(me ?? null), [me]);

  const createTicket = useCreateTicket();
  const reference = useReferenceData();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const dialogWasOpenRef = useRef(false);
  const [form, setForm] = useState<QuestionFormState>(() => emptyForm(defaultProjectRefId));
  const [restorePromptOpen, setRestorePromptOpen] = useState(false);
  const [epicComboOpen, setEpicComboOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const projectNumericId = useMemo(() => refIdToNumeric(form.projectId), [form.projectId]);
  const epicsQuery = useEpics(projectNumericId ? { project_id: projectNumericId, page: 1, page_size: 100 } : {}, {
    enabled: open && projectNumericId != null,
  });
  const epicOptions = useMemo(() => {
    const list = epicsQuery.data?.items ?? [];
    return list.filter(isEpicOpenForNewQuestions).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }, [epicsQuery.data]);
  const priorityOptions = useMemo(
    () =>
      priorities.map((value, index) => ({
        value,
        label: reference.data?.question_priorities?.[index]?.label ?? value,
      })),
    [reference.data],
  );
  const audienceLabelMap = useMemo(() => {
    const entries = [
      ...(reference.data?.role_directions?.expert ?? []),
      ...(reference.data?.role_directions?.employee ?? []),
      ...(reference.data?.role_directions?.coordinator ?? []),
    ];
    return new Map(entries.map((option) => [option.value, option.label]));
  }, [reference.data]);

  const selectedEpicTitle = useMemo(() => {
    if (form.epicId == null || form.epicId < 1) return "";
    return epicOptions.find((e) => e.id === form.epicId)?.title ?? "";
  }, [form.epicId, epicOptions]);

  const reset = () => {
    setForm(emptyForm(defaultProjectRefId));
  };

  useEffect(() => {
    if (!open) {
      dialogWasOpenRef.current = false;
      setRestorePromptOpen(false);
      setEpicComboOpen(false);
      setPreviewOpen(false);
      return;
    }
    if (isLoading) return;

    if (!dialogWasOpenRef.current) {
      dialogWasOpenRef.current = true;
      if (userId != null && readQuestionDraft(userId)) {
        setRestorePromptOpen(true);
        return;
      }
      setForm(emptyForm(defaultProjectRefId));
    }
  }, [open, defaultProjectRefId, userId, isLoading]);

  useEffect(() => {
    if (!open || userId == null || createTicket.isPending || restorePromptOpen) return;
    const draftFields = {
      title: form.title,
      description: form.description,
      projectId: form.projectId,
      priority: form.priority,
      validationTeam: form.audience,
      epicId: form.epicId,
    };
    if (!shouldPersistQuestionDraft(draftFields)) return;

    const t = window.setTimeout(() => {
      writeQuestionDraft(userId, draftFields);
    }, QUESTION_DRAFT_IDLE_MS);

    return () => window.clearTimeout(t);
  }, [open, userId, form, createTicket.isPending, restorePromptOpen]);

  useEffect(() => {
    if (!open) return;
    if (!projectNumericId || !epicsQuery.isSuccess) return;
    const list = epicsQuery.data?.items ?? [];
    setForm((f) => {
      if (f.epicId == null) return f;
      const epic = list.find((e) => e.id === f.epicId);
      if (epic && isEpicOpenForNewQuestions(epic)) return f;
      return { ...f, epicId: null };
    });
  }, [open, projectNumericId, epicsQuery.isSuccess, epicsQuery.data]);

  useEffect(() => {
    if (!open || !me) return;
    const allowed = audienceOptionsForMode(audienceMode);
    setForm((f) => {
      if (!f.audience) return f;
      if ((allowed as readonly string[]).includes(f.audience)) return f;
      return { ...f, audience: "" };
    });
  }, [open, me, audienceMode]);

  const applyDraftFromStorage = () => {
    if (userId == null) {
      setRestorePromptOpen(false);
      return;
    }
    const d = readQuestionDraft(userId);
    if (!d) {
      setRestorePromptOpen(false);
      return;
    }
    const fields = draftToFormFields(d);
    setForm({
      title: fields.title,
      description: fields.description,
      projectId: fields.projectId,
      priority: fields.priority,
      audience: (fields.validationTeam as QuestionAudienceAllSlug | "") || "",
      epicId: d.epicId ?? null,
    });
    setRestorePromptOpen(false);
  };

  const discardDraftAndResetForm = () => {
    clearQuestionDraft(userId);
    setForm(emptyForm(defaultProjectRefId));
    setRestorePromptOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Введите заголовок");
      return;
    }
    if (!form.projectId) {
      toast.error("Выберите проект");
      return;
    }
    if (!form.audience) {
      toast.error("Выберите, кому адресован вопрос");
      return;
    }
    if (form.epicId == null || form.epicId < 1) {
      toast.error("Выберите эпик");
      return;
    }
    const projectIdNumeric = refIdToNumeric(form.projectId);
    if (!projectIdNumeric) {
      toast.error("Некорректный проект");
      return;
    }
    try {
      await createTicket.mutateAsync({
        project_id: projectIdNumeric,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: PRIORITY_FROM_REF[form.priority],
        epic_id: form.epicId,
        data_json: { target_direction: form.audience },
      });
      clearQuestionDraft(userId);
      toast.success(`Вопрос создан: ${form.title}`);
      onOpenChange(false);
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать вопрос";
      toast.error(message);
    }
  };

  const draftForPrompt = userId != null && restorePromptOpen ? readQuestionDraft(userId) : null;
  const audienceHelp =
    audienceMode === "engineering"
      ? "Вопрос сразу уходит лиду выбранного направления (QA, Front или Back) без проверки координатором."
      : audienceMode === "admin"
        ? "После выбора доменных направлений (аналитика, дизайн) вопрос сначала на согласовании у координатора; инженерные направления — сразу к лиду."
        : "После согласования координатором вопрос будет назначен лиду эпика (аналитик или дизайнер) в соответствии с выбором.";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-2xl mx-4 max-h-[min(92vh,780px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Задать вопрос</DialogTitle>
            <DialogDescription className="sr-only">
              Форма создания вопроса: заголовок, описание, адресат, проект, эпик и приоритет.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Заголовок *</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Краткое описание вопроса"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                data-testid="input-question-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Описание</label>
              <MarkdownEditorToolbar
                textareaRef={descriptionRef}
                value={form.description}
                onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                disabled={createTicket.isPending}
                className="mb-1.5"
              />
              <textarea
                ref={descriptionRef}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Подробное описание… (Markdown: списки, `код`, **жирный**, ссылки)"
                rows={7}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y min-h-40"
                data-testid="textarea-question-description"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground">Поддерживается безопасный Markdown (без HTML и таблиц).</p>
                <button
                  type="button"
                  onClick={() => setPreviewOpen((v) => !v)}
                  className="text-[11px] font-medium text-primary hover:underline"
                  data-testid="button-toggle-question-preview"
                >
                  {previewOpen ? "Скрыть предпросмотр" : "Предпросмотр"}
                </button>
              </div>
              {previewOpen && form.description.trim() ? (
                <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 max-h-40 overflow-y-auto">
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Предпросмотр</p>
                  <TicketMarkdown markdown={form.description} className="text-xs" />
                </div>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Кому адресован *</label>
              <Select
                value={form.audience}
                onValueChange={(v) => setForm((f) => ({ ...f, audience: v as QuestionAudienceAllSlug }))}
              >
                <SelectTrigger className="text-sm" data-testid="select-question-audience">
                  <SelectValue placeholder="Выберите направление" />
                </SelectTrigger>
                <SelectContent>
                  {audienceOptionsForMode(audienceMode).map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {audienceLabelMap.get(slug) ?? QUESTION_AUDIENCE_ALL_LABELS[slug]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">{audienceHelp}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Проект *</label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) => setForm((f) => ({ ...f, projectId: v, epicId: null }))}
                >
                  <SelectTrigger className="text-sm" data-testid="select-question-project">
                    <SelectValue placeholder="Выберите" />
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
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Приоритет</label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as RefPriority }))}>
                  <SelectTrigger className="text-sm" data-testid="select-question-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Эпик *</label>
              <Popover open={epicComboOpen} onOpenChange={setEpicComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={epicComboOpen}
                    disabled={!form.projectId || epicsQuery.isLoading || createTicket.isPending}
                    className="w-full justify-between h-9 px-3 text-sm font-normal text-left"
                    data-testid="select-question-epic"
                  >
                    <span className="truncate">
                      {form.projectId
                        ? selectedEpicTitle || "Выберите эпик…"
                        : "Сначала выберите проект"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Поиск по названию…" />
                    <CommandList>
                      <CommandEmpty>
                        {form.projectId ? "Нет подходящих эпиков" : "Выберите проект"}
                      </CommandEmpty>
                      <CommandGroup>
                        {epicOptions.map((epic) => (
                          <CommandItem
                            key={epic.id}
                            value={`${epic.title} ${epic.id}`}
                            onSelect={() => {
                              setForm((f) => ({ ...f, epicId: epic.id }));
                              setEpicComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.epicId === epic.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="truncate">{epic.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-[10px] text-muted-foreground mt-1">
                Эпик обязателен: после согласования вопрос пойдёт к лиду эпика (для аналитики и дизайна).
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {userId != null && hasDraftInStorage ? (
                <button
                  type="button"
                  onClick={() => discardDraftAndResetForm()}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  data-testid="button-discard-question-draft"
                >
                  Сбросить черновик
                </button>
              ) : (
                <span />
              )}
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
                  disabled={createTicket.isPending}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-70 flex items-center gap-2"
                >
                  {createTicket.isPending && <Loader2 size={14} className="animate-spin" />}
                  Создать
                </button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={restorePromptOpen} onOpenChange={setRestorePromptOpen}>
        <AlertDialogContent className="z-[60]">
          <AlertDialogHeader>
            <AlertDialogTitle>Найден черновик вопроса</AlertDialogTitle>
            <AlertDialogDescription>
              {draftForPrompt ? (
                <>
                  Продолжить черновик от {formatDateTime(draftForPrompt.updatedAt)}? Текущий текст в форме будет заменён.
                </>
              ) : (
                <>Черновик больше не найден.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={() => discardDraftAndResetForm()}>
              Начать заново
            </AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => applyDraftFromStorage()} disabled={!draftForPrompt}>
              Продолжить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
