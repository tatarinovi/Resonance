import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { useKanbanConnect } from "@/lib/queries";

interface KanbanLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KanbanLoginDialog({ open, onOpenChange }: KanbanLoginDialogProps) {
  const connect = useKanbanConnect();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = useMemo(() => email.trim().length > 0 && password.length > 0 && !connect.isPending, [
    email,
    password,
    connect.isPending,
  ]);

  useEffect(() => {
    if (!open) return;
    setPassword("");
  }, [open]);

  const submit = async () => {
    try {
      await connect.mutateAsync({ email: email.trim(), password });
      toast.success("Kanban подключён");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось подключить Kanban");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Вход в Kanban</DialogTitle>
        <DialogDescription>
          Введите учётные данные Kanban. Они используются для получения токена и сохраняются только токеном на сервере.
          Доступно только администраторам Resonance.
        </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="kanban-login-email">
              Email
            </label>
            <input
              id="kanban-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.ru"
              autoComplete="username"
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="kanban-login-email"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="kanban-login-password">
              Пароль
            </label>
            <input
              id="kanban-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="kanban-login-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void submit();
              }}
            />
          </div>

          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="kanban-login-submit"
          >
            {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Войти
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

