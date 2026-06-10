import { useState } from "react";
import { useLocation as useWouterLocation, Link } from "@/lib/router";
import { useLocation as useRouterLocation } from "react-router-dom";
import { Search, ChevronRight, Menu, X } from "lucide-react";
import { NotificationBell } from "@/components/shared/NotificationCenter";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useRole } from "@/contexts/RoleContext";
import { questions } from "@/data/questions";
import { epics } from "@/data/epics";
import { projects } from "@/data/projects";

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
    return <span className="text-sm font-medium text-foreground truncate">Kanban проекты</span>;
  }

  if (location === "/admin/kanban/team-roles") {
    return <span className="text-sm font-medium text-foreground truncate">Kanban — роли команды</span>;
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
            <span className="cursor-pointer text-muted-foreground hover:text-foreground hidden sm:inline">Kanban проекты</span>
          </Link>
          <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground/50 sm:block" />
          <Link href="/admin/kanban/team-roles">
            <span className="cursor-pointer text-muted-foreground hover:text-foreground hidden sm:inline">Роли</span>
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
          <span className="cursor-pointer text-muted-foreground hover:text-foreground hidden sm:inline">Kanban проекты</span>
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
    const q = questions.find(q => q.id === id);
    return (
      <div className="flex items-center gap-1 text-sm min-w-0">
        <Link href="/questions">
          <span className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline">Вопросы</span>
        </Link>
        <ChevronRight size={14} className="text-muted-foreground/50 hidden sm:block" />
        <span className="text-foreground font-medium truncate">{q?.id ?? id}</span>
      </div>
    );
  }

  if (location.startsWith("/epics/") && location !== "/epics/") {
    const id = location.split("/")[2];
    const e = epics.find(e => e.id === id);
    return (
      <div className="flex items-center gap-1 text-sm min-w-0">
        <Link href="/epics">
          <span className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline">Эпики</span>
        </Link>
        <ChevronRight size={14} className="text-muted-foreground/50 hidden sm:block" />
        <span className="text-foreground font-medium truncate">{e?.id ?? id}</span>
      </div>
    );
  }

  if (location.startsWith("/projects/") && location !== "/projects/") {
    const id = location.split("/")[2];
    const p = projects.find(p => p.id === id);
    return (
      <div className="flex items-center gap-1 text-sm min-w-0">
        <Link href="/projects">
          <span className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline">Проекты</span>
        </Link>
        <ChevronRight size={14} className="text-muted-foreground/50 hidden sm:block" />
        <span className="text-foreground font-medium truncate">{p?.name ?? id}</span>
      </div>
    );
  }

  const label = routeLabels[location] ?? "Resonance";
  return <h1 className="text-sm font-semibold text-foreground truncate">{label}</h1>;
}

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { currentUser } = useRole();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [, setLocation] = useWouterLocation();

  const filtered = search.length > 1
    ? [
        ...questions
          .filter(q => q.title.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 3)
          .map(q => ({ type: "q", id: q.id, label: q.title })),
        ...epics
          .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 2)
          .map(e => ({ type: "e", id: e.id, label: e.name })),
      ]
    : [];

  const handleSearchSelect = (item: { type: string; id: string }) => {
    setSearch("");
    setSearchOpen(false);
    setLocation(item.type === "q" ? `/questions/${item.id}` : `/epics/${item.id}`);
  };

  return (
    <header className="h-[52px] flex items-center gap-2 px-3 md:px-4 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
        data-testid="button-menu"
        aria-label="Меню"
      >
        <Menu size={18} />
      </button>

      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Desktop search */}
      <div className="relative w-56 lg:w-64 hidden md:block">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Поиск вопросов, эпиков..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          data-testid="input-global-search"
        />
        {filtered.length > 0 && (
          <div className="absolute top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg z-50 overflow-hidden">
            {filtered.map(item => (
              <button
                key={item.id}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                onClick={() => handleSearchSelect(item)}
                data-testid={`search-result-${item.id}`}
              >
                <span className="text-[10px] text-muted-foreground font-mono">{item.id}</span>
                <span className="truncate text-foreground">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile search button + overlay */}
      <div className="md:hidden relative">
        <button
          onClick={() => setSearchOpen(v => !v)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          data-testid="button-mobile-search"
        >
          {searchOpen ? <X size={17} /> : <Search size={17} />}
        </button>

        {searchOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 z-50 bg-popover border border-border rounded-md shadow-xl p-2">
            <input
              type="search"
              placeholder="Поиск..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {filtered.length > 0 && (
              <div className="mt-1">
                {filtered.map(item => (
                  <button
                    key={item.id}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent rounded-md transition-colors flex items-center gap-2"
                    onClick={() => handleSearchSelect(item)}
                  >
                    <span className="text-[10px] text-muted-foreground font-mono">{item.id}</span>
                    <span className="truncate text-foreground">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1 flex-shrink-0 min-w-0">
        <div className="min-w-0 max-w-[min(280px,52vw)] sm:max-w-none">
          <RoleSwitcher />
        </div>
        <NotificationBell />
        <UserAvatar userId={currentUser.id} size="sm" tooltipAlign="end" tooltipSide="bottom" href="/profile" />
      </div>
    </header>
  );
}
