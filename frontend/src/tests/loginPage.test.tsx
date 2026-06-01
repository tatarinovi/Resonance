import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LoginPage from "@/pages/LoginPage";
import { AuthProvider } from "@/contexts/AuthContext";

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
