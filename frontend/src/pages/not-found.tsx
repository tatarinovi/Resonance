import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, FileQuestion, Home, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      </div>
    );
  }

  const fullPath = `${location.pathname}${location.search}${location.hash}`;
  const displayPath = fullPath || "/";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg border-border shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted/60"
              aria-hidden
            >
              <FileQuestion className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ошибка 404</p>
              <CardTitle className="text-xl leading-tight">Страница не найдена</CardTitle>
            </div>
          </div>
          <CardDescription className="text-base leading-relaxed text-muted-foreground">
            По этому адресу в приложении ничего не зарегистрировано. Чаще всего так бывает, если ссылка
            устарела, раздел переименовали или в URL есть опечатка.
          </CardDescription>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Запрошенный путь</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground" title={displayPath}>
              {displayPath}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild className="w-full sm:w-auto">
            <Link to={isAuthenticated ? "/" : "/login"} replace>
              {isAuthenticated ? (
                <>
                  <Home className="h-4 w-4" aria-hidden />
                  На главную
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" aria-hidden />
                  Войти
                </>
              )}
            </Link>
          </Button>
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Назад
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
