import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { AuthProvider } from "@/contexts/AuthContext";
import { setProjects } from "@/data/projects";
import { api } from "@/lib/api";

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  setProjects([{ id: 4, name: "Платформа", config_json: {} }], { bump: false });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <CreateQuestionDialog open onOpenChange={() => undefined} defaultProjectRefId="PRJ-4" />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("CreateQuestionDialog optional epic", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => undefined;
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = () => undefined;
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => undefined;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setProjects([], { bump: false });
  });

  it("does not require an epic and omits epic_id when creating a question", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path === "/epics") return { items: [], total: 0, page: 1, page_size: 100 };
      return {};
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: 9, epic_id: null, title: "Межотдельный вопрос" });

    renderDialog();

    expect(screen.getByText("Эпик")).toBeInTheDocument();
    expect(screen.queryByText("Эпик *")).not.toBeInTheDocument();
    expect(screen.getByText(/Необязательно/)).toBeInTheDocument();
    expect(screen.getByTestId("select-question-epic")).toHaveTextContent("Без эпика");

    await user.type(screen.getByTestId("input-question-title"), "Межотдельный вопрос");
    await user.click(screen.getByTestId("select-question-audience"));
    await user.click(await screen.findByRole("option", { name: "Аналитик" }));
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe("/tickets");
    expect(body).toMatchObject({
      project_id: 4,
      title: "Межотдельный вопрос",
      priority: "medium",
      data_json: { target_direction: "analytics" },
    });
    expect(body).not.toHaveProperty("epic_id");
  });
});
