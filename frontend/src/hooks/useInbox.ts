import { useCallback, useEffect, useMemo, useState } from "react";

import { useRole } from "@/contexts/RoleContext";
import { useDataBridgeVersion } from "@/data/_bridge";
import { collectInboxRows, loadInboxReadIds, persistInboxReadIds } from "@/lib/inboxModel";

/**
 * Входящие: список строк, множество прочитанных id (в localStorage), счётчик непрочитанных.
 */
export function useInbox() {
  const dataBridgeV = useDataBridgeVersion();
  const { currentUser } = useRole();
  const userId = currentUser.id;

  const rows = useMemo(() => collectInboxRows(userId), [userId, dataBridgeV]);

  const [readIds, setReadIds] = useState<Set<string>>(() => loadInboxReadIds(userId));

  useEffect(() => {
    setReadIds(loadInboxReadIds(userId));
  }, [userId]);

  const markItemRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set([...prev, id]);
        persistInboxReadIds(userId, next);
        return next;
      });
    },
    [userId],
  );

  const markAllRead = useCallback(() => {
    const next = new Set(rows.map((r) => r.id));
    persistInboxReadIds(userId, next);
    setReadIds(next);
  }, [userId, rows]);

  const unreadCount = useMemo(() => rows.filter((r) => !readIds.has(r.id)).length, [rows, readIds]);

  return { rows, readIds, unreadCount, markItemRead, markAllRead };
}
