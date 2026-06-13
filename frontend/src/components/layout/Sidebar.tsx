import { useCallback, useEffect, useState } from "react";
import { useLocation as useRouterLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  BarChart2,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  FolderOpen,
  Keyboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Radio,
  Sparkles,
} from "lucide-react";

import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { KanbanLoginDialog } from "@/components/kanban/KanbanLoginDialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useDataBridgeVersion } from "@/data/_bridge";
import { epics } from "@/data/epics";
import { questions } from "@/data/questions";
import { useInbox } from "@/hooks/useInbox";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { useQuestionDraftPresence } from "@/hooks/useQuestionDraftPresence";
import { ApiError } from "@/lib/api";
import {
  OVERFLOW_NAVIGATION_SECTIONS,
  VISIBLE_NAVIGATION_SECTIONS,
  shouldShowFocusNavigationItem,
  type FocusNavigationCounts,
  type NavigationItem,
} from "@/lib/navigation";
import { useUpdateMe } from "@/lib/queries";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

const COMPACT_BREAKPOINT_PX = 148;

const SHORTCUT_GROUPS = [
  {
    title: "Везде в рабочем пространстве",
    items: [
      {
        keys: ["⌘/Ctrl", "K"],
        description: "Открыть или закрыть командное меню: поиск, переходы и быстрые команды.",
      },
    ],
  },
  {
    title: "Рабочий стол и вопросы",
    items: [
      {
        keys: ["C / С"],
        description: "Открыть создание вопроса. Работает и на русской, и на английской раскладке.",
      },
    ],
  },
  {
    title: "Список вопросов",
    items: [
      {
        keys: ["J"],
        description: "Перейти на следующую строку списка.",
      },
      {
        keys: ["K"],
        description: "Перейти на предыдущую строку списка.",
      },
      {
        keys: ["Enter"],
        description: "Открыть активный вопрос.",
      },
      {
        keys: ["/"],
        description: "Перевести фокус в быстрый поиск по вопросам.",
      },
    ],
  },
];

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[min(420px,92vw)] flex-col overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle>Горячие клавиши</SheetTitle>
          <SheetDescription>
            Хоткеи не срабатывают, когда фокус находится в поле ввода, редакторе, селекте или command palette.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {group.items.map((item) => (
                  <div key={`${group.title}-${item.description}`} className="grid grid-cols-[104px_1fr] gap-3 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {item.keys.map((key) => (
                        <ShortcutKey key={key}>{key}</ShortcutKey>
                      ))}
                    </div>
                    <p className="text-sm leading-snug text-foreground/85">{item.description}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function splitHref(href: string) {
  const [pathname, search = ""] = href.split("?");
  return { pathname, search: search ? `?${search}` : "" };
}

