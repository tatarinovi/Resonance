import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateFeedback, type FeedbackType } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: Record<string, { label: string; backend: FeedbackType }> = {
  "Баг": { label: "Баг", backend: "bug" },
  "Предложение": { label: "Предложение", backend: "improvement" },
  "Вопрос": { label: "Вопрос", backend: "improvement" },
  "Другое": { label: "Другое", backend: "improvement" },
};

interface FeedbackFormProps {
  onSuccess?: () => void;
  className?: string;
}

export function FeedbackForm({ onSuccess, className }: FeedbackFormProps) {
  const [typeKey, setTypeKey] = useState("Баг");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateFeedback();

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
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить";
      toast.error(message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Тип *</label>
          <Select value={typeKey} onValueChange={setTypeKey}>
            <SelectTrigger className="text-sm" data-testid="select-feedback-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(TYPE_OPTIONS).map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Заголовок *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Кратко"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Описание *</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Подробности, шаги для воспроизведения, ожидаемое поведение..."
          rows={5}
          className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          data-testid="textarea-feedback"
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
        data-testid="button-submit-feedback"
      >
        {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Отправить
      </button>
    </form>
  );
}
