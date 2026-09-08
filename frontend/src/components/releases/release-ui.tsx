import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { label, date, panel } from "./release-display";
import type { ApiEpicTestOpsSnapshot, ReleaseSource } from "@/lib/types";

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={panel}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function QueryState({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    isFetching?: boolean;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  if (query.isError)
    return (
      <div role="alert" className={panel}>
        <p>Не удалось загрузить данные.</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => query.refetch()}
        >
          Повторить
        </Button>
      </div>
    );
  if (query.isPending)
    return (
      <div role="status" aria-label="Загрузка" className={`${panel} space-y-4`}>
        <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    );
  return (
    <div aria-busy={query.isFetching}>
      {query.isFetching && (
        <p className="mb-2 text-xs text-muted-foreground">Обновление…</p>
      )}
      {children}
    </div>
  );
}
export function Pagination({
  total,
  page,
  size,
  onChange,
}: {
  total: number;
  page: number;
  size: number;
  onChange: (p: number, s: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 text-sm">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} из ${total}`
          : "0 записей"}
      </span>
      <div className="flex items-center gap-2">
        <select
          aria-label="Записей на странице"
          className="rounded border border-border bg-background p-2"
          value={size}
          onChange={(e) => onChange(1, Number(e.target.value))}
        >
          {[25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => onChange(page - 1, size)}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          disabled={page * size >= total}
          onClick={() => onChange(page + 1, size)}
        >
          Далее
        </Button>
      </div>
    </div>
  );
}
export function SelectFilter({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (s: string) => void;
}) {
  return (
    <select
      aria-label={name}
      className="max-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{name}: все</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
export function Metrics({
  snapshot,
  onStatus,
}: {
  snapshot: Pick<
    ApiEpicTestOpsSnapshot,
    "total" | "passed" | "failed" | "broken" | "blocked"
  >;
  onStatus?: (status: string) => void;
}) {
  const completed =
    snapshot.passed + snapshot.failed + snapshot.broken + snapshot.blocked;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Выполнено{" "}
        <b>
          {completed} из {snapshot.total}
        </b>
        {snapshot.total > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {Math.round((completed / snapshot.total) * 100)}%
          </span>
        )}
      </p>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary"
          style={{
            width: `${snapshot.total ? Math.min(100, (completed / snapshot.total) * 100) : 0}%`,
          }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {(["passed", "failed", "broken", "blocked"] as const).map((key) => (
          <button
            key={key}
            disabled={!onStatus || key === "passed"}
            onClick={() => onStatus?.(key)}
            className={`${key === "failed" && snapshot[key] ? "text-destructive" : "text-muted-foreground"} enabled:underline enabled:underline-offset-4`}
          >
            {snapshot[key]}{" "}
            {key === "failed" ? "с ошибками" : label(key).toLowerCase()}
          </button>
        ))}
        <span className="text-muted-foreground">
          {Math.max(0, snapshot.total - completed)} осталось
        </span>
      </div>
    </div>
  );
}
export function Sources({
  sources,
}: {
  sources: Record<string, ReleaseSource>;
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Источники ·{" "}
        {Object.entries(sources)
          .map(
            ([s, v]) =>
              `${s === "testops" ? "TestOps" : s === "jira" ? "Jira" : "Kanban"}: ${label(v.status)}`,
          )
          .join(" · ")}
      </summary>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {Object.entries(sources).map(([s, v]) => (
          <section
            key={s}
            className="rounded-lg border border-border bg-card p-3"
          >
            <h3 className="font-medium">
              {s === "testops" ? "TestOps" : s === "jira" ? "Jira" : "Kanban"} ·{" "}
              {label(v.status)}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Данные: {v.covered}/{v.total} · {date(v.last_success_at)}
            </p>
            {v.details.map((d, i) => (
              <div key={i} className="mt-3 border-t border-border pt-2 text-xs">
                <p>
                  {d.label} · {label(d.status)}
                </p>
                <p className="text-muted-foreground">
                  Успех: {date(d.last_success_at)} · Попытка:{" "}
                  {date(d.last_attempt_at)}
                </p>
                {d.message && (
                  <p>
                    Не удалось обновить источник. Предыдущие данные сохранены,
                    если были загружены.
                  </p>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </details>
  );
}