function NavLink({
  item,
  compact,
  badge,
  onNavigate,
}: {
  item: NavigationItem;
  compact: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const location = useRouterLocation();
  const { pathname, search } = splitHref(item.href);
  const isActive = location.pathname === pathname && (!search || location.search === search);
  const tooltip = badge != null && badge > 0 ? `${item.label} (${badge})` : item.label;
  const Icon = item.icon;

  const content = (
    <span
      onClick={onNavigate}
      className={cn(
        "group flex cursor-pointer items-center rounded-md text-sm transition-colors",
        compact ? "justify-center px-0 py-2 md:py-1.5" : "gap-2.5 px-2.5 py-1.5",
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-foreground/68 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
      data-testid={`nav-${item.href.replace(/[/?=&]/g, "-") || "dashboard"}`}
    >
      <span className="relative inline-flex shrink-0">
        <Icon
          size={17}
          className={isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}
        />
        {compact && badge != null && badge > 0 ? (
          <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" aria-hidden />
        ) : null}
      </span>
      {!compact ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {badge != null && badge > 0 ? (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
              {badge}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={item.href} className="block text-inherit no-underline">
            {content}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[240px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={item.href} className="block text-inherit no-underline">
      {content}
    </Link>
  );
}

interface SidebarProps {
  onNavigate?: () => void;
  sidebarWidth: number;
}

export function Sidebar({ onNavigate, sidebarWidth }: SidebarProps) {
  useDataBridgeVersion();
  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [kanbanLoginOpen, setKanbanLoginOpen] = useState(false);
  const [kanbanLogoutOpen, setKanbanLogoutOpen] = useState(false);
  const { me } = useAuth();
  const updateMe = useUpdateMe();
  const { unreadCount: inboxUnread } = useInbox();
  const isNota = useIsNotaWorkspace();
  const hasQuestionDraft = useQuestionDraftPresence(me?.id ?? null);
  const isAdmin = me?.role === "admin";
  const isKanbanConnected = Boolean(me?.kanban_connected);
  const compact = sidebarWidth < COMPACT_BREAKPOINT_PX;
  const blockedEpicIds = new Set(epics.filter((epic) => epic.blockers.length > 0).map((epic) => epic.id));
  const focusCounts: FocusNavigationCounts = {
    expert: questions.filter((question) => question.status === "У эксперта").length,
    waiting: questions.filter((question) => question.status === "Ожидает автора").length,
    blocked: questions.filter((question) => question.epicId && blockedEpicIds.has(question.epicId)).length,
  };

  useEffect(() => {
    if (!isAdmin) return;
    const handler = () => setKanbanLoginOpen(true);
    window.addEventListener("resonance:kanban-login", handler);
    return () => window.removeEventListener("resonance:kanban-login", handler);
  }, [isAdmin]);

  const confirmKanbanLogout = useCallback(async () => {
    try {
      await updateMe.mutateAsync({ kanban_token: null });
      toast.success("Вы вышли из Kanban");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось выйти из Kanban");
    }
  }, [updateMe]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar",
        compact ? "px-1" : "px-0",
      )}
    >
      <div
        className={cn(
          "flex h-[52px] shrink-0 items-center border-b border-border text-inherit no-underline transition-colors hover:bg-sidebar-accent/40",
          compact ? "gap-1 px-1" : "gap-2.5 px-3",
        )}
      >
        <Link href="/" className={cn("min-w-0 flex-1 text-inherit no-underline", compact ? "flex justify-center" : "")}>
          <span onClick={onNavigate} className={cn("flex items-center", compact ? "justify-center" : "w-full gap-2.5")}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Radio size={14} className="text-white" />
            </div>
            {!compact ? <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-none text-sidebar-foreground">Resonance</span> : null}
          </span>
        </Link>
      </div>

      <div className={cn("py-3", compact ? "px-0" : "px-2")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                setCreateQuestionOpen(true);
                onNavigate?.();
              }}
              className={cn(
                "relative flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90",
                compact ? "px-0 py-2 md:py-1.5" : "gap-2 px-2.5 py-2 text-sm font-medium",
              )}
              data-testid="sidebar-create-question"
            >
              {hasQuestionDraft ? (
                <span
                  className={cn(
                    "absolute h-2 w-2 rounded-full bg-amber-400 ring-2 ring-primary",
                    compact ? "right-1.5 top-1.5" : "right-2 top-1.5",
                  )}
                  aria-hidden
                  data-testid="sidebar-question-draft-dot"
                />
              ) : null}
              <Plus size={16} />
              {!compact ? "Задать вопрос" : null}
            </button>
          </TooltipTrigger>
          {compact ? <TooltipContent side="right">Задать вопрос</TooltipContent> : null}
        </Tooltip>
      </div>

      <nav className={cn("flex-1 space-y-4 pb-2", compact ? "px-0" : "px-2")}>
        {VISIBLE_NAVIGATION_SECTIONS.map((section) => {
          const items = section.items
            .filter((item) => !item.adminOnly || isAdmin)
            .filter((item) => section.id !== "focus" || shouldShowFocusNavigationItem(item.href, focusCounts));
          if (!items.length) return null;
          return (
            <div key={section.id} className="space-y-1">
              {!compact ? (
                <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {section.label}
                </div>
              ) : null}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={{
                      ...item,
                      icon: item.href === "/projects" && isNota ? FolderOpen : item.icon,
                    }}
                    badge={item.badgeKey === "inboxUnread" ? inboxUnread : undefined}
                    compact={compact}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="space-y-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "group flex w-full items-center rounded-md text-sm text-sidebar-foreground/68 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      compact ? "justify-center px-0 py-2 md:py-1.5" : "justify-start gap-2.5 px-2.5 py-1.5",
                    )}
                    data-testid="sidebar-more"
                  >
                    <MoreHorizontal size={17} className="text-muted-foreground group-hover:text-foreground" />
                    {!compact ? <span className="min-w-0 flex-1 truncate text-left">Дополнительно</span> : null}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {compact ? <TooltipContent side="right">Дополнительно</TooltipContent> : null}
            </Tooltip>
            <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-64">
              {OVERFLOW_NAVIGATION_SECTIONS.map((section, sectionIndex) => {
                const items = section.items
                  .filter((item) => item.href !== "/feedback")
                  .filter((item) => !item.adminOnly || isAdmin);
                if (!items.length) return null;
                return (
                  <div key={section.id}>
                    {sectionIndex > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </DropdownMenuLabel>
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem key={item.href} asChild>
                          <Link href={item.href} className="cursor-pointer" onClick={onNavigate}>
                            <Icon size={15} />
                            {item.label}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                );
              })}
              {isAdmin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Kanban
                  </DropdownMenuLabel>
                  {isKanbanConnected ? (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/admin/kanban/projects" className="cursor-pointer" onClick={onNavigate}>
                          <FolderKanban size={15} />
                          Проекты
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/admin/kanban/analytics/epics" className="cursor-pointer" onClick={onNavigate}>
                          <BarChart2 size={15} />
                          Эпики
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/admin/kanban/analytics/tasks" className="cursor-pointer" onClick={onNavigate}>
                          <ClipboardList size={15} />
                          Задачи
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/admin/kanban/summary" className="cursor-pointer" onClick={onNavigate}>
                          <CalendarDays size={15} />
                          Сводка
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setKanbanLogoutOpen(true)}>
                        Выйти из Kanban
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => {
                        setKanbanLoginOpen(true);
                        onNavigate?.();
                      }}
                    >
                      <FolderKanban size={15} />
                      Подключить Kanban
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <div className={cn("shrink-0 border-t border-sidebar-border py-2", compact ? "px-1" : "px-2")}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sm font-semibold text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    compact ? "mx-auto" : "ml-0",
                  )}
                  aria-label="Помощь"
                  data-testid="sidebar-help"
                >
                  ?
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Помощь</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
            <DropdownMenuItem className="cursor-pointer" onSelect={() => setShortcutHelpOpen(true)}>
              <Keyboard size={15} />
              Горячие клавиши
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => toast.info("История изменений появится здесь позже.")}>
              <Sparkles size={15} />
              Что нового?
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onSelect={() => setFeedbackOpen(true)}>
              <MessageSquare size={15} />
              Обратная связь
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ShortcutHelpSheet open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <CreateQuestionDialog open={createQuestionOpen} onOpenChange={setCreateQuestionOpen} />
      {isAdmin ? (
        <AlertDialog open={kanbanLogoutOpen} onOpenChange={setKanbanLogoutOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Выйти из Kanban?</AlertDialogTitle>
              <AlertDialogDescription>
                Токен доступа к Kanban будет удалён. Разделы админки Kanban станут недоступны, пока вы снова не
                подключите учётную запись.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <Button type="button" disabled={updateMe.isPending} onClick={() => void confirmKanbanLogout()}>
                {updateMe.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Выйти
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {isAdmin ? <KanbanLoginDialog open={kanbanLoginOpen} onOpenChange={setKanbanLoginOpen} /> : null}
    </aside>
  );
}
