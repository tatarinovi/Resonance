import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { RefRole } from "@/lib/mappers";

export const ADMIN_DASHBOARD_STORAGE_KEY = "resonance.admin.dashboardPersona";
export const DASHBOARD_STORAGE_KEY = "resonance.dashboardPersona";

export const DASHBOARD_PERSONAS: RefRole[] = ["Координатор", "Эксперт", "Разработчик", "Админ"];

function readStoredPersona(): RefRole | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY) ?? localStorage.getItem(ADMIN_DASHBOARD_STORAGE_KEY);
    if (raw === "Менеджер") return "Координатор";
    if (raw === "Лид") return "Координатор";
    if (raw && DASHBOARD_PERSONAS.includes(raw as RefRole)) return raw as RefRole;
  } catch {
    /* ignore */
  }
  return null;
}

interface AdminDashboardPersonaContextValue {
  persona: RefRole | null;
  setPersona: (p: RefRole) => void;
}

const AdminDashboardPersonaContext = createContext<AdminDashboardPersonaContextValue | null>(null);

export function AdminDashboardPersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<RefRole | null>(readStoredPersona);

  const setPersona = useCallback((p: RefRole) => {
    setPersonaState(p);
    try {
      localStorage.setItem(DASHBOARD_STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ persona, setPersona }), [persona, setPersona]);

  return (
    <AdminDashboardPersonaContext.Provider value={value}>{children}</AdminDashboardPersonaContext.Provider>
  );
}

export function useAdminDashboardPersona(): AdminDashboardPersonaContextValue | null {
  return useContext(AdminDashboardPersonaContext);
}
