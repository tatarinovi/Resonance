import { useEffect, useState } from "react";
import { AlertTriangle, Clock, HelpCircle, Layers } from "lucide-react";

import {
  DASHBOARD_PERSONAS,
  useAdminDashboardPersona,
} from "@/contexts/AdminDashboardPersonaContext";
import { useRole } from "@/contexts/RoleContext";
import { epics } from "@/data/epics";
import { questions } from "@/data/questions";
import { useDataBridgeVersion } from "@/data/users";
import { getDashboardGreeting } from "@/lib/dashboardGreeting";
import { hoursSinceUpdated } from "@/lib/questionStagnation";
import type { RefRole } from "@/lib/mappers";
import { Link } from "@/lib/router";
import { EnvironmentPill } from "@/components/shared/EnvironmentPill";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { CreateQuestionDialog } from "@/components/questions/CreateQuestionDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CLOSED_STATUSES = new Set(["Закрыт", "Отменён"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable || Boolean(target.closest("[cmdk-root]"));
}

function isCreateQuestionHotkey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return event.code === "KeyC" || key === "c" || key === "с";
}

function Section({
  title,
  icon: Icon,
  children,
  href,
}: {
  title: string;
  icon: typeof HelpCircle;
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {href ? (
          <Link href={href}>
            <span className="text-xs font-medium text-muted-foreground hover:text-foreground">Открыть</span>
          </Link>
        ) : null}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-sm text-muted-foreground">{children}</p>;
}

function QuestionLine({ q }: { q: typeof questions[0] }) {
  return (
    <Link href={`/questions/${q.id}`}>
      <div className="flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/45">
        <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{q.id}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{q.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={q.status} size="sm" />
            <ProjectBadge projectId={q.projectId} />
          </div>
        </div>
        <UserAvatar userId={q.assigneeId} size="sm" />
        <QuestionStagnationBadge updatedAt={q.updatedAt} />
      </div>
    </Link>
  );
}

function EpicBlockerLine({ epic }: { epic: typeof epics[0] }) {
  const firstBlocker = epic.blockers[0];
  return (
    <Link href={`/epics/${epic.id}`}>
      <div className="rounded-md px-2 py-2 transition-colors hover:bg-accent/45">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{epic.id}</span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{epic.name}</p>
          <span className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            {epic.blockers.length} блок.
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ProjectBadge projectId={epic.projectId} />
          {epic.activeEnvironment ? <EnvironmentPill env={epic.activeEnvironment} active /> : null}
          {firstBlocker ? <span className="truncate">{firstBlocker.text}</span> : null}
        </div>
      </div>
    </Link>
  );
}

function buildRoleQueues(role: RefRole, userId: string) {
  const openQuestions = questions.filter((q) => !CLOSED_STATUSES.has(q.status));
  const staleQuestions = openQuestions
    .filter((q) => hoursSinceUpdated(q.updatedAt) > 24)
    .sort((a, b) => hoursSinceUpdated(b.updatedAt) - hoursSinceUpdated(a.updatedAt));
  const assignedQuestions = openQuestions.filter((q) => q.assigneeId === userId);
  const authoredQuestions = openQuestions.filter((q) => q.authorId === userId && q.assigneeId !== userId);
  const expertQueue = openQuestions.filter((q) => q.status === "У эксперта");
  const waitingQueue = openQuestions.filter((q) => q.status === "Ожидает автора" || q.status === "На уточнении");

  if (role === "Эксперт") {
    return {
      attention: expertQueue.length ? expertQueue : staleQuestions,
      action: assignedQuestions,
      watch: authoredQuestions,
    };
  }

  if (role === "Админ" || role === "Координатор") {
    return {
      attention: [...waitingQueue, ...staleQuestions].slice(0, 12),
      action: assignedQuestions,
      watch: authoredQuestions,
    };
  }

  return {
    attention: assignedQuestions.length ? assignedQuestions : staleQuestions,
    action: assignedQuestions,
    watch: authoredQuestions,
  };
}

export default function DashboardPage() {
  useDataBridgeVersion();
  const { currentUser } = useRole();
  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const personaCtx = useAdminDashboardPersona();
  const canSwitchPersona = currentUser.role === "Админ" && personaCtx != null;
  const effectiveRole: RefRole = canSwitchPersona ? (personaCtx.persona ?? currentUser.role) : currentUser.role;
  const queues = buildRoleQueues(effectiveRole, currentUser.id);
  const blockers = epics.filter((epic) => epic.blockers.length > 0).slice(0, 6);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (isCreateQuestionHotkey(event)) {
        event.preventDefault();
        setCreateQuestionOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl p-3 md:p-4">
      <div className="mb-4 flex min-h-[44px] items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Рабочий стол</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{getDashboardGreeting(currentUser.name)}</p>
        </div>
        {canSwitchPersona ? (
          <div className="flex shrink-0 items-center gap-1.5" data-testid="dashboard-admin-persona-tools">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">Вид</span>
            <Select value={effectiveRole} onValueChange={(value) => personaCtx.setPersona(value as RefRole)}>
              <SelectTrigger
                className="h-8 w-[min(150px,42vw)] border-border bg-card text-xs sm:w-[170px]"
                data-testid="select-dashboard-persona"
              >
                <SelectValue placeholder="Вид дашборда" />
              </SelectTrigger>
              <SelectContent align="end">
                {DASHBOARD_PERSONAS.map((persona) => (
                  <SelectItem key={persona} value={persona}>
                    {persona}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="Требует внимания" icon={AlertTriangle} href="/questions?view=stale">
          {queues.attention.slice(0, 6).length ? (
            queues.attention.slice(0, 6).map((q) => <QuestionLine key={q.id} q={q} />)
          ) : (
            <EmptyLine>Нет срочных вопросов.</EmptyLine>
          )}
        </Section>

        <Section title="Моя очередь" icon={HelpCircle} href="/questions?view=mine">
          {queues.action.slice(0, 6).length ? (
            queues.action.slice(0, 6).map((q) => <QuestionLine key={q.id} q={q} />)
          ) : (
            <EmptyLine>В вашей очереди сейчас пусто.</EmptyLine>
          )}
        </Section>

        <Section title="На контроле" icon={Clock} href="/questions">
          {queues.watch.slice(0, 6).length ? (
            queues.watch.slice(0, 6).map((q) => <QuestionLine key={q.id} q={q} />)
          ) : (
            <EmptyLine>Нет открытых вопросов, где вы автор.</EmptyLine>
          )}
        </Section>

        <Section title="Блокеры эпиков" icon={Layers} href="/epics">
          {blockers.length ? (
            blockers.map((epic) => <EpicBlockerLine key={epic.id} epic={epic} />)
          ) : (
            <EmptyLine>Активных блокеров нет.</EmptyLine>
          )}
        </Section>
      </div>
      <CreateQuestionDialog open={createQuestionOpen} onOpenChange={setCreateQuestionOpen} />
    </div>
  );
}
