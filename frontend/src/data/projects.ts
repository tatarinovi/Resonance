import { mapApiProjectToRefProject, type RefProject } from "@/lib/mappers";
import type { ApiProject } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export type Project = RefProject;

let _projects: Project[] = [];

export function setProjects(api: ApiProject[], options?: { bump?: boolean }): void {
  _projects = api.map(mapApiProjectToRefProject);
  if (options?.bump !== false) bumpDataVersion();
}

export function getProjects(): Project[] {
  return _projects;
}

export const projects = new Proxy<Project[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_projects, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _projects;
  },
  ownKeys() {
    return Reflect.ownKeys(_projects);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_projects, prop);
  },
});
