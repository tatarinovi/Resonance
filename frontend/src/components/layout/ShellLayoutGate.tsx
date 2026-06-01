import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { useBridgeListsReady } from "@/contexts/DataBridge";
import { NotificationProvider } from "@/contexts/NotificationContext";

import { AppShell } from "./AppShell";

interface ShellLayoutGateProps {
  children: ReactNode;
}

/**
 * Single full-screen loading state for the authenticated shell: waits for
 * `GET /auth/me` and for the DataBridge list queries (`isFetched`) before
 * mounting the sidebar/header and the route page — avoids two sequential loaders.
 */
export function ShellLayoutGate({ children }: ShellLayoutGateProps) {
  const { isLoading, isAuthenticated } = useAuth();
  const listsReady = useBridgeListsReady();
  const location = useLocation();

  if (!isLoading && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isLoading || !listsReady) {
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-background"
        role="status"
        aria-busy="true"
        aria-label="Загрузка"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary/70" aria-hidden />
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  return (
    <NotificationProvider>
      <AppShell>{children}</AppShell>
    </NotificationProvider>
  );
}
