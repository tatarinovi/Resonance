import { mapActivity, type RefActivityEvent } from "@/lib/mappers";
import type { ApiActivityEvent } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export type ActivityType = RefActivityEvent["type"];
export type ActivityEvent = RefActivityEvent;

let _events: ActivityEvent[] = [];

export function setActivityEvents(api: ApiActivityEvent[], options?: { bump?: boolean }): void {
  _events = api.map(mapActivity);
  if (options?.bump !== false) bumpDataVersion();
}

export function getActivityEvents(): ActivityEvent[] {
  return _events;
}

export const activityEvents = new Proxy<ActivityEvent[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_events, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _events;
  },
  ownKeys() {
    return Reflect.ownKeys(_events);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_events, prop);
  },
});
