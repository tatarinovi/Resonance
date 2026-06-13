import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { ListPagination } from "@/components/shared/ListPagination";
import { useMyFeedback, type FeedbackStatus } from "@/lib/queries";
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

export default function FeedbackPage() {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const myFeedback = useMyFeedback({ page, page_size: pageSize });

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
        <FeedbackForm />
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
