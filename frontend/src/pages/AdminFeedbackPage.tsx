import { useEffect, useState } from "react";
import { ClipboardList, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useAdminFeedback,
  useUpdateAdminFeedback,
  type ApiFeedback,
  type FeedbackStatus,
  type FeedbackType,
} from "@/lib/queries";
import { formatDateTime } from "@/lib/formatDateTime";

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "Новый",
  in_review: "На рассмотрении",
  planned: "Запланировано",
  in_progress: "В работе",
  resolved: "Принято",
  declined: "Отклонено",
};

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  in_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  planned: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  declined: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const ALL_STATUSES: FeedbackStatus[] = [
  "new",
  "in_review",
  "planned",
  "in_progress",
  "resolved",
  "declined",
];

const TYPE_LABEL: Record<FeedbackType, string> = {
  bug: "Баг",
  improvement: "Предложение",
};

export default function AdminFeedbackPage() {
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FeedbackType>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, debouncedSearch]);

  const list = useAdminFeedback({
    status: statusFilter === "all" ? null : statusFilter,
    type: typeFilter === "all" ? null : typeFilter,
    search: debouncedSearch || undefined,
    page,
    page_size: pageSize,
  });

  const update = useUpdateAdminFeedback();

  const [selected, setSelected] = useState<ApiFeedback | null>(null);
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>("new");
  const [draftResponse, setDraftResponse] = useState("");

  useEffect(() => {
    if (!selected) return;
    setDraftStatus(selected.status);
    setDraftResponse(selected.admin_response ?? "");
  }, [selected]);

  const handleSave = async () => {
    if (!selected) return;
    try {
      await update.mutateAsync({
        id: selected.id,
        body: {
          status: draftStatus,
          admin_response: draftResponse.trim() === "" ? "" : draftResponse,
        },
      });
      toast.success("Сохранено");
      setSelected(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить";
      toast.error(message);
    }
  };

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Заявки обратной связи</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Просмотр и ответы на сообщения пользователей
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="w-full sm:w-44">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Статус</label>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "all" | FeedbackStatus)}
          >
            <SelectTrigger className="text-sm h-9" data-testid="admin-feedback-filter-status">
              <SelectValue placeholder="Все" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Тип</label>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | FeedbackType)}>
            <SelectTrigger className="text-sm h-9" data-testid="admin-feedback-filter-type">
              <SelectValue placeholder="Все" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="bug">{TYPE_LABEL.bug}</SelectItem>
              <SelectItem value="improvement">{TYPE_LABEL.improvement}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Поиск</label>
          <div className="relative">
            <Search
              size={15}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Заголовок, текст, автор…"
              className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 h-9"
              data-testid="admin-feedback-search"
            />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl">
        {list.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Нет заявок"
            description="Измените фильтры или дождитесь новых сообщений от пользователей."
          />
        ) : (
          <div className="divide-y divide-border/80">
            {items.map((fb) => (
              <button
                key={fb.id}
                type="button"
                onClick={() => setSelected(fb)}
                className="w-full text-left px-4 py-3 flex gap-3 hover:bg-muted/40 transition-colors"
                data-testid={`admin-feedback-row-${fb.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[11px] text-muted-foreground font-mono">FB-{fb.id}</span>
                    <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      {TYPE_LABEL[fb.type]}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{fb.author_username}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{fb.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(fb.created_at)}</p>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 self-start ${
                    STATUS_COLOR[fb.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[fb.status] ?? fb.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <ListPagination page={page} pageSize={pageSize} total={total} isLoading={list.isFetching} onPageChange={setPage} />

      <Sheet open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
          {selected && (
            <>
              <SheetHeader className="p-6 pb-4 border-b border-border">
                <SheetTitle className="pr-8 text-left">
                  <span className="text-[11px] text-muted-foreground font-mono font-normal">
                    FB-{selected.id}
                  </span>
                  <span className="block text-base mt-1">{selected.title}</span>
                </SheetTitle>
                <p className="text-xs text-muted-foreground text-left">
                  {selected.author_username} · {formatDateTime(selected.created_at)}
                </p>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Описание</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{selected.description}</p>
                </div>
                {selected.context_url && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Контекст</p>
                    <a
                      href={selected.context_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {selected.context_url}
                    </a>
                  </div>
                )}
                {selected.expected_result && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Ожидаемый результат</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{selected.expected_result}</p>
                  </div>
                )}
                {selected.steps_to_reproduce && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Шаги воспроизведения</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{selected.steps_to_reproduce}</p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Статус</label>
                  <Select value={draftStatus} onValueChange={(v) => setDraftStatus(v as FeedbackStatus)}>
                    <SelectTrigger className="text-sm" data-testid="admin-feedback-edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    Ответ пользователю
                  </label>
                  <textarea
                    value={draftResponse}
                    onChange={(e) => setDraftResponse(e.target.value)}
                    rows={5}
                    placeholder="Текст ответа отображается у автора заявки…"
                    className="w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
                    data-testid="admin-feedback-edit-response"
                  />
                </div>

                {selected.responded_at && (
                  <p className="text-[11px] text-muted-foreground">
                    Последний ответ: {selected.responder_username ?? "—"} ·{" "}
                    {formatDateTime(selected.responded_at)}
                  </p>
                )}
              </div>

              <SheetFooter className="p-6 pt-4 border-t border-border mt-auto">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/60 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={update.isPending}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-70 flex items-center gap-1.5"
                  data-testid="admin-feedback-save"
                >
                  {update.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                  Сохранить
                </button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
