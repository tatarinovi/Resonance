/**
 * Subscribes to the SSE channel at `/api/stream` and dispatches events to
 * React Query cache invalidations. The hook is mounted once at the AppShell
 * level so a single connection is shared across the app.
 *
 * `EventSource` cannot send Authorization headers, so we pass the JWT as a
 * query string parameter; the backend accepts both. We use
 * `@microsoft/fetch-event-source` for richer reconnection semantics, falling
 * back to native `EventSource` if the dependency is unavailable.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tokenStorage } from "./api";
import {
  showDesktopNotificationFromSse,
  type NotificationCreatedPayload,
} from "./browserDesktopNotifications";

type Handler = (payload: unknown) => void;

const TYPE_HANDLERS: Record<string, (qc: ReturnType<typeof useQueryClient>) => Handler> = {
  "ticket.updated": (qc) => () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["ticket-summary"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
    qc.invalidateQueries({ queryKey: ["role-summary"] });
  },
  "ticket.created": (qc) => () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["ticket-summary"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  },
  "ticket.message_added": (qc) => (payload) => {
    const ticketId = (payload as { ticket_id?: number })?.ticket_id;
    if (typeof ticketId === "number") {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket-messages", ticketId] });
    }
  },
  "ticket.attachment_added": (qc) => (payload) => {
    const ticketId = (payload as { ticket_id?: number })?.ticket_id;
    if (typeof ticketId === "number") {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    }
  },
  "epic.updated": (qc) => (payload) => {
    const epicId = (payload as { epic_id?: number })?.epic_id;
    if (typeof epicId === "number") {
      qc.invalidateQueries({ queryKey: ["epic", epicId] });
      qc.invalidateQueries({ queryKey: ["epic-history", epicId] });
      qc.invalidateQueries({ queryKey: ["epic-blockers", epicId] });
      qc.invalidateQueries({ queryKey: ["epic-test-runs", epicId] });
    }
    qc.invalidateQueries({ queryKey: ["epics"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  },
  "epic.deleted": (qc) => (payload) => {
    const epicId = (payload as { epic_id?: number })?.epic_id;
    if (typeof epicId === "number") {
      qc.removeQueries({ queryKey: ["epic", epicId] });
      qc.removeQueries({ queryKey: ["epic-history", epicId] });
      qc.removeQueries({ queryKey: ["epic-blockers", epicId] });
      qc.removeQueries({ queryKey: ["epic-test-runs", epicId] });
    }
    qc.invalidateQueries({ queryKey: ["epics"] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["ticket-summary"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  },
  "project.deleted": (qc) => (payload) => {
    const projectId = (payload as { project_id?: number })?.project_id;
    if (typeof projectId === "number") {
      qc.removeQueries({ queryKey: ["experts", projectId] });
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["directory-users"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["epics"] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["ticket-summary"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  },
  "notification.created": (qc) => (payload) => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    const p = payload as NotificationCreatedPayload | null;
    if (p && typeof p === "object") {
      const typ = typeof p.type === "string" ? p.type : "";
      const tgt = typeof p.target_type === "string" ? p.target_type : "";
      const slug =
        typeof p.project_slug === "string" && p.project_slug.trim()
          ? p.project_slug.trim()
          : typeof p.metadata === "object" && p.metadata && typeof p.metadata.project_slug === "string"
            ? String(p.metadata.project_slug).trim()
            : null;
      if (typ.startsWith("kanban_") || tgt === "kanban_task") {
        if (slug) {
          void qc.invalidateQueries({ queryKey: ["kanban-board-bundle", slug, true] });
          void qc.invalidateQueries({ queryKey: ["kanban-board-bundle", slug, false] });
        } else {
          void qc.invalidateQueries({ queryKey: ["kanban-board-bundle"] });
        }
      }
      showDesktopNotificationFromSse(p);
    }
  },
};

export function useEventStream(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = tokenStorage.get();
    if (!token) return;

    const url = `/api/stream?token=${encodeURIComponent(token)}`;
    let closed = false;
    let source: EventSource | null = null;

    function dispatch(type: string, raw: string) {
      let payload: unknown = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      const handler = TYPE_HANDLERS[type];
      if (handler) handler(qc)(payload);
    }

    function connect() {
      source = new EventSource(url);
      Object.keys(TYPE_HANDLERS).forEach((type) => {
        source?.addEventListener(type, (event) => dispatch(type, (event as MessageEvent).data));
      });
      source.addEventListener("ping", () => {
        // heartbeat, ignore
      });
      source.addEventListener("error", () => {
        if (closed) return;
        source?.close();
        setTimeout(() => {
          if (!closed) connect();
        }, 5000);
      });
    }

    connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, [enabled, qc]);
}
