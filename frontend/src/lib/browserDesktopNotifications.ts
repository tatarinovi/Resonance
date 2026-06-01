/**
 * Системные (desktop) уведомления браузера через Web Notifications API.
 *
 * Использует основной поток (без service worker), поэтому уведомления
 * приходят, только если открыта хотя бы одна вкладка приложения.
 * Включается пользователем явно: opt-in хранится в localStorage отдельно
 * от системного `Notification.permission`, чтобы можно было выключить
 * показ, не отзывая разрешение в браузере.
 */
import { epicIdToRef, ticketIdToRef } from "./mappers";
import { resolveNotificationTargetUrl } from "./notificationNavigation";

const OPT_IN_STORAGE_KEY = "resonance:desktop-notifications:enabled";

export interface NotificationCreatedPayload {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  target_type: string;
  target_id: number;
  target_url?: string;
  project_slug?: string | null;
  metadata?: Record<string, unknown>;
}

export type DesktopNotificationPermission = NotificationPermission | "unsupported";

export function isDesktopNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getDesktopNotificationPermission(): DesktopNotificationPermission {
  if (!isDesktopNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

export function isDesktopNotificationsOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OPT_IN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDesktopNotificationsOptIn(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(OPT_IN_STORAGE_KEY, "1");
    else window.localStorage.removeItem(OPT_IN_STORAGE_KEY);
  } catch {
    // ignore: localStorage may be unavailable in private mode
  }
}

/**
 * Запрашивает разрешение у браузера. Должно вызываться из обработчика
 * пользовательского жеста (клика), иначе некоторые браузеры тихо отказывают.
 */
export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (!isDesktopNotificationsSupported()) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

function buildTargetPath(payload: NotificationCreatedPayload): string {
  const ext = payload.target_url?.trim();
  if (ext) {
    const r = resolveNotificationTargetUrl(ext);
    if (r?.kind === "in_app") return r.path;
    if (r?.kind === "external") return r.url;
  }
  if (payload.target_type === "kanban_task") {
    return ext && ext.length > 0 ? ext : "/";
  }
  if (payload.target_type === "epic") {
    return `/epics/${epicIdToRef(payload.target_id)}`;
  }
  return `/questions/${ticketIdToRef(payload.target_id)}`;
}

/**
 * Показывает системное уведомление по событию `notification.created` из SSE.
 * Молча выходит, если: opt-in выключен, разрешения нет, API недоступно,
 * либо вкладка сейчас активна и в фокусе (там и так есть колокольчик).
 */
export function showDesktopNotificationFromSse(payload: NotificationCreatedPayload): void {
  if (!isDesktopNotificationsSupported()) return;
  if (!isDesktopNotificationsOptedIn()) return;
  if (Notification.permission !== "granted") return;

  if (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    typeof document.hasFocus === "function" &&
    document.hasFocus()
  ) {
    return;
  }

  const path = buildTargetPath(payload);
  const isExternal =
    path.startsWith("http://") || path.startsWith("https://");
  const body = (payload.body ?? "").trim() || payload.title;

  let notification: Notification;
  try {
    notification = new Notification(payload.title, {
      body,
      tag: `notification-${payload.id}`,
      renotify: false,
    } as NotificationOptions);
  } catch {
    return;
  }

  notification.onclick = () => {
    try {
      window.focus();
    } catch {
      // ignore: focus may fail when window is closed
    }
    if (isExternal) {
      window.open(path, "_blank", "noopener,noreferrer");
    } else if (path.startsWith("/") && typeof window !== "undefined") {
      const dest = `${window.location.origin}${path}`;
      if (window.location.href !== dest) {
        window.location.assign(dest);
      }
    }
    notification.close();
  };
}
