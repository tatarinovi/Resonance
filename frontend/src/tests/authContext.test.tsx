import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { tokenStorage } from "@/lib/api";

describe("AuthProvider logout", () => {
  afterEach(() => localStorage.clear());

  it("clears user data and queries while preserving appearance and unrelated applications", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
      ),
    });
    tokenStorage.set("test-token");
    localStorage.setItem("resonance.theme", "light");
    localStorage.setItem("resonance.sidebarWidth", "260");
    localStorage.setItem("resonance.draft", "private draft");
    localStorage.setItem("resonance:kanban-favorite-project-slugs", "[]");
    localStorage.setItem("another-app.draft", "keep me");
    qc.setQueryData(["tickets"], ["private ticket"]);

    act(() => result.current.logout());

    expect(tokenStorage.get()).toBeNull();
    expect(localStorage.getItem("resonance.draft")).toBeNull();
    expect(localStorage.getItem("resonance:kanban-favorite-project-slugs")).toBeNull();
    expect(localStorage.getItem("resonance.theme")).toBe("light");
    expect(localStorage.getItem("resonance.sidebarWidth")).toBe("260");
    expect(localStorage.getItem("another-app.draft")).toBe("keep me");
    expect(qc.getQueryData(["tickets"])).toBeUndefined();
  });
});
