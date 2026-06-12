import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_EFFECTIVE_HOURS_PER_QA_PER_DAY,
  RELEASE_TYPE_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/release-planning/config";
import { distributeHoursFromWeights } from "@/lib/release-planning/distribute";
import { planRelease } from "@/lib/release-planning/engine";
import type { PlannerConfidence, PlannerRiskLevel, ReleasePlannerInput, ReleaseStageId, ReleaseType } from "@/lib/release-planning/types";
import { useEpic, type KanbanAnalyticsEpicDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Единый вид полей даты под тёмную тему (в т.ч. всплывающий календарь в Chromium). */
const planningDateInputClassName =
  "bg-background text-foreground [color-scheme:light_dark] shadow-sm [font-variant-numeric:tabular-nums]";

function riskLevelRu(level: PlannerRiskLevel): string {
  if (level === "high") return "высокий";
  if (level === "medium") return "средний";
  return "низкий";
}

function confidenceRu(level: PlannerConfidence): string {
  if (level === "high") return "высокая";
  if (level === "medium") return "средняя";
  return "низкая";
}

function storageKey(projectSlug: string, kanbanEpicId: number) {
  return `resonance-kanban-planning:v1:${projectSlug}:${kanbanEpicId}`;
}

function ymdFromIsoOrDate(s: string | null | undefined): string {
  if (!s) return "";
  const d = s.includes("T") ? parseISO(s) : parseISO(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "yyyy-MM-dd");
}

function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}

type DraftV1 = Omit<ReleasePlannerInput, "stageHours"> & { stageHours: Partial<Record<ReleaseStageId, number>> };

function normalizeStageHours(partial: Partial<Record<ReleaseStageId, number>> | undefined, total: number): Record<ReleaseStageId, number> {
  const base = distributeHoursFromWeights(Math.max(0, total));
  for (const id of STAGE_ORDER) {
    if (partial && typeof partial[id] === "number" && !Number.isNaN(partial[id]!)) {
      base[id] = Math.max(0, partial[id]!);
    }
  }
  return base;
}

function scaleStagesToMatchTotal(hours: Record<ReleaseStageId, number>, total: number): Record<ReleaseStageId, number> {
  const s = STAGE_ORDER.reduce((a, id) => a + hours[id], 0);
  if (total <= 0) {
    const z = {} as Record<ReleaseStageId, number>;
    for (const id of STAGE_ORDER) z[id] = 0;
    return z;
  }
  if (s <= 0) return distributeHoursFromWeights(total);
  const factor = total / s;
  const out = {} as Record<ReleaseStageId, number>;
  let sum = 0;
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const id = STAGE_ORDER[i];
    out[id] = Math.max(0, Math.round(hours[id] * factor));
    sum += out[id];
  }
  const last = STAGE_ORDER[STAGE_ORDER.length - 1];
  out[last] = Math.max(0, total - sum);
  return out;
}

function buildInitialDraft(d: KanbanAnalyticsEpicDetail): DraftV1 {
  const meta = d.epic.local_meta;
  const total = meta?.qa_estimate_hours != null && Number.isFinite(Number(meta.qa_estimate_hours)) ? Number(meta.qa_estimate_hours) : 40;
  const qaCount = meta?.qa_member_ids?.length ? meta.qa_member_ids.length : 2;
  return {
    specDraft: "",
    atrText: "",
    qaEstimateHours: total,
    qaCount,
    effectiveHoursPerQaPerDay: DEFAULT_EFFECTIVE_HOURS_PER_QA_PER_DAY,
    testStartDate: todayYmd(),
    demoDate: d.epic.deadline ? ymdFromIsoOrDate(d.epic.deadline) : null,
    freezeDate: null,
    releaseType: "minor",
    legacy: false,
    newIntegration: false,
    parallelReleasesHigh: false,
    externalDependency: false,
    extraRisksText: "",
    stageHours: distributeHoursFromWeights(total),
  };
}

