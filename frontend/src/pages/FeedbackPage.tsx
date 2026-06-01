import { useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/shared/ListPagination";
import { useCreateFeedback, useMyFeedback, type FeedbackStatus, type FeedbackType } from "@/lib/queries";
import { formatDateTime } from "@/lib/formatDateTime";

const TYPE_OPTIONS: Record<string, { label: string; backend: FeedbackType }> = {
  Баг: { label: "Баг", backend: "bug" },
  Предложение: { label: "Предложение", backend: "improvement" },
  Вопрос: { label: "Вопрос", backend: "improvement" },
  Другое: { label: "Другое", backend: "improvement" },
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "Новый",
  in_review: "На рассмотрении",
  planned: "Запланировано",
  in_progress: "В работе",
  resolved: "Принято",
  declined: "Отклонено",
};

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  new: "bg-blue-500/15 text-blue-400",
  in_review: "bg-amber-500/15 text-amber-400",
  planned: "bg-violet-500/15 text-violet-400",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  declined: "bg-red-500/15 text-red-400",
};

export default function FeedbackPage() {
  const [typeKey, setTypeKey] = useState("Баг");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const create = useCreateFeedback();
  const myFeedback = useMyFeedback({ page, page_size: pageSize });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Введите заголовок");
      return;
    }
    if (!description.trim()) {
      toast.error("Введите описание");
      return;
    }
    try {
      await create.mutateAsync({
        type: TYPE_OPTIONS[typeKey].backend,
        title: title.trim(),
        description: description.trim(),
      });
      toast.success("Обратная связь отправлена");
      setTitle("");
      setDescription("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить";
      toast.error(message);
    }
  };

  const items = myFeedback.data?.items ?? [];
  const total = myFeedback.data?.total ?? 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Обратная связь</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Сообщите о проблеме или предложите улучшение</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Новая обратная связь</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Тип *</label>
              <Select value={typeKey} onValueChange={setTypeKey}>
                <SelectTrigger className="text-sm" data-testid="select-feedback-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(TYPE_OPTIONS).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Заголовок *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Кратко"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Описание *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Подробности, шаги для воспроизведения, ожидаемое поведение..."
              rows={4}
              className="w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
              data-testid="textarea-feedback"
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-70"
            data-testid="button-submit-feedback"
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Отправить
          </button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Мои отправки ({total})</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока ничего не отправлено</p>
        ) : (
          <div className="space-y-3">
            {items.map((fb) => (
              <div
                key={fb.id}
                className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0"
                data-testid={`feedback-${fb.id}`}
              >
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <MessageSquare size={13} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[11px] text-muted-foreground font-mono">FB-{fb.id}</span>
                    <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      {fb.type === "bug" ? "Баг" : "Предложение"}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{fb.title}</p>
                  <p className="text-sm text-foreground/80 leading-relaxed mt-0.5 whitespace-pre-wrap">
                    {fb.description}
                  </p>
                  {fb.admin_response && (
                    <div className="mt-2 p-2 rounded-md bg-muted/40 text-xs text-foreground/80">
                      <span className="font-medium text-foreground">Ответ:</span> {fb.admin_response}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formatDateTime(fb.created_at)}
                  </p>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    STATUS_COLOR[fb.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[fb.status] ?? fb.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <ListPagination page={page} pageSize={pageSize} total={total} isLoading={myFeedback.isFetching} onPageChange={setPage} />
      </div>
    </div>
  );
}
