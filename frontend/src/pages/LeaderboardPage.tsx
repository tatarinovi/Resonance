import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trophy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { formatDateTime } from "@/lib/formatDateTime";
import {
  canViewLeaderboard,
  useLeaderboard,
  useLeaderboardActivity,
  useLeaderboardAdmin,
  useLeaderboardMutation,
  type Board,
  type AdminData,
} from "@/lib/leaderboard/queries";

const sourceNames: Record<string, string> = {
  jira: "Jira",
  kanban: "Kanban",
  testops: "Allure TestOps",
  testops_cases: "TestOps · тест-кейс",
  testops_runs: "TestOps · исполнение",
  manual: "Корректировка",
};
const statusNames: Record<string, string> = {
  pending: "На проверке",
  confirmed: "Подтверждён",
  rejected: "Отклонён",
  success: "Обновлено",
  partial: "Есть проблемы",
  failed: "Ошибка",
  running: "Синхронизация…",
  complete: "Завершено",
};
const selectClass =
  "w-full rounded-md border border-input bg-background p-2 text-sm";

function SourceForm({ settings }: { settings: AdminData["settings"] }) {
  const mutation = useLeaderboardMutation();
  const [jql, setJql] = useState(settings.jira_jql ?? "");
  const [field, setField] = useState(
    settings.jira_environment_field ?? "environment",
  );
  const [projects, setProjects] = useState(
    settings.testops_project_ids?.join(", ") ?? "",
  );
  const [reason, setReason] = useState("");
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer font-medium">
        Область источников
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ids = projects
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map(Number);
          if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
            toast.error("Укажите положительные Project ID через запятую");
            return;
          }
          try {
            await mutation.mutateAsync({
              path: "/sources",
              method: "put",
              body: {
                jira_jql: jql,
                jira_environment_field: field,
                testops_project_ids: ids,
                reason,
              },
            });
            toast.success("Область сохранена. Запустите синхронизацию.");
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Не удалось сохранить",
            );
          }
        }}
      >
        <p className="text-sm text-muted-foreground">
          По умолчанию используются Jira JQL эпиков и TestOps launches,
          связанные с эпиками. Укажите общую область команды, чтобы включить
          работу вне этих связей. Kanban использует эпики с оценкой и
          участниками в Resonance.
        </p>
        <Label htmlFor="source-jql">Общий Jira JQL (необязательно)</Label>
        <Textarea
          id="source-jql"
          value={jql}
          maxLength={10000}
          onChange={(e) => setJql(e.target.value)}
        />
        <Label htmlFor="source-field">Поле окружения Jira</Label>
        <Input
          id="source-field"
          required
          value={field}
          pattern="environment|customfield_[0-9]+"
          onChange={(e) => setField(e.target.value)}
        />
        <Label htmlFor="source-projects">
          TestOps Project ID через запятую (необязательно)
        </Label>
        <Input
          id="source-projects"
          value={projects}
          onChange={(e) => setProjects(e.target.value)}
        />
        <Label htmlFor="source-reason">Причина изменения</Label>
        <Input
          id="source-reason"
          required
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button disabled={mutation.isPending || !reason.trim()}>
          Сохранить область
        </Button>
      </form>
    </details>
  );
}

