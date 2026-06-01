import { Environment } from "@/data/epics";

interface EnvironmentPillProps {
  env: Environment;
  active?: boolean;
  done?: boolean;
}

const baseColors: Record<Environment, string> = {
  "TEST": "border-sky-500/40 text-sky-400",
  "STAGE": "border-amber-500/40 text-amber-400",
  "PROD": "border-emerald-500/40 text-emerald-400",
};

const activeColors: Record<Environment, string> = {
  "TEST": "bg-sky-500/15 border-sky-500/60 text-sky-300",
  "STAGE": "bg-amber-500/15 border-amber-500/60 text-amber-300",
  "PROD": "bg-emerald-500/15 border-emerald-500/60 text-emerald-300",
};

export function EnvironmentPill({ env, active = false, done = false }: EnvironmentPillProps) {
  const colorClass = active ? activeColors[env] : done ? "border-slate-600 text-slate-500 line-through" : `border-slate-700 ${baseColors[env]}`;
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${colorClass}`}>
      {env}
      {active && <span className="ml-1 w-1 h-1 rounded-full bg-current animate-pulse" />}
    </span>
  );
}
