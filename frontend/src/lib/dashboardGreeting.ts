/** Local calendar date YYYY-MM-DD for greeting stability (same phrase within a time-of-day bucket for that day). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DashboardDayBucket = "morning" | "day" | "evening" | "night";

/** Buckets match plan: morning 5–11:59, day 12–16:59, evening 17–22:59, night 23–4:59. */
export function dashboardHourBucket(hour: number): DashboardDayBucket {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "day";
  if (hour >= 17 && hour < 23) return "evening";
  return "night";
}

function hashString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const PLACEHOLDER = "{username}";

const MORNING: readonly string[] = [
  `Доброе утро, ${PLACEHOLDER}`,
  `С добрым утром, ${PLACEHOLDER}`,
  `Утро доброе, ${PLACEHOLDER}`,
  `Хорошего дня, ${PLACEHOLDER}`,
  `Продуктивного дня, ${PLACEHOLDER}`,
  `Удачного дня, ${PLACEHOLDER}`,
  `Рады видеть вас с утра, ${PLACEHOLDER}`,
  `Начинаем день — здравствуйте, ${PLACEHOLDER}`,
];

const DAY: readonly string[] = [
  `Добрый день, ${PLACEHOLDER}`,
  `Здравствуйте, ${PLACEHOLDER}`,
  `Привет, ${PLACEHOLDER}`,
  `Рады вас видеть, ${PLACEHOLDER}`,
  `С возвращением, ${PLACEHOLDER}`,
  `Хорошей работы, ${PLACEHOLDER}`,
  `Приятной работы, ${PLACEHOLDER}`,
];

const EVENING: readonly string[] = [
  `Добрый вечер, ${PLACEHOLDER}`,
  `Вечер добрый, ${PLACEHOLDER}`,
  `Здравствуйте, ${PLACEHOLDER}`,
  `Приятного вечера, ${PLACEHOLDER}`,
  `Хорошего вечера, ${PLACEHOLDER}`,
  `Рады видеть вас, ${PLACEHOLDER}`,
  `Удачного завершения дня, ${PLACEHOLDER}`,
];

const NIGHT: readonly string[] = [
  `Здравствуйте, ${PLACEHOLDER}`,
  `Доброй ночи, ${PLACEHOLDER}`,
  `Рады видеть вас, ${PLACEHOLDER}`,
  `Спокойной работы, ${PLACEHOLDER}`,
  `Поздний визит — здравствуйте, ${PLACEHOLDER}`,
];

const ANYTIME: readonly string[] = [
  `С возвращением в Resonance, ${PLACEHOLDER}`,
  `Рады снова видеть вас, ${PLACEHOLDER}`,
];

const BY_BUCKET: Record<DashboardDayBucket, readonly string[]> = {
  morning: MORNING,
  day: DAY,
  evening: EVENING,
  night: NIGHT,
};

/** ~12% of days/buckets pick the shared pool (deterministic per user+date+bucket). */
const GENERAL_POOL_WEIGHT = 12;

function displayName(username: string): string {
  const t = username.trim();
  if (!t || t === "Guest") return "Гость";
  return t;
}

/**
 * Personalized dashboard line in Russian; stable for the same username, local date, and time-of-day bucket.
 */
export function getDashboardGreeting(username: string, now: Date = new Date()): string {
  const name = displayName(username);
  const bucket = dashboardHourBucket(now.getHours());
  const dateKey = localDateKey(now);
  const baseSeed = `${username}|${dateKey}|${bucket}`;
  const primary = hashString(baseSeed);
  const useGeneral = primary % 100 < GENERAL_POOL_WEIGHT;
  const pool = useGeneral ? ANYTIME : BY_BUCKET[bucket];
  const idx = hashString(`${baseSeed}|${useGeneral ? "g" : "t"}`) % pool.length;
  return pool[idx].replaceAll(PLACEHOLDER, name);
}
