import { users } from "@/data/users";

const colors = [
  "bg-violet-600", "bg-blue-600", "bg-emerald-600",
  "bg-orange-600", "bg-pink-600", "bg-teal-600", "bg-indigo-600",
];

interface UserAvatarProps {
  userId: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
}

export function UserAvatar({ userId, size = "md", showName = false }: UserAvatarProps) {
  const user = users.find(u => u.id === userId);
  const initials = user?.avatarInitials ?? "??";
  const tooltip = user?.name || userId;
  const colorIdx = parseInt(userId.replace(/\D/g, ""), 10) % colors.length;
  const colorClass = colors[colorIdx] ?? "bg-slate-600";

  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : size === "lg" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";

  return (
    <span className="group/avatar relative inline-flex items-center gap-2" aria-label={tooltip}>
      <span className={`${sizeClass} ${colorClass} select-none rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
        {initials}
      </span>
      <span className="pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100">
        {tooltip}
      </span>
      {showName && user && <span className="text-sm text-foreground">{user.name}</span>}
    </span>
  );
}
