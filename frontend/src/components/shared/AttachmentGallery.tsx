import { useState } from "react";
import { FileText, Image, File, Download } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface AttachmentItem {
  id: string;
  name: string;
  size: string;
  type: string;
  url: string;
  mimeType: string;
}

const iconByType: Record<string, typeof File> = {
  pdf: FileText,
  png: Image,
  jpg: Image,
  jpeg: Image,
  webp: Image,
  gif: Image,
  avif: Image,
};

/** Только по MIME: изображения для <img>, без application/pdf и прочих не-image/* */
function isInlineImageMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("image/");
}

interface AttachmentGalleryProps {
  attachments: AttachmentItem[];
}

export function AttachmentGallery({ attachments }: AttachmentGalleryProps) {
  const [preview, setPreview] = useState<AttachmentItem | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => {
          const Icon = iconByType[a.type] ?? File;
          const previewable = isInlineImageMime(a.mimeType);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                if (previewable) setPreview(a);
                else window.open(a.url, "_blank", "noopener,noreferrer");
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/50 hover:bg-muted cursor-pointer transition-colors group text-left"
            >
              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
                <p className="text-[10px] text-muted-foreground">{a.size}</p>
              </div>
              <Download className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 flex-shrink-0" />
            </button>
          );
        })}
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent
          className="[&>div]:!max-w-[min(92vw,56rem)] [&>div]:w-full gap-3 p-4 sm:p-6"
        >
          {preview && (
            <>
              <DialogTitle className="sr-only">{preview.name}</DialogTitle>
              <DialogDescription className="sr-only">Предпросмотр изображения</DialogDescription>
              <div className="flex max-h-[min(85vh,720px)] w-full items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="max-h-[min(85vh,720px)] max-w-full object-contain"
                />
              </div>
              <p className="truncate text-center text-xs text-muted-foreground">{preview.name}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
