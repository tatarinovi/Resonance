import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";

interface RequireAuthProps {
  children: React.ReactNode;
}

/**
 * Redirects unauthenticated users to `/login`.
 *
 * For the main app shell, loading + auth are handled by `ShellLayoutGate` so
 * list queries can run in parallel with `/auth/me` behind one full-screen loader.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
