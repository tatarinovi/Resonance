import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Header, RealtimeStatusIndicator } from "@/components/layout/Header";
import type { RealtimeStatus } from "@/lib/useEventStream";

vi.mock("@/contexts/RoleContext", () => ({
  useRole: () => ({
    currentUser: {
      id: "admin",
      name: "Admin",
      avatarInitials: "A",
    },
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/shared/NotificationCenter", () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

vi.mock("@/components/shared/RoleSwitcher", () => ({
  RoleSwitcher: () => <div>Role switcher</div>,
}));

vi.mock("@/components/shared/UserAvatar", () => ({
  UserAvatar: () => <div>Avatar</div>,
}));

function renderHeader(status: RealtimeStatus) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Header onMenuClick={() => undefined} realtimeStatus={status} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RealtimeStatusIndicator", () => {
  it("renders online state with aria label, tooltip fallback and desktop label", () => {
    render(<RealtimeStatusIndicator status="online" />);

    const indicator = screen.getByTestId("realtime-status");
    expect(indicator).toHaveAttribute("aria-label", "Realtime подключен");
    expect(indicator).toHaveAttribute("title", "Realtime подключен");
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it.each([
    ["connecting", "Подключение к realtime"],
    ["reconnecting", "Realtime переподключается"],
    ["offline", "Realtime не используется"],
  ] satisfies Array<[RealtimeStatus, string]>)("renders %s state", (status, label) => {
    render(<RealtimeStatusIndicator status={status} />);

    const indicator = screen.getByTestId("realtime-status");
    expect(indicator).toHaveAttribute("aria-label", label);
    expect(indicator).toHaveAttribute("title", label);
  });

  it("marks connecting and reconnecting states as pulsing", () => {
    const { rerender } = render(<RealtimeStatusIndicator status="connecting" />);
    expect(screen.getByTestId("realtime-status").querySelector(".animate-pulse")).toBeInTheDocument();

    rerender(<RealtimeStatusIndicator status="reconnecting" />);
    expect(screen.getByTestId("realtime-status").querySelector(".animate-pulse")).toBeInTheDocument();
  });
});

describe("Header realtime status", () => {
  it("renders the realtime indicator and actions from the avatar menu", async () => {
    const user = userEvent.setup();
    renderHeader("offline");

    await user.click(screen.getByTestId("button-profile-menu"));

    await waitFor(() => {
      expect(screen.getByTestId("realtime-status")).toHaveAttribute("aria-label", "Realtime не используется");
    });
    expect(screen.getByText("Профиль")).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Выйти")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });
});
