import { useEffect, useState } from "react";
import { useLocation as useWouterLocation, Link } from "@/lib/router";
import { useLocation as useRouterLocation } from "react-router-dom";
import { ChevronRight, LogOut, Menu, Search, Settings, User } from "lucide-react";

import { CommandMenu } from "@/components/layout/CommandMenu";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { NotificationBell } from "@/components/shared/NotificationCenter";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/contexts/RoleContext";
import { epics } from "@/data/epics";
import { projects } from "@/data/projects";
import type { RealtimeStatus } from "@/lib/useEventStream";

const routeLabels: Record<string, string> = {
  "/": "Рабочий стол",
  "/inbox": "Входящие",
  "/questions": "Вопросы",
  "/epics": "Эпики",
  "/activity": "Активность",
  "/statistics": "Статистика",
  "/users": "Пользователи",
  "/admin/feedback": "Заявки ОС",
  "/projects": "Проекты",
  "/settings": "Настройки",
  "/profile": "Профиль",
  "/feedback": "Обратная связь",
};

function Breadcrumb() {
  const [location] = useWouterLocation();
  const routerLoc = useRouterLocation();

  if (location === "/admin/kanban/projects") {
    return <span className="truncate text-sm font-medium text-foreground">Kanban проекты</span>;
  }

  if (location === "/admin/kanban/team-roles") {
    return <span className="truncate text-sm font-medium text-foreground">Kanban - роли команды</span>;
  }

  if (location.startsWith("/admin/kanban/projects/") && location !== "/admin/kanban/projects") {
    const rest = location.slice("/admin/kanban/projects/".length);
    const rolesSuffix = "/member-roles";
    if (rest.endsWith(rolesSuffix)) {
      const slug = decodeURIComponent(rest.slice(0, -rolesSuffix.length));
      const name = (routerLoc.state as { name?: string } | null)?.name?.trim() || slug;
      return (
        <div className="flex min-w-0 items-center gap-1 text-sm">
          <Link href="/admin/kanban/projects">
            <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Kanban проекты</span>
          </Link>
          <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground/50 sm:block" />
          <Link href="/admin/kanban/team-roles">
            <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Роли</span>
          </Link>
          <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground/50 sm:block" />
          <span className="truncate font-medium text-foreground" title={slug}>
            {name}
          </span>
        </div>
      );
    }
    const slug = decodeURIComponent(rest);
    const name = (routerLoc.state as { name?: string } | null)?.name?.trim() || slug;
    return (
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <Link href="/admin/kanban/projects">
          <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Kanban проекты</span>
        </Link>
        <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground/50 sm:block" />
        <span className="truncate font-medium text-foreground" title={slug}>
          {name}
        </span>
      </div>
    );
  }

  if (location.startsWith("/questions/") && location !== "/questions/") {
    const id = location.split("/")[2];
    return (
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <Link href="/questions">
          <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Вопросы</span>
        </Link>
        <ChevronRight size={14} className="hidden text-muted-foreground/50 sm:block" />
        <span className="truncate font-medium text-foreground">{id}</span>
      </div>
    );
  }

  if (location.startsWith("/epics/") && location !== "/epics/") {
    const id = location.split("/")[2];
    const epic = epics.find((item) => item.id === id);
    return (
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <Link href="/epics">
          <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Эпики</span>
        </Link>
        <ChevronRight size={14} className="hidden text-muted-foreground/50 sm:block" />
        <span className="truncate font-medium text-foreground">{epic?.id ?? id}</span>
      </div>
    );
  }

  if (location.startsWith("/projects/") && location !== "/projects/") {
    const id = location.split("/")[2];
    const project = projects.find((item) => item.id === id);
    return (
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <Link href="/projects">
          <span className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Проекты</span>
        </Link>
        <ChevronRight size={14} className="hidden text-muted-foreground/50 sm:block" />
        <span className="truncate font-medium text-foreground">{project?.name ?? id}</span>
      </div>
    );
  }

  const label = routeLabels[location] ?? "Resonance";
  return <h1 className="truncate text-sm font-semibold text-foreground">{label}</h1>;
}

interface HeaderProps {
  onMenuClick: () => void;
  realtimeStatus: RealtimeStatus;
}

const REALTIME_STATUS_META: Record<RealtimeStatus, { ariaLabel: string; dotClassName: string; showLiveLabel: boolean }> = {
  online: {
    ariaLabel: "Realtime подключен",
    dotClassName: "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.14)]",
    showLiveLabel: true,
  },
  connecting: {
    ariaLabel: "Подключение к realtime",
    dotClassName: "bg-amber-400 animate-pulse shadow-[0_0_0_3px_rgba(251,191,36,0.14)]",
    showLiveLabel: false,
  },
  reconnecting: {
    ariaLabel: "Realtime переподключается",
    dotClassName: "bg-amber-400 animate-pulse shadow-[0_0_0_3px_rgba(251,191,36,0.14)]",
    showLiveLabel: false,
  },
  offline: {
    ariaLabel: "Realtime не используется",
    dotClassName: "bg-muted-foreground/50",
    showLiveLabel: false,
  },
};

export function RealtimeStatusIndicator({ status }: { status: RealtimeStatus }) {
  const meta = REALTIME_STATUS_META[status];

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="realtime-status"
            aria-label={meta.ariaLabel}
            title={meta.ariaLabel}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground"
            role="status"
            tabIndex={0}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dotClassName}`} aria-hidden="true" />
            {meta.showLiveLabel && <span className="hidden text-emerald-700 md:inline dark:text-emerald-300">Live</span>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {meta.ariaLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Header({ onMenuClick, realtimeStatus }: HeaderProps) {
  const { currentUser } = useRole();
  const { logout } = useAuth();
  const [commandOpen, setCommandOpen] = useState(false);
  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [, setLocation] = useWouterLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleLogout = () => {
    logout();
    setLocation("/login", { replace: true });
  };

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-border bg-card/50 px-3 backdrop-blur-sm md:px-4">
      <button
        onClick={onMenuClick}
        className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
        data-testid="button-menu"
        aria-label="Меню"
      >
        <Menu size={18} />
      </button>

      <div className="min-w-0 flex-1">
        <Breadcrumb />
      </div>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="hidden h-9 w-[280px] items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex xl:w-[360px]"
        data-testid="button-command-menu"
      >
        <span className="min-w-0 flex-1 truncate">⌘  Поиск, переход или команда...</span>
      </button>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
        data-testid="button-mobile-command-menu"
        aria-label="Открыть поиск и команды"
      >
        <Search size={17} />
      </button>

      <div className="flex min-w-0 flex-shrink-0 items-center gap-1">
        <div className="min-w-0 max-w-[min(280px,52vw)] sm:max-w-none">
          <RoleSwitcher />
        </div>
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Открыть меню профиля"
              data-testid="button-profile-menu"
            >
              {currentUser.avatarInitials || currentUser.name?.slice(0, 1) || "?"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-56">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div className="min-w-0 truncate text-sm font-semibold text-popover-foreground">{currentUser.name}</div>
              <RealtimeStatusIndicator status={realtimeStatus} />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" className="cursor-pointer">
                <User size={14} />
                Профиль
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings size={14} />
                Настройки
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onSelect={handleLogout}>
              <LogOut size={14} />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCreateQuestion={() => setCreateQuestionOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
      />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <CreateQuestionDialog open={createQuestionOpen} onOpenChange={setCreateQuestionOpen} />
    </header>
  );
}
