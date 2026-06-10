import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { activityEvents } from "@/data/activity";
import { useDataBridgeVersion } from "@/data/users";
import { questions } from "@/data/questions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Link } from "@/lib/router";
import { useProfileStats } from "@/lib/queries";
import { formatDateTime } from "@/lib/formatDateTime";
import type { RefUser } from "@/lib/mappers";
import type { ApiProfileStats } from "@/lib/types";
import type { ReactNode } from "react";
import { Clock, MessageCircle, Send, HelpCircle, Activity, CheckCircle, Settings } from "lucide-react";

type HeatmapDay = { date: string; count: number };
type ContactItem = { label: string; value: string; icon: ReactNode; href?: string };

const HEATMAP_DAYS = 140;

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildQuestionHeatmapFallback(myQuestions: typeof questions, currentUserId: string): HeatmapDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - HEATMAP_DAYS + 1);

  const counts = new Map<string, number>();
  for (let i = 0; i < HEATMAP_DAYS; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    counts.set(dateKey(d), 0);
  }

  const add = (iso: string | undefined) => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    d.setHours(0, 0, 0, 0);
    if (d < start || d > today) return;
    const key = dateKey(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const q of myQuestions) {
    add(q.createdAt);
    for (const message of q.thread ?? []) {
      if (message.authorId === currentUserId) add(message.createdAt);
    }
  }

  return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
}

function heatmapCellClass(count: number): string {
  if (count <= 0) return "bg-muted/50";
  if (count === 1) return "bg-primary/25";
  if (count <= 3) return "bg-primary/45";
  if (count <= 6) return "bg-primary/70";
  return "bg-primary";
}

function formatHeatmapDate(date: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00`));
}

function QuestionHeatmap({ days }: { days: HeatmapDay[] }) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Активность по вопросам</h3>
          <p className="mt-1 text-xs text-muted-foreground">{activeDays} активн. дней · {total} действий</p>
        </div>
      </div>
      <div className="mt-4 flex justify-center overflow-hidden">
        <div className="grid grid-flow-col grid-rows-7 auto-cols-[10px] gap-[3px]">
          {days.map((day) => (
            <div
              key={day.date}
              className={`h-2.5 w-2.5 rounded-[3px] ${heatmapCellClass(day.count)}`}
              title={`${formatHeatmapDate(day.date)}: ${day.count} действ.`}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>меньше</span>
          {[0, 1, 3, 6, 9].map((count) => (
            <span key={count} className={`h-2 w-2 rounded-[2px] ${heatmapCellClass(count)}`} />
          ))}
          <span>больше</span>
        </div>
      </div>
    </div>
  );
}

function QuestionHeatmapLoading() {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div>
        <div className="h-4 w-36 rounded bg-muted" />
        <div className="mt-2 h-3 w-28 rounded bg-muted/70" />
      </div>
      <div className="mt-4 flex justify-center">
        <div className="grid grid-flow-col grid-rows-7 auto-cols-[10px] gap-[3px]">
          {Array.from({ length: HEATMAP_DAYS }).map((_, index) => (
            <div key={index} className="h-2.5 w-2.5 rounded-[3px] bg-muted/60" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function matrixProfileHref(matrixId: string | null | undefined): string | undefined {
  const value = (matrixId ?? "").trim();
  if (!value) return undefined;
  return `https://matrix.to/#/${encodeURIComponent(value)}`;
}

