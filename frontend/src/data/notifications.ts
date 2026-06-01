import { mapApiNotificationToRef, type RefNotification } from "@/lib/mappers";
import type { ApiNotification } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export type Notification = RefNotification;

let _notifications: Notification[] = [];

export function setNotifications(api: ApiNotification[], options?: { bump?: boolean }): void {
  _notifications = api.map(mapApiNotificationToRef);
  if (options?.bump !== false) bumpDataVersion();
}

export function getNotifications(): Notification[] {
  return _notifications;
}

export const notifications = new Proxy<Notification[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_notifications, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _notifications;
  },
  ownKeys() {
    return Reflect.ownKeys(_notifications);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_notifications, prop);
  },
});
