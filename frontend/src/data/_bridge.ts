/**
 * Shared subscription bus used by every `@/data/*` module so that any change to
 * the underlying snapshot causes consumers (`useDataBridgeVersion()`) to
 * re-render. Without this, components reading the proxied arrays would still
 * see the latest data on the next render but would never re-render on their
 * own when the source array is reassigned by a `set*` call.
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function bumpDataVersion(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function getDataVersion(): number {
  return version;
}

export function subscribeDataVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDataBridgeVersion(): number {
  return useSyncExternalStore(subscribeDataVersion, getDataVersion, getDataVersion);
}
