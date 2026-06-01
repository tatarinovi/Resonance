import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Radio, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError } from "@/lib/api";
import { validatePassword, validateUsername } from "@/lib/authCredentials";
import { cn } from "@/lib/utils";

interface LocationState {
  from?: { pathname?: string };
}

function mapAuthErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const m = err.message;
    if (m === "Invalid credentials") return "Неверный логин или пароль";
    if (/account is waiting for admin approval/i.test(m)) {
      return "Учётная запись ожидает подтверждения администратором";
    }
    return m;
  }
  return err instanceof Error ? err.message : "Не удалось войти";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as LocationState | null)?.from?.pathname ?? "/";

  const clearMessages = () => {
    setValidationWarning(null);
    setAuthError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    const userErr = validateUsername(username);
    const passErr = validatePassword(password);
    const first = userErr ?? passErr;
    if (first) {
      setValidationWarning(first);
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast.success("Добро пожаловать");
      navigate(fromPath, { replace: true });
    } catch (err) {
      setAuthError(mapAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <Radio size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Resonance</h1>
          <p className="text-sm text-muted-foreground mt-1">Операционная рабочая среда</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Логин
              </label>
              <input
                type="text"
                name="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearMessages();
                }}
                placeholder="username"
                autoComplete="username"
                autoFocus
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                data-testid="input-username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearMessages();
                  }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-3 py-2 pr-9 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-password"
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {validationWarning && (
              <Alert
                className={cn(
                  "py-2.5 border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-300",
                )}
                data-testid="alert-validation"
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Проверьте ввод</AlertTitle>
                <AlertDescription className="text-xs">{validationWarning}</AlertDescription>
              </Alert>
            )}
            {authError && (
              <Alert variant="destructive" className="py-2.5" data-testid="alert-auth-error">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Не удалось войти</AlertTitle>
                <AlertDescription className="text-xs">{authError}</AlertDescription>
              </Alert>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              data-testid="button-login"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Войти
            </button>
            <div className="text-center text-xs text-muted-foreground">
              <span>Нет аккаунта? </span>
              <Link to="/register" className="text-primary hover:underline">
                Запросить доступ
              </Link>
            </div>
          </form>
        </div>
        <p className="text-center text-[11px] text-muted-foreground/50 mt-5">
          Внутренняя система. Только для сотрудников.
        </p>
      </div>
    </div>
  );
}
