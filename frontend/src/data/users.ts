/**
 * Live `users` store fed by the `DataBridge` from `GET /api/admin/users`.
 *
 * The reference UI imports `users` as a synchronous array. We expose it through
 * a `Proxy` so reads always go to the latest snapshot, while updates bump the
 * shared `useDataBridgeVersion` counter so consumers re-render.
 */
import { mapApiUserToRefUser, type RefRole, type RefUser } from "@/lib/mappers";
import type { ApiUser } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export { useDataBridgeVersion } from "./_bridge";

export type Role = RefRole;
export type User = RefUser;

let _users: User[] = [];

export function setUsers(api: ApiUser[], options?: { bump?: boolean }): void {
  _users = api.map(mapApiUserToRefUser);
  if (options?.bump !== false) bumpDataVersion();
}

export function getUsers(): User[] {
  return _users;
}

export const users = new Proxy<User[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_users, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _users;
  },
  ownKeys() {
    return Reflect.ownKeys(_users);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_users, prop);
  },
});
