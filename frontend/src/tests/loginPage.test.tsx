import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/pages/LoginPage";
import { AuthProvider } from "@/contexts/AuthContext";
import { api, ApiError, tokenStorage } from "@/lib/api";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>{children}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("LoginPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    tokenStorage.clear();
  });

  it("keeps a failed profile request on the login form with an error", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ access_token: "test-token" });
    vi.spyOn(api, "get").mockRejectedValue(new ApiError("Профиль временно недоступен", 503));
    render(<Wrapper><LoginPage /></Wrapper>);
    fireEvent.change(screen.getByLabelText("Логин"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByTestId("alert-auth-error")).toHaveTextContent("Профиль временно недоступен");
    expect(tokenStorage.get()).toBeNull();
  });

  it("exposes labels and the password visibility control to assistive technology", () => {
    render(<Wrapper><LoginPage /></Wrapper>);
    expect(screen.getByLabelText("Логин")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Показать пароль" }));
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Скрыть пароль" })).toHaveAttribute("aria-pressed", "true");
  });
  it("renders the login form with username/password fields", () => {
    render(
      <Wrapper>
        <LoginPage />
      </Wrapper>,
    );
    expect(screen.getByTestId("input-username")).toBeInTheDocument();
    expect(screen.getByTestId("input-password")).toBeInTheDocument();
    expect(screen.getByTestId("button-login")).toBeInTheDocument();
  });

  it("shows a validation warning when login or password fails format checks", () => {
    render(
      <Wrapper>
        <LoginPage />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId("input-username"), { target: { value: "ab" } });
    fireEvent.change(screen.getByTestId("input-password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByTestId("button-login"));
    expect(screen.getByTestId("alert-validation")).toBeInTheDocument();
    expect(screen.getByTestId("alert-validation")).toHaveTextContent("Логин не короче");
  });

  it("shows validation when username contains non-Latin characters", () => {
    render(
      <Wrapper>
        <LoginPage />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId("input-username"), { target: { value: "юзер" } });
    fireEvent.change(screen.getByTestId("input-password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByTestId("button-login"));
    expect(screen.getByTestId("alert-validation")).toHaveTextContent("латинские");
  });
});
