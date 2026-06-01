import { useEffect, useState } from "react";

import {
  QUESTION_DRAFT_UPDATED_EVENT,
  hasQuestionDraft,
  questionDraftStorageKey,
} from "@/lib/questionDraftStorage";

/**
 * Whether the current user has a saved question form draft (localStorage).
 * Updates on same-tab writes and cross-tab `storage` events.
 */
export function useQuestionDraftPresence(userId: number | null): boolean {
  const [has, setHas] = useState(() => hasQuestionDraft(userId));

  useEffect(() => {
    const sync = () => setHas(hasQuestionDraft(userId));

    sync();

    const onStorage = (e: StorageEvent) => {
      if (userId == null) return;
      if (e.key === questionDraftStorageKey(userId)) sync();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(QUESTION_DRAFT_UPDATED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(QUESTION_DRAFT_UPDATED_EVENT, sync);
    };
  }, [userId]);

  return has;
}
