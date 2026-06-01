import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { ArrowLeft, Bell, BellOff, Calendar, Clock, HelpCircle, Link2, Loader2, Pencil, Send, User } from "lucide-react";
import { toast } from "sonner";

import { AttachmentGallery } from "@/components/shared/AttachmentGallery";
import { AttachmentUploader } from "@/components/shared/AttachmentUploader";
import { EmptyState } from "@/components/shared/EmptyState";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TicketMarkdown } from "@/components/shared/TicketMarkdown";
import { MarkdownEditorToolbar } from "@/components/shared/MarkdownEditorToolbar";
import { Timeline } from "@/components/shared/Timeline";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { epics } from "@/data/epics";
import { questions } from "@/data/questions";
import { users } from "@/data/users";
import {
  STATUS_FROM_REF,
  isCoordinatorRole,
  mapApiTicketToRefQuestion,
  refIdToNumeric,
  ticketStatusToRefQuestion,
  userIdToRef,
  type RefQuestionStatus,
} from "@/lib/mappers";
import type { ApiMe, ApiTicket, TicketStatus } from "@/lib/types";
import {
  useCreateTicketMessage,
  useProjectMentionUsers,
  useClaimTicketAssignee,
  useReassignTicketExpert,
  useSubscribeTicket,
  useTicket,
  useTicketReassignCandidates,
  useUnsubscribeTicket,
  useUpdateTicket,
} from "@/lib/queries";
import { formatDateLong } from "@/lib/formatDateTime";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LEGACY_QUESTION_AUDIENCE_LABELS,
  QUESTION_AUDIENCE_ALL_LABELS,
} from "@/lib/validationTeam";

function audienceLabel(slug: string | undefined | null): string {
  if (!slug) return "—";
  const k = slug as keyof typeof QUESTION_AUDIENCE_ALL_LABELS;
  return QUESTION_AUDIENCE_ALL_LABELS[k] ?? LEGACY_QUESTION_AUDIENCE_LABELS[slug] ?? slug;
}

function actorCanReassignExpert(me: ApiMe | null, ticket: ApiTicket | undefined): boolean {
  if (!me || !ticket || !["pending_approval", "forwarded"].includes(ticket.status)) return false;
  if (me.role === "admin" || isCoordinatorRole(me.role)) return true;
  return ticket.assignee_id === me.id;
}

function transitionActionLabel(target: TicketStatus, current?: TicketStatus): string {
  if (target === "pending_approval" && (current === "closed" || current === "cancelled")) {
    return "Переоткрыть";
  }
  switch (target) {
    case "pending_approval":
      return "Вернуть на проверку";
    case "forwarded":
      return "Передать эксперту";
    case "returned":
      return "Вернуть на уточнение";
    case "answered":
      return current === "forwarded" ? "Ответ готов" : "Отметить «Ожидает автора»";
    case "closed":
      return "Закрыть вопрос";
    case "cancelled":
      return "Отменить вопрос";
    default:
      return target;
  }
}

function transitionSuccessMessage(target: TicketStatus, current?: TicketStatus): string {
  if (target === "pending_approval" && (current === "closed" || current === "cancelled")) {
    return "Вопрос переоткрыт";
  }
  switch (target) {
    case "pending_approval":
      return "Вопрос возвращён на проверку";
    case "forwarded":
      return "Вопрос передан эксперту";
    case "returned":
      return "Вопрос возвращён на уточнение";
    case "answered":
      return current === "forwarded" ? "Ответ передан автору" : "Вопрос ожидает автора";
    case "closed":
      return "Вопрос закрыт";
    case "cancelled":
      return "Вопрос отменён";
    default:
      return "Статус вопроса обновлён";
  }
}

