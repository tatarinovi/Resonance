/**
 * Real auth context backed by JWT in localStorage and `GET /api/auth/me`.
 * Replaces the mock `RoleContext` from the reference; we still re-export a
 * `useRole()` shim so untouched pages keep compiling.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api, tokenStorage } from "@/lib/api";
import type { ApiMe } from "@/lib/types";
import { mapApiUserToRefUser, type RefUser } from "@/lib/mappers";

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  me: ApiMe | null;
  currentUser: RefUser;
  setCurrentUserId: (id: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const guestUser: RefUser = {
  id: "guest",
  name: "Guest",
  email: "",
  role: "Разработчик",
  avatarInitials: "G",
  projectIds: [],
  isActive: false,
  lastActive: null,
};

function invalidateBridgeQueries(qc: QueryClient): void {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return (
        k === "tickets" ||
        k === "projects" ||
        k === "epics" ||
        k === "notifications" ||
        k === "activity" ||
        k === "users" ||
        k === "directory-users"
      );
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<ApiMe | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(tokenStorage.get()));
  const [error, setError] = useState<string | null>(null);

  const fetchMe = useCallback(async () => {
    if (!tokenStorage.get()) {
      setMe(null);
      setIsLoading(false);
      return;
    }
    try {
      const data = await api.get<ApiMe>("/auth/me");
      setMe(data);
      setError(null);
      // Defer until after React commits and DataBridge observers attach; otherwise
      // some TanStack Query setups can leave list queries in a stuck state on hard refresh.
      window.setTimeout(() => {
        invalidateBridgeQueries(qc);
      }, 0);
    } catch (err) {
      setMe(null);
      tokenStorage.clear();
      const message = err instanceof Error ? err.message : "Не удалось получить профиль";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [qc]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const login = useCallback(
    async (username: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { access_token } = await api.post<{ access_token: string }>("/auth/login", {
          username,
          password,
        });
        tokenStorage.set(access_token);
        await fetchMe();
      } catch (err) {
        setIsLoading(false);
        const message = err instanceof Error ? err.message : "Не удалось войти";
        setError(message);
        throw err;
      }
    },
    [fetchMe],
  );

  const logout = useCallback(() => {
    tokenStorage.clear();
    setMe(null);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchMe();
  }, [fetchMe]);

  const currentUser = useMemo<RefUser>(
    () => (me ? mapApiUserToRefUser(me) : guestUser),
    [me],
  );

  const value: AuthContextValue = {
    isAuthenticated: Boolean(me),
    isLoading,
    me,
    currentUser,
    setCurrentUserId: () => {
      // No-op: in real auth we don't switch users; kept for ref-page compatibility.
    },
    login,
    logout,
    refresh,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

// Backwards-compat shim for pages still importing `useRole`.
export function useRole() {
  const auth = useAuth();
  return {
    currentUser: auth.currentUser,
    setCurrentUserId: auth.setCurrentUserId,
  };
}
