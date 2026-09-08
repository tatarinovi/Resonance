import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Metrics, QueryState, Sources } from "@/components/releases/release-ui";
import { ReleaseListTab } from "@/components/releases/ReleaseTabs";
import type { ApiRelease } from "@/lib/types";

const useTab = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({ useReleaseTab: useTab }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const r = { id: 2, epics: [] } as unknown as ApiRelease;
function Location() {
  const l = useLocation();
  return <output data-testid="url">{l.search}</output>;
}

describe("Release insight navigation", () => {
  it("distinguishes execution from test success and opens failed results", () => {
    const go = vi.fn();
    render(
      <Metrics
        snapshot={{
          total: 263,
          passed: 232,
          failed: 20,
          broken: 0,
          blocked: 0,
        }}
        onStatus={go}
      />,
    );
    expect(screen.getByText("252 из 263")).toBeInTheDocument();
    expect(screen.getByText("11 осталось")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "20 с ошибками" }));
    expect(go).toHaveBeenCalledWith("failed");
  });
  it("never reports empty data during loading and offers retry on error", () => {
    const retry = vi.fn();
    const view = render(
      <QueryState query={{ isPending: true, isError: false, refetch: retry }}>
        Данных нет
      </QueryState>,
    );
    expect(screen.queryByText("Данных нет")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    view.rerender(
      <QueryState query={{ isPending: false, isError: true, refetch: retry }}>
        Данных нет
      </QueryState>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(retry).toHaveBeenCalled();
  });
  it("keeps 74 tasks reachable and preserves group filter in pagination URL", () => {
    useTab.mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      data: {
        items: [{ key: "J-1", title: "Task", status: "Новое" }],
        total: 74,
        page: 1,
        page_size: 25,
      },
    });
    render(
      <MemoryRouter
        initialEntries={["/releases/2?tab=tasks&status_group=todo"]}
      >
        <ReleaseListTab release={r} kind="tasks" />
        <Location />
      </MemoryRouter>,
    );
    expect(screen.getByText("1–25 из 74")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByTestId("url")).toHaveTextContent("status_group=todo");
    expect(screen.getByTestId("url")).toHaveTextContent("page=2");
    fireEvent.change(screen.getByRole("combobox", { name: "Группа" }), {
      target: { value: "done" },
    });
    expect(screen.getByTestId("url")).toHaveTextContent("status_group=done");
    expect(screen.getByTestId("url")).not.toHaveTextContent("page=2");
  });
  it("shows partial coverage without pretending there are no snapshots", () => {
    render(
      <Sources
        sources={{
          jira: {
            status: "partial",
            has_data: true,
            covered: 1,
            total: 2,
            last_success_at: "2026-09-08T10:00:00Z",
            details: [],
          },
        }}
      />,
    );
    expect(screen.getByText(/Jira: Частично/)).toBeInTheDocument();
    expect(screen.getByText(/Данные: 1\/2/)).toBeInTheDocument();
  });
});


it("displays legacy UTC timestamps consistently with typed timestamps", async () => {
  const { date } = await import("@/components/releases/release-display");
  expect(date("2026-09-08T11:47:00")).toBe(date("2026-09-08T11:47:00Z"));
  expect(date("2026-09-08T14:47:00+03:00")).toBe(date("2026-09-08T11:47:00Z"));
});
