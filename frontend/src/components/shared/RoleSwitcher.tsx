import { ChevronDown, UserCog } from "lucide-react";
import { useRole } from "@/contexts/RoleContext";
import { users, Role } from "@/data/users";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

const roleUsers: Record<Role, string> = {
  "Координатор": "U-001",
  "Эксперт": "U-003",
  "Разработчик": "U-004",
  "Админ": "U-005",
};

const roleColors: Record<Role, string> = {
  "Координатор": "text-blue-700 dark:text-blue-400",
  "Эксперт": "text-emerald-700 dark:text-emerald-400",
  "Разработчик": "text-amber-700 dark:text-amber-400",
  "Админ": "text-red-700 dark:text-red-400",
};

/** После входа роль задаётся учётной записью на сервере; демо не переключает JWT. */
export function RoleSwitcher() {
  const { currentUser, setCurrentUserId } = useRole();
  const { me } = useAuth();

  if (me) {
    return null;
  }

  const handleSwitch = (role: Role) => {
    const userId = roleUsers[role];
    setCurrentUserId(userId);
    toast.success(`Роль переключена: ${role}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card hover:bg-accent text-xs font-medium transition-colors"
          data-testid="button-role-switcher"
        >
          <UserCog size={13} className="text-muted-foreground" />
          <span className={roleColors[currentUser.role]}>{currentUser.role}</span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">Демо-режим: роль</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(roleUsers) as Role[]).map((role) => {
          const uid = roleUsers[role];
          const user = users.find((u) => u.id === uid);
          return (
            <DropdownMenuItem
              key={role}
              onClick={() => handleSwitch(role)}
              className="flex items-center justify-between"
              data-testid={`role-option-${role}`}
            >
              <div>
                <p className={`text-xs font-medium ${roleColors[role]}`}>{role}</p>
                <p className="text-[10px] text-muted-foreground">{user?.name}</p>
              </div>
              {currentUser.role === role && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
