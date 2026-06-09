import { useRole } from "@/contexts/RoleContext";
import { activityEvents } from "@/data/activity";
import { useDataBridgeVersion } from "@/data/users";
import { questions } from "@/data/questions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Link } from "@/lib/router";
import { useProfileStats } from "@/lib/queries";
import { Mail, HelpCircle, Activity, CheckCircle, Settings } from "lucide-react";

type HeatmapDay = { date: string; count: number };

const HEATMAP_DAYS = 91;

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
      <div className="mt-4 overflow-hidden">
        <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
          {days.map((day) => (
            <div
              key={day.date}
              className={`h-2 w-2 rounded-[2px] ${heatmapCellClass(day.count)}`}
              title={`${formatHeatmapDate(day.date)}: ${day.count} действ.`}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>13 недель</span>
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

export default function ProfilePage() {
  useDataBridgeVersion();
  const { currentUser } = useRole();
  const profileStats = useProfileStats();

  const myActivity = activityEvents.filter(e => e.userId === currentUser.id).slice(0, 8);
  const myQ = questions.filter(q => q.authorId === currentUser.id);
  const closedQ = profileStats.data?.authored_closed ?? myQ.filter(q => q.status === "Закрыт").length;
  const assignedQ = profileStats.data?.assigned_open ?? questions.filter(q => q.assigneeId === currentUser.id && !["Закрыт", "Отменён"].includes(q.status)).length;
  const authoredTotal = profileStats.data?.authored_total ?? myQ.length;
  const questionHeatmap = profileStats.data?.question_heatmap ?? buildQuestionHeatmapFallback(myQ, currentUser.id);

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
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Профиль</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Profile card */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">
              {currentUser.avatarInitials}
            </div>
            <h2 className="text-base font-semibold text-foreground">{currentUser.name}</h2>
            <span className={`inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${roleColors[currentUser.role] ?? "bg-muted text-muted-foreground"}`}>
              {currentUser.role}
            </span>
            <div className="flex items-center gap-1.5 justify-center mt-3 text-xs text-muted-foreground">
              <Mail size={12} />
              <span className="truncate">{currentUser.email}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-border">
              {[
                { label: "Задано", value: authoredTotal, icon: HelpCircle },
                { label: "Закрыто", value: closedQ, icon: CheckCircle },
                { label: "Назначено", value: assignedQ, icon: Activity },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <s.icon size={14} className="text-muted-foreground mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
            <Link href="/settings">
              <span className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                <Settings size={14} />
                Настройки профиля
              </span>
            </Link>
          </div>

          <QuestionHeatmap days={questionHeatmap} />
        </div>

        {/* Activity + questions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Мои вопросы</h3>
            {myQ.length === 0
              ? <p className="text-sm text-muted-foreground">Вы ещё не задавали вопросов</p>
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
                  <Link href="/questions?author=me">
                    <span className="block px-2 pt-2 text-xs text-primary hover:underline">Все мои вопросы</span>
                  </Link>
                </div>
              )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Последняя активность</h3>
            {myActivity.length === 0
              ? <p className="text-sm text-muted-foreground">Нет активности</p>
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
