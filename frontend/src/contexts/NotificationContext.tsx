/**
 * Notification context backed by React Query against `/api/notifications`.
 *
 * Keeps the same hook surface as the original mock provider: pages call
 * `useNotifications()` and receive `{ notifications, unreadCount, markAsRead,
 * markAllAsRead }`.
 */
import { createContext, useContext, useMemo, useState, ReactNode } from "react";

import { mapApiNotificationToRef } from "@/lib/mappers";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsQuery,
} from "@/lib/queries";
import type { Notification } from "../data/notifications";

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  totalCount: number;
  hasMore: boolean;
  loadMore: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [pageSize, setPageSize] = useState(50);
  const { data } = useNotificationsQuery(true, { page: 1, page_size: pageSize });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const notifications = useMemo<Notification[]>(
    () => (data?.items ?? []).map(mapApiNotificationToRef),
    [data],
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const totalCount = data?.total ?? notifications.length;
  const hasMore = notifications.length < totalCount && pageSize < 100;

  const markAsRead = (id: string) => {
    const numericId = Number.parseInt(id.replace("N-", ""), 10);
    if (Number.isFinite(numericId)) markRead.mutate(numericId);
  };

  const markAllAsRead = () => {
    markAll.mutate();
  };

  const loadMore = () => {
    setPageSize((value) => Math.min(100, value + 50));
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, totalCount, hasMore, loadMore, markAsRead, markAllAsRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