function AdminPanel({ board }: { board: Board }) {
  const [page, setPage] = useState(1);
  const query = useLeaderboardAdmin(board.season, page, true);
  const mutation = useLeaderboardMutation();
  const [decision, setDecision] = useState<{
    id: number;
    key: string;
    status: "confirmed" | "rejected";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [participant, setParticipant] = useState("");
  const [points, setPoints] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [historical, setHistorical] = useState(false);
  const [source, setSource] = useState("jira");
  const [external, setExternal] = useState("");
  const [mappingReason, setMappingReason] = useState("");
  const [mappingUser, setMappingUser] = useState("");
  const [importMonth, setImportMonth] = useState("");
  const [importReason, setImportReason] = useState("");
  const [importAcknowledged, setImportAcknowledged] = useState(false);
  const submit = async (
    path: string,
    body?: unknown,
    method: "post" | "put" = "post",
  ) => {
    try {
      await mutation.mutateAsync({ path, body, method });
      toast.success("Сохранено");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сохранить",
      );
      return false;
    }
  };
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return <p role="status">Загрузка управления…</p>;
  const data = query.data;
  return (
    <div className="space-y-6">
      <SourceForm
        key={JSON.stringify(data.settings)}
        settings={data.settings}
      />
      <section className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="font-medium">Источники и синхронизация</h2>
          <Button
            variant="outline"
            disabled={mutation.isPending || data.sync.status === "running"}
            onClick={() => void submit("/sync")}
          >
            <RefreshCw size={14} />
            Синхронизировать текущий месяц
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {statusNames[data.sync.status ?? ""] ?? "Ещё не синхронизировано"}
          {data.sync.last_finished_at
            ? ` · ${formatDateTime(data.sync.last_finished_at)}`
            : ""}
          . Закрытые месяцы сохраняются.
        </p>
        {Object.entries(data.sync.sources ?? {}).map(([name, state]) => (
          <div
            key={name}
            className="rounded-lg bg-muted/40 p-3 text-sm space-y-1"
          >
            <p className="font-medium">
              {sourceNames[name] ?? name} ·{" "}
              {statusNames[state.status] ?? state.status}
            </p>
            {state.last_success_at && (
              <p className="text-muted-foreground">
                Успешное обновление: {formatDateTime(state.last_success_at)}
              </p>
            )}
            {state.error && (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            )}
            {!!state.problem_count && (
              <details>
                <summary className="cursor-pointer">
                  Проблемы: {state.problem_count}
                </summary>
                <ul className="mt-2 space-y-1">
                  {state.problems?.map((p, i) => (
                    <li key={i} className="break-words">
                      {p.source_key}: {p.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Проверка Jira bugs</h2>
        <p className="text-sm text-muted-foreground">
          Подтверждение относится к текущему автору и окружению. При их
          изменении потребуется повторная проверка.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50">
              <tr>
                {["Задача", "Автор", "Среда", "Состояние", "Действия"].map(
                  (t) => (
                    <th key={t} className="p-3 font-medium">
                      {t}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.bugs.items.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-3 font-mono">{b.issue_key}</td>
                  <td className="p-3">
                    {board.items.find((p) => p.id === b.participant_id)?.name ??
                      "Не сопоставлен"}
                  </td>
                  <td className="p-3">{b.environment ?? "Не определена"}</td>
                  <td className="p-3">
                    {statusNames[b.status]}
                    {b.problem && (
                      <p className="mt-1 max-w-md text-xs text-destructive">
                        {b.problem}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          board.closed ||
                          !!b.problem ||
                          b.status === "confirmed"
                        }
                        onClick={() => {
                          setReason("");
                          setDecision({
                            id: b.id,
                            key: b.issue_key,
                            status: "confirmed",
                          });
                        }}
                      >
                        Подтвердить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={board.closed || b.status === "rejected"}
                        onClick={() => {
                          setReason("");
                          setDecision({
                            id: b.id,
                            key: b.issue_key,
                            status: "rejected",
                          });
                        }}
                      >
                        Отклонить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.bugs.items.length && (
            <p className="p-4 text-sm text-muted-foreground">
              Кандидатов в этом сезоне нет.
            </p>
          )}
        </div>
        <ListPagination
          page={page}
          pageSize={25}
          total={data.bugs.total}
          onPageChange={setPage}
        />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          className="rounded-xl border border-border p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await submit(`/seasons/${board.season}/adjustments`, {
                participant_id: Number(participant),
                points: Number(points),
                reason: correctionReason,
                historical,
              })
            ) {
              setPoints("");
              setCorrectionReason("");
            }
          }}
        >
          <h2 className="font-medium">
            {board.closed
              ? "Историческая корректировка"
              : "Корректировка баллов"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Отдельная запись с причиной. Изменение будет видно в истории
            участника и журнале администратора.
          </p>
          <Label htmlFor="adjust-person">Участник</Label>
          <select
            id="adjust-person"
            required
            className={selectClass}
            value={participant}
            onChange={(e) => setParticipant(e.target.value)}
          >
            <option value="">Выберите участника</option>
            {board.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Label htmlFor="adjust-points">
            Изменение баллов, например +4 или −4
          </Label>
          <Input
            id="adjust-points"
            type="number"
            min={-10000}
            max={10000}
            step={1}
            required
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
          <Label htmlFor="adjust-reason">Причина</Label>
          <Textarea
            id="adjust-reason"
            maxLength={1000}
            required
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
          />
          {board.closed && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={historical}
                onCheckedChange={(v) => setHistorical(v === true)}
              />
              Я понимаю, что изменится сохранённый рейтинг за {board.season}.
            </label>
          )}
          <Button
            disabled={
              mutation.isPending ||
              !Number(points) ||
              !correctionReason.trim() ||
              (board.closed && !historical)
            }
          >
            Записать корректировку
          </Button>
        </form>
        <form
          className="rounded-xl border border-border p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await submit(
                "/identities",
                {
                  source,
                  external_id: external,
                  user_id: Number(mappingUser),
                  reason: mappingReason,
                },
                "put",
              )
            ) {
              setExternal("");
              setMappingReason("");
            }
          }}
        >
          <h2 className="font-medium">Сопоставление аккаунтов</h2>
          <p className="text-sm text-muted-foreground">
            Используйте точный идентификатор из диагностики источника. После
            изменения запустите синхронизацию.
          </p>
          <Label htmlFor="map-source">Источник</Label>
          <select
            id="map-source"
            className={selectClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {["jira", "testops", "kanban"].map((s) => (
              <option key={s} value={s}>
                {sourceNames[s]}
              </option>
            ))}
          </select>
          <Label htmlFor="map-external">Внешний идентификатор</Label>
          <Input
            id="map-external"
            required
            maxLength={255}
            value={external}
            onChange={(e) => setExternal(e.target.value)}
          />
          <Label htmlFor="map-person">Участник</Label>
          <select
            id="map-person"
            required
            className={selectClass}
            value={mappingUser}
            onChange={(e) => setMappingUser(e.target.value)}
          >
            <option value="">Выберите участника</option>
            {data.users.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Label htmlFor="map-reason">Основание сопоставления</Label>
          <Input
            id="map-reason"
            required
            maxLength={1000}
            value={mappingReason}
            onChange={(e) => setMappingReason(e.target.value)}
          />
          <Button
            disabled={
              mutation.isPending || !external.trim() || !mappingReason.trim()
            }
          >
            Сохранить сопоставление
          </Button>
          <details>
            <summary className="cursor-pointer text-sm">
              Сохранённые аккаунты ({data.identities.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {data.identities.map((i) => (
                <li key={i.id} className="break-words">
                  {sourceNames[i.source]}: {i.external_id} →{" "}
                  {board.items.find((p) => p.id === i.user_id)?.name ??
                    `#${i.user_id}`}
                </li>
              ))}
            </ul>
          </details>
        </form>
      </div>
      <form
        className="rounded-xl border border-border p-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await submit("/backfill", {
            season: importMonth,
            reason: importReason,
            acknowledge_current_source_state: importAcknowledged,
          });
        }}
      >
        <h2 className="font-medium">Первичный импорт прошедшего сезона</h2>
        <p className="text-sm text-muted-foreground">
          Импорт использует реальные даты работы, но источники не
          восстанавливают прежнее состояние записей и состав команды. Будет
          зафиксировано доступное состояние на дату импорта. Существующий сезон
          не перезаписывается; Jira bugs потребуют проверки и отдельной
          корректировки.
        </p>
        <Label htmlFor="import-month">Прошедший месяц</Label>
        <Input
          id="import-month"
          type="month"
          required
          value={importMonth}
          onChange={(e) => setImportMonth(e.target.value)}
        />
        <Label htmlFor="import-reason">Основание импорта</Label>
        <Input
          id="import-reason"
          required
          maxLength={1000}
          value={importReason}
          onChange={(e) => setImportReason(e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={importAcknowledged}
            onCheckedChange={(v) => setImportAcknowledged(v === true)}
          />
          Я проверил ограничения и подтверждаю создание исторического снимка по
          доступным данным.
        </label>
        <Button
          disabled={
            mutation.isPending ||
            !importAcknowledged ||
            !importReason.trim() ||
            data.backfill.status === "running"
          }
        >
          Импортировать и зафиксировать
        </Button>
        {data.backfill.status && (
          <p className="text-sm" role="status">
            {data.backfill.season}:{" "}
            {statusNames[data.backfill.status] ?? data.backfill.status}{" "}
            {data.backfill.error}
          </p>
        )}
      </form>
      <section className="space-y-2">
        <h2 className="font-medium">Журнал действий за сезон</h2>
        {data.audit.map((a) => (
          <div
            key={a.id}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <p>{a.reason}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(a.date)} · Администратор #{a.admin_id}
            </p>
          </div>
        ))}
      </section>
      <Dialog
        open={!!decision}
        onOpenChange={(open) => !open && setDecision(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.status === "confirmed" ? "Подтвердить" : "Отклонить"}{" "}
              {decision?.key}
            </DialogTitle>
            <DialogDescription>
              Решение изменит баллы текущего сезона и сохранится в журнале.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="bug-reason">Причина решения</Label>
          <Textarea
            id="bug-reason"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Отмена
            </Button>
            <Button
              disabled={!reason.trim() || mutation.isPending}
              onClick={async () => {
                if (
                  decision &&
                  (await submit(`/bugs/${decision.id}/decision`, {
                    status: decision.status,
                    reason,
                  }))
                )
                  setDecision(null);
              }}
            >
              Сохранить решение
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LeaderboardPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const season = params.get("season") ?? "";
  const tab = params.get("tab") ?? "ranking";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const participant = Number(params.get("participant")) || me?.id;
  const allowed = canViewLeaderboard(me);
  const query = useLeaderboard(season, allowed);
  const activity = useLeaderboardActivity(
    query.data?.season ?? "",
    participant,
    page,
    allowed && tab === "activity",
  );
  const admin = me?.role === "admin";
  const change = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k),
    );
    setParams(next);
  };
  if (!allowed)
    return (
      <div className="p-6">
        Рейтинг доступен участникам QA DS и администраторам.
      </div>
    );
  if (query.isError)
    return (
      <div className="p-6 space-y-3" role="alert">
        <p>{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </div>
    );
  if (!query.data)
    return (
      <div className="p-6" role="status">
        Загрузка рейтинга…
      </div>
    );
  const board = query.data;
  const mine = board.items.find((p) => p.id === me?.id);
  const above =
    mine && board.items.filter((p) => p.points > mine.points).at(-1);
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Trophy size={20} className="text-primary" />
            QA · Рейтинг команды
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Признание вклада в качество. Баллы — повод отметить работу коллег.
          </p>
        </div>
        <div className="space-y-1">
          <Label>Сезон</Label>
          <Select
            value={board.season}
            onValueChange={(value) => change({ season: value, page: "" })}
          >
            <SelectTrigger className="w-40" aria-label="Сезон">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {board.seasons.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
        <span>
          {board.closed
            ? "Сезон закрыт · рейтинг сохранён"
            : "Текущий сезон · баллы обновляются"}
        </span>
        {mine && (
          <span className="font-medium">
            Ваше место: {mine.rank} · {mine.points} баллов
            {above
              ? ` · до ближайшего места ${above.points - mine.points}`
              : ""}
          </span>
        )}
        <span className="text-muted-foreground">
          Пересчёт: {formatDateTime(board.updated_at)}
        </span>
      </div>
      {!board.closed &&
        Object.values(board.source_statuses ?? {}).some(
          (status) => status !== "success",
        ) && (
          <p
            role="status"
            className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
          >
            Часть данных пока недоступна или требует проверки. Последние
            успешные начисления сохранены; причины доступны администратору.
          </p>
        )}
      <Tabs
        value={tab}
        onValueChange={(value) => change({ tab: value, page: "" })}
      >
        <TabsList className="flex w-fit max-w-full flex-wrap h-auto">
          <TabsTrigger value="ranking">Рейтинг</TabsTrigger>
          <TabsTrigger value="activity">
            {admin ? "Активность участников" : "Моя активность"}
          </TabsTrigger>
          <TabsTrigger value="rules">Как начисляются баллы</TabsTrigger>
          {admin && <TabsTrigger value="admin">Управление</TabsTrigger>}
        </TabsList>
        <TabsContent value="ranking" className="mt-4">
          {!board.items.length ? (
            <EmptyState
              icon={Trophy}
              title="В этом сезоне нет участников"
              description="В рейтинге участвуют разработчики QA пространства DS."
            />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 w-20 font-medium">Место</th>
                    <th className="p-3 font-medium">Участник</th>
                    <th className="p-3 text-right font-medium">Баллы</th>
                  </tr>
                </thead>
                <tbody>
                  {board.items.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-t border-border ${p.id === me?.id ? "bg-primary/5" : ""}`}
                    >
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {p.rank}
                      </td>
                      <td className="p-3 break-words max-w-[15rem] sm:max-w-none font-medium">
                        {p.name}
                        {p.id === me?.id && (
                          <span className="ml-2 text-xs font-normal text-primary">
                            Вы
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">
                        {p.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="activity" className="mt-4 space-y-4">
          {admin && (
            <select
              aria-label="Активность участника"
              className={selectClass}
              value={participant ?? ""}
              onChange={(e) =>
                change({ participant: e.target.value, page: "" })
              }
            >
              <option value="">Выберите участника</option>
              {board.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {activity.isError ? (
            <p role="alert">{activity.error.message}</p>
          ) : activity.isLoading ? (
            <p role="status">Загрузка активности…</p>
          ) : (
            <>
              <div className="rounded-xl border border-border divide-y divide-border">
                {activity.data?.items.map((a) => (
                  <div key={a.id} className="flex gap-4 p-4">
                    <span className="w-12 shrink-0 tabular-nums font-semibold">
                      {a.points > 0 ? "+" : ""}
                      {a.points}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words">
                        {a.explanation}
                        {!a.eligible && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Не учитывается
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground break-words">
                        {formatDateTime(a.date)} ·{" "}
                        {sourceNames[a.source] ?? a.source} · {a.source_key}
                      </p>
                    </div>
                  </div>
                ))}
                {!activity.data?.items.length && (
                  <p className="p-4 text-sm text-muted-foreground">
                    За этот сезон пока нет начислений.
                  </p>
                )}
              </div>
              <ListPagination
                page={page}
                pageSize={25}
                total={activity.data?.total ?? 0}
                onPageChange={(p) => change({ page: String(p) })}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="rules" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border divide-y divide-border">
            {Object.entries(board.rules.events).map(([key, rule]) => (
              <div key={key} className="flex justify-between gap-3 p-4 text-sm">
                <span>{rule.label}</span>
                <strong>+{rule.points}</strong>
              </div>
            ))}
          </div>
          <section className="rounded-xl border border-border p-4 space-y-3">
            <h2 className="font-medium">Исполнение тестов</h2>
            <p className="text-sm text-muted-foreground">
              Один уровень за run, участника и месяц. Статусы{" "}
              {board.rules.execution_statuses.join(", ")} считаются одинаково.
              Остальные статусы не учитываются.
            </p>
            <div className="flex flex-wrap gap-3">
              {board.rules.execution_tiers.map((t) => (
                <div
                  key={t.minimum}
                  className="rounded-lg bg-muted/50 p-3 text-sm"
                >
                  {t.minimum}
                  {t.maximum ? `–${t.maximum}` : "+"} тестов{" "}
                  <strong className="ml-2">+{t.points}</strong>
                </div>
              ))}
            </div>
          </section>
          <p className="text-sm text-muted-foreground">
            Месяц определяется датой работы в часовом поясе{" "}
            {board.rules.timezone}. Тест-кейс учитывается только в месяце
            создания и пока активен. Bugs требуют подтверждения администратора.
            По окончании месяца баллы сохраняются; исправления истории всегда
            содержат причину.
          </p>
        </TabsContent>
        {admin && (
          <TabsContent value="admin" className="mt-4">
            <AdminPanel key={board.season} board={board} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
