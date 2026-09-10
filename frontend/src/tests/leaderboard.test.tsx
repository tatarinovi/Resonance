import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LeaderboardPage from "@/pages/LeaderboardPage";
const mocked = vi.hoisted(() => ({
  me: { id: 1, role: "employee", direction: "qa", workspace: "ds" },
  activity: vi.fn(),
  board: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ me: mocked.me }),
}));
vi.mock("@/lib/leaderboard/queries", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/leaderboard/queries")
  >("@/lib/leaderboard/queries");
  return {
    ...actual,
    useLeaderboard: mocked.board,
    useLeaderboardActivity: mocked.activity,
  };
});
const board = {
  season: "2026-09",
  seasons: ["2026-09", "2026-08"],
  closed: false,
  updated_at: "2026-09-10T10:00:00Z",
  items: [
    { id: 1, name: "Alice long participant name", points: 4, rank: 1 },
    { id: 2, name: "Bob", points: 4, rank: 1 },
    { id: 3, name: "Carol", points: 0, rank: 3 },
  ],
  rules: {
    events: {
      BUG_DEV_CONFIRMED: { label: "Подтверждённый DEV bug", points: 4 },
    },
    timezone: "Europe/Moscow",
    execution_statuses: ["passed", "failed", "blocked"],
    execution_tiers: [{ minimum: 1, maximum: 25, points: 1 }],
  },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup() {
  mocked.me = { id: 1, role: "employee", direction: "qa", workspace: "ds" };
  mocked.board.mockReturnValue({ data: board });
  mocked.activity.mockReturnValue({ data: { items: [], total: 0 } });
}
function show(path = "/leaderboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LeaderboardPage />
    </MemoryRouter>,
  );
}
describe("QA leaderboard", () => {
  it("shows tied ranks, zero participants and personal position", () => {
    setup();
    show();
    expect(screen.getByText("Alice long participant name")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "1" })).toHaveLength(2);
    expect(screen.getByText(/Ваше место: 1/)).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Управление" }),
    ).not.toBeInTheDocument();
  });
  it("renders season-specific rules returned by the API", () => {
    setup();
    show("/leaderboard?tab=rules");
    expect(screen.getByText("Подтверждённый DEV bug")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });
  it("distinguishes errors from empty activity", () => {
    setup();
    mocked.activity.mockReturnValue({
      isError: true,
      error: new Error("Доступ запрещён"),
    });
    show("/leaderboard?tab=activity");
    expect(screen.getByRole("alert")).toHaveTextContent("Доступ запрещён");
    expect(screen.queryByText(/пока нет начислений/)).not.toBeInTheDocument();
  });
  it("shows frozen history and does not invent an admin rank", () => {
    setup();
    mocked.me = { id: 99, role: "admin", direction: "", workspace: "ds" };
    mocked.board.mockReturnValue({
      data: { ...board, closed: true, season: "2026-08" },
    });
    show("/leaderboard?season=2026-08");
    expect(screen.getByText(/Сезон закрыт/)).toBeInTheDocument();
    expect(screen.queryByText(/Ваше место/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Управление" })).toBeInTheDocument();
  });
});
