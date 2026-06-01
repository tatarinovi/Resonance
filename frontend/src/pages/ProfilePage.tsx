import { useRole } from "@/contexts/RoleContext";
import { activityEvents } from "@/data/activity";
import { useDataBridgeVersion } from "@/data/users";
import { questions } from "@/data/questions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Link } from "@/lib/router";
import { useProfileStats } from "@/lib/queries";
import { Mail, HelpCircle, Activity, CheckCircle } from "lucide-react";

export default function ProfilePage() {
  useDataBridgeVersion();
  const { currentUser } = useRole();
  const profileStats = useProfileStats();

  const myActivity = activityEvents.filter(e => e.userId === currentUser.id).slice(0, 8);
  const myQ = questions.filter(q => q.authorId === currentUser.id);
  const closedQ = profileStats.data?.authored_closed ?? myQ.filter(q => q.status === "Закрыт").length;
  const assignedQ = profileStats.data?.assigned_open ?? questions.filter(q => q.assigneeId === currentUser.id && !["Закрыт", "Отменён"].includes(q.status)).length;
  const authoredTotal = profileStats.data?.authored_total ?? myQ.length;

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
        <div className="lg:col-span-1">
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
          </div>
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