export function telegramProfileHref(telegram: string | null | undefined): string | undefined {
  const value = (telegram ?? "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^t\.me\//i.test(value)) return `https://${value}`;
  if (/^\d+$/.test(value)) return `tg://user?id=${value}`;
  return `https://t.me/${value.replace(/^@/, "")}`;
}

export default function ProfilePage() {
  useDataBridgeVersion();
  const { currentUser } = useRole();
  const { me } = useAuth();
  const profileStats = useProfileStats();

  return (
    <UserProfileView
      user={currentUser}
      stats={profileStats.data}
      statsLoading={profileStats.isLoading}
      statsError={profileStats.isError}
      showSettingsLink
      heading="Профиль"
      questionsHeading="Мои вопросы"
      activityHeading="Последняя активность"
      contactItems={[
        {
          label: "Matrix ID",
          value: me?.matrix_id || "Не указан",
          href: matrixProfileHref(me?.matrix_id),
          icon: <MessageCircle size={12} />,
        },
        {
          label: "Telegram",
          value: me?.telegram_id || "Не указан",
          href: telegramProfileHref(me?.telegram_id),
          icon: <Send size={12} />,
        },
        { label: "Последний вход", value: me?.last_login_at ? formatDateTime(me.last_login_at) : "Нет данных", icon: <Clock size={12} /> },
      ]}
      emptyQuestionsText="Вы ещё не задавали вопросов"
      allQuestionsHref="/questions?author=me"
      allQuestionsText="Все мои вопросы"
    />
  );
}

export function UserProfileView({
  user,
  stats,
  statsLoading = false,
  statsError = false,
  showSettingsLink = false,
  heading = "Профиль пользователя",
  questionsHeading = "Вопросы пользователя",
  activityHeading = "Активность пользователя",
  contactItems = [],
  emptyQuestionsText = "Нет видимых вопросов",
  allQuestionsHref,
  allQuestionsText = "Все видимые вопросы",
}: {
  user: RefUser;
  stats?: ApiProfileStats;
  statsLoading?: boolean;
  statsError?: boolean;
  showSettingsLink?: boolean;
  heading?: string;
  questionsHeading?: string;
  activityHeading?: string;
  contactItems?: ContactItem[];
  emptyQuestionsText?: string;
  allQuestionsHref?: string;
  allQuestionsText?: string;
}) {
  useDataBridgeVersion();

  const myActivity = activityEvents.filter(e => e.userId === user.id).slice(0, 8);
  const myQ = questions.filter(q => q.authorId === user.id);
  const closedQ = stats?.authored_closed ?? myQ.filter(q => q.status === "Закрыт").length;
  const assignedQ = stats?.assigned_open ?? questions.filter(q => q.assigneeId === user.id && !["Закрыт", "Отменён"].includes(q.status)).length;
  const authoredTotal = stats?.authored_total ?? myQ.length;
  const questionHeatmap = stats?.question_heatmap ?? buildQuestionHeatmapFallback(myQ, user.id);

  const roleColors: Record<string, string> = {
    Координатор: "bg-blue-500/15 text-blue-400",
    "Эксперт": "bg-emerald-500/15 text-emerald-400",
    "Разработчик": "bg-amber-500/15 text-amber-400",
    "Админ": "bg-red-500/15 text-red-400",
  };

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "только что";
    if (h < 24) return `${h} ч. назад`;
    return `${Math.floor(h / 24)} д. назад`;
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">{heading}</h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Profile card */}
        <div className="space-y-4 lg:order-2">
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">
              {user.avatarInitials}
            </div>
            <h2 className="text-base font-semibold text-foreground">{user.name}</h2>
            <span className={`inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${roleColors[user.role] ?? "bg-muted text-muted-foreground"}`}>
              {user.role}
            </span>
            {contactItems.length > 0 && (
              <div className="mx-auto mt-4 w-full max-w-[240px] space-y-2 text-xs">
                {contactItems.map((item) => (
                  <div key={item.label} className="flex min-w-0 items-center gap-2 text-left">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] leading-none text-muted-foreground/70">{item.label}</span>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          title={item.value}
                          className="mt-0.5 block truncate text-xs font-medium text-primary hover:underline"
                        >
                          {item.value}
                        </a>
                      ) : (
                        <span title={item.value} className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
                          {item.value}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {statsError && (
              <p className="mt-3 text-xs text-destructive">Не удалось загрузить статистику</p>
            )}
            <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-border">
              {[
                { label: "Задано", value: authoredTotal, icon: HelpCircle },
                { label: "Закрыто", value: closedQ, icon: CheckCircle },
                { label: "Назначено", value: assignedQ, icon: Activity },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <s.icon size={14} className="text-muted-foreground mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{statsLoading && stats == null ? "..." : s.value}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
            {showSettingsLink && (
              <Link href="/settings">
                <span className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                  <Settings size={14} />
                  Настройки профиля
                </span>
              </Link>
            )}
          </div>

          {statsLoading && stats == null ? <QuestionHeatmapLoading /> : <QuestionHeatmap days={questionHeatmap} />}
        </div>

        {/* Activity + questions */}
        <div className="space-y-4 lg:order-1">
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">{questionsHeading}</h3>
            {myQ.length === 0
              ? <p className="text-sm text-muted-foreground">{emptyQuestionsText}</p>
              : (
                <div className="space-y-1">
                  {myQ.slice(0, 6).map(q => (
                    <Link key={q.id} href={`/questions/${q.id}`}>
                      <div className="flex items-center gap-3 py-2 hover:bg-accent/50 rounded-md px-2 cursor-pointer transition-colors">
                        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">{q.id}</span>
                        <span className="text-sm text-foreground flex-1 truncate">{q.title}</span>
                        <StatusBadge status={q.status} size="sm" />
                      </div>
                    </Link>
                  ))}
                  {allQuestionsHref && (
                    <Link href={allQuestionsHref}>
                      <span className="block px-2 pt-2 text-xs text-primary hover:underline">{allQuestionsText}</span>
                    </Link>
                  )}
                </div>
              )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">{activityHeading}</h3>
            {myActivity.length === 0
              ? <p className="text-sm text-muted-foreground">Нет видимой активности</p>
              : (
                <div className="space-y-3">
                  {myActivity.map(e => (
                    <div key={e.id} className="flex items-start gap-2.5 py-1.5 border-b border-border/50 last:border-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/80">
                          {e.action}{" "}
                          <Link href={e.targetType === "question" ? `/questions/${e.targetId}` : `/epics/${e.targetId}`}>
                            <span className="text-primary hover:underline cursor-pointer line-clamp-1">{e.targetTitle}</span>
                          </Link>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(e.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
