/** Последняя позиция указателя в окне — для анимации диалогов относительно курсора. */

let lastX = typeof window !== "undefined" ? window.innerWidth / 2 : 0;
let lastY = typeof window !== "undefined" ? window.innerHeight / 2 : 0;

let trackingInstalled = false;

export function ensureLastPointerTracking(): void {
  if (trackingInstalled || typeof window === "undefined") return;
  trackingInstalled = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
    },
    { passive: true },
  );
}

export function getLastPointerPosition(): { x: number; y: number } {
  return { x: lastX, y: lastY };
}

/** Смещение стартовой позиции модалки (в px): от центра экрана в сторону курсора. */
export function computeDialogEnterOffset(clientX: number, clientY: number): { enterX: number; enterY: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1;
  const cx = clientX - vw / 2;
  const cy = clientY - vh / 2;
  const mag = Math.hypot(cx, cy) || 1;
  const strength = Math.min(vw, vh) * 0.26;
  return {
    enterX: (cx / mag) * strength,
    enterY: (cy / mag) * strength,
  };
}
