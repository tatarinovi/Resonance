import { projects } from "@/data/projects";

const projectColors: Record<string, string> = {
  "PRJ-1": "bg-blue-500/10 text-blue-400",
  "PRJ-2": "bg-orange-500/10 text-orange-400",
  "PRJ-3": "bg-violet-500/10 text-violet-400",
  "PRJ-4": "bg-teal-500/10 text-teal-400",
};

interface ProjectBadgeProps {
  projectId: string;
}

export function ProjectBadge({ projectId }: ProjectBadgeProps) {
  const project = projects.find(p => p.id === projectId);
  const color = projectColors[projectId] ?? "bg-slate-500/10 text-slate-400";
  return (
    <span className={`inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[10px] font-medium truncate ${color}`}>
      {project?.name ?? projectId}
    </span>
  );
}
