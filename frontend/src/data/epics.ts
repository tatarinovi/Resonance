import {
  mapApiEpicToRefEpic,
  type RefEnvironment,
  type RefEpic,
  type RefEpicStatus,
  type RefQAStatus,
} from "@/lib/mappers";
import type { ApiEpic } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export type EpicStatus = RefEpicStatus;
export type QAStatus = RefQAStatus;
export type Environment = RefEnvironment;
export type Epic = RefEpic;

let _epics: Epic[] = [];

export function setEpics(api: ApiEpic[], options?: { bump?: boolean }): void {
  _epics = api.map(mapApiEpicToRefEpic);
  if (options?.bump !== false) bumpDataVersion();
}

export function getEpics(): Epic[] {
  return _epics;
}

export const epics = new Proxy<Epic[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_epics, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _epics;
  },
  ownKeys() {
    return Reflect.ownKeys(_epics);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_epics, prop);
  },
});
