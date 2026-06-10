import { useRole } from "@/contexts/RoleContext";
import { useState } from "react";
import {
  DASHBOARD_PERSONAS,
  useAdminDashboardPersona,
} from "@/contexts/AdminDashboardPersonaContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { questions } from "@/data/questions";
import { epics } from "@/data/epics";
import { users, useDataBridgeVersion } from "@/data/users";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { hoursSinceUpdated } from "@/lib/questionStagnation";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { EnvironmentPill } from "@/components/shared/EnvironmentPill";
import { Link } from "@/lib/router";
import { getDashboardGreeting } from "@/lib/dashboardGreeting";
import { useDashboardAggregate } from "@/lib/queries";
import type { ApiDashboardAggregate } from "@/lib/types";
import type { RefRole } from "@/lib/mappers";
import { AlertTriangle, Clock, Layers, HelpCircle, Users, CheckCircle } from "lucide-react";

const STAGNANT_PAGE_SIZE = 6;
const EXPERT_QUEUE_PAGE_SIZE = 7;

function StatCard({ icon: Icon, label, value, sub, color }: { icon: typeof Clock; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color ?? "bg-muted"}`}>
          <Icon size={14} className="text-foreground/70" />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{children}</h2>;
}

function SectionPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        Назад
      </button>
      <span className="text-[11px] text-muted-foreground">
        {page}/{totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        Вперёд
      </button>
    </div>
  );
}

function BackendSummaryStrip({ summary }: { summary?: ApiDashboardAggregate }) {
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <StatCard icon={HelpCircle} label="Открытых вопросов" value={summary.totals.questions_open} sub={`из ${summary.totals.questions_total} всего`} color="bg-blue-500/15" />
      <StatCard icon={Layers} label="Активных эпиков" value={summary.totals.active_epics} color="bg-violet-500/15" />
      <StatCard icon={AlertTriangle} label="Эпиков с блокерами" value={summary.totals.blocked_epics} color="bg-red-500/15" />
      <StatCard icon={Clock} label="Без движения > 48 ч" value={summary.stale_questions.length} color="bg-amber-500/15" />
    </div>
  );
}

function QuestionRow({ q, compact = false }: { q: typeof questions[0]; compact?: boolean }) {
  return (
    <Link href={`/questions/${q.id}`}>
      <div className={`flex items-start gap-2 px-2 sm:px-3 py-2.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors group ${compact ? "flex-col" : ""}`}>
        <span className="text-[10px] text-muted-foreground font-mono w-12 flex-shrink-0 pt-0.5">{q.id}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground group-hover:text-primary line-clamp-2">{q.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
            <ProjectBadge projectId={q.projectId} />
            <UserAvatar userId={q.assigneeId} size="sm" />
          </div>
        </div>
        <div className={`flex flex-shrink-0 items-center gap-1 sm:gap-2 ${compact ? "w-full" : "ml-auto pt-0.5"}`}>
          <StatusBadge status={q.status} size="sm" />
          <QuestionStagnationBadge updatedAt={q.updatedAt} />
        </div>
      </div>
    </Link>
  );
}

function EpicRow({ e, compact = false }: { e: typeof epics[0]; compact?: boolean }) {
  return (
    <Link href={`/epics/${e.id}`}>
      <div className={`flex flex-wrap items-start gap-x-2 gap-y-1.5 px-2 sm:px-3 py-2.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors group ${compact ? "flex-col" : ""}`}>
        <span className="text-[10px] text-muted-foreground font-mono w-12 flex-shrink-0">{e.id}</span>
        <div className="flex-1 min-w-[min(100%,10rem)] basis-0 grow">
          <p className="text-sm text-foreground group-hover:text-primary line-clamp-2">{e.name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
            <ProjectBadge projectId={e.projectId} />
            {e.activeEnvironment && <EnvironmentPill env={e.activeEnvironment} active />}
          </div>
        </div>
        <div className={`flex flex-wrap items-center gap-1 ${compact ? "w-full" : "ml-auto"}`}>
          <StatusBadge status={e.qaStatus} size="sm" />
          {e.blockers.length > 0 && (
            <span className="text-[10px] bg-destructive/15 text-destructive border border-destructive/30 rounded px-1.5 py-0.5 font-medium">
              {e.blockers.length} блок.
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CoordinatorDashboard({ userId }: { userId: string }) {
  const [stagnantPage, setStagnantPage] = useState(1);
  const attention = questions.filter(q => ["На проверке", "На уточнении"].includes(q.status)).slice(0, 5);
  const blockedEpics = epics.filter(e => e.blockers.length > 0);
  const longStagnant = questions
    .filter((q) => !["Закрыт", "Отменён"].includes(q.status) && hoursSinceUpdated(q.updatedAt) > 48)
    .sort((a, b) => hoursSinceUpdated(b.updatedAt) - hoursSinceUpdated(a.updatedAt));
  const stagnantPages = Math.max(1, Math.ceil(longStagnant.length / STAGNANT_PAGE_SIZE));
  const currentStagnantPage = Math.min(stagnantPage, stagnantPages);
  const visibleStagnant = longStagnant.slice(
    (currentStagnantPage - 1) * STAGNANT_PAGE_SIZE,
    currentStagnantPage * STAGNANT_PAGE_SIZE,
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Требуют внимания</SectionTitle>
          {attention.map(q => <QuestionRow key={q.id} q={q} />)}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Эпики с блокерами</SectionTitle>
          {blockedEpics.map(e => <EpicRow key={e.id} e={e} />)}
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-card border border-red-500/20 rounded-lg p-4">
          <SectionTitle>Долго без движения</SectionTitle>
          {longStagnant.length === 0 ? (
            <p className="text-xs text-muted-foreground">Нет вопросов, простаивающих более 48 ч</p>
          ) : (
            <>
              {visibleStagnant.map(q => (
                <div key={q.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/questions/${q.id}`}>
                    <span className="text-xs text-foreground hover:text-primary cursor-pointer truncate max-w-[140px] block">{q.title}</span>
                  </Link>
                  <QuestionStagnationBadge updatedAt={q.updatedAt} />
                </div>
              ))}
              <SectionPagination
                page={currentStagnantPage}
                totalPages={stagnantPages}
                onPageChange={setStagnantPage}
              />
            </>
          )}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Обзор статусов</SectionTitle>
          {["На проверке", "У эксперта", "На уточнении"].map(s => {
            const count = questions.filter(q => q.status === s).length;
            return (
              <div key={s} className="flex items-center justify-between py-1.5">
                <StatusBadge status={s as any} size="sm" />
                <span className="text-sm font-semibold text-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LeadDashboard({ userId }: { userId: string }) {
  const myQ = questions.filter(q => q.assigneeId === userId).slice(0, 5);
  const activeEpics = epics.filter(e => e.epicStatus === "В работе").slice(0, 4);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>На проверке у меня</SectionTitle>
          {myQ.length === 0
            ? <p className="text-xs text-muted-foreground py-2">Нет вопросов</p>
            : myQ.map(q => <QuestionRow key={q.id} q={q} />)}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Активные эпики</SectionTitle>
          {activeEpics.map(e => <EpicRow key={e.id} e={e} />)}
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Блокеры эпиков</SectionTitle>
          {epics.filter(e => e.blockers.length > 0).flatMap(e => e.blockers.map(b => ({ ...b, epicId: e.id, epicName: e.name }))).slice(0, 5).map(b => (
            <div key={b.id} className="py-1.5 border-b border-border/50 last:border-0">
              <Link href={`/epics/${b.epicId}`}><p className="text-xs text-primary cursor-pointer hover:underline">{b.epicId}</p></Link>
              <p className="text-xs text-foreground/80 mt-0.5">{b.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpertDashboard({ userId }: { userId: string }) {
  const [queuePage, setQueuePage] = useState(1);
  const expertQ = questions.filter(q => q.status === "У эксперта" && q.assigneeId === userId);
  const queuePages = Math.max(1, Math.ceil(expertQ.length / EXPERT_QUEUE_PAGE_SIZE));
  const currentQueuePage = Math.min(queuePage, queuePages);
  const visibleExpertQ = expertQ.slice(
    (currentQueuePage - 1) * EXPERT_QUEUE_PAGE_SIZE,
    currentQueuePage * EXPERT_QUEUE_PAGE_SIZE,
  );
  const myAnswered = questions.filter(q => q.assigneeId === userId && ["Ожидает автора", "Закрыт"].includes(q.status));
  const myAuthored = questions
    .filter(q => q.authorId === userId && !["Закрыт", "Отменён"].includes(q.status))
    .slice(0, 5);
  const allExpertQ = questions
    .filter(q => q.status === "У эксперта")
    .sort((a, b) => hoursSinceUpdated(b.updatedAt) - hoursSinceUpdated(a.updatedAt))
    .slice(0, 6);
  const staleMine = expertQ.filter(q => hoursSinceUpdated(q.updatedAt) > 24).length;
  const relatedEpicIds = new Set(expertQ.map(q => q.epicId).filter(Boolean));
  const relatedEpics = epics.filter(e => relatedEpicIds.has(e.id)).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={HelpCircle} label="Назначено мне" value={expertQ.length} color="bg-violet-500/15" />
        <StatCard icon={CheckCircle} label="Отвечено мной" value={myAnswered.length} color="bg-emerald-500/15" />
        <StatCard icon={Clock} label="Без движения > 24 ч" value={staleMine} color="bg-amber-500/15" />
        <StatCard icon={Layers} label="Связанных эпиков" value={relatedEpics.length} color="bg-blue-500/15" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Моя очередь на ответ</SectionTitle>
            {expertQ.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Нет вопросов, назначенных вам</p>
            ) : (
              <>
                {visibleExpertQ.map(q => <QuestionRow key={q.id} q={q} />)}
                <SectionPagination
                  page={currentQueuePage}
                  totalPages={queuePages}
                  onPageChange={setQueuePage}
                />
              </>
            )}
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Мои вопросы</SectionTitle>
            {myAuthored.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет открытых вопросов от вас</p>
              : myAuthored.map(q => <QuestionRow key={q.id} q={q} />)}
          </div>
        </div>
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Очередь экспертов</SectionTitle>
            {allExpertQ.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет вопросов у экспертов</p>
              : allExpertQ.map(q => <QuestionRow key={q.id} q={q} compact />)}
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Связанные эпики</SectionTitle>
            {relatedEpics.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет эпиков с назначенными вам вопросами</p>
              : relatedEpics.map(e => <EpicRow key={e.id} e={e} compact />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DevDashboard({ userId }: { userId: string }) {
  const assignedQuestions = questions.filter(q => q.assigneeId === userId && !["Закрыт", "Отменён"].includes(q.status));
  const myQ = assignedQuestions.slice(0, 6);
  const authoredQuestions = questions
    .filter(q => q.authorId === userId && !["Закрыт", "Отменён"].includes(q.status))
    .slice(0, 5);
  const myEpicIds = new Set(assignedQuestions.map((q) => q.epicId).filter(Boolean));
  const myEpics = epics
    .filter(e => e.leadDesignerId === userId || e.leadAnalystId === userId || myEpicIds.has(e.id))
    .slice(0, 6);
  const blockedMyEpics = myEpics.filter(e => e.blockers.length > 0);
  const qaActiveEpics = myEpics.filter(e => ["В тестировании", "Блокер"].includes(e.qaStatus));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={HelpCircle} label="Моих вопросов" value={assignedQuestions.length} color="bg-violet-500/15" />
        <StatCard icon={Layers} label="Моих эпиков" value={myEpics.length} color="bg-blue-500/15" />
        <StatCard icon={CheckCircle} label="В тестировании" value={qaActiveEpics.length} color="bg-emerald-500/15" />
        <StatCard icon={AlertTriangle} label="Блокеров" value={blockedMyEpics.reduce((s, e) => s + e.blockers.length, 0)} color="bg-red-500/15" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Вопросы, где я ответственный</SectionTitle>
            {myQ.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет активных вопросов</p>
              : myQ.map(q => <QuestionRow key={q.id} q={q} />)}
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Мои эпики</SectionTitle>
            {myEpics.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет эпиков с назначенными вам вопросами</p>
              : myEpics.map(e => <EpicRow key={e.id} e={e} />)}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <SectionTitle>Мои вопросы как автора</SectionTitle>
            {authoredQuestions.length === 0
              ? <p className="text-xs text-muted-foreground py-2">Нет открытых вопросов от вас</p>
              : authoredQuestions.map(q => <QuestionRow key={q.id} q={q} compact />)}
          </div>
          <div className="bg-card border border-red-500/20 rounded-lg p-4">
            <SectionTitle>Блокеры моих эпиков</SectionTitle>
            {blockedMyEpics.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Блокеров нет</p>
            ) : (
              blockedMyEpics.flatMap(e => e.blockers.map(b => ({ ...b, epicId: e.id, epicName: e.name }))).slice(0, 6).map(b => (
                <div key={b.id} className="py-1.5 border-b border-border/50 last:border-0">
                  <Link href={`/epics/${b.epicId}`}><p className="text-xs text-primary cursor-pointer hover:underline">{b.epicName}</p></Link>
                  <p className="text-xs text-foreground/80 mt-0.5">{b.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const roleCount = users.reduce((acc, u) => { acc[u.role] = (acc[u.role] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Распределение по ролям</SectionTitle>
          {Object.entries(roleCount).map(([role, count]) => (
            <div key={role} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground">{role}</span>
              <div className="flex items-center gap-2">
                <div className="w-16 bg-muted rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full" style={{ width: `${(count / users.length) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold text-foreground w-4">{count}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <SectionTitle>Последние вопросы</SectionTitle>
          {questions.slice(0, 5).map(q => <QuestionRow key={q.id} q={q} />)}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const dataVersion = useDataBridgeVersion();
  void dataVersion;
  const { currentUser } = useRole();
  const personaCtx = useAdminDashboardPersona();
  const effectiveRole: RefRole = personaCtx?.persona ?? currentUser.role;
  const showDashboardViewSelect = Boolean(personaCtx);
  const dashboardSummary = useDashboardAggregate(effectiveRole);

  const roleLabel: Record<string, string> = {
    Координатор: "Привет, координатор",
    "Эксперт": "Рабочий стол эксперта",
    "Разработчик": "Рабочий стол разработчика",
    "Админ": "Системная статистика",
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4 min-h-[50px]">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">
              {roleLabel[effectiveRole] ?? "Рабочий стол"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{getDashboardGreeting(currentUser.name)}</p>
          </div>
          {showDashboardViewSelect && personaCtx && (
            <div
              className="flex items-center gap-1.5 shrink-0 self-center"
              data-testid="dashboard-admin-persona-tools"
            >
              <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">Вид</span>
              <Select
                value={effectiveRole}
                onValueChange={(v) => personaCtx.setPersona(v as RefRole)}
              >
                <SelectTrigger
                  className="h-8 w-[min(140px,42vw)] sm:w-[160px] text-xs border-border bg-card"
                  data-testid="select-dashboard-persona"
                >
                  <SelectValue placeholder="Вид дашборда" />
                </SelectTrigger>
                <SelectContent align="end">
                  {DASHBOARD_PERSONAS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
      {effectiveRole === "Админ" && <BackendSummaryStrip summary={dashboardSummary.data} />}
      {effectiveRole === "Координатор" && <CoordinatorDashboard userId={currentUser.id} />}
      {effectiveRole === "Эксперт" && <ExpertDashboard userId={currentUser.id} />}
      {effectiveRole === "Разработчик" && <DevDashboard userId={currentUser.id} />}
      {effectiveRole === "Админ" && <AdminDashboard />}
    </div>
  );
}
