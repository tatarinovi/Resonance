import { DEFAULT_STAGE_WEIGHTS, STAGE_ORDER } from "./config";
import type { ReleaseStageId } from "./types";

/** Распределить total часов по этапам по весам (целые часы; остаток от floor раздаётся round-robin с Test). */
export function distributeHoursFromWeights(totalHours: number): Record<ReleaseStageId, number> {
  const out = {} as Record<ReleaseStageId, number>;
  if (totalHours <= 0) {
    for (const id of STAGE_ORDER) out[id] = 0;
    return out;
  }
  let assigned = 0;
  for (const id of STAGE_ORDER) {
    const v = Math.floor(totalHours * DEFAULT_STAGE_WEIGHTS[id]);
    out[id] = v;
    assigned += v;
  }
  let rem = totalHours - assigned;
  let idx = STAGE_ORDER.indexOf("test");
  while (rem > 0) {
    out[STAGE_ORDER[idx]] += 1;
    rem -= 1;
    idx = (idx + 1) % STAGE_ORDER.length;
  }
  return out;
}
