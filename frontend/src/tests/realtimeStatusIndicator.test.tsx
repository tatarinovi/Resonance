import { fireEvent, render, screen } from "@testing-library/react";
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
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Header onMenuClick={() => undefined} realtimeStatus={status} />
    </MemoryRouter>,
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
  it("renders the realtime indicator and actions from the avatar menu", () => {
    renderHeader("offline");

    fireEvent.click(screen.getByTestId("button-profile-menu"));

    expect(screen.getByTestId("realtime-status")).toHaveAttribute("aria-label", "Realtime не используется");
    expect(screen.getByText("Профиль")).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Выйти")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });
});
