import { label, date, panel } from "@/components/releases/release-display";
import { useState } from "react";
import { Link } from "@/lib/router";
import type {
  ApiRelease,
  ApiReleaseAssessment,
  ApiReleaseAttention,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Metrics, Panel, SelectFilter } from "./release-ui";
export type Go = (tab: string, params?: Record<string, string>) => void;
export function Attention({
  assessment,
}: {
  assessment: ApiReleaseAssessment;
}) {
  const [category, setCategory] = useState("actual_risks");
  const [source, setSource] = useState("");
  const [all, setAll] = useState(false);
  const categories = {
    actual_risks: "Риски",
    warnings: "Предупреждения",
    data_gaps: "Нет данных",
  } as const;
  const items = (
    assessment[category as keyof typeof categories] as ApiReleaseAttention[]
  ).filter((i) => !source || i.source === source);
  return (
    <Panel
      title="Требует внимания"
      action={
        <span className="text-sm text-muted-foreground">
          {assessment.attention.length} элементов
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(categories).map(([k, v]) => (
          <Button
            key={k}
            size="sm"
            variant={category === k ? "default" : "outline"}
            onClick={() => {
              setCategory(k);
              setAll(false);
            }}
          >
            {v} · {assessment[k as keyof typeof categories].length}
          </Button>
        ))}
        <SelectFilter
          name="Источник"
          value={source}
          options={[...new Set(assessment.attention.map((i) => i.source))].map(
            (s) => ({
              value: s,
              label:
                s === "testops"
                  ? "TestOps"
                  : s === "jira"
                    ? "Jira"
                    : s === "qa"
                      ? "QA"
                      : "Resonance",
            }),
          )}
          onChange={setSource}
        />
      </div>
      <div className={all ? "max-h-[480px] overflow-y-auto" : ""}>
        {(all ? items : items.slice(0, 6)).map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[180px_90px_1fr_130px] items-start gap-4 border-b border-border py-3 text-sm last:border-0"
          >
            <span
              className={
                item.severity === "blocker"
                  ? "text-destructive"
                  : "text-foreground"
              }
            >
              {label(item.kind)}
            </span>
            <Link className="text-primary" href={`/epics/${item.epic.key}`}>
              {item.epic.key}
            </Link>
            <div>
              {item.message}
              <p className="mt-1 text-xs text-muted-foreground">
                {item.entity?.status && label(item.entity.status)}{" "}
                {item.timestamp && `· ${date(item.timestamp)}`}
              </p>
            </div>
            {item.entity?.url ? (
              <a
                className="text-primary"
                href={item.entity.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.entity.link_kind === "launch"
                  ? "Открыть ран"
                  : "Открыть ↗"}
              </a>
            ) : (
              <Link className="text-primary" href={`/epics/${item.epic.key}`}>
                Открыть эпик
              </Link>
            )}
          </div>
        ))}
      </div>
      {!items.length && (
        <p className="text-sm text-muted-foreground">
          В этой категории ничего нет.
        </p>
      )}
      {items.length > 6 && (
        <Button
          variant="ghost"
          className="mt-2 text-primary"
          onClick={() => setAll(!all)}
        >
          {all ? "Свернуть" : `Показать все · ${items.length}`}
        </Button>
      )}
    </Panel>
  );
}
export function ReleaseOverview({
  assessment: a,
  release: r,
  go,
}: {
  assessment: ApiReleaseAssessment;
  release: ApiRelease;
  go: Go;
}) {
  const qa = a.summary.qa;
  const jira = a.summary.jira;
  const q = a.summary.questions;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <div className={panel}>
          <p className="text-sm text-muted-foreground">Готовность релиза</p>
          <p className="mt-2 text-xl font-semibold">
            {a.readiness === "has_risks"
              ? "Есть риски"
              : a.readiness === "ready"
                ? "Готов к выпуску"
                : "Недостаточно данных"}
          </p>
          <a
            href="#release-attention"
            className="mt-3 block text-sm text-primary"
          >
            {a.actual_risks.length} рисков · {a.warnings.length} предупреждений
          </a>
        </div>
        <div className={panel}>
          <button
            className="mb-3 text-sm text-primary"
            onClick={() => go("qa", { active_only: "true" })}
          >
            QA · активная среда →
          </button>
          {qa?.covered ? (
            <Metrics
              snapshot={qa}
              onStatus={(result_status) =>
                go("qa", { result_status, active_only: "true" })
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Результаты ещё не загружены. Откройте QA, чтобы проверить привязки
              ранов.
            </p>
          )}
          {qa && qa.covered < qa.epic_count && (
            <p className="mt-2 text-xs text-muted-foreground">
              Покрытие: {qa.covered} из {qa.epic_count} эпиков
            </p>
          )}
        </div>
        <div className={panel}>
          <button className="text-sm text-primary" onClick={() => go("tasks")}>
            Jira →
          </button>
          <p className="my-2 text-2xl font-semibold">
            {jira?.total ?? 0}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              задач
            </span>
          </p>
          <button
            className="block text-sm text-primary"
            onClick={() => go("tasks", { priority_group: "blocker" })}
          >
            {jira?.open_blockers ?? 0} открытых блокеров
          </button>
          <button
            className="mt-1 block text-sm text-primary"
            onClick={() => go("tasks", { priority_group: "critical" })}
          >
            {jira?.open_critical ?? 0} критичных
          </button>
        </div>
        <div className={panel}>
          <button
            className="text-sm text-primary"
            onClick={() => go("questions", { view: "open" })}
          >
            Вопросы →
          </button>
          <p className="my-2 text-2xl font-semibold">
            {q?.open ?? 0}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              открытых
            </span>
          </p>
          <button
            className="block text-sm text-primary"
            onClick={() => go("questions", { view: "overdue" })}
          >
            {q?.overdue ?? 0} просрочено
          </button>
          <button
            className="mt-1 block text-sm text-primary"
            onClick={() => go("questions", { view: "waiting" })}
          >
            {q?.waiting_expert ?? 0} ожидают эксперта
          </button>
        </div>
      </div>
      <div id="release-attention">
        <Attention assessment={a} />
      </div>
      <div className="grid grid-cols-2 items-start gap-4">
        <Panel
          title="Текущие тест-раны"
          action={
            <Button variant="ghost" onClick={() => go("qa")}>
              Все раны →
            </Button>
          }
        >
          {a.current_test_runs?.length ? (
            a.current_test_runs.map((item) => (
              <div
                key={item.epic.id}
                className="space-y-3 border-b border-border py-3 first:pt-0 last:border-0"
              >
                <Link
                  href={`/epics/${item.epic.key}`}
                  className="text-sm font-medium hover:text-primary"
                >
                  {item.epic.key} · {item.epic.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {item.environment.toUpperCase()} ·{" "}
                  {item.run
                    ? `Ран ${item.run.testops_launch_id ?? item.run.id} · ${label(item.run.status)}`
                    : "Ран не подключён"}
                </p>
                {item.run?.snapshot ? (
                  <>
                    <Metrics
                      snapshot={item.run.snapshot}
                      onStatus={(result_status) =>
                        go("qa", {
                          run_id: String(item.run!.id),
                          result_status,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Обновлено: {date(item.run.snapshot.synced_at)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {item.run
                      ? "Результаты не загружены"
                      : "Добавьте ран в QA эпика"}
                  </p>
                )}
                {item.run?.url && (
                  <a
                    className="inline-block text-sm text-primary"
                    href={item.run.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть TestOps ↗
                  </a>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Добавьте эпики в состав релиза.
            </p>
          )}
        </Panel>
        <Panel title="Jira по статусам">
          {jira?.total ? (
            jira.groups
              .filter((g) => g.id !== "unknown" || g.count > 0)
              .map((g) => (
                <button
                  key={g.id}
                  className="mb-3 block w-full text-left text-sm last:mb-0"
                  onClick={() => go("tasks", { status_group: g.id })}
                >
                  <span className="flex justify-between">
                    <span>{g.label}</span>
                    <b>{g.count}</b>
                  </span>
                  <span className="mt-1 block h-2 rounded bg-muted">
                    <span
                      className="block h-full rounded bg-primary/70"
                      style={{ width: `${(g.count / jira.total) * 100}%` }}
                    />
                  </span>
                </button>
              ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Задачи Jira ещё не загружены.
            </p>
          )}
        </Panel>
      </div>
      <div className="grid grid-cols-2 items-start gap-4">
        <Panel
          title="Ключевые открытые задачи"
          action={
            <Button variant="ghost" onClick={() => go("tasks")}>
              Все задачи · {jira?.total ?? 0} →
            </Button>
          }
        >
          {a.key_jira_tasks?.length ? (
            a.key_jira_tasks.map((t) => (
              <a
                key={t.key}
                className="block border-b border-border py-3 text-sm last:border-0 hover:text-primary"
                href={t.url}
                target="_blank"
                rel="noreferrer"
              >
                <b>{t.key}</b> · {t.title}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t.status} · {t.priority}
                </span>
              </a>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Открытых задач нет.</p>
          )}
        </Panel>
        <Panel
          title="Вопросы к экспертам"
          action={
            <Button variant="ghost" onClick={() => go("questions")}>
              Все вопросы →
            </Button>
          }
        >
          {a.key_questions?.length ? (
            a.key_questions.map((t) => (
              <Link
                key={t.id}
                className="block border-b border-border py-3 text-sm last:border-0"
                href={t.url}
              >
                {t.key} · {t.title}
                <span className="block text-muted-foreground">
                  {t.overdue ? "Просрочен" : label(t.status)}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Открытых вопросов нет.
            </p>
          )}
        </Panel>
      </div>
      <Panel
        title={`Состав релиза · ${r.epic_count}`}
        action={
          <Button variant="ghost" onClick={() => go("composition")}>
            Управление составом →
          </Button>
        }
      >
        {r.epics.map((e) => (
          <Link
            key={e.id}
            href={`/epics/${e.key}`}
            className="flex justify-between border-b border-border py-3 text-sm last:border-0"
          >
            <span>
              {e.key} · {e.title}
            </span>
            <span className="text-muted-foreground">
              QA: {label(e.qa_status)} ·{" "}
              {a.actual_risks.filter((i) => i.epic.id === e.id).length} рисков
            </span>
          </Link>
        ))}
        {!r.epics.length && (
          <p className="text-sm text-muted-foreground">
            В релиз ещё не добавлены эпики.
          </p>
        )}
      </Panel>
    </div>
  );
}
