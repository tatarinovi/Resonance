import { useState } from "react";
import { toast } from "sonner";

import { projects } from "@/data/projects";
import { users } from "@/data/users";
import { questions } from "@/data/questions";
import { epics } from "@/data/epics";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { Link } from "@/lib/router";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateProject } from "@/lib/queries";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { FolderKanban, FolderOpen, HelpCircle, Layers, ArrowRight, Plus } from "lucide-react";

export default function ProjectsPage() {
  const { me } = useAuth();
  const isNota = useIsNotaWorkspace();
  const ProjectIcon = isNota ? FolderOpen : FolderKanban;
  const [createOpen, setCreateOpen] = useState(false);
  const createProject = useCreateProject();

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold">Проекты</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Откройте карточку, чтобы посмотреть детали проекта</p>
        </div>
        {me?.role === "admin" && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            data-testid="button-create-project"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Создать проект</span>
            <span className="sm:hidden">Создать</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((p) => {
          const team = p.teamMemberIds.map((id) => users.find((u) => u.id === id)).filter(Boolean);
          const epicsCount = epics.filter((e) => e.projectId === p.id).length;
          const questionsCount = questions.filter((q) => q.projectId === p.id).length;
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="bg-card border border-border rounded-xl p-4 md:p-5 cursor-pointer transition-all hover:shadow-md hover:border-primary/40"
              data-testid={`project-card-${p.id}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 mb-1">
                    <ProjectIcon size={14} className="text-primary flex-shrink-0" />
                    <span className="text-[10px] text-muted-foreground font-mono">{p.id}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${p.status === "Активен" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-slate-500/15 text-slate-600 dark:text-slate-400"}`}
                >
                  {p.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{p.description}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <Layers size={11} /> {epicsCount} эпиков
                </span>
                <span className="flex items-center gap-1">
                  <HelpCircle size={11} /> {questionsCount} вопросов
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center -space-x-1.5">
                  {team.slice(0, 5).map((u) => u && <UserAvatar key={u.id} userId={u.id} size="sm" />)}
                  {team.length > 5 && <span className="text-[10px] text-muted-foreground ml-1.5">+{team.length - 5}</span>}
                </div>
                <span className="text-xs text-primary flex items-center gap-0.5">
                  Открыть <ArrowRight size={11} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <ProjectFormDialog
        title="Новый проект"
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialProject={null}
        onSubmit={async (values) => {
          await createProject.mutateAsync(values);
          toast.success("Проект создан");
          setCreateOpen(false);
        }}
        busy={createProject.isPending}
      />
    </div>
  );
}
