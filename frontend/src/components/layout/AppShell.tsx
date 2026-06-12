import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Toaster } from "sonner";

import { useDataBridgeVersion } from "@/data/_bridge";
import { useThemePreference } from "@/contexts/ThemeContext";
import { useEventStream } from "@/lib/useEventStream";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

const SIDEBAR_WIDTH_KEY = "resonance.sidebarWidth";
const SIDEBAR_MIN = 56;
const SIDEBAR_MAX = 320;
const SIDEBAR_DEFAULT = 240;

function clampSidebarWidth(n: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

function readStoredSidebarWidth(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function persistSidebarWidth(w: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
  } catch {
    /* ignore quota / private mode */
  }
}

export function AppShell({ children }: AppShellProps) {
  const { theme } = useThemePreference();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const lastPointerXRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);
  const resizeHandleRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const stored = readStoredSidebarWidth();
    if (stored != null) {
      setSidebarWidth(clampSidebarWidth(stored));
    }
  }, []);

  const endResizeDrag = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const el = resizeHandleRef.current;
    if (el?.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const clientX = e.type === "pointercancel" ? lastPointerXRef.current : e.clientX;
    const w = clampSidebarWidth(d.startW + (clientX - d.startX));
    setSidebarWidth(w);
    persistSidebarWidth(w);
  }, []);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    resizeHandleRef.current?.setPointerCapture(e.pointerId);
    lastPointerXRef.current = e.clientX;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: sidebarWidthRef.current };
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId || !resizeHandleRef.current?.hasPointerCapture(e.pointerId)) {
      return;
    }
    lastPointerXRef.current = e.clientX;
    setSidebarWidth(clampSidebarWidth(d.startW + (e.clientX - d.startX)));
  }, []);

  const onResizeDoubleClick = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    persistSidebarWidth(SIDEBAR_DEFAULT);
  }, []);

  // Force re-renders on data bridge updates so reference pages reading the
  // proxied `@/data/*` arrays pick up new snapshots.
  useDataBridgeVersion();

  // Live cache invalidation via SSE (`/api/stream`). Mutations also invalidate queries explicitly.
  const realtimeStatus = useEventStream({ enabled: true });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`
          fixed inset-y-0 left-0 z-40 flex h-full shrink-0 flex-col overflow-hidden md:relative md:z-auto
          transition-[transform] duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        style={{ width: sidebarWidth }}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Sidebar
            sidebarWidth={sidebarWidth}
            onNavigate={() => setSidebarOpen(false)}
          />
          <button
            ref={resizeHandleRef}
            type="button"
            aria-label="Изменить ширину боковой панели"
            title="Потяните границу. Двойной щелчок — сброс ширины."
            className="absolute top-0 right-0 z-50 h-full w-3 cursor-col-resize touch-none border-0 bg-transparent p-0 select-none hover:bg-primary/15 active:bg-primary/25"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResizeDrag}
            onPointerCancel={endResizeDrag}
            onDoubleClick={onResizeDoubleClick}
          />
        </div>
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen((v) => !v)} realtimeStatus={realtimeStatus} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>

      <Toaster theme={theme} position="bottom-right" richColors />
    </div>
  );
}