interface HistoryEntry {
  id: string;
  userId: string;
  action: string;
  date: string;
}

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = id ? refIdToNumeric(id) : null;
  const ticketQuery = useTicket(ticketId);
  const updateTicket = useUpdateTicket(ticketId ?? -1);
  const createMessage = useCreateTicketMessage(ticketId ?? -1);
  const subscribeTicket = useSubscribeTicket(ticketId ?? -1);
  const unsubscribeTicket = useUnsubscribeTicket(ticketId ?? -1);

  const [message, setMessage] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number; query: string } | null>(null);

  const q = ticketQuery.data
    ? mapApiTicketToRefQuestion(ticketQuery.data)
    : questions.find((x) => x.id === id);

  const numericProjectId = ticketQuery.data?.project_id ?? (q ? refIdToNumeric(q.projectId) : null);
  const mentionUsersQuery = useProjectMentionUsers(numericProjectId);

  const { me } = useAuth();
  const [reassignToId, setReassignToId] = useState("");
  const reassignExpert = useReassignTicketExpert(ticketId ?? -1);
  const claimAssignee = useClaimTicketAssignee(ticketId ?? -1);

  const canReassignExpert = actorCanReassignExpert(me, ticketQuery.data);
  const reassignQuery = useTicketReassignCandidates(ticketId ?? -1, {
    enabled: Boolean(canReassignExpert && ticketId != null && ticketId > 0),
  });
  const reassignCandidates = reassignQuery.data ?? [];

  const mentionSuggestions = useMemo(() => {
    if (!mentionAnchor || !mentionUsersQuery.data?.length) return [];
    const qm = mentionAnchor.query.toLowerCase();
    return mentionUsersQuery.data.filter((u) => u.username.toLowerCase().startsWith(qm));
  }, [mentionAnchor, mentionUsersQuery.data]);

  const subscribed = ticketQuery.data?.is_subscribed ?? false;
  const watchBusy = subscribeTicket.isPending || unsubscribeTicket.isPending;

  const toggleWatch = useCallback(async () => {
    if (!ticketId) return;
    try {
      if (subscribed) {
        await unsubscribeTicket.mutateAsync();
        toast.success("Вы отписались от обновлений");
      } else {
        await subscribeTicket.mutateAsync();
        toast.success("Вы будете получать уведомления об этом вопросе");
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Не удалось изменить подписку";
      toast.error(text);
    }
  }, [ticketId, subscribed, subscribeTicket, unsubscribeTicket]);

  const updateMentionFromCaret = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) {
      setMentionAnchor(null);
      return;
    }
    const frag = before.slice(at + 1);
    if (/[\s\n]/.test(frag)) {
      setMentionAnchor(null);
      return;
    }
    setMentionAnchor({ start: at, query: frag });
  };

  const insertMention = (username: string) => {
    if (!mentionAnchor || !textareaRef.current) return;
    const caret = textareaRef.current.selectionStart ?? message.length;
    const { start } = mentionAnchor;
    const newText = `${message.slice(0, start)}@${username} ${message.slice(caret)}`;
    setMessage(newText);
    setMentionAnchor(null);
    const pos = start + username.length + 2;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const history: HistoryEntry[] = !ticketQuery.data
    ? []
    : ticketQuery.data.events.map((event) => ({
        id: `EV-${event.id}`,
        userId: event.actor_id ? userIdToRef(event.actor_id) : "U-000",
        action: humanEventKind(event.kind, event.new_value),
        date: event.created_at,
      }));

  if (ticketQuery.isLoading && !q) {
    return (
      <div className="p-4 md:p-6">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!q) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          icon={HelpCircle}
          title="Вопрос не найден"
          description={`Вопрос с ID ${id} не существует`}
        />
      </div>
    );
  }

  const epic = epics.find((e) => e.id === q.epicId);
  const currentStatus = q.status;
  const apiStatus = ticketQuery.data?.status;
  const hideStagnationOnDetail =
    apiStatus === "closed" ||
    apiStatus === "cancelled" ||
    (apiStatus == null && ["Закрыт", "Отменён"].includes(currentStatus));
  const canEditQuestion =
    ticketQuery.data != null &&
    !["closed", "cancelled"].includes(ticketQuery.data.status) &&
    (me?.role === "admin" || isCoordinatorRole(me?.role) || me?.id === ticketQuery.data.author_id);
  const sendMessage = async (kind: "message" | "response" = "message") => {
    if (!message.trim() || !ticketId) return;
    try {
      await createMessage.mutateAsync({ body: message, kind });
      setMessage("");
      toast.success(kind === "response" ? "Ответ отправлен автору" : "Сообщение добавлено");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Не удалось отправить";
      toast.error(text);
    }
  };

  const performAction = async (successMessage: string, newStatus: RefQuestionStatus) => {
    if (!ticketId) return;
    try {
      await updateTicket.mutateAsync({ status: STATUS_FROM_REF[newStatus] });
      toast.success(successMessage);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Не удалось обновить статус";
      toast.error(text);
    }
  };

  const openEditQuestion = () => {
    setEditTitle(q.title);
    setEditDescription(q.description ?? "");
    setEditOpen(true);
  };

  const saveQuestionDetails = async () => {
    if (!ticketId || !editTitle.trim()) {
      toast.error("Введите заголовок");
      return;
    }
    try {
      await updateTicket.mutateAsync({
        title: editTitle.trim(),
        description: editDescription.trim() || "",
      });
      toast.success("Вопрос обновлён");
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить вопрос");
    }
  };

  const getActions = () => {
    const targets = ticketQuery.data?.allowed_target_statuses;
    const cur = ticketQuery.data?.status;
    if (!ticketId || !targets?.length) return [];
    return targets.map((target) => {
      const label = transitionActionLabel(target, cur);
      const successMessage = transitionSuccessMessage(target, cur);
      return {
        label,
        variant: target === "cancelled" ? ("destructive" as const) : undefined,
        action: () => performAction(successMessage, ticketStatusToRefQuestion(target)),
      };
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/questions">
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft size={13} /> Вопросы
        </button>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4 order-2 lg:order-1">
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-sm text-muted-foreground font-mono flex-shrink-0 mt-0.5">{q.id}</span>
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-semibold text-foreground leading-snug">{q.title}</h1>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <StatusBadge status={currentStatus} />
                  <PriorityBadge priority={q.priority} />
                  <ProjectBadge projectId={q.projectId} />
                  {typeof ticketQuery.data?.data_json?.target_direction === "string" ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                      Кому: {audienceLabel(ticketQuery.data.data_json.target_direction)}
                    </span>
                  ) : null}
                </div>
              </div>
              {canEditQuestion ? (
                <button
                  type="button"
                  onClick={openEditQuestion}
                  className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  data-testid="button-edit-question"
                >
                  <Pencil size={12} />
                  Изменить
                </button>
              ) : null}
            </div>
            {ticketQuery.data?.data_json?.reopened_to_author && ticketQuery.data.status === "pending_approval" ? (
              <div className="mt-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-foreground/90 leading-snug">
                <p className="font-medium text-amber-900 dark:text-amber-100/90">Вопрос переоткрыт</p>
                <p className="text-muted-foreground mt-0.5">
                  Внесите правки и отправьте вопрос снова на проверку координатору.
                </p>
                {me?.id === ticketQuery.data.author_id ? (
                  <button
                    type="button"
                    disabled={updateTicket.isPending}
                    onClick={() =>
                      void (async () => {
                        try {
                          await updateTicket.mutateAsync({ data_json: { clear_reopen_submission: true } });
                          toast.success("Вопрос отправлен на проверку координатору");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Не удалось отправить");
                        }
                      })()
                    }
                    className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    data-testid="button-clear-reopen-submission"
                  >
                    Отправить на проверку координатору
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="text-sm text-foreground/80 leading-relaxed border-t border-border pt-4 mt-2">
              {q.description?.trim() ? (
                <TicketMarkdown markdown={q.description} />
              ) : (
                <span className="text-muted-foreground">Без описания</span>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Вложения</h3>
            {q.attachments.length > 0 && <AttachmentGallery attachments={q.attachments} />}
            {ticketId && !["Закрыт", "Отменён"].includes(currentStatus) && (
              <div className={q.attachments.length > 0 ? "mt-3" : ""}>
                <AttachmentUploader ticketId={ticketId} />
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Обсуждение ({q.thread.length})
            </h3>
            <div className="space-y-4">
              {q.thread.map((msg) => {
                const author = users.find((u) => u.id === msg.authorId);
                return (
                  <div key={msg.id} className="flex gap-3">
                    <UserAvatar userId={msg.authorId} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{author?.name ?? msg.authorId}</span>
                        {author && (
                          <span className="text-[10px] text-muted-foreground/60 px-1.5 py-0.5 bg-muted rounded">
                            {author.role}
                          </span>
                        )}
                      </div>
                      <TicketMarkdown markdown={msg.text} className="text-sm text-foreground/85 leading-relaxed" />
                    </div>
                  </div>
                );
              })}
            </div>

            {!["Закрыт", "Отменён"].includes(currentStatus) && (
              <div className="mt-5 pt-4 border-t border-border relative">
                <MarkdownEditorToolbar
                  textareaRef={textareaRef}
                  value={message}
                  onChange={setMessage}
                  disabled={createMessage.isPending}
                  onAfterChange={(next, caret) => updateMentionFromCaret(next, caret)}
                  className="mb-2"
                />
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    updateMentionFromCaret(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMentionAnchor(null);
                  }}
                  onSelect={(e) => {
                    const t = e.currentTarget;
                    updateMentionFromCaret(t.value, t.selectionStart ?? 0);
                  }}
                  onClick={(e) => {
                    const t = e.currentTarget;
                    updateMentionFromCaret(t.value, t.selectionStart ?? 0);
                  }}
                  placeholder="Добавить сообщение… (поддерживается Markdown, @username)"
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
                  data-testid="textarea-reply"
                />
                {mentionAnchor && mentionUsersQuery.isSuccess && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 z-10 max-h-40 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                    {mentionSuggestions.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-muted-foreground">Нет пользователей по префиксу</p>
                    ) : (
                      mentionSuggestions.slice(0, 15).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          className="block w-full text-left px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            insertMention(u.username);
                          }}
                        >
                          @{u.username}
                        </button>
                      ))
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Списки, код, ссылки, выделение — через Markdown; коллег можно выбрать после символа @.
                </p>
                <div className="flex flex-wrap justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void sendMessage("message")}
                    disabled={createMessage.isPending || !message.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-70"
                    data-testid="button-send-message"
                  >
                    {createMessage.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Отправить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 order-1 lg:order-2">
          {getActions().length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Действия</h3>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {getActions().map((action, i) => (
                  <button
                    key={i}
                    onClick={action.action}
                    disabled={updateTicket.isPending}
                    className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors text-left disabled:opacity-70 ${
                      action.variant === "destructive"
                        ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
                    }`}
                    data-testid={`action-${i}`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Детали</h3>
            <InfoRow icon={User} label="Автор">
              <UserAvatar userId={q.authorId} showName size="sm" />
            </InfoRow>
            <InfoRow icon={User} label="Ответственный">
              <UserAvatar userId={q.assigneeId} showName size="sm" />
            </InfoRow>
            {ticketId && ticketQuery.data?.can_claim_assignee ? (
              <div className="pt-1">
                <button
                  type="button"
                  disabled={claimAssignee.isPending}
                  onClick={() => {
                    void (async () => {
                      if (!ticketId) return;
                      try {
                        await claimAssignee.mutateAsync();
                        toast.success("Вы назначены ответственным");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Не удалось взять на себя");
                      }
                    })();
                  }}
                  className="w-full py-1.5 px-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  data-testid="button-claim-assignee"
                >
                  {claimAssignee.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                  Взять на себя
                </button>
              </div>
            ) : null}
            {ticketId && canReassignExpert && (
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-[10px] text-muted-foreground">Передать другому</p>
                {reassignCandidates.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Нет других подходящих участников проекта для передачи.
                  </p>
                ) : (
                  <>
                    <Select value={reassignToId} onValueChange={setReassignToId}>
                      <SelectTrigger className="h-8 text-xs" data-testid="select-reassign-expert">
                        <SelectValue placeholder="Выберите эксперта" />
                      </SelectTrigger>
                      <SelectContent>
                        {reassignCandidates.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            @{e.username}
                            {e.direction
                              ? ` · ${QUESTION_AUDIENCE_ALL_LABELS[e.direction as keyof typeof QUESTION_AUDIENCE_ALL_LABELS] ?? e.direction}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      disabled={!reassignToId || reassignExpert.isPending}
                      onClick={() => {
                        void (async () => {
                          if (!ticketId || !reassignToId) return;
                          try {
                            await reassignExpert.mutateAsync({ assignee_id: Number(reassignToId) });
                            setReassignToId("");
                            toast.success("Вопрос передан другому ответственному");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Не удалось переназначить");
                          }
                        })();
                      }}
                      className="w-full py-1.5 px-2 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                      data-testid="button-reassign-expert"
                    >
                      {reassignExpert.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                      Передать
                    </button>
                  </>
                )}
              </div>
            )}
            {ticketId && !["Закрыт", "Отменён"].includes(currentStatus) && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-[10px] text-muted-foreground">Следить за вопросом</p>
                <button
                  type="button"
                  onClick={() => void toggleWatch()}
                  disabled={watchBusy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-secondary/60 hover:bg-secondary text-secondary-foreground disabled:opacity-60"
                  data-testid="button-ticket-watch"
                >
                  {watchBusy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : subscribed ? (
                    <BellOff size={12} />
                  ) : (
                    <Bell size={12} />
                  )}
                  {subscribed ? "Отписаться" : "Следить"}
                </button>
              </div>
            )}
            <InfoRow icon={Calendar} label="Создан">
              <span className="text-xs text-foreground">{formatDateLong(q.createdAt)}</span>
            </InfoRow>
            {!hideStagnationOnDetail ? (
              <InfoRow icon={Clock} label="Без движения">
                <div className="space-y-1">
                  <QuestionStagnationBadge updatedAt={q.updatedAt} />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Время с последнего изменения вопроса (статус, сообщение, вложение и т.д.).
                  </p>
                </div>
              </InfoRow>
            ) : null}
            {epic && (
              <InfoRow icon={Link2} label="Эпик">
                <Link href={`/epics/${epic.id}`}>
                  <span className="text-xs text-primary hover:underline cursor-pointer">
                    {epic.id}: {epic.name}
                  </span>
                </Link>
              </InfoRow>
            )}
          </div>

          {history.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">История</h3>
              <Timeline events={history} />
            </div>
          )}
        </div>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl mx-4">
          <DialogHeader>
            <DialogTitle>Редактировать вопрос</DialogTitle>
            <DialogDescription className="sr-only">Форма редактирования заголовка и описания вопроса.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Заголовок</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                data-testid="input-edit-question-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Описание</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={8}
                className="w-full min-h-44 px-3 py-2 text-sm bg-background border border-input rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
                data-testid="textarea-edit-question-description"
              />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setEditOpen(false)} className="px-3 py-2 text-xs font-medium rounded-md border border-border hover:bg-muted/50">
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void saveQuestionDetails()}
              disabled={updateTicket.isPending}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {updateTicket.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Сохранить
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}

function humanEventKind(kind: string, newValue: string | null): string {
  const map: Record<string, string> = {
    created: "Создал вопрос",
    status_changed: `Сменил статус${newValue ? ` → ${newValue}` : ""}`,
    forwarded: "Передал эксперту",
    assigned: `Назначил${newValue ? ` → ${newValue}` : ""}`,
    answered: "Ответил",
    closed: "Закрыл вопрос",
    cancelled: "Отменил вопрос",
    assignee_changed: "Изменён ответственный",
    returned: "Вернул на уточнение",
    message_added: "Добавил сообщение",
    attachment_added: "Прикрепил файл",
  };
  return map[kind] ?? kind;
}
