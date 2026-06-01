/**
 * Drop zone + file picker that uploads files via `POST /api/files/upload`
 * and immediately attaches them to a ticket via
 * `POST /api/tickets/{id}/attachments`.
 *
 * The component keeps a small per-upload state machine (idle → uploading →
 * done | error) and surfaces errors via `sonner` toasts.
 */
import { useRef, useState } from "react";
import { Loader2, Paperclip, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { useCreateTicketAttachment, useUploadFile } from "@/lib/queries";

interface AttachmentUploaderProps {
  ticketId: number;
  onUploaded?: () => void;
  className?: string;
  messageId?: number;
}

interface PendingItem {
  id: string;
  name: string;
  size: number;
  state: "uploading" | "done" | "error";
  error?: string;
}

export function AttachmentUploader({ ticketId, onUploaded, className, messageId }: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadFile();
  const attach = useCreateTicketAttachment(ticketId);
  const [items, setItems] = useState<PendingItem[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev, { id, name: file.name, size: file.size, state: "uploading" }]);
      try {
        const uploaded = await upload.mutateAsync(file);
        await attach.mutateAsync({
          url: uploaded.url,
          name: uploaded.name,
          mime_type: uploaded.mime_type,
          size_bytes: uploaded.size_bytes,
          message_id: messageId,
        });
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "done" } : it)));
        onUploaded?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
        toast.error(`${file.name}: ${message}`);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "error", error: message } : it)));
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex items-center justify-center gap-2 w-full text-xs text-muted-foreground border border-dashed border-border rounded-md py-2.5 hover:border-primary/40 hover:text-foreground transition-colors"
      >
        <Upload size={13} />
        Перетащите файл или выберите
      </button>

      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 text-xs"
            >
              <Paperclip size={12} className="text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate text-foreground/90">{item.name}</span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{humanSize(item.size)}</span>
              {item.state === "uploading" && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
              {item.state === "done" && <span className="text-[10px] text-emerald-400">готово</span>}
              {item.state === "error" && (
                <span title={item.error} className="text-[10px] text-destructive flex items-center gap-1">
                  <X size={10} /> ошибка
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
