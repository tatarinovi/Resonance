import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Обратная связь</DialogTitle>
          <DialogDescription>
            Сообщите о проблеме или предложите улучшение. Мы сохраним заявку и вернёмся к ней.
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
