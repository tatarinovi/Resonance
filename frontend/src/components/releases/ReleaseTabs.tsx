import { label, date } from "@/components/releases/release-display";
import { useReleaseFilters } from "./useReleaseFilters";
import { Link } from "@/lib/router";
import { useReleaseTab } from "@/lib/queries";
import type {
  ApiRelease,
  ApiEpicTestOpsSnapshot,
  ApiEpicTestOpsProblemCase,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Metrics,
  Pagination,
  Panel,
  QueryState,
  SelectFilter,
} from "./release-ui";

type Row = {
  key?: string;
  id?: number;
  title?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  issue_type?: string;
  url?: string;
  source_epics?: Array<{ key: string }>;
  source_epic?: { key: string };
  expert?: { username: string };
  due_at?: string;
  overdue?: boolean;
  action?: string;
  actor_username?: string;
  created_at?: string;
  details_json?: Record<string, unknown>;
  name?: string;
  task_name?: string;
  task_url?: string;
  user_name?: string;
  hours?: number;
  begin?: string;
  comment?: string;
};
type Page = {
  items: Row[];
  total: number;
  page: number;
  page_size: number;
  facets?: Record<string, string[]>;
  experts?: Array<{id:number;username:string}>;
};
const actionLabels: Record<string, string> = {
  created: "Релиз создан",
  updated: "Релиз изменён",
  epics_added: "Эпики добавлены",
  epic_removed: "Эпик исключён",
  status_changed: "Статус изменён",
  data_refreshed: "Источники обновлены",
  archived: "Релиз архивирован",
  unarchived: "Релиз восстановлен",
};
const fieldLabels: Record<string, string> = {
  title: "название",
  description: "описание",
  planned_release_at: "плановая дата",
  owner_user_id: "владелец",
  release_note: "примечание к выпуску",
};
function HistoryDetails({ data: d }: { data: Record<string, unknown> }) {
  return (
    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
      {d.old_status != null && (
        <p>
          {label(String(d.old_status))} → {label(String(d.new_status))}
        </p>
      )}
      {Array.isArray(d.fields) && (
        <p>
          Изменено:{" "}
          {d.fields.map((f) => fieldLabels[String(f)] ?? String(f)).join(", ")}
        </p>
      )}
      {Array.isArray(d.epic_ids) && (
        <p>
          Эпики:{" "}
          {d.epic_ids
            .map((id) => `EP-${String(id).padStart(3, "0")}`)
            .join(", ")}
        </p>
      )}
      {d.epic_id != null && (
        <p>Эпик: EP-{String(d.epic_id).padStart(3, "0")}</p>
      )}
      {d.reason != null && <p>Причина: {String(d.reason)}</p>}
      {d.outcome != null && <p>Результат: {label(String(d.outcome))}</p>}
      {d.counts != null && typeof d.counts === "object" && (
        <p>
          {Object.entries(d.counts)
            .map(([k, v]) => `${label(k)}: ${v}`)
            .join(" · ")}
        </p>
      )}
      {Array.isArray(d.accepted_risks) && d.accepted_risks.length > 0 && (
        <details>
          <summary>Приняты риски · {d.accepted_risks.length}</summary>
          {d.accepted_risks.map((r, i) => (
            <p key={i}>{String(r).replace(/^[a-f0-9]+: /, "")}</p>
          ))}
        </details>
      )}
    </div>
  );
}
export function ReleaseListTab({
  release: r,
  kind,
}: {
  release: ApiRelease;
  kind:
    | "tasks"
    | "questions"
    | "history"
    | "time-management/tasks"
    | "time-management/worklogs";
}) {
  const { params, update, page, size } = useReleaseFilters();
  const queryParams = Object.fromEntries(
    [...params].filter(([k]) => k !== "tab"),
  );
  queryParams.page = String(page);
  queryParams.page_size = String(size);
  const query = useReleaseTab<Page>(r.id, kind, queryParams);
  const data = query.data;
  const tasks = kind === "tasks",
    questions = kind === "questions",
    history = kind === "history";
  const filter = (
    name: string,
    key: string,
    opts: Array<{ value: string; label: string }>,
  ) => (
    <SelectFilter
      name={name}
      value={params.get(key) ?? ""}
      options={opts}
      onChange={(v) => update({ [key]: v })}
    />
  );
  return (
    <div className="space-y-4">
      {(tasks || questions) && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Поиск"
            className="w-72"
            placeholder="Поиск по ключу или названию"
            value={params.get("q") ?? ""}
            onChange={(e) => update({ q: e.target.value })}
          />
          {filter(
            "Эпик",
            "epic_id",
            r.epics.map((e) => ({ value: String(e.id), label: e.key })),
          )}
          {tasks && (
            <>
              {filter(
                "Группа",
                "status_group",
                [
                  ["todo", "К работе"],
                  ["development", "В разработке"],
                  ["review", "Проверка"],
                  ["blocked", "Заблокировано"],
                  ["done", "Завершено"],
                  ["unknown", "Не распределено"],
                ].map(([value, label]) => ({ value, label })),
              )}
              {Object.entries({
                status: "Статус",
                priority: "Приоритет",
                assignee: "Исполнитель",
                issue_type: "Тип",
              }).map(([key, name]) => (
                <span key={key}>
                  {filter(
                    name,
                    key,
                    (data?.facets?.[key] ?? []).map((v) => ({
                      value: v,
                      label: v,
                    })),
                  )}
                </span>
              ))}
              {filter(
                "Сортировка",
                "sort",
                [
                  ["priority", "По приоритету"],
                  ["key", "По ключу"],
                  ["status", "По статусу"],
                ].map(([value, label]) => ({ value, label })),
              )}
            </>
          )}
          {questions &&
            filter(
              "Показать",
              "view",
              [
                ["open", "Открытые"],
                ["overdue", "Просроченные"],
                ["waiting", "Ожидают эксперта"],
              ].map(([value, label]) => ({ value, label })),
            )}
          {questions && <>
            {filter("Статус", "status", ["pending_approval", "forwarded", "returned", "answered", "closed", "cancelled"].map(value => ({value, label: label(value)})))}
            {filter("Эксперт", "expert_id", (data?.experts ?? []).map(e => ({value: String(e.id), label:e.username})))}
          </>}
          <Button
            variant="ghost"
            onClick={() =>
              update(
                Object.fromEntries(
                  [...params.keys()]
                    .filter((k) => k !== "tab")
                    .map((k) => [k, ""]),
                ),
              )
            }
          >
            Сбросить фильтры
          </Button>
        </div>
      )}
      <QueryState query={query}>
        {data?.items.length ? (
          <div className="overflow-auto rounded-xl border border-border bg-card">
            {history ? (
              <div className="divide-y divide-border">
                {data.items.map((row, i) => (
                  <article key={row.id ?? i} className="p-4">
                    <h3 className="font-medium">
                      {actionLabels[row.action ?? ""] ?? "Событие релиза"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {row.actor_username ?? "Система"} · {date(row.created_at)}
                    </p>
                    <HistoryDetails data={row.details_json ?? {}} />
                  </article>
                ))}
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    {(tasks
                      ? [
                          "Ключ",
                          "Название",
                          "Статус",
                          "Приоритет",
                          "Исполнитель",
                          "Эпики",
                        ]
                      : questions
                        ? ["Вопрос", "Статус", "Эксперт", "Срок", "Эпик"]
                        : ["Задача", "Сотрудник", "Часы", "Дата", "Эпик"]
                    ).map((h) => (
                      <th className="px-4 py-3 font-medium" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row, i) => (
                    <tr
                      key={row.key ?? row.id ?? i}
                      className="border-b border-border align-top last:border-0 hover:bg-muted/20"
                    >
                      {tasks ? (
                        <>
                          <td className="whitespace-nowrap px-4 py-3">
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary"
                            >
                              {row.key}
                            </a>
                          </td>
                          <td className="px-4 py-3">{row.title}</td>
                          <td className="px-4 py-3">{label(row.status)}</td>
                          <td className="px-4 py-3">{row.priority ?? "—"}</td>
                          <td className="px-4 py-3">
                            {row.assignee ?? "Не назначен"}
                          </td>
                          <td className="px-4 py-3">
                            {row.source_epics?.map((e) => (
                              <Link
                                className="block text-primary"
                                href={`/epics/${e.key}`}
                                key={e.key}
                              >
                                {e.key}
                              </Link>
                            ))}
                          </td>
                        </>
                      ) : questions ? (
                        <>
                          <td className="px-4 py-3">
                            <Link
                              href={row.url ?? "/questions"}
                              className="text-primary"
                            >
                              {row.key} · {row.title}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{label(row.status)}</td>
                          <td className="px-4 py-3">
                            {row.expert?.username ?? "Не назначен"}
                          </td>
                          <td
                            className={`px-4 py-3 ${row.overdue ? "text-destructive" : ""}`}
                          >
                            {date(row.due_at)}
                          </td>
                          <td className="px-4 py-3">{row.source_epic?.key}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            {row.task_url || row.url ? (
                              <a
                                href={row.task_url ?? row.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary"
                              >
                                {row.task_name ??
                                  row.name ??
                                  row.title ??
                                  row.id}
                              </a>
                            ) : (
                              (row.task_name ?? row.name ?? row.title ?? row.id)
                            )}
                            {row.comment && (
                              <p className="text-muted-foreground">
                                {row.comment}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">{row.user_name ?? "—"}</td>
                          <td className="px-4 py-3">{row.hours ?? "—"}</td>
                          <td className="px-4 py-3">{date(row.begin)}</td>
                          <td className="px-4 py-3">{row.source_epic?.key}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
            {params.size > 1
              ? "По выбранным условиям ничего не найдено. Измените фильтры."
              : history
                ? "История пока пуста."
                : "Данные пока отсутствуют. Проверьте состав релиза и состояние источников."}
          </p>
        )}
        <Pagination
          total={data?.total ?? 0}
          page={page}
          size={size}
          onChange={(p, s) =>
            update({ page: String(p), page_size: String(s) }, false)
          }
        />
      </QueryState>
    </div>
  );
}
type Run = {
  id: number;
  environment: string;
  status: string;
  url: string | null;
  testops_launch_id: string | null;
  testops_snapshot: ApiEpicTestOpsSnapshot | null;
};
type QaPage = {
  items: Array<{
    epic: { id: number; key: string; title: string };
    qa_status: string;
    active_test_stage: string;
    runs: Run[];
  }>;
  total: number;
};
export function ReleaseQa({ release: r }: { release: ApiRelease }) {
  const { params, update, page, size } = useReleaseFilters();
  const query = useReleaseTab<QaPage>(r.id, "qa", {
    page: Number(params.get("epic_page")) || 1,
    page_size: 10,
  });
  const resultParams = {
    run_id: params.get("run_id") || undefined,
    result_status: params.get("result_status") || undefined,
    active_only: params.get("active_only") === "true",
    page,
    page_size: size,
  };
  const results = useReleaseTab<{
    items: Array<
      ApiEpicTestOpsProblemCase & {
        run_id: number;
        epic_key: string;
        environment: string;
      }
    >;
    total: number;
  }>(r.id, "qa/results", resultParams);
  return (
    <div className="space-y-4">
      <QueryState query={query}>
        {query.data?.items.map((item) => (
          <Panel
            key={item.epic.id}
            title={`${item.epic.key} · ${item.epic.title}`}
            action={
              <Link
                href={`/epics/${item.epic.key}`}
                className="text-sm text-primary"
              >
                Открыть эпик →
              </Link>
            }
          >
            <p className="mb-4 text-sm text-muted-foreground">
              QA-процесс: {label(item.qa_status)} · Активная среда:{" "}
              {item.active_test_stage.toUpperCase()}
            </p>
            <div className="grid grid-cols-3 items-start gap-3">
              {["test", "stage", "prod"].map((env) => {
                const run = item.runs.find((r) => r.environment === env);
                return (
                  <div
                    key={env}
                    className={`rounded-lg border p-4 ${item.active_test_stage === env ? "border-primary/40" : "border-border"}`}
                  >
                    <h3 className="font-medium">
                      {env.toUpperCase()}{" "}
                      {run?.testops_launch_id &&
                        `· Ран ${run.testops_launch_id}`}
                    </h3>
                    <p className="my-2 text-sm text-muted-foreground">
                      {run
                        ? `Состояние рана: ${label(run.status)}`
                        : "Ран не подключён"}
                    </p>
                    {run?.testops_snapshot ? (
                      <>
                        <p className="mb-3 text-xs text-muted-foreground">
                          TestOps: {label(run.testops_snapshot.status)} ·{" "}
                          {date(run.testops_snapshot.synced_at)}
                        </p>
                        <Metrics
                          snapshot={run.testops_snapshot}
                          onStatus={(result_status) =>
                            update({
                              run_id: String(run.id),
                              result_status,
                              active_only: "",
                            })
                          }
                        />
                        {run.testops_snapshot.total === 0 && (
                          <p className="mt-2 text-sm">
                            Ран пуст — результатов пока нет.
                          </p>
                        )}
                      </>
                    ) : (
                      run && (
                        <p className="text-sm text-muted-foreground">
                          Результаты не загружены. Обновите источники релиза.
                        </p>
                      )
                    )}
                    {run?.url && (
                      <a
                        className="mt-3 block text-sm text-primary"
                        href={run.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть TestOps ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
        {!query.data?.items.length && <p>В релизе нет эпиков.</p>}
        {(query.data?.total ?? 0) > 10 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={(Number(params.get("epic_page")) || 1) <= 1}
              onClick={() =>
                update({
                  epic_page: String((Number(params.get("epic_page")) || 1) - 1),
                })
              }
            >
              Предыдущие эпики
            </Button>
            <Button
              variant="outline"
              disabled={
                (Number(params.get("epic_page")) || 1) * 10 >=
                (query.data?.total ?? 0)
              }
              onClick={() =>
                update({
                  epic_page: String((Number(params.get("epic_page")) || 1) + 1),
                })
              }
            >
              Следующие эпики
            </Button>
          </div>
        )}
      </QueryState>
      <Panel title="Проблемные результаты">
        <div className="mb-4 flex gap-3">
          <SelectFilter
            name="Результат"
            value={params.get("result_status") ?? ""}
            options={["failed", "broken", "blocked"].map((s) => ({
              value: s,
              label: label(s),
            }))}
            onChange={(v) => update({ result_status: v })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={params.get("active_only") === "true"}
              onChange={(e) =>
                update({ active_only: e.target.checked ? "true" : "" })
              }
            />
            Только активные среды
          </label>
          {params.get("run_id") && (
            <Button variant="outline" onClick={() => update({ run_id: "" })}>
              Ран {params.get("run_id")} ×
            </Button>
          )}
        </div>
        <QueryState query={results}>
          {results.data?.items.map((c) => (
            <article
              key={`${c.run_id}:${c.external_result_id ?? c.id}`}
              className="border-b border-border py-3 text-sm last:border-0"
            >
              <div className="flex justify-between gap-4">
                <b>{c.title}</b>
                <span className="text-destructive">{label(c.status)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.epic_key} · {c.environment.toUpperCase()} · Результат{" "}
                {c.external_result_id ?? c.id}
              </p>
              {c.parameters && (
                <p className="mt-1">
                  {Object.entries(c.parameters)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              )}
              {c.defect_key && <p className="mt-1">Дефект: {c.defect_key}</p>}
              {c.comment && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {c.comment}
                </p>
              )}
              {c.url && (
                <a
                  className="mt-2 inline-block text-primary"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.link_kind === "result"
                    ? "Открыть результат"
                    : "Открыть ран"}{" "}
                  ↗
                </a>
              )}
            </article>
          ))}
          {!results.data?.items.length && (
            <p className="text-sm text-muted-foreground">
              Нет проблемных результатов по выбранным условиям.
            </p>
          )}
          <Pagination
            total={results.data?.total ?? 0}
            page={page}
            size={size}
            onChange={(p, s) =>
              update({ page: String(p), page_size: String(s) }, false)
            }
          />
        </QueryState>
      </Panel>
    </div>
  );
}
export function ReleaseTime({ release }: { release: ApiRelease }) {
  const { params, update } = useReleaseFilters();
  const detail = params.get("detail") === "worklogs" ? "worklogs" : "tasks";
  const query = useReleaseTab<{
    summary: { spent_hours: number; epic_count: number };
    by_user: Array<{ name: string; hours: number }>;
    by_epic: Array<{ id: number; key: string; title: string; hours: number }>;
    freshness: {
      has_data: boolean;
      status: string;
      last_success_at: string | null;
    };
  }>(release.id, "time-management/summary");
  return (
    <div className="space-y-4">
      <QueryState query={query}>
        {query.data && (
          <Panel title="Трудозатраты релиза">
            <p className="mb-4 text-sm text-muted-foreground">
              Kanban: {label(query.data.freshness.status)} ·{" "}
              {date(query.data.freshness.last_success_at)}
            </p>
            {query.data.freshness.has_data ? (
              <>
                <p className="text-2xl font-semibold">
                  {query.data.summary.spent_hours} ч{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {query.data.summary.epic_count} эпиков
                  </span>
                </p>
                <div className="mt-4 grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="mb-2 font-medium">По сотрудникам</h3>
                    {query.data.by_user.map((u) => (
                      <p
                        key={u.name}
                        className="flex justify-between py-1 text-sm"
                      >
                        <span>{u.name}</span>
                        <b>{u.hours} ч</b>
                      </p>
                    ))}
                    {!query.data.by_user.length && (
                      <p className="text-sm text-muted-foreground">
                        Списаний времени нет.
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 font-medium">По эпикам</h3>
                    {query.data.by_epic.map((e) => (
                      <Link
                        key={e.id}
                        href={`/epics/${e.key}`}
                        className="flex justify-between py-1 text-sm"
                      >
                        <span>
                          {e.key} · {e.title}
                        </span>
                        <b>{e.hours} ч</b>
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm">
                Адресные данные ещё не загружены. Проверьте Kanban-ссылки эпиков
                и синхронизируйте релиз.
              </p>
            )}
          </Panel>
        )}
      </QueryState>
      <div className="flex gap-2">
        <Button
          variant={detail === "tasks" ? "default" : "outline"}
          onClick={() => update({ detail: "tasks" })}
        >
          Задачи
        </Button>
        <Button
          variant={detail === "worklogs" ? "default" : "outline"}
          onClick={() => update({ detail: "worklogs" })}
        >
          Списания времени
        </Button>
      </div>
      <ReleaseListTab release={release} kind={`time-management/${detail}`} />
    </div>
  );
}
