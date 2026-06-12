import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEventStream } from "@/lib/useEventStream";

const fetchEventSourceMock = vi.hoisted(() => vi.fn());

vi.mock("@microsoft/fetch-event-source", () => ({
  EventStreamContentType: "text/event-stream",
  fetchEventSource: fetchEventSourceMock,
}));

type FetchEventSourceOptions = {
  signal: AbortSignal;
  onopen?: (response: Response) => Promise<void>;
  onerror?: (error?: unknown) => number | undefined | void;
};

const TOKEN_KEY = "resonance.auth.token";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function latestOptions(): FetchEventSourceOptions {
  const call = fetchEventSourceMock.mock.calls.at(-1);
  if (!call) throw new Error("fetchEventSource was not called");
  return call[1] as FetchEventSourceOptions;
}

function eventStreamResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

describe("useEventStream", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchEventSourceMock.mockReset();
    fetchEventSourceMock.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns offline when disabled", () => {
    const { result } = renderHook(() => useEventStream({ enabled: false }), { wrapper });

    expect(result.current).toBe("offline");
    expect(fetchEventSourceMock).not.toHaveBeenCalled();
  });

  it("returns offline when token is absent", () => {
    const { result } = renderHook(() => useEventStream({ enabled: true }), { wrapper });

    expect(result.current).toBe("offline");
    expect(fetchEventSourceMock).not.toHaveBeenCalled();
  });

  it("starts as connecting when opening the first connection", async () => {
    window.localStorage.setItem(TOKEN_KEY, "jwt-token");

    const { result } = renderHook(() => useEventStream({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current).toBe("connecting"));
    expect(fetchEventSourceMock).toHaveBeenCalledWith(
      "/api/stream",
      expect.objectContaining({
        headers: { Authorization: "Bearer jwt-token" },
      }),
    );
  });

  it("switches to online when the SSE connection opens", async () => {
    window.localStorage.setItem(TOKEN_KEY, "jwt-token");

    const { result } = renderHook(() => useEventStream({ enabled: true }), { wrapper });

    await act(async () => {
      await latestOptions().onopen?.(eventStreamResponse());
    });

    expect(result.current).toBe("online");
  });

  it("switches to reconnecting on errors and preserves retry delay", async () => {
    window.localStorage.setItem(TOKEN_KEY, "jwt-token");

    const { result } = renderHook(() => useEventStream({ enabled: true }), { wrapper });

    await act(async () => {
      await latestOptions().onopen?.(eventStreamResponse());
    });
    expect(result.current).toBe("online");

    let retryDelay: number | undefined | void;
    act(() => {
      retryDelay = latestOptions().onerror?.(new Error("network"));
    });

    expect(retryDelay).toBe(5000);
    expect(result.current).toBe("reconnecting");
  });

  it("aborts on unmount without switching to reconnecting", async () => {
    window.localStorage.setItem(TOKEN_KEY, "jwt-token");

    const { result, unmount } = renderHook(() => useEventStream({ enabled: true }), { wrapper });

    await act(async () => {
      await latestOptions().onopen?.(eventStreamResponse());
    });
    expect(result.current).toBe("online");

    const options = latestOptions();
    unmount();

    expect(options.signal.aborted).toBe(true);
    expect(options.onerror?.(new Error("abort"))).toBeUndefined();
  });
});
