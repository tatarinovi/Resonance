import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "@/lib/router";
import {
  LayoutDashboard, Inbox, HelpCircle, Layers, Activity,
  BarChart2, Users, FolderKanban, FolderOpen, MessageSquare,
  Radio, Plus, ClipboardList, Loader2, CalendarDays,
} from "lucide-react";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { useInbox } from "@/hooks/useInbox";
import { useAuth } from "@/contexts/AuthContext";
import { useQuestionDraftPresence } from "@/hooks/useQuestionDraftPresence";
import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { KanbanLoginDialog } from "@/components/kanban/KanbanLoginDialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { ApiError } from "@/lib/api";
import { useUpdateMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Ниже этой ширины панели показываются только иконки (подписи — в подсказках). */
const COMPACT_BREAKPOINT_PX = 148;

interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  adminOnly?: boolean;
}

const mainNav: NavItem[] = [
  { href: "/", icon: LayoutDashboard, label: "Рабочий стол" },
  { href: "/inbox", icon: Inbox, label: "Входящие" },
  { href: "/questions", icon: HelpCircle, label: "Вопросы" },
  { href: "/epics", icon: Layers, label: "Эпики" },
  { href: "/projects", icon: FolderKanban, label: "Проекты" },
  { href: "/activity", icon: Activity, label: "Активность" },
  { href: "/statistics", icon: BarChart2, label: "Статистика" },
];

const bottomNav: NavItem[] = [
  { href: "/users", icon: Users, label: "Пользователи", adminOnly: true },
  { href: "/feedback", icon: MessageSquare, label: "Обратная связь" },
  { href: "/admin/feedback", icon: ClipboardList, label: "Заявки ОС", adminOnly: true },
];

