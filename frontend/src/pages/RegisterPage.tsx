import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api";
import { validatePassword, validateUsername } from "@/lib/authCredentials";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [matrixId, setMatrixId] = useState("");
  const [direction, setDirection] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const clearMessages = () => {
    setValidationWarning(null);
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    const userErr = validateUsername(username);
    if (userErr) {
      setValidationWarning(userErr);
      return;
    }
    const passErr = validatePassword(password);
    if (passErr) {
      setValidationWarning(passErr);
      return;
    }
    if (password !== confirm) {
      setValidationWarning("Пароли не совпадают");
      return;
    }
    if (!direction.trim()) {
      setValidationWarning("Введите направление");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/register", {
        username: username.trim(),
        password,
        workspace: "ds",
        matrix_id: matrixId.trim() || null,
        direction: direction.trim(),
      });
      setSubmitted(true);
      toast.success("Заявка отправлена администратору");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось зарегистрироваться";
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-card border border-border rounded-xl p-6 text-center shadow-lg">
          <img src="/sidebar-logo.png" alt="Resonance" className="w-12 h-12 mx-auto rounded-2xl mb-4 object-cover" />
          <h2 className="text-base font-semibold text-foreground">Заявка отправлена</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Дождитесь подтверждения вашей учётной записи администратором.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-5 w-full py-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Перейти ко входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/sidebar-logo.png" alt="Resonance" className="w-12 h-12 rounded-2xl mb-4 object-cover" />
          <h1 className="text-xl font-semibold text-foreground">Запрос доступа</h1>
          <p className="text-sm text-muted-foreground mt-1">
            После заполнения формы дождитесь подтверждения администратора
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Логин">
              <input
                name="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearMessages();
                }}
                placeholder="username"
                autoComplete="username"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </Field>
            <Field label="Пароль">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearMessages();
                }}
                placeholder="не короче 6 символов"
                autoComplete="new-password"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </Field>
            <Field label="Подтверждение пароля">
              <input
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  clearMessages();
                }}
                placeholder="повторите пароль"
                autoComplete="new-password"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </Field>
            <Field label="Matrix ID (опционально)">
              <input
                value={matrixId}
                onChange={(e) => setMatrixId(e.target.value)}
                placeholder="@user:matrix.example.com"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </Field>
            <Field label="Направление *">
              <input
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  clearMessages();
                }}
                placeholder="Например: QA, Project Manager, Team Lead"
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </Field>
            {validationWarning && (
              <Alert
                className={cn(
                  "py-2.5 border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-300",
                )}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Проверьте ввод</AlertTitle>
                <AlertDescription className="text-xs">{validationWarning}</AlertDescription>
              </Alert>
            )}
            {submitError && (
              <Alert variant="destructive" className="py-2.5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Не удалось отправить заявку</AlertTitle>
                <AlertDescription className="text-xs">{submitError}</AlertDescription>
              </Alert>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Отправить заявку
            </button>
            <div className="text-center text-xs text-muted-foreground">
              <Link to="/login" className="text-primary hover:underline">
                Уже есть аккаунт? Войти
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}
