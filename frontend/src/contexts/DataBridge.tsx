/**
 * Live data bridge: keeps the legacy `@/data/*` module-level arrays in sync
 * with the FastAPI backend so reference pages that import them as static data
 * still render fresh values.
 *
 * Updates run during this component's render (with `bump: false`) so the
 * module snapshot is updated before descendants in the same commit.
 *
 * `BridgeListsReadyContext`: while core list queries are still fetching, the
 * shell shows a micro-loader instead of mounting route pages — they must not
 * read an empty bridge on hard refresh even when the network already returned
 * data in the same tick.
 *
 * Non-admin users cannot call `GET /admin/users`; their `@/data/users` snapshot
 * is filled from `GET /directory/users` (colleagues on shared projects).
 */
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { bumpDataVersion } from "@/data/_bridge";
import { setActivityEvents } from "@/data/activity";
import { setEpics } from "@/data/epics";
import { setNotifications } from "@/data/notifications";
import { setProjects } from "@/data/projects";
import { setQuestionsPage } from "@/data/questions";
import { setUsers } from "@/data/users";
import {
  dataBridgeActivityParams,
  dataBridgeEpicsParams,
  dataBridgeTicketsParams,
  useActivity,
  useEpics,
  useNotificationsQuery,
  useProjects,
  useTickets,
  useDirectoryUsers,
  useUsers as useUsersQuery,
} from "@/lib/queries";

const BridgeListsReadyContext = createContext(false);

export function useBridgeListsReady(): boolean {
  return useContext(BridgeListsReadyContext);
}

interface DataBridgeProps {
  children: ReactNode;
}

/**
 * Mounts query subscriptions for `users`, `projects`, `questions`, `epics`,
 * `notifications`, and the activity feed. Exposes `useBridgeListsReady()` so
 * the shell can defer mounting data-heavy pages until the first fetch wave
 * has settled (`isFetched`).
 */
export function DataBridge({ children }: DataBridgeProps) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  const adminUsersQuery = useUsersQuery({ page: 1, page_size: 100 }, isAdmin === true);
  const directoryUsersQuery = useDirectoryUsers(Boolean(me) && !isAdmin);

  const projectsQuery = useProjects();
  const ticketsQuery = useTickets(dataBridgeTicketsParams);
  const epicsQuery = useEpics(dataBridgeEpicsParams);
  const notificationsQuery = useNotificationsQuery(true);
  const activityQuery = useActivity(dataBridgeActivityParams);

  const { data: adminUsersData } = adminUsersQuery;
  const { data: directoryUsersData } = directoryUsersQuery;
  const { data: projectsData } = projectsQuery;
  const { data: ticketsData } = ticketsQuery;
  const { data: epicsData } = epicsQuery;
  const { data: notificationsData } = notificationsQuery;
  const { data: activityData } = activityQuery;

  const usersListsReady =
    !me || (isAdmin ? adminUsersQuery.isFetched : directoryUsersQuery.isFetched);

  const listsReady =
    projectsQuery.isFetched &&
    ticketsQuery.isFetched &&
    epicsQuery.isFetched &&
    notificationsQuery.isFetched &&
    activityQuery.isFetched &&
    usersListsReady;

  const usersSyncKeyRef = useRef<string>("");
  const usersSyncMarker = !me
    ? "no-me"
    : isAdmin
      ? `a:${adminUsersQuery.dataUpdatedAt}:${adminUsersQuery.fetchStatus}`
      : `d:${directoryUsersQuery.dataUpdatedAt}:${directoryUsersQuery.fetchStatus}:${directoryUsersQuery.isFetched}`;

  if (usersSyncMarker !== usersSyncKeyRef.current) {
    usersSyncKeyRef.current = usersSyncMarker;
    if (!me) {
      setUsers([], { bump: false });
    } else if (isAdmin) {
      if (adminUsersData) setUsers(adminUsersData.items ?? [], { bump: false });
    } else if (directoryUsersQuery.isFetched) {
      setUsers(directoryUsersData ?? [], { bump: false });
    }
  }

  const projectsSyncRef = useRef<typeof projectsData>(undefined);
  if (projectsData !== projectsSyncRef.current) {
    projectsSyncRef.current = projectsData;
    if (projectsData) setProjects(projectsData, { bump: false });
  }

  // Sync on `dataUpdatedAt`, not only referential equality: React Query structural
  // sharing can reuse the previous `data` reference after a refetch even when the
  // server payload changed, which would skip `setQuestions` and leave `@/data/questions` stale.
  const ticketsSyncedAtRef = useRef<number>(0);
  if (ticketsData && ticketsQuery.dataUpdatedAt !== ticketsSyncedAtRef.current) {
    ticketsSyncedAtRef.current = ticketsQuery.dataUpdatedAt;
    setQuestionsPage(ticketsData.items ?? [], ticketsData.total ?? 0, { bump: false });
  }

  const epicsSyncRef = useRef<typeof epicsData>(undefined);
  if (epicsData !== epicsSyncRef.current) {
    epicsSyncRef.current = epicsData;
    if (epicsData) setEpics(epicsData.items ?? [], { bump: false });
  }

  const notificationsSyncRef = useRef<typeof notificationsData>(undefined);
  if (notificationsData !== notificationsSyncRef.current) {
    notificationsSyncRef.current = notificationsData;
    if (notificationsData) setNotifications(notificationsData.items ?? [], { bump: false });
  }

  const activitySyncRef = useRef<typeof activityData>(undefined);
  if (activityData !== activitySyncRef.current) {
    activitySyncRef.current = activityData;
    if (activityData) setActivityEvents(activityData.items ?? [], { bump: false });
  }

  useLayoutEffect(() => {
    const hasSnapshot =
      ticketsData != null ||
      projectsData != null ||
      epicsData != null ||
      notificationsData != null ||
      activityData != null ||
      (isAdmin ? adminUsersData != null : !me || directoryUsersData != null);
    if (!hasSnapshot) return;
    bumpDataVersion();
  }, [
    me,
    isAdmin,
    adminUsersData,
    directoryUsersData,
    projectsData,
    ticketsData,
    epicsData,
    notificationsData,
    activityData,
  ]);

  return (
    <BridgeListsReadyContext.Provider value={listsReady}>{children}</BridgeListsReadyContext.Provider>
  );
}