function NavLink({
  item,
  onNavigate,
  compact,
}: {
  item: NavItem;
  onNavigate?: () => void;
  compact: boolean;
}) {
  const [location] = useLocation();
  const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
  const count = item.badge;
  const tooltip =
    count != null && count > 0 ? `${item.label} (${count})` : item.label;

  const inner = (
    <span
      onClick={onNavigate}
      className={cn(
        "flex cursor-pointer items-center rounded-md text-sm transition-colors group",
        compact ? "justify-center px-0 py-2 md:py-1.5" : "gap-2.5 px-2.5 py-2 md:py-1.5",
        isActive
          ? "bg-primary/15 text-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      data-testid={`nav-${item.href.replace(/\//g, "-") || "dashboard"}`}
    >
      <span className="relative inline-flex shrink-0">
        <item.icon
          size={18}
          className={isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}
        />
        {compact && count != null && count > 0 ? (
          <span
            className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
            aria-hidden
          />
        ) : null}
      </span>
      {!compact ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {count != null && count > 0 ? (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-bold text-primary">
              {count}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );

  const linkBody = compact ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={item.href} className="block text-inherit no-underline">
          {inner}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  ) : (
    <Link href={item.href} className="block text-inherit no-underline">
      {inner}
    </Link>
  );

  return linkBody;
}

interface SidebarProps {
  onNavigate?: () => void;
  /** Текущая ширина панели (px), задаётся из AppShell при перетаскивании границы. */
  sidebarWidth: number;
}

export function Sidebar({ onNavigate, sidebarWidth }: SidebarProps) {
  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const [kanbanLoginOpen, setKanbanLoginOpen] = useState(false);
  const [kanbanLogoutOpen, setKanbanLogoutOpen] = useState(false);
  const { me } = useAuth();
  const updateMe = useUpdateMe();
  const hasQuestionDraft = useQuestionDraftPresence(me?.id ?? null);
  const { unreadCount: inboxUnread } = useInbox();
  const isNota = useIsNotaWorkspace();
  const isAdmin = me?.role === "admin";
  const isKanbanConnected = Boolean(me?.kanban_connected);
  const compact = sidebarWidth < COMPACT_BREAKPOINT_PX;

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
      <Link
        href="/"
        className={cn(
          "flex h-[52px] shrink-0 items-center border-b border-border text-inherit no-underline transition-colors hover:bg-sidebar-accent/40",
          compact ? "justify-center px-0" : "gap-2.5 px-4",
        )}
      >
        <span onClick={onNavigate} className={cn("flex items-center", compact ? "justify-center" : "w-full gap-2.5")}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Radio size={14} className="text-white" />
          </div>
          {!compact ? (
            <span className="text-sm font-semibold leading-none text-sidebar-foreground">Resonance</span>
          ) : null}
        </span>
      </Link>

      <div className={cn("py-3", compact ? "px-0" : "px-2")}>
        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setCreateQuestionOpen(true);
                  onNavigate?.();
                }}
                className="relative flex w-full items-center justify-center rounded-md bg-primary px-0 py-2 text-primary-foreground transition-colors hover:bg-primary/90 md:py-1.5"
                data-testid="sidebar-create-question"
              >
                {hasQuestionDraft ? (
                  <span
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-primary"
                    aria-hidden
                    data-testid="sidebar-question-draft-dot"
                  />
                ) : null}
                <Plus size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Задать вопрос</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreateQuestionOpen(true);
              onNavigate?.();
            }}
            className="relative flex w-full items-center justify-center gap-2 rounded-md bg-primary px-2.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="sidebar-create-question"
          >
            {hasQuestionDraft ? (
              <span
                className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-primary"
                aria-hidden
                data-testid="sidebar-question-draft-dot"
              />
            ) : null}
            <Plus size={16} />
            Задать вопрос
          </button>
        )}
      </div>

      <nav className={cn("flex-1 space-y-0.5 py-2", compact ? "px-0" : "px-2")}>
        {mainNav.map(item => (
          <NavLink
            key={item.href}
            item={{
              ...item,
              badge: item.href === "/inbox" ? inboxUnread : item.badge,
              icon: item.href === "/projects" && isNota ? FolderOpen : item.icon,
            }}
            onNavigate={onNavigate}
            compact={compact}
          />
        ))}

        {isAdmin && compact ? (
          <div className="pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Kanban"
                  className="flex w-full cursor-pointer items-center justify-center rounded-md px-0 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:py-1.5"
                  aria-label="Kanban"
                >
                  <FolderKanban size={18} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-56">
                {isKanbanConnected ? (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/kanban/projects" className="cursor-pointer" onClick={onNavigate}>
                        Проекты
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/kanban/analytics/epics" className="cursor-pointer" onClick={onNavigate}>
                        Эпики
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/kanban/analytics/tasks" className="cursor-pointer" onClick={onNavigate}>
                        Задачи
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/admin/kanban/summary"
                        className="cursor-pointer"
                        onClick={onNavigate}
                        data-testid="sidebar-kanban-summary-compact"
                      >
                        Сводка
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer" onSelect={() => setKanbanLogoutOpen(true)}>
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
                    Подключить Kanban
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        {isAdmin && !compact ? (
          <div className="pt-1">
            <Accordion type="single" collapsible>
              <AccordionItem value="kanban" className="border-none">
                <AccordionTrigger className="rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/70 no-underline hover:bg-sidebar-accent hover:text-sidebar-foreground hover:no-underline md:py-1.5">
                  <span className="flex w-full items-center gap-2.5">
                    <FolderKanban size={18} className="text-muted-foreground" />
                    <span className="flex-1 text-left">Kanban</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-1">
                  {isKanbanConnected ? (
                    <div className="space-y-0.5 pr-2 pl-6">
                      <NavLink
                        item={{ href: "/admin/kanban/projects", icon: FolderKanban, label: "Проекты" }}
                        onNavigate={onNavigate}
                        compact={false}
                      />
                      <NavLink
                        item={{ href: "/admin/kanban/analytics/epics", icon: BarChart2, label: "Эпики" }}
                        onNavigate={onNavigate}
                        compact={false}
                      />
                      <NavLink
                        item={{ href: "/admin/kanban/analytics/tasks", icon: BarChart2, label: "Задачи" }}
                        onNavigate={onNavigate}
                        compact={false}
                      />
                      <NavLink
                        item={{ href: "/admin/kanban/summary", icon: CalendarDays, label: "Сводка" }}
                        onNavigate={onNavigate}
                        compact={false}
                      />

                      <button
                        type="button"
                        className="flex w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:py-1.5"
                        onClick={() => setKanbanLogoutOpen(true)}
                        data-testid="sidebar-kanban-logout"
                      >
                        Выйти из Kanban
                      </button>
                    </div>
                  ) : (
                    <div className="px-6 pr-2">
                      <button
                        type="button"
                        className="flex w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:py-1.5"
                        onClick={() => {
                          setKanbanLoginOpen(true);
                          onNavigate?.();
                        }}
                        data-testid="sidebar-kanban-login"
                      >
                        Подключить Kanban
                      </button>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ) : null}
      </nav>

      <div className={cn("border-t border-border/80", compact ? "mx-1" : "mx-2")} />

      <nav className={cn("space-y-0.5 py-2", compact ? "px-0" : "px-2")}>
        {bottomNav
          .filter(item => !item.adminOnly || isAdmin)
          .map(item => (
            <NavLink
              key={item.href}
              item={item}
              onNavigate={onNavigate}
              compact={compact}
            />
          ))}
      </nav>
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
              <Button
                type="button"
                disabled={updateMe.isPending}
                onClick={() => void confirmKanbanLogout()}
                data-testid="kanban-logout-confirm"
              >
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
