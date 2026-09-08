import { label, date } from "@/components/releases/release-display";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useArchiveRelease,
  useDeleteRelease,
  useManageReleaseEpics,
  useRelease,
  useReleaseEpicOptions,
  useReleaseOverview,
  useRefreshRelease,
  useRemoveReleaseEpic,
  useTransitionRelease,
  useUpdateRelease,
  useProjectMentionUsers,
} from "@/lib/queries";
import { Link } from "@/lib/router";
import { formatDate } from "@/lib/formatDateTime";
import type { ApiRelease, ReleaseStatus } from "@/lib/types";
import {
  Attention,
  ReleaseOverview,
} from "@/components/releases/ReleaseOverview";
import {
  ReleaseListTab,
  ReleaseQa,
  ReleaseTime,
} from "@/components/releases/ReleaseTabs";
import { Panel, QueryState, Sources } from "@/components/releases/release-ui";

const tabs = [
  ["overview", "Обзор"],
  ["tasks", "Задачи"],
  ["qa", "QA"],
  ["questions", "Вопросы"],
  ["time", "Трудозатраты"],
  ["composition", "Состав"],
  ["history", "История"],
];
const transitions: Record<ReleaseStatus, string> = {
  draft: "Вернуть в черновик",
  in_progress: "Начать работу",
  ready: "Перевести в готовность",
  released: "Выпустить релиз",
  cancelled: "Отменить релиз",
};
function EditRelease({
  release: r,
  onClose,
}: {
  release: ApiRelease;
  onClose: () => void;
}) {
  const update = useUpdateRelease(r.id);
  const users = useProjectMentionUsers(r.project_id);
  const [title, setTitle] = useState(r.title),
    [description, setDescription] = useState(r.description ?? ""),
    [note, setNote] = useState(r.release_note ?? ""),
    [owner, setOwner] = useState(String(r.owner_user_id ?? "")),
    [planned, setPlanned] = useState(r.planned_release_at?.slice(0, 10) ?? "");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактировать релиз</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="release-title">Название</Label>
            <Input
              id="release-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="release-description">Описание</Label>
            <Textarea
              id="release-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="release-date">Плановая дата</Label>
            <Input
              id="release-date"
              type="date"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="release-owner">Владелец</Label>
            <select
              id="release-owner"
              className="w-full rounded border border-border bg-background p-2"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Не назначен</option>
              {r.owner_user_id &&
                !users.data?.some((u) => u.id === r.owner_user_id) && (
                  <option value={r.owner_user_id}>{r.owner_username}</option>
                )}
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
            {users.isError && (
              <p className="text-sm text-destructive">
                Не удалось загрузить участников.{" "}
                <button onClick={() => users.refetch()}>Повторить</button>
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="release-note">Примечание к выпуску</Label>
            <Textarea
              id="release-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={!title.trim() || update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync({
                  title: title.trim(),
                  description: description || null,
                  release_note: note || null,
                  owner_user_id: owner ? Number(owner) : null,
                  planned_release_at: planned ? `${planned}T00:00:00` : null,
                });
                toast.success("Релиз обновлён");
                onClose();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Не удалось сохранить",
                );
              }
            }}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function Composition({ release: r }: { release: ApiRelease }) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [reason, setReason] = useState(""),
    [removeId, setRemoveId] = useState<number | null>(null);
  const terminal = ["released", "cancelled"].includes(r.status);
  const options = useReleaseEpicOptions(
    r.project_id,
    search,
    r.capabilities.can_manage_epics,
  );
  const add = useManageReleaseEpics(r.id);
  const remove = useRemoveReleaseEpic(r.id);
  const candidates =
    options.data?.items.filter((e) => !r.epics.some((x) => x.id === e.id)) ??
    [];
  return (
    <div className="space-y-4">
      <Panel title={`Состав релиза · ${r.epic_count}`}>
        {r.epics.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
          >
            <div>
              <Link
                className="text-sm font-medium text-primary"
                href={`/epics/${e.key}`}
              >
                {e.key} · {e.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                QA: {label(e.qa_status)} · Среда: {e.active_test_stage?.toUpperCase() ?? "не задана"} · {e.risk_count ?? e.blockers_count} рисков
              </p>
            </div>
            {r.capabilities.can_manage_epics && (
              <Button variant="outline" onClick={() => setRemoveId(e.id)}>
                Исключить
              </Button>
            )}
          </div>
        ))}
        {!r.epics.length && (
          <p className="text-sm text-muted-foreground">
            Добавьте эпики, чтобы собирать задачи, QA и вопросы релиза.
          </p>
        )}
      </Panel>
      {r.capabilities.can_manage_epics && (
        <Panel title="Добавить эпики">
          {terminal && (
            <div className="mb-4">
              <Label htmlFor="correction">
                Причина исторической корректировки
              </Label>
              <Textarea
                id="correction"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          <Input
            className="mb-4"
            placeholder="Поиск эпика"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <QueryState query={options}>
            <div className="max-h-80 overflow-auto">
              {candidates.map((e) => (
                <label
                  key={e.id}
                  className="flex gap-3 border-b border-border py-3 text-sm"
                >
                  <input
                    type="checkbox"
                    disabled={!terminal && !e.available}
                    checked={selected.includes(e.id)}
                    onChange={(ev) =>
                      setSelected((prev) =>
                        ev.target.checked
                          ? [...prev, e.id]
                          : prev.filter((id) => id !== e.id),
                      )
                    }
                  />
                  <span>
                    {e.key} · {e.title}
                    {e.disabled_reason && (
                      <span className="block text-muted-foreground">
                        {e.disabled_reason}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {!candidates.length && (
              <p className="text-sm text-muted-foreground">
                {search
                  ? "По запросу эпики не найдены."
                  : "Других доступных эпиков проекта нет. Уже включённые эпики показаны выше."}
              </p>
            )}
            {(options.data?.total ?? 0) > 100 && (
              <p className="text-sm text-muted-foreground">
                Показаны первые 100 вариантов. Уточните поиск.
              </p>
            )}
            <Button
              className="mt-4"
              disabled={
                !selected.length ||
                add.isPending ||
                (terminal && !reason.trim())
              }
              onClick={async () => {
                try {
                  await add.mutateAsync({
                    epic_ids: selected,
                    correction_reason: reason.trim() || undefined,
                  });
                  setSelected([]);
                  toast.success("Эпики добавлены");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Ошибка");
                }
              }}
            >
              Добавить выбранные · {selected.length}
            </Button>
          </QueryState>
        </Panel>
      )}
      <Dialog
        open={removeId != null}
        onOpenChange={(o) => !o && setRemoveId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Исключить эпик из релиза?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">Сам эпик и его данные сохранятся.</p>
          {terminal && (
            <>
              <Label htmlFor="remove-reason">Причина корректировки</Label>
              <Textarea
                id="remove-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>
              Отмена
            </Button>
            <Button
              disabled={remove.isPending || (terminal && !reason.trim())}
              onClick={async () => {
                try {
                  await remove.mutateAsync({
                    epicId: removeId!,
                    correctionReason: reason.trim() || undefined,
                  });
                  setRemoveId(null);
                  toast.success("Эпик исключён");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Ошибка");
                }
              }}
            >
              Исключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default function ReleaseDetailPage() {
  const { id } = useParams();
  const releaseId = Number(id);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([t]) => t === params.get("tab"))
    ? params.get("tab")!
    : "overview";
  const query = useRelease(Number.isFinite(releaseId) ? releaseId : null);
  const overview = useReleaseOverview(releaseId);
  const refresh = useRefreshRelease(releaseId);
  const archive = useArchiveRelease(releaseId);
  const deletion = useDeleteRelease(releaseId);
  const transition = useTransitionRelease(releaseId);
  const [edit, setEdit] = useState(false),
    [target, setTarget] = useState<ReleaseStatus | null>(null),
    [accepted, setAccepted] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [deleteOpen, setDeleteOpen] = useState(false);
  const targetQuery = useReleaseOverview(releaseId, target, !!target);
  const assessment = targetQuery.data;
  const r = query.data;
  const go = (next: string, filters: Record<string, string> = {}) =>
    setParams(next === "overview" ? {} : { tab: next, ...filters });
  const openTransition = (s: ReleaseStatus) => {
    setAccepted(null);
    setTarget(s);
    setNote("");
  };
  if (!r)
    return (
      <div className="p-6">
        <QueryState query={query}>
          <p>Релиз не найден или недоступен.</p>
        </QueryState>
      </div>
    );
  const refreshResult = refresh.data ?? r.last_refresh;
  const main = r.capabilities.allowed_status_transitions.find(
    (s) => s !== "cancelled",
  );
  const needsAcceptance =
    !!assessment?.actual_risks.length &&
    ["ready", "released"].includes(target ?? "");
  return (
    <div className="space-y-5 p-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-sm font-mono text-muted-foreground">{r.key}</p>
            <h1 className="text-2xl font-semibold">{r.title}</h1>
            {r.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {r.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {r.capabilities.can_refresh_data && (
              <Button
                variant="outline"
                disabled={refresh.isPending}
                onClick={async () => {
                  try {
                    const result = await refresh.mutateAsync();
                    if (result.outcome === "success")
                      toast.success("Источники обновлены");
                    else
                      toast.warning(
                        "Проверьте результат обновления источников",
                      );
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Ошибка синхронизации",
                    );
                  }
                }}
              >
                <RefreshCw
                  size={16}
                  className={refresh.isPending ? "animate-spin" : ""}
                />
                {refresh.isPending ? "Обновление…" : "Синхронизировать"}
              </Button>
            )}
            {overview.data?.jira_search_url && (
              <Button variant="outline" asChild>
                <a
                  href={overview.data.jira_search_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть Jira ↗
                </a>
              </Button>
            )}
            {main && (
              <Button onClick={() => openTransition(main)}>
                {transitions[main]}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Действия релиза">
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {r.capabilities.can_edit_release && (
                  <DropdownMenuItem onSelect={() => setEdit(true)}>
                    Редактировать
                  </DropdownMenuItem>
                )}
                {r.capabilities.can_manage_epics && (
                  <DropdownMenuItem onSelect={() => go("composition")}>
                    Изменить состав
                  </DropdownMenuItem>
                )}
                {r.capabilities.allowed_status_transitions
                  .filter((s) => s !== main)
                  .map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onSelect={() => openTransition(s)}
                    >
                      {transitions[s]}
                    </DropdownMenuItem>
                  ))}
                {r.capabilities.can_archive && !r.archived_at && (
                  <DropdownMenuItem
                    disabled={archive.isPending}
                    onSelect={async () => {
                      try {
                        await archive.mutateAsync();
                        toast.success("Релиз архивирован");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Ошибка");
                      }
                    }}
                  >
                    Архивировать
                  </DropdownMenuItem>
                )}
                {r.capabilities.can_delete && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    Удалить черновик
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{label(r.status)}</span>
          <span>{r.project_name}</span>
          <span>Владелец: {r.owner_username ?? "не назначен"}</span>
          <span>
            План:{" "}
            {r.planned_release_at
              ? formatDate(r.planned_release_at)
              : "не задан"}
          </span>
          <button className="text-primary" onClick={() => go("composition")}>
            Эпики: {r.epic_count}
          </button>
        </div>
        <Sources sources={r.freshness} />
        {refreshResult && (
          <details
            open
            className="rounded-lg border border-border bg-card p-3 text-sm"
          >
            <summary className="cursor-pointer font-medium">
              Последняя синхронизация: {label(refreshResult.outcome)}
            </summary>
            <div className="mt-2 space-y-1">
              {refreshResult.results.map((op, i) => (
                <div key={i}>
                  EP-{String(op.epic_id).padStart(3, "0")} · {String(op.source)}
                  : {label(String(op.status))}
                  {op.current_success_at
                    ? ` · ${date(String(op.current_success_at))}`
                    : ""}
                  {["failed", "timed_out"].includes(String(op.status))
                    ? " — обновление не выполнено; проверьте подключение источника"
                    : ""}
                  {op.runs?.map((run) => (
                    <p key={run.run_id} className="ml-4 text-muted-foreground">
                      Ран #{run.run_id}: {label(run.status)} ·{" "}
                      {date(run.current_success_at)}
                    </p>
                  ))}
                </div>
              ))}
              {"kanban" in refreshResult && (
                <p>
                  Kanban:{" "}
                  {label(
                    String((refreshResult.kanban as { status: string }).status),
                  )}
                </p>
              )}
            </div>
          </details>
        )}
      </header>
      <nav
        aria-label="Разделы релиза"
        className="flex gap-1 border-b border-border"
      >
        {tabs.map(([value, title]) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            className={`border-b-2 px-4 py-3 text-sm ${tab === value ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => go(value)}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <QueryState query={overview}>
          {overview.data && (
            <ReleaseOverview assessment={overview.data} release={r} go={go} />
          )}
        </QueryState>
      )}
      {(tab === "tasks" || tab === "questions" || tab === "history") && (
        <ReleaseListTab key={tab} release={r} kind={tab} />
      )}
      {tab === "qa" && <ReleaseQa release={r} />}
      {tab === "time" && <ReleaseTime release={r} />}
      {tab === "composition" && <Composition release={r} />}
      {edit && <EditRelease release={r} onClose={() => setEdit(false)} />}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{target ? transitions[target] : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {label(r.status)} → {label(target)}
          </p>
          <QueryState query={targetQuery}>
            {assessment && <Attention assessment={assessment} />}
          </QueryState>
          {needsAcceptance && (
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={accepted === assessment?.risk_fingerprint}
                onChange={(e) =>
                  setAccepted(
                    e.target.checked ? assessment!.risk_fingerprint : null,
                  )
                }
              />
              Ознакомлен с рисками и принимаю их
            </label>
          )}
          {target && ["released", "cancelled"].includes(target) && (
            <div>
              <Label htmlFor="transition-note">Примечание к выпуску</Label>
              <Textarea
                id="transition-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Отмена
            </Button>
            <Button
              disabled={
                transition.isPending ||
                targetQuery.isFetching ||
                targetQuery.isError ||
                !assessment ||
                (needsAcceptance && accepted !== assessment.risk_fingerprint)
              }
              onClick={async () => {
                try {
                  await transition.mutateAsync({
                    target_status: target!,
                    release_note: note || null,
                    accept_risks:
                      needsAcceptance &&
                      accepted === assessment?.risk_fingerprint,
                    risk_fingerprint: assessment?.risk_fingerprint,
                  });
                  setTarget(null);
                  toast.success("Статус обновлён");
                } catch (e) {
                  setAccepted(null);
                  void targetQuery.refetch();
                  toast.error(
                    e instanceof Error ? e.message : "Ошибка перехода",
                  );
                }
              }}
            >
              {target ? transitions[target] : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить черновик {r.key}?</DialogTitle>
          </DialogHeader>
          <p>
            Релиз будет удалён без возможности восстановления. Эпики сохранятся.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deletion.isPending}
              onClick={async () => {
                try {
                  await deletion.mutateAsync();
                  navigate("/releases");
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Ошибка удаления",
                  );
                }
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