export function EpicReleasePlanningTab({
  projectSlug,
  kanbanEpicId,
  detail,
}: {
  projectSlug: string;
  kanbanEpicId: number;
  detail: KanbanAnalyticsEpicDetail;
}) {
  const resonanceId = detail.epic.local_meta?.resonance_epic_id;
  const resonanceEpic = useEpic(typeof resonanceId === "number" && resonanceId > 0 ? resonanceId : null);
  const appliedResonance = useRef(false);
  const hadStoredDraft = useRef(false);

  const [draft, setDraft] = useState<DraftV1>(() => buildInitialDraft(detail));
  const [hydrated, setHydrated] = useState(false);

  /** Загрузка черновика из localStorage (один раз). */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(projectSlug, kanbanEpicId));
      if (raw) {
        hadStoredDraft.current = true;
        const parsed = JSON.parse(raw) as DraftV1;
        if (parsed && typeof parsed.qaEstimateHours === "number") {
          setDraft({
            ...buildInitialDraft(detail),
            ...parsed,
            stageHours: normalizeStageHours(parsed.stageHours, parsed.qaEstimateHours ?? 0),
          });
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [projectSlug, kanbanEpicId, detail]);

  /** Сохранение черновика. */
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey(projectSlug, kanbanEpicId), JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, hydrated, projectSlug, kanbanEpicId]);

  /** Префилл из связанного эпика Resonance (один раз, если не восстановили черновик из LS). */
  useEffect(() => {
    if (appliedResonance.current || !resonanceEpic.data || hadStoredDraft.current) return;
    const e = resonanceEpic.data;
    appliedResonance.current = true;
    setDraft((prev) => {
      const qh = e.qa_estimate_hours;
      const nextHours = typeof qh === "number" ? qh : prev.qaEstimateHours;
      return {
        ...prev,
        qaEstimateHours: nextHours,
        qaCount: e.qa_member_ids?.length ? e.qa_member_ids.length : prev.qaCount,
        testStartDate: e.start_date ? ymdFromIsoOrDate(e.start_date) : prev.testStartDate,
        demoDate: e.target_date ? ymdFromIsoOrDate(e.target_date) : prev.demoDate,
        specDraft: prev.specDraft.trim().length === 0 ? `Описание требований: ${e.confluence_url}` : prev.specDraft,
        atrText:
          prev.atrText.trim().length === 0 && e.design_url
            ? `Архитектурно-техническое решение или макеты: ${e.design_url}`
            : prev.atrText.trim().length === 0 && e.notes
              ? String(e.notes).slice(0, 2000)
              : prev.atrText,
        extraRisksText:
          prev.extraRisksText.trim().length === 0 && e.qa_block?.risks ? String(e.qa_block.risks) : prev.extraRisksText,
        stageHours: typeof qh === "number" ? distributeHoursFromWeights(qh) : prev.stageHours,
      };
    });
  }, [resonanceEpic.data]);

  const plannerInput: ReleasePlannerInput = useMemo(
    () => ({
      ...draft,
      demoDate: draft.demoDate?.trim() ? draft.demoDate.trim() : null,
      freezeDate: draft.freezeDate?.trim() ? draft.freezeDate.trim() : null,
      stageHours: normalizeStageHours(draft.stageHours, draft.qaEstimateHours),
    }),
    [draft],
  );

  const result = useMemo(() => planRelease(plannerInput), [plannerInput]);

  const updateDraft = useCallback(<K extends keyof DraftV1>(key: K, value: DraftV1[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onTotalHoursChange = (v: number) => {
    const next = Math.max(0, v);
    setDraft((prev) => ({
      ...prev,
      qaEstimateHours: next,
      stageHours: distributeHoursFromWeights(next),
    }));
  };

  const onStageHourChange = (id: ReleaseStageId, v: number) => {
    setDraft((prev) => {
      const sh = normalizeStageHours(prev.stageHours, prev.qaEstimateHours);
      sh[id] = Math.max(0, v);
      return { ...prev, stageHours: sh };
    });
  };

  const alignStagesToTotal = () => {
    setDraft((prev) => {
      const sh = normalizeStageHours(prev.stageHours, prev.qaEstimateHours);
      return { ...prev, stageHours: scaleStagesToMatchTotal(sh, prev.qaEstimateHours) };
    });
  };

  const sumStage = STAGE_ORDER.reduce((a, id) => a + plannerInput.stageHours[id], 0);
  const hoursMismatch = Math.abs(sumStage - plannerInput.qaEstimateHours) > 0.01;

  const today = todayYmd();
  const flowStart = plannerInput.testStartDate;
  const flowEnd = result.realisticEndDate ?? result.minimalEndDate;

  return (
    <div className="space-y-4">
      {resonanceEpic.isError ? (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Не удалось подтянуть эпик Resonance для префилла (можно продолжать вручную).
        </div>
      ) : null}

      {/* Explanation-first */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground">Объяснение прогноза</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{result.narratives.lead}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-foreground list-disc pl-5">
          {[...result.narratives.durationBullets, ...result.narratives.longestPhaseBullets].map((t, i) => (
            <li key={`d-${i}`}>{t}</li>
          ))}
        </ul>
        <div className="mt-4 grid gap-4 @md/kanban-epic-detail:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Риск срыва сроков</h3>
            <ul className="mt-1.5 space-y-1 text-sm list-disc pl-5 text-muted-foreground">
              {result.narratives.riskBullets.map((t, i) => (
                <li key={`r-${i}`}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Насколько прогнозу можно доверять</h3>
            <ul className="mt-1.5 space-y-1 text-sm list-disc pl-5 text-muted-foreground">
              {result.narratives.confidenceBullets.map((t, i) => (
                <li key={`c-${i}`}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground list-disc pl-5">
          {result.narratives.capacityBullets.map((t, i) => (
            <li key={`cap-${i}`}>{t}</li>
          ))}
        </ul>
      </div>

      {/* Summary cards */}
      <div className="grid gap-2 @sm/kanban-epic-detail:grid-cols-2 @lg/kanban-epic-detail:grid-cols-3">
        <MetricCard title="Оценка тестирования, ч" value={`${plannerInput.qaEstimateHours} ч`} hint="Сумма часов по этапам должна совпадать с этой оценкой" />
        <MetricCard
          title="Мощность команды, ч/день"
          value={`${result.capacityPerDay.toFixed(1)} ч`}
          hint={`${plannerInput.qaCount} человек(а) × ${plannerInput.effectiveHoursPerQaPerDay} эффективных ч/день`}
        />
        <MetricCard title="Минимальный срок" value={`${result.minimalWorkDays} раб. дн.`} hint={result.minimalEndDate ? `ориентир до ${result.minimalEndDate}` : "—"} />
        <MetricCard title="Реалистичный срок" value={`${result.realisticWorkDays} раб. дн.`} hint={result.realisticEndDate ? `ориентир до ${result.realisticEndDate}` : "—"} />
        <MetricCard title="Укладываемся в демо" value={result.demoFitLabel} hint={plannerInput.demoDate ? `Дата демонстрации: ${plannerInput.demoDate}` : ""} />
        <MetricCard
          title="Риск и достоверность"
          value={
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                риск: {riskLevelRu(result.riskLevel)}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                достоверность: {confidenceRu(result.confidence)}
              </Badge>
            </span>
          }
          hint={result.longestPhase ? `Самая длинная фаза: ${result.longestPhase.label}` : ""}
        />
      </div>

      {result.warnings.length > 0 ? (
        <div className="space-y-2">
          {result.warnings.map((w) => (
            <div
              key={w.code}
              className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${
                w.severity === "error" ? "border-destructive/50 bg-destructive/10" : "border-amber-500/40 bg-amber-500/10"
              }`}
            >
              {w.severity === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /> : <Info className="h-4 w-4 shrink-0 text-amber-600" />}
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {hoursMismatch ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <span>Сумма часов по этапам ({sumStage.toFixed(0)}) не совпадает с оценкой тестирования ({plannerInput.qaEstimateHours}).</span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted/50"
            onClick={alignStagesToTotal}
          >
            Выровнять пропорционально
          </button>
        </div>
      ) : null}

      {/* Form */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Входные данные</h2>
        <div className="grid gap-4 @md/kanban-epic-detail:grid-cols-2">
          <div className="space-y-2 @md/kanban-epic-detail:col-span-2">
            <Label className="text-xs">Постановка и требования</Label>
            <Textarea value={draft.specDraft} onChange={(e) => updateDraft("specDraft", e.target.value)} rows={3} className="text-sm min-h-[72px]" />
          </div>
          <div className="space-y-2 @md/kanban-epic-detail:col-span-2">
            <Label className="text-xs">Архитектурно-техническое решение</Label>
            <Textarea value={draft.atrText} onChange={(e) => updateDraft("atrText", e.target.value)} rows={3} className="text-sm min-h-[72px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Оценка тестирования, часы</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={draft.qaEstimateHours}
              onChange={(e) => onTotalHoursChange(Number(e.target.value))}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Число тестировщиков</Label>
            <Input type="number" min={0} step={1} value={draft.qaCount} onChange={(e) => updateDraft("qaCount", Number(e.target.value))} className="text-sm" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Эффективных часов в день на одного тестировщика</Label>
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={draft.effectiveHoursPerQaPerDay}
              onChange={(e) => updateDraft("effectiveHoursPerQaPerDay", Number(e.target.value))}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Тип релиза</Label>
            <Select value={draft.releaseType} onValueChange={(v) => updateDraft("releaseType", v as ReleaseType)}>
              <SelectTrigger className="h-9 w-full text-sm">
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RELEASE_TYPE_LABELS) as ReleaseType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {RELEASE_TYPE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Старт тестирования</Label>
            <Input
              type="date"
              value={draft.testStartDate}
              onChange={(e) => updateDraft("testStartDate", e.target.value)}
              className={cn("text-sm", planningDateInputClassName)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Дата демонстрации</Label>
            <Input
              type="date"
              value={draft.demoDate ?? ""}
              onChange={(e) => updateDraft("demoDate", e.target.value || null)}
              className={cn("text-sm", planningDateInputClassName)}
            />
          </div>
          <div className="space-y-2 @md/kanban-epic-detail:col-span-2">
            <Label className="text-xs">Дата заморозки изменений (по желанию)</Label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Заморозка — день, с которого в релиз обычно не принимают новые задачи и не расширяют объём без пересогласования сроков. Поле
              используется, чтобы проверить: не попадает ли заморозка после начала регрессии и достаточно ли рабочих дней между окончанием
              регрессии и демонстрацией.
            </p>
            <Input
              type="date"
              value={draft.freezeDate ?? ""}
              onChange={(e) => updateDraft("freezeDate", e.target.value || null)}
              className={cn("text-sm", planningDateInputClassName)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-6 @md/kanban-epic-detail:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.legacy} onCheckedChange={(c) => updateDraft("legacy", c)} />
              Унаследованные системы
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.newIntegration} onCheckedChange={(c) => updateDraft("newIntegration", c)} />
              Новая интеграция
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.parallelReleasesHigh} onCheckedChange={(c) => updateDraft("parallelReleasesHigh", c)} />
              Параллельные релизы
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.externalDependency} onCheckedChange={(c) => updateDraft("externalDependency", c)} />
              Внешние зависимости
            </label>
          </div>
          <div className="space-y-2 @md/kanban-epic-detail:col-span-2">
            <Label className="text-xs">Дополнительные риски</Label>
            <Textarea value={draft.extraRisksText} onChange={(e) => updateDraft("extraRisksText", e.target.value)} rows={2} className="text-sm" />
          </div>
        </div>
      </div>

      {/* Distribution */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Распределение часов по этапам</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Доля в процентах считается автоматически: часы этапа к суммарной оценке тестирования. Этап «Документация» в календарном прогнозе от даты старта тестирования не учитывается (готовится до тестов). На контурах тестирования, предпродакшена,
          продакшена и демонстрации при ненулевых часах заложено не менее одного рабочего дня на площадку.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Этап</th>
                <th className="py-2 pr-2 font-medium">Часы</th>
                <th className="py-2 font-medium">Доля, %</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((id) => {
                const row = result.stageRows.find((r) => r.id === id)!;
                return (
                  <tr key={id} className="border-b border-border/60">
                    <td className="py-2 pr-2">{STAGE_LABELS[id]}</td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="h-8 w-24 text-xs"
                        value={plannerInput.stageHours[id]}
                        onChange={(e) => onStageHourChange(id, Number(e.target.value))}
                      />
                    </td>
                    <td className="py-2 tabular-nums text-muted-foreground">{row.percent != null ? `${row.percent}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk buffers */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Рисковые буферы, рабочие дни</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Правило</th>
              <th className="py-2 pr-2 font-medium">Вкл.</th>
              <th className="py-2 text-right font-medium">Дни</th>
            </tr>
          </thead>
          <tbody>
            {result.riskBufferRows.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="py-2 pr-2">{r.label}</td>
                <td className="py-2 pr-2 text-muted-foreground">{r.active ? "да" : "нет"}</td>
                <td className="py-2 text-right tabular-nums">{r.active ? `+${r.days}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Projected flow */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground mb-1">Прогноз по этапам релиза</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Последовательные рабочие дни по этапам; на полосе отмечены сегодняшний день и дата демонстрации.
        </p>
        {result.timelineSegments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Задайте дату старта и ненулевые часы по этапам.</p>
        ) : (
          <div className="space-y-4">
            <div className="relative pt-6">
              <div className="flex h-9 w-full overflow-hidden rounded-md border border-border bg-muted/30">
                {result.timelineSegments.map((seg) => {
                  const wd = result.stageRows.find((r) => r.id === seg.stageId)?.workDays ?? 1;
                  return (
                    <div
                      key={seg.stageId}
                      className="flex min-w-[2rem] items-center justify-center border-r border-border/60 bg-primary/15 px-1 text-[10px] font-medium text-foreground last:border-r-0"
                      style={{ flex: Math.max(1, wd) }}
                      title={`${seg.label}: ${seg.startDate} — ${seg.endDate}`}
                    >
                      <span className="truncate">{seg.label}</span>
                    </div>
                  );
                })}
                {result.riskBufferSpan ? (
                  <div
                    className="flex min-w-[2rem] items-center justify-center border-l border-dashed border-amber-500/50 bg-amber-500/10 px-1 text-[10px] text-amber-900 dark:text-amber-200"
                    style={{ flex: Math.max(1, result.riskBufferTotal) }}
                    title={`Буфер: ${result.riskBufferSpan.startDate} — ${result.riskBufferSpan.endDate}`}
                  >
                    Буфер
                  </div>
                ) : null}
              </div>
              {flowStart && flowEnd ? (
                <FlowMarkers today={today} demo={plannerInput.demoDate || null} flowStart={flowStart} flowEnd={flowEnd} segments={result.timelineSegments} bufferEnd={result.riskBufferSpan?.endDate ?? null} />
              ) : null}
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              {result.timelineSegments.map((s) => (
                <li key={s.stageId}>
                  <span className="font-medium text-foreground">{s.label}</span>: {s.startDate} — {s.endDate}
                </li>
              ))}
              {result.riskBufferSpan ? (
                <li>
                  <span className="font-medium text-foreground">Рисковый буфер</span>: {result.riskBufferSpan.startDate} — {result.riskBufferSpan.endDate}
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>

      {/* Assumptions */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Допущения (задач ещё нет)</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <AssumptionRow
            title="Серверная часть и зависимости готовы к старту тестирования"
            severity="warn"
            impact="Иначе сдвигается весь прогноз по календарю."
          />
          <AssumptionRow
            title="Даты заморозки и демонстрации согласованы с заинтересованными сторонами"
            severity="warn"
            impact="Предупреждения выше проверяют согласованность календаря."
          />
          <AssumptionRow
            title="Объём работ после оценки не растёт"
            severity="high"
            impact="Любое расширение объёма требует новой оценки и новых сроков."
          />
          <AssumptionRow
            title="Предпродакшен-стенд стабилен"
            severity="medium"
            impact="Нестабильный стенд на практике удлиняет регрессию и выкладку, но в числа это не закладывается автоматически."
          />
        </ul>
      </div>
    </div>
  );
}

function AssumptionRow({ title, severity, impact }: { title: string; severity: "warn" | "medium" | "high"; impact: string }) {
  const badge =
    severity === "high" ? (
      <Badge variant="destructive" className="text-[10px]">
        сильно
      </Badge>
    ) : severity === "warn" ? (
      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-300">
        внимание
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-[10px]">
        умеренно
      </Badge>
    );
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <span className="text-foreground">{title}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{impact}</p>
    </li>
  );
}

function MetricCard({ title, value, hint }: { title: string; value: ReactNode; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug">{hint}</div> : null}
    </div>
  );
}

function FlowMarkers({
  today,
  demo,
  flowStart,
  flowEnd,
  segments,
  bufferEnd,
}: {
  today: string;
  demo: string | null;
  flowStart: string;
  flowEnd: string;
  segments: { startDate: string; endDate: string; label: string }[];
  bufferEnd: string | null;
}) {
  const end = bufferEnd && bufferEnd > flowEnd ? bufferEnd : flowEnd;
  const spanMs = (a: string, b: string) => {
    const t0 = parseISO(`${a}T12:00:00Z`).getTime();
    const t1 = parseISO(`${b}T12:00:00Z`).getTime();
    return Math.max(1, t1 - t0);
  };
  const total = spanMs(flowStart, end);

  const pct = (d: string) => {
    const t = parseISO(`${d}T12:00:00Z`).getTime();
    const t0 = parseISO(`${flowStart}T12:00:00Z`).getTime();
    return Math.min(100, Math.max(0, ((t - t0) / total) * 100));
  };

  const showToday = today >= flowStart && today <= end;
  const showDemo = demo && demo >= flowStart;

  return (
    <>
      {showToday ? (
        <div className="pointer-events-none absolute top-0 h-full w-px bg-sky-500/80" style={{ left: `${pct(today)}%` }} title={`Сегодня: ${today}`} />
      ) : null}
      {showDemo ? (
        <div className="pointer-events-none absolute top-0 h-full w-px bg-violet-500/80" style={{ left: `${pct(demo!)}%` }} title={`Демо: ${demo}`} />
      ) : null}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{flowStart}</span>
        <span>{segments[0]?.label ?? ""}</span>
        <span>{end}</span>
      </div>
    </>
  );
}
