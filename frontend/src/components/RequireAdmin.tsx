import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";

interface RequireAdminProps {
  children: ReactNode;
}

/** `/admin/*` UI routes that must match backend `require_admin`. */
export function RequireAdmin({ children }: RequireAdminProps) {
  const { me, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      </div>
    );
  }

  if (me?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
