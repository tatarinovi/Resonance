import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity,
  BarChart2,
  ClipboardList,
  FolderKanban,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Layers,
  Settings,
  Users,
} from "lucide-react";

import { QUESTION_SAVED_VIEWS } from "@/lib/questionViews";

export type NavigationRole = "admin" | "user";

export interface NavigationItem {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  badgeKey?: "inboxUnread";
  adminOnly?: boolean;
}

export interface NavigationSection {
  id: "workspace" | "work" | "focus" | "observe" | "system";
  label: string;
  items: NavigationItem[];
}

export interface FocusNavigationCounts {
  expert: number;
  waiting: number;
  blocked: number;
}

export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "workspace",
    label: "Пространство",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Рабочий стол" },
      { href: "/inbox", icon: Inbox, label: "Входящие", badgeKey: "inboxUnread" },
    ],
  },
  {
    id: "work",
    label: "Работа",
    items: [
      { href: "/questions", icon: HelpCircle, label: "Вопросы" },
      { href: "/epics", icon: Layers, label: "Эпики" },
      { href: "/projects", icon: FolderKanban, label: "Проекты" },
    ],
  },
  {
    id: "focus",
    label: "Фокус",
    items: QUESTION_SAVED_VIEWS.filter((view) => view.id !== "all").map((view) => ({
      href: view.href,
      icon: HelpCircle,
      label: view.label,
    })),
  },
  {
    id: "observe",
    label: "Наблюдение",
    items: [
      { href: "/activity", icon: Activity, label: "Активность" },
      { href: "/statistics", icon: BarChart2, label: "Статистика" },
    ],
  },
  {
    id: "system",
    label: "Система",
    items: [
      { href: "/users", icon: Users, label: "Пользователи", adminOnly: true },
      { href: "/admin/feedback", icon: ClipboardList, label: "Заявки ОС", adminOnly: true },
      { href: "/settings", icon: Settings, label: "Настройки" },
    ],
  },
];

export const VISIBLE_NAVIGATION_SECTIONS = NAVIGATION_SECTIONS.filter((section) =>
  ["workspace", "work", "focus"].includes(section.id),
);

export const OVERFLOW_NAVIGATION_SECTIONS = NAVIGATION_SECTIONS.filter((section) =>
  ["observe", "system"].includes(section.id),
);

export const COMMAND_NAVIGATION_ITEMS = NAVIGATION_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ ...item, group: section.label })),
);

export function shouldShowFocusNavigationItem(href: string, counts: FocusNavigationCounts): boolean {
  const view = new URLSearchParams(href.split("?")[1] ?? "").get("view");
  if (view === "mine" || view === "stale") return true;
  if (view === "expert") return counts.expert > 0;
  if (view === "waiting") return counts.waiting > 0;
  if (view === "blocked") return counts.blocked > 0;
  return true;
}
