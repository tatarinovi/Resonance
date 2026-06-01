import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { KanbanBoardView } from "@/components/kanban-board/KanbanBoardView";
import { useKanbanBoardBundle } from "@/lib/kanban-ds/queries";

function projectName(project: unknown): string | undefined {
  if (!project || typeof project !== "object") return undefined;
  const n = (project as Record<string, unknown>).name;
  return typeof n === "string" ? n : undefined;
}

export default function KanbanProjectBoardPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const decoded = slug ? decodeURIComponent(slug) : "";

  const bundle = useKanbanBoardBundle(decoded || undefined, Boolean(decoded));

  const titleFromState = (location.state as { name?: string } | null)?.name;

  const projectTitle = useMemo(() => {
    if (titleFromState) return titleFromState;
    const n = projectName(bundle.data?.project);
    return n || decoded || "Проект";
  }, [titleFromState, bundle.data?.project, decoded]);

  if (!decoded) {
    return <div className="p-6 text-sm text-muted-foreground">Не указан проект</div>;
  }

  if (bundle.isLoading && !titleFromState) {
    return (
      <div className="flex h-full min-h-[50vh] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка доски…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <KanbanBoardView key={decoded} projectSlug={decoded} projectTitle={projectTitle} />
    </div>
  );
}
