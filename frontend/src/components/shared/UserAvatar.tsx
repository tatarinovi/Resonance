import { users } from "@/data/users";
import { refIdToNumeric } from "@/lib/mappers";
import type React from "react";
import { useNavigate } from "react-router-dom";

const colors = [
  "bg-violet-600", "bg-blue-600", "bg-emerald-600",
  "bg-orange-600", "bg-pink-600", "bg-teal-600", "bg-indigo-600",
];

interface UserAvatarProps {
  userId: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  tooltipAlign?: "center" | "end";
  tooltipSide?: "top" | "bottom";
  href?: string;
}

export function UserAvatar({
  userId,
  size = "md",
  showName = false,
  tooltipAlign = "center",
  tooltipSide = "top",
  href,
}: UserAvatarProps) {
  const navigate = useNavigate();
  const user = users.find(u => u.id === userId);
  const initials = user?.avatarInitials ?? "??";
  const tooltip = user?.name || userId;
  const numericUserId = user ? refIdToNumeric(user.id) : null;
  const profileHref = href ?? (numericUserId != null ? `/users/${numericUserId}` : null);
  const colorIdx = parseInt(userId.replace(/\D/g, ""), 10) % colors.length;
  const colorClass = colors[colorIdx] ?? "bg-slate-600";

  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : size === "lg" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";
  const tooltipAlignClass =
    tooltipAlign === "end"
      ? "right-0 max-w-[min(260px,calc(100vw-24px))] translate-x-0"
      : "left-1/2 max-w-[min(260px,calc(100vw-24px))] -translate-x-1/2";
  const tooltipSideClass =
    tooltipSide === "bottom"
      ? "top-full mt-2"
      : "top-0 -translate-y-[calc(100%+8px)]";

  const openProfile = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!profileHref) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(profileHref);
  };

  return (
    <span
      className={`group/avatar relative inline-flex items-center gap-2 ${profileHref ? "cursor-pointer" : ""}`}
      aria-label={tooltip}
      role={profileHref ? "link" : undefined}
      tabIndex={profileHref ? 0 : undefined}
      onClick={openProfile}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") openProfile(event);
      }}
    >
      <span className={`${sizeClass} ${colorClass} select-none rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
        {initials}
      </span>
      <span className={`pointer-events-none absolute z-50 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100 ${tooltipAlignClass} ${tooltipSideClass}`}>
        {tooltip}
      </span>
      {showName && user && <span className="text-sm text-foreground hover:underline">{user.name}</span>}
    </span>
  );
}
